import { anthropic } from "@ai-sdk/anthropic";
import {
  APICallError,
  CoreMessage,
  generateObject,
  RetryError,
  wrapLanguageModel,
} from "ai";
import { z } from "zod";
import { logger } from "./logger";
import { cacheMiddleware } from "./cache-middleware";
import { sleep } from "./utils";

// Token pricing in dollars per million tokens
const PRICING = {
  "claude-3-7-sonnet-latest": {
    input: 3.0 / 1_000_000, // $3.00 per million input tokens
    output: 15.0 / 1_000_000, // $15.00 per million output tokens
    cacheWrite: 3.75 / 1_000_000, // $3.75 per million tokens for cache creation
    cacheRead: 0.3 / 1_000_000, // $0.30 per million tokens for cache reads
  },
  "claude-3-5-haiku-latest": {
    input: 0.8 / 1_000_000, // $0.80 per million input tokens
    output: 4.0 / 1_000_000, // $4.00 per million output tokens
    cacheWrite: 1.0 / 1_000_000, // $1.00 per million tokens for cache creation
    cacheRead: 0.08 / 1_000_000, // $0.08 per million tokens for cache reads
  },
};

// Max number of retries for rate limit errors
const MAX_RATE_LIMIT_RETRIES = 5;

// Rate limit tracking interface
type RateLimitBudget = {
  requests: {
    limit: number;
    remaining: number;
    resetTime: number; // Unix timestamp
  };
  inputTokens: {
    limit: number;
    remaining: number;
    resetTime: number;
  };
  outputTokens: {
    limit: number;
    remaining: number;
    resetTime: number;
  };
  // Track if we've received real headers from the API
  initialized: boolean;
};

// Response header type
type RateLimitHeaders = {
  "anthropic-ratelimit-requests-limit"?: string;
  "anthropic-ratelimit-requests-remaining"?: string;
  "anthropic-ratelimit-requests-reset"?: string;
  "anthropic-ratelimit-tokens-limit"?: string;
  "anthropic-ratelimit-tokens-remaining"?: string;
  "anthropic-ratelimit-tokens-reset"?: string;
  "anthropic-ratelimit-input-tokens-limit"?: string;
  "anthropic-ratelimit-input-tokens-remaining"?: string;
  "anthropic-ratelimit-input-tokens-reset"?: string;
  "anthropic-ratelimit-output-tokens-limit"?: string;
  "anthropic-ratelimit-output-tokens-remaining"?: string;
  "anthropic-ratelimit-output-tokens-reset"?: string;
  "retry-after"?: string;
  [key: string]: string | undefined;
};

type ModelUsage = {
  promptTokens: number;
  completionTokens: number;
  cost: number;
  cachedRequests?: number;
  liveRequests?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  costWithoutCaching?: number;
  cachingSavings?: number;
  rateLimitRetries?: number;
  preemptiveDelays?: number;
};

type ModelIntegrationOptions = {
  cacheEnabled?: boolean;
  maxRateLimitRetries?: number;
};

/**
 * Handles integration with the AI models
 */
export class ModelIntegration {
  private smartModel;
  private lightModel;
  private usage: ModelUsage = {
    promptTokens: 0,
    completionTokens: 0,
    cost: 0,
    cachedRequests: 0,
    liveRequests: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    costWithoutCaching: 0,
    cachingSavings: 0,
    rateLimitRetries: 0,
    preemptiveDelays: 0,
  };
  private maxRateLimitRetries: number;

  private rateLimitBudgets: Record<string, RateLimitBudget> = {};

  constructor(options: ModelIntegrationOptions) {
    this.maxRateLimitRetries =
      options.maxRateLimitRetries ?? MAX_RATE_LIMIT_RETRIES;

    this.rateLimitBudgets = {
      "claude-3-7-sonnet-latest": this.createUninitializedBudget(),
      "claude-3-5-haiku-latest": this.createUninitializedBudget(),
    };

    const middlewares = options.cacheEnabled ? [cacheMiddleware] : [];

    this.smartModel = wrapLanguageModel({
      model: anthropic("claude-3-7-sonnet-latest"),
      middleware: middlewares,
    });

    this.lightModel = wrapLanguageModel({
      model: anthropic("claude-3-5-haiku-latest"),
      middleware: middlewares,
    });
  }

  /**
   * Creates an uninitialized rate limit budget
   */
  private createUninitializedBudget(): RateLimitBudget {
    const now = Date.now();
    const resetTime = now + 60000;

    return {
      requests: {
        limit: Number.MAX_SAFE_INTEGER,
        remaining: Number.MAX_SAFE_INTEGER,
        resetTime,
      },
      inputTokens: {
        limit: Number.MAX_SAFE_INTEGER,
        remaining: Number.MAX_SAFE_INTEGER,
        resetTime,
      },
      outputTokens: {
        limit: Number.MAX_SAFE_INTEGER,
        remaining: Number.MAX_SAFE_INTEGER,
        resetTime,
      },
      initialized: false,
    };
  }

  /**
   * Get current usage statistics
   */
  getUsage(): ModelUsage {
    return { ...this.usage };
  }

  /**
   * Format and return usage statistics as a string
   */
  reportUsage(): string {
    const usage = this.getUsage();

    return [
      `Total Input Tokens: ${usage.promptTokens.toLocaleString()}`,
      `Total Output Tokens: ${usage.completionTokens.toLocaleString()}`,
      `Requests: ${usage.liveRequests || 0} live, ${usage.cachedRequests || 0} cached`,
      `Total Cost: $${usage.cost.toFixed(4)}`,
    ].join("\n");
  }

  /**
   * Update rate limit budgets from response headers
   */
  private updateRateLimitBudgets(
    modelName: string,
    headers: RateLimitHeaders,
  ): void {
    if (!headers) return;

    const budget =
      this.rateLimitBudgets[modelName] || this.createUninitializedBudget();
    const now = Date.now();

    // Parse reset times from headers
    const parseResetTime = (resetTimeStr: string | undefined): number => {
      if (!resetTimeStr) return now + 60000; // Default to 1 minute if not provided
      try {
        return new Date(resetTimeStr).getTime();
      } catch {
        return now + 60000; // Default to 1 minute on parsing error
      }
    };

    // Update request limits if present in headers
    if (
      headers["anthropic-ratelimit-requests-limit"] &&
      headers["anthropic-ratelimit-requests-remaining"]
    ) {
      budget.requests = {
        limit: parseInt(
          headers["anthropic-ratelimit-requests-limit"] || "50",
          10,
        ),
        remaining: parseInt(
          headers["anthropic-ratelimit-requests-remaining"] || "50",
          10,
        ),
        resetTime: parseResetTime(
          headers["anthropic-ratelimit-requests-reset"],
        ),
      };
    }

    // Update input token limits if present
    if (
      headers["anthropic-ratelimit-input-tokens-limit"] &&
      headers["anthropic-ratelimit-input-tokens-remaining"]
    ) {
      budget.inputTokens = {
        limit: parseInt(
          headers["anthropic-ratelimit-input-tokens-limit"] || "30000",
          10,
        ),
        remaining: parseInt(
          headers["anthropic-ratelimit-input-tokens-remaining"] || "30000",
          10,
        ),
        resetTime: parseResetTime(
          headers["anthropic-ratelimit-input-tokens-reset"],
        ),
      };
    }

    // Update output token limits if present
    if (
      headers["anthropic-ratelimit-output-tokens-limit"] &&
      headers["anthropic-ratelimit-output-tokens-remaining"]
    ) {
      budget.outputTokens = {
        limit: parseInt(
          headers["anthropic-ratelimit-output-tokens-limit"] || "10000",
          10,
        ),
        remaining: parseInt(
          headers["anthropic-ratelimit-output-tokens-remaining"] || "10000",
          10,
        ),
        resetTime: parseResetTime(
          headers["anthropic-ratelimit-output-tokens-reset"],
        ),
      };
    }

    // Mark budget as initialized since we've received real headers
    budget.initialized = true;

    // Save the updated budget
    this.rateLimitBudgets[modelName] = budget;
  }

  /**
   * Check if we need to wait before making a request to avoid hitting rate limits
   * Returns the time to wait in ms, or 0 if no wait is needed
   */
  private checkRateLimitBudget(
    modelName: string,
    estimatedInputTokens = 1000,
    estimatedOutputTokens = 500,
  ): { shouldWait: boolean; waitTimeMs: number; reason: string } {
    const now = Date.now();
    const budget = this.rateLimitBudgets[modelName];

    if (!budget || !budget.initialized) {
      return {
        shouldWait: false,
        waitTimeMs: 0,
        reason: "No rate limit data yet",
      };
    }

    let waitTimeMs = 0;
    let reason = "";

    // Check if any budgets have been reset
    if (budget.requests.resetTime <= now) {
      budget.requests.remaining = budget.requests.limit;
      budget.requests.resetTime = now + 60000; // Reset to 1 minute from now
    }

    if (budget.inputTokens.resetTime <= now) {
      budget.inputTokens.remaining = budget.inputTokens.limit;
      budget.inputTokens.resetTime = now + 60000;
    }

    if (budget.outputTokens.resetTime <= now) {
      budget.outputTokens.remaining = budget.outputTokens.limit;
      budget.outputTokens.resetTime = now + 60000;
    }

    // Only wait if we've completely hit a limit - no safety threshold

    // Check request limit - need at least 1 request
    if (budget.requests.remaining < 1) {
      waitTimeMs = Math.max(waitTimeMs, budget.requests.resetTime - now);
      reason = "Request limit reached";
    }

    // Check input token limit - need at least enough for this request
    if (budget.inputTokens.remaining < estimatedInputTokens) {
      waitTimeMs = Math.max(waitTimeMs, budget.inputTokens.resetTime - now);
      reason = reason
        ? `${reason}, input token limit`
        : "Input token limit reached";
    }

    // Check output token limit - need at least enough for this request
    if (budget.outputTokens.remaining < estimatedOutputTokens) {
      waitTimeMs = Math.max(waitTimeMs, budget.outputTokens.resetTime - now);
      reason = reason
        ? `${reason}, output token limit`
        : "Output token limit reached";
    }

    // Reduce budgets preemptively if we're going to proceed
    if (waitTimeMs === 0) {
      budget.requests.remaining = Math.max(0, budget.requests.remaining - 1);
      budget.inputTokens.remaining = Math.max(
        0,
        budget.inputTokens.remaining - estimatedInputTokens,
      );
      budget.outputTokens.remaining = Math.max(
        0,
        budget.outputTokens.remaining - estimatedOutputTokens,
      );
    }

    return {
      shouldWait: waitTimeMs > 0,
      waitTimeMs: Math.min(waitTimeMs, 60000), // Cap at 1 minute
      reason,
    };
  }

  /**
   * Track usage and update costs
   */
  private updateUsage(
    modelName: string,
    promptTokens: number,
    completionTokens: number,
    fromCache = false,
    cacheCreationTokens?: number,
    cacheReadTokens?: number,
  ): void {
    const pricing = PRICING[modelName as keyof typeof PRICING];

    if (!pricing) {
      logger.warn(`Unknown model: ${modelName}, can't calculate cost`);
      return;
    }

    // Update token counts
    this.usage.promptTokens += promptTokens;
    this.usage.completionTokens += completionTokens;

    // Update request counts
    if (fromCache) {
      this.usage.cachedRequests = (this.usage.cachedRequests || 0) + 1;
    } else {
      this.usage.liveRequests = (this.usage.liveRequests || 0) + 1;
    }

    // Update cache creation and read tokens
    if (cacheCreationTokens) {
      this.usage.cacheCreationTokens =
        (this.usage.cacheCreationTokens || 0) + cacheCreationTokens;
    }
    if (cacheReadTokens) {
      this.usage.cacheReadTokens =
        (this.usage.cacheReadTokens || 0) + cacheReadTokens;
    }

    // Calculate and add cost
    const inputCost = promptTokens * pricing.input;
    const outputCost = completionTokens * pricing.output;
    const cacheWriteCost = cacheCreationTokens
      ? cacheCreationTokens * pricing.cacheWrite
      : 0;
    const cacheReadCost = cacheReadTokens
      ? cacheReadTokens * pricing.cacheRead
      : 0;
    this.usage.cost += inputCost + outputCost + cacheWriteCost + cacheReadCost;

    // Calculate cost without caching
    const costWithoutCaching =
      this.usage.promptTokens * pricing.input +
      this.usage.completionTokens * pricing.output;
    this.usage.costWithoutCaching = costWithoutCaching;

    // Calculate caching savings
    const cachingSavings = costWithoutCaching - this.usage.cost;
    this.usage.cachingSavings = cachingSavings;

    const usageMessage = [
      `💰 Current usage ${fromCache ? "(from cache)" : "(live request)"}`,
      `Input: ${promptTokens.toLocaleString()} tokens ($${inputCost.toFixed(
        4,
      )})`,
      `Output: ${completionTokens.toLocaleString()} tokens ($${outputCost.toFixed(
        4,
      )})`,
      `Cache creation: ${cacheCreationTokens?.toLocaleString()} tokens ($${cacheWriteCost.toFixed(
        4,
      )})`,
      `Cache read: ${cacheReadTokens?.toLocaleString()} tokens ($${cacheReadCost.toFixed(
        4,
      )})`,
      `Total so far: ${this.usage.promptTokens.toLocaleString()} input tokens, ${this.usage.completionTokens.toLocaleString()} output tokens`,
      `Requests: ${this.usage.liveRequests || 0} live, ${
        this.usage.cachedRequests || 0
      } cached, ${this.usage.rateLimitRetries || 0} retries due to rate limits, ${this.usage.preemptiveDelays || 0} preemptive delays`,
      `Total cost so far: $${this.usage.cost.toFixed(4)}`,
      `Cost without caching: $${this.usage.costWithoutCaching.toFixed(4)}`,
      `Caching savings: $${this.usage.cachingSavings.toFixed(4)}`,
    ].join("\n");

    logger.debug(usageMessage);
  }

  /**
   * Handle rate limiting by checking response headers and implementing backoff
   */
  private async handleRateLimit(
    error: APICallError,
    retryAttempt: number,
    modelName: string,
  ): Promise<number> {
    // Increment rate limit retry counter
    this.usage.rateLimitRetries = (this.usage.rateLimitRetries || 0) + 1;

    // Check if we've reached the maximum number of retries
    if (retryAttempt >= this.maxRateLimitRetries) {
      logger.error(
        `Maximum retry attempts (${this.maxRateLimitRetries}) reached for rate limit error.`,
      );
      throw new Error(
        `Rate limit exceeded for ${modelName} after ${retryAttempt} retries. Please try again later or adjust concurrency settings.`,
      );
    }

    // Get retry delay from headers or calculate exponential backoff
    const headers = error.responseHeaders;
    let retryDelaySeconds = 0;

    if (headers && headers["retry-after"]) {
      retryDelaySeconds = parseInt(
        (headers["retry-after"] as string) || "0",
        10,
      );

      const requestsRemaining =
        headers["anthropic-ratelimit-requests-remaining"];
      const tokensRemaining = headers["anthropic-ratelimit-tokens-remaining"];
      const inputTokensRemaining =
        headers["anthropic-ratelimit-input-tokens-remaining"];
      const outputTokensRemaining =
        headers["anthropic-ratelimit-output-tokens-remaining"];

      this.updateRateLimitBudgets(modelName, headers);

      let limitType = "unknown";
      if (requestsRemaining === "0") limitType = "requests per minute";
      else if (inputTokensRemaining === "0")
        limitType = "input tokens per minute";
      else if (outputTokensRemaining === "0")
        limitType = "output tokens per minute";
      else if (tokensRemaining === "0") limitType = "total tokens per minute";

      logger.warn(
        `Rate limit hit: ${limitType} limit reached. Retrying in ${retryDelaySeconds} seconds (attempt ${retryAttempt + 1}/${this.maxRateLimitRetries})`,
      );
    } else {
      // If no retry-after header, use exponential backoff with jitter
      const baseDelay = Math.pow(2, retryAttempt) * 1000; // Exponential backoff
      const jitter = Math.random() * 1000; // Add some randomness
      retryDelaySeconds = Math.min(60, (baseDelay + jitter) / 1000); // Cap at 60 seconds

      logger.warn(
        `Rate limit hit. No retry header found. Using exponential backoff: retrying in ${retryDelaySeconds.toFixed(1)} seconds (attempt ${retryAttempt + 1}/${this.maxRateLimitRetries})`,
      );
    }

    // Add a little extra time to be safe
    retryDelaySeconds += 0.5;

    return retryDelaySeconds * 1000; // Convert to milliseconds
  }

  /**
   * Generate object with AI model
   * 1:1 mapping to the AI SDK's generateObject with added usage tracking and caching
   */
  async generateObject<T>(
    schema: z.ZodType<T>,
    options: {
      prompt?: string;
      messages?: CoreMessage[];
      useSmart?: boolean;
      systemPrompt?: string;
      estimatedInputTokens?: number;
      estimatedOutputTokens?: number;
    } = {},
  ): Promise<T> {
    const {
      useSmart = false,
      systemPrompt,
      prompt,
      messages,
      estimatedInputTokens,
      estimatedOutputTokens,
    } = options;
    const model = useSmart ? this.smartModel : this.lightModel;
    const modelName = useSmart
      ? "claude-3-7-sonnet-latest"
      : "claude-3-5-haiku-latest";

    // Estimate token usage based on input - use more conservative estimates for initial calls
    let estimatedInput = 0;

    if (estimatedInputTokens) {
      // Use explicit estimate if provided
      estimatedInput = estimatedInputTokens;
    } else if (messages) {
      // For message format, estimate 1 token per 3 characters for each message
      estimatedInput = messages.reduce((sum, msg) => {
        const content =
          typeof msg.content === "string"
            ? msg.content
            : JSON.stringify(msg.content);
        return sum + content.length / 3;
      }, 0);
    } else if (prompt) {
      // For prompt format, estimate 1 token per 3 characters
      estimatedInput = prompt.length / 3;
    } else {
      // Default conservative estimate
      estimatedInput = 1000;
    }

    // Add a buffer for system message and encoding overhead
    estimatedInput = Math.ceil(estimatedInput * 1.2);

    // For output tokens, either use explicit estimate or default
    const estimatedOutput = estimatedOutputTokens || 500;

    logger.debug(
      `Using ${modelName} for generation (est. ${Math.round(estimatedInput)} input, ${estimatedOutput} output tokens)...`,
    );

    const params = messages ? { messages } : { prompt, system: systemPrompt };

    let retryAttempt = 0;

    while (true) {
      // Check if we need to wait before making the request to avoid hitting rate limits
      const { shouldWait, waitTimeMs, reason } = this.checkRateLimitBudget(
        modelName,
        Math.ceil(estimatedInput),
        Math.ceil(estimatedOutput),
      );

      if (shouldWait) {
        this.usage.preemptiveDelays = (this.usage.preemptiveDelays || 0) + 1;
        const waitTimeSeconds = waitTimeMs / 1000;

        logger.warn(
          `Preemptively waiting ${waitTimeSeconds.toFixed(1)} seconds to avoid rate limit (${reason})`,
        );
        await sleep(waitTimeMs);
      }

      try {
        const result = await generateObject({
          model,
          schema,
          ...params,
          maxRetries: 1, // We handle retries ourselves for rate limits
        });

        // Update rate limit tracking from response headers
        if (
          result.providerMetadata &&
          result.providerMetadata["anthropic"] &&
          result.providerMetadata["anthropic"]["responseHeaders"]
        ) {
          this.updateRateLimitBudgets(
            modelName,
            result.providerMetadata["anthropic"][
              "responseHeaders"
            ] as RateLimitHeaders,
          );
        }

        // Update usage metrics
        if (result.usage) {
          // Extract cache tokens from providerMetadata if available
          const cacheCreationTokens =
            result.providerMetadata &&
            result.providerMetadata["anthropic"] &&
            typeof result.providerMetadata["anthropic"][
              "cacheCreationInputTokens"
            ] === "number"
              ? result.providerMetadata["anthropic"]["cacheCreationInputTokens"]
              : 0;

          const cacheReadTokens =
            result.providerMetadata &&
            result.providerMetadata["anthropic"] &&
            typeof result.providerMetadata["anthropic"][
              "cacheReadInputTokens"
            ] === "number"
              ? result.providerMetadata["anthropic"]["cacheReadInputTokens"]
              : 0;

          this.updateUsage(
            modelName,
            result.usage.promptTokens || 0,
            result.usage.completionTokens || 0,
            false,
            cacheCreationTokens,
            cacheReadTokens,
          );
        }

        return result.object;
      } catch (error) {
        // Handle rate limit errors
        if (
          error instanceof RetryError &&
          error.lastError instanceof APICallError
        ) {
          const apiError = error.lastError;

          // Check if this is a rate limit error (status code 429)
          if (
            apiError.message.includes("429") ||
            apiError.message.includes("rate limit")
          ) {
            const waitTime = await this.handleRateLimit(
              apiError,
              retryAttempt,
              modelName,
            );
            retryAttempt++;

            // Wait for the calculated time before retrying
            await sleep(waitTime);
            continue; // Retry the request
          }
        }

        // If not a rate limit error or if we couldn't handle it, rethrow
        throw error;
      }
    }
  }
}
