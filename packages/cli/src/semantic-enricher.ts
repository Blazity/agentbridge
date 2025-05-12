import { z } from "zod";
import { ModelIntegration } from "./model-integration";
import { EnhancedEndpoint } from "./enhanced-interim";
import { NormalizedEndpoint } from "./normalized-interim";
import { logger } from "./logger";
import { objectToXML } from "./xml-formatter";
import { outro } from "@clack/prompts";

const EndpointEnhancementSchema = z.object({
  enhancedDescription: z
    .string()
    .min(10)
    .describe(
      "Clear, detailed explanation of what the endpoint does, its primary functionality, and key use cases",
    ),
  purpose: z
    .string()
    .min(5)
    .describe(
      "Concise statement of the endpoint's primary purpose or goal in a business context",
    ),
  operationType: z
    .string()
    .describe(
      "Category of operation (e.g., CREATE, READ, UPDATE, DELETE, LIST, SEARCH, etc.)",
    ),
  resourceType: z
    .string()
    .describe(
      "Type of resource being manipulated (e.g., User, Product, Order)",
    ),
});

const ParameterEnhancementSchema = z.object({
  name: z
    .string()
    .describe("Parameter name as defined in the API specification"),
  enhancedDescription: z
    .string()
    .min(10)
    .describe(
      "Detailed explanation of the parameter's purpose, expected format, and impact on the operation",
    ),
  importance: z
    .enum(["critical", "important", "optional"])
    .describe(
      "Classification of parameter importance: critical (required), important (recommended), or optional",
    ),
  commonValues: z
    .array(z.any())
    .optional()
    .describe("Examples of typical values for this parameter"),
});

const ParametersArraySchema = z.object({
  result: z
    .array(ParameterEnhancementSchema)
    .describe("Array of enhanced parameter descriptions"),
});

const ResponseEnhancementSchema = z.object({
  statusCode: z.string().describe("HTTP status code for this response"),
  enhancedDescription: z
    .string()
    .min(10)
    .describe(
      "Detailed explanation of what this response indicates about the request's outcome",
    ),
  resolutionSteps: z
    .array(z.string())
    .optional()
    .describe("For error responses, steps that could resolve the issue"),
});

// Wrap array schema in an object with result property
const ResponsesArraySchema = z.object({
  result: z
    .array(ResponseEnhancementSchema)
    .describe("Array of enhanced response descriptions"),
});

/**
 * Uses LLM to enhance API descriptions with semantic context
 */
export class SemanticEnricher {
  private modelIntegration: ModelIntegration;
  private readonly DEFAULT_CONCURRENCY = 3; // Default concurrency for parallel processing

  constructor(modelIntegration: ModelIntegration) {
    this.modelIntegration = modelIntegration;
  }

  async enhanceEndpoints(
    endpoints: NormalizedEndpoint[],
    concurrency: number = this.DEFAULT_CONCURRENCY,
  ): Promise<EnhancedEndpoint[]> {
    const totalEndpoints = endpoints.length;

    // Update spinner with initial information
    logger.updateSpinner(
      `Enhancing ${totalEndpoints} endpoints${concurrency > 1 ? ` with concurrency ${concurrency}` : ""}`,
    );

    // Process endpoints with specified concurrency
    const enhancedEndpoints = await this.processEndpointsWithConcurrency(
      endpoints,
      concurrency,
    );

    logger.stopSpinner(`Successfully enhanced ${totalEndpoints} endpoints`);
    return enhancedEndpoints;
  }

  /**
   * Process endpoints with controlled concurrency
   */
  private async processEndpointsWithConcurrency(
    endpoints: NormalizedEndpoint[],
    concurrency: number,
  ): Promise<EnhancedEndpoint[]> {
    // Create a queue for processing endpoints with limited concurrency
    const results: EnhancedEndpoint[] = [];
    const queue = [...endpoints];
    const processingPromises: Promise<void>[] = [];
    const totalEndpoints = endpoints.length;

    // Track which endpoints are currently being processed
    const inProgress = new Set<number>();
    let completed = 0;

    const updateProgressSpinner = () => {
      if (concurrency === 1) {
        // For single-concurrency mode, no change needed (handled in the queue processing)
        return;
      }

      if (logger.isVerbose()) {
        // In verbose mode, we show detailed info in the queue processing
        return;
      }

      // For parallel mode with normal logging, show ranges of endpoints being processed
      const inProgressArray = Array.from(inProgress).sort((a, b) => a - b);
      const ranges: string[] = [];

      if (inProgressArray.length > 0) {
        let rangeStart = inProgressArray[0];
        let rangeEnd = rangeStart;

        for (let i = 1; i < inProgressArray.length; i++) {
          if (inProgressArray[i] === rangeEnd + 1) {
            // Extend the current range
            rangeEnd = inProgressArray[i];
          } else {
            // End the current range and start a new one
            if (rangeStart === rangeEnd) {
              ranges.push(`${rangeStart + 1}`);
            } else {
              ranges.push(`${rangeStart + 1}-${rangeEnd + 1}`);
            }
            rangeStart = inProgressArray[i];
            rangeEnd = rangeStart;
          }
        }

        // Add the last range
        if (rangeStart === rangeEnd) {
          ranges.push(`${rangeStart + 1}`);
        } else {
          ranges.push(`${rangeStart + 1}-${rangeEnd + 1}`);
        }
      }

      const inProgressText =
        ranges.length > 0 ? `Processing endpoints ${ranges.join(", ")}` : "";

      logger.updateSpinner(
        `Enhancing endpoints: ${completed}/${totalEndpoints} complete${inProgressText ? ` (${inProgressText})` : ""}`,
      );
    };

    // Process the queue with controlled concurrency
    const processQueue = async () => {
      while (queue.length > 0) {
        const endpoint = queue.shift();
        if (!endpoint) continue;

        const currentIndex = endpoints.indexOf(endpoint);
        inProgress.add(currentIndex);
        updateProgressSpinner();

        // For single-concurrency mode, update spinner with detailed endpoint info
        if (concurrency === 1) {
          logger.updateSpinner(
            `Enhancing endpoint: ${endpoint.method} ${endpoint.path} (${currentIndex + 1}/${endpoints.length})`,
          );
        } else if (logger.isVerbose()) {
          // In verbose mode, still show detailed endpoint info
          logger.updateSpinner(
            `Enhancing endpoint: ${endpoint.method} ${endpoint.path} (${currentIndex + 1}/${endpoints.length})`,
          );
        }

        try {
          // Process the endpoint
          const enhancedEndpoint = await this.enhanceEndpoint(endpoint);
          results.push(enhancedEndpoint);

          // Update progress tracking
          inProgress.delete(currentIndex);
          completed++;
          updateProgressSpinner();
        } catch (error) {
          logger.error(
            `Error enhancing endpoint ${endpoint.method} ${endpoint.path}:\n${error instanceof Error ? error.message : String(error)}`,
          );
          // Update progress tracking even on error
          inProgress.delete(currentIndex);
          completed++;
          updateProgressSpinner();
        }
      }
    };

    // Start concurrent processing based on concurrency limit
    for (let i = 0; i < Math.min(concurrency, endpoints.length); i++) {
      processingPromises.push(processQueue());
    }

    // Wait for all processing to complete
    await Promise.all(processingPromises);

    return results;
  }

  /**
   * Enhance a single endpoint with semantic information
   */
  private async enhanceEndpoint(
    endpoint: NormalizedEndpoint,
  ): Promise<EnhancedEndpoint> {
    try {
      // We no longer need to log each endpoint here as we're showing it in the spinner
      const baseMessage = `Enhancing endpoint: ${endpoint.method} ${endpoint.path}`;

      // 1. Enhance the endpoint description
      if (logger.isVerbose()) {
        logger.updateSpinner(`${baseMessage} - enriching description...`);
      }
      const enhancedInfo = await this.enhanceEndpointDescription(endpoint);

      // 2. Enhance parameters
      if (logger.isVerbose()) {
        logger.updateSpinner(`${baseMessage} - enriching parameters...`);
      }
      const enhancedParameters = await this.enhanceParameters(endpoint);

      // 3. Enhance responses
      if (logger.isVerbose()) {
        logger.updateSpinner(`${baseMessage} - enriching responses...`);
      }
      const enhancedResponses = await this.enhanceResponses(
        endpoint,
        enhancedInfo.purpose,
      );

      // Create the enhanced endpoint
      return {
        ...endpoint,
        enhancedDescription: enhancedInfo.enhancedDescription,
        purpose: enhancedInfo.purpose,
        resourceType: enhancedInfo.resourceType,
        operationType: enhancedInfo.operationType,
        relatedEndpoints: [], // This will be filled in by the ActionAnalyzer
        potentialFlowSteps: {
          asFirst: false,
          asMiddle: false,
          asLast: false,
        }, // Also filled in by the ActionAnalyzer
        enhancedParameters,
        enhancedResponses,
      };
    } catch (error) {
      logger.error(
        `Error enhancing endpoint ${endpoint.method} ${endpoint.path}:\n${error instanceof Error ? error.message : String(error)}`,
      );
      outro("Encountered unexpected error while processing OpenAPI spec");
      process.exit(1);
    }
  }

  /**
   * Enhance an endpoint's description using the LLM
   */
  private async enhanceEndpointDescription(endpoint: NormalizedEndpoint) {
    return this.modelIntegration.generateObject(EndpointEnhancementSchema, {
      useSmart: false, // Use the light model for documentation
      estimatedInputTokens: 1200, // Provide token estimate for rate limiting
      estimatedOutputTokens: 400,
      messages: [
        {
          role: "system",
          content: `You are an expert API documentation architect who specializes in creating clear, comprehensive, and AI-friendly API descriptions.

## Documentation Framework
When analyzing an API endpoint, consider these key aspects:

1. CORE FUNCTIONALITY
   - What specific operation does this endpoint perform?
   - What resource(s) does it manipulate or access?
   - What is the business or technical purpose it serves?

2. CONTEXTUAL SIGNIFICANCE
   - Where does this endpoint fit in typical workflows?
   - What user needs or business processes does it support?
   - What problems does it solve for API consumers?

3. TECHNICAL CLASSIFICATION
   - What standard operation category does it represent? (CREATE, READ, UPDATE, DELETE, LIST, SEARCH, etc.)
   - What resource type is being manipulated?
   - What access pattern does it implement? (collection vs. instance, etc.)

## Analysis Method
First, study the path structure to identify the resource:
- /users → User resource
- /products/{id}/reviews → Review resource (child of Product)

Then, map the HTTP method to standard operations:
- GET /resources → LIST operation
- GET /resources/{id} → READ operation
- POST /resources → CREATE operation
- PUT/PATCH /resources/{id} → UPDATE operation
- DELETE /resources/{id} → DELETE operation

## Output Format
Provide your analysis in XML format:
<enhanced_documentation>
  <enhanced_description>Detailed explanation of what the endpoint does, including key functionality and context.</enhanced_description>
  <purpose>Concise business-focused statement of endpoint's goal</purpose>
  <operation_type>Standardized operation category (CREATE, READ, UPDATE, DELETE, LIST, SEARCH, etc.)</operation_type>
  <resource_type>Primary resource being manipulated</resource_type>
  <analysis>Your step-by-step reasoning about this endpoint</analysis>
</enhanced_documentation>

Focus on clarity, precision, and developer usability. Developers should immediately understand what the endpoint does and how to use it effectively.`,
          experimental_providerMetadata: {
            anthropic: {
              cacheControl: { type: "ephemeral" },
            },
          },
        },
        {
          role: "user",
          content: `Here is the endpoint information:
Path: ${endpoint.path}
Method: ${endpoint.method}
Current Summary: ${endpoint.summary || "No summary provided"}
Current Description: ${endpoint.description || "No description provided"}
Parameters: ${objectToXML({
            parameters: {
              parameter: endpoint.parameters.map(param => ({
                n: param.name,
                description: param.description ?? "",
                required: param.required ? "true" : "false",
                in: param.in ?? "",
                type: param.schema?.["type"] ?? "string",
              })),
            },
          })}
Response: ${objectToXML(Object.values(endpoint.responses)[0] || {})}

Please analyze this endpoint following these steps:
1. Extract the resource type from the path structure
2. Determine the operation type based on the HTTP method and path pattern
3. Create a comprehensive description that explains what the endpoint does
4. Formulate a concise statement of the endpoint's business purpose
5. Format your response using the XML structure specified in the instructions

Think carefully about what this endpoint achieves in a business context, not just its technical operation.`,
        },
      ],
    });
  }

  /**
   * Enhance the parameters of an endpoint
   */
  private async enhanceParameters(endpoint: NormalizedEndpoint) {
    // If there are no parameters, return an empty array
    if (!endpoint.parameters || endpoint.parameters.length === 0) {
      return [];
    }

    // Format parameters as XML for better LLM understanding
    const parametersXML = objectToXML({
      parameters: {
        parameter: endpoint.parameters.map(param => ({
          n: param.name,
          description: param.description ?? "",
          required: param.required ? "true" : "false",
          in: param.in ?? "",
          type: param.schema?.["type"] ?? "string",
        })),
      },
    });

    try {
      const result = await this.modelIntegration.generateObject(
        ParametersArraySchema,
        {
          useSmart: false, // Use the light model for parameter descriptions
          estimatedInputTokens: 1000, // Provide token estimate for rate limiting
          estimatedOutputTokens: 800,
          messages: [
            {
              role: "system",
              content: `You are an API parameter documentation expert who creates precise, developer-friendly descriptions of API parameters.

## Parameter Analysis Framework
When documenting API parameters, systematically analyze:

1. FUNCTIONAL PURPOSE
   - What specific role does this parameter serve?
   - How does it modify or influence the operation?
   - What options or capabilities does it enable?

2. DATA CHARACTERISTICS
   - What values, formats, or patterns are expected?
   - What are valid ranges, limits or constraints?
   - Are there default values or special cases?

3. USAGE IMPORTANCE
   - How critical is this parameter to the operation's success?
   - What happens if omitted (for optional parameters)?
   - What errors might occur with invalid values?

## Classification Guidance
Categorize each parameter's importance as:
- CRITICAL: Operation fails without it; absolutely required
- IMPORTANT: Significantly impacts results but has defaults
- OPTIONAL: Provides refinement but not essential for basic operation

## Analysis Process
For each parameter:
1. Examine the parameter name, type, and location (path, query, header, body)
2. Review any existing description for clues about usage
3. Consider the endpoint's purpose and how this parameter supports it
4. Determine appropriate importance classification
5. Generate clear, comprehensive description with example values

## Output Format
Provide your enhanced parameter descriptions in XML format:

<enhanced_parameters>
  <parameter>
    <name>parameter_name</name>
    <enhanced_description>Detailed explanation of purpose and expected values</enhanced_description>
    <importance>critical|important|optional</importance>
    <common_values>
      <value>example1</value>
      <value>example2</value>
    </common_values>
    <analysis>Your reasoning about this parameter</analysis>
  </parameter>
  <!-- Additional parameters as needed -->
</enhanced_parameters>

Be precise, thorough, and focus on real-world developer needs. Your documentation should help developers implement the API correctly on the first attempt.`,
              experimental_providerMetadata: {
                anthropic: {
                  cacheControl: { type: "ephemeral" },
                },
              },
            },
            {
              role: "user",
              content: `Endpoint Information:
Path: ${endpoint.path}
Method: ${endpoint.method}
Purpose: ${endpoint.description || "No description provided"}`,
              experimental_providerMetadata: {
                anthropic: {
                  cacheControl: { type: "ephemeral" },
                },
              },
            },
            {
              role: "user",
              content: `Parameters:
${parametersXML}

Please analyze each parameter following these steps:
1. Determine the parameter's purpose based on its name, type, and context
2. Assess its importance to the operation (critical/important/optional)
3. Create a detailed description that explains usage, constraints, and impact
4. Provide realistic example values when possible

Think step-by-step about how each parameter affects the endpoint's operation. If you're unsure about a parameter's exact purpose, make your best educated guess based on common API patterns and the endpoint's context.

Format your response using the XML structure specified in the instructions.`,
            },
          ],
        },
      );

      // Extract the result array from the wrapper object
      const enhancedParams = result.result;

      // Merge the enhanced descriptions with the original parameter info
      return endpoint.parameters.map(param => {
        const enhanced = enhancedParams.find(p => p.name === param.name);
        if (enhanced) {
          return {
            ...param,
            enhancedDescription: enhanced.enhancedDescription,
            importance: enhanced.importance as
              | "critical"
              | "important"
              | "optional",
            commonValues: enhanced.commonValues,
          };
        }

        // Fallback if the parameter wasn't enhanced
        return {
          ...param,
          enhancedDescription: param.description,
          importance: param.required
            ? ("critical" as const)
            : ("optional" as const),
        };
      });
    } catch (error) {
      logger.error(
        `Error enhancing parameters for ${endpoint.path}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      // Return fallback enhanced parameters
      return endpoint.parameters.map(param => ({
        ...param,
        enhancedDescription: param.description,
        importance: param.required
          ? ("critical" as const)
          : ("optional" as const),
      }));
    }
  }

  /**
   * Enhance the responses of an endpoint
   */
  private async enhanceResponses(
    endpoint: NormalizedEndpoint,
    purpose: string,
  ) {
    const enhancedResponses: Record<
      string,
      {
        enhancedDescription: string;
        resolutionSteps?: string[];
      }
    > = {};

    try {
      const responseEntries = Object.entries(endpoint.responses);

      // If there are no responses, return an empty object
      if (responseEntries.length === 0) {
        return enhancedResponses;
      }

      // Format responses as XML for better LLM understanding
      const responsesXML = objectToXML({
        responses: endpoint.responses,
      });

      const result = await this.modelIntegration.generateObject(
        ResponsesArraySchema,
        {
          useSmart: false, // Use the light model for response descriptions
          messages: [
            {
              role: "system",
              content: `You are an API response documentation specialist who creates comprehensive, actionable descriptions of API responses and error handling.

## Response Analysis Framework
When documenting API responses, analyze:

1. SUCCESS SCENARIOS (2xx)
   - What successful outcome does this response represent?
   - What important data is returned to the client?
   - What state changes occur as a result?

2. CLIENT ERROR SCENARIOS (4xx)
   - What specific client mistake triggers this response?
   - What validation rules or requirements were violated?
   - How can developers diagnose and fix the issue?

3. SERVER ERROR SCENARIOS (5xx)
   - What server-side conditions trigger this response?
   - Is it transient or persistent?
   - What recovery strategies are appropriate?

## Documentation Elements
For each response status code, provide:
1. ENHANCED DESCRIPTION - Clear explanation of what the status means in this specific context
2. RESOLUTION STEPS (for errors) - Actionable steps to diagnose and resolve the issue

Focus on practical, developer-centric guidance that helps API consumers handle both success and failure paths properly. Your documentation should serve as a troubleshooting guide for error cases.`,
              experimental_providerMetadata: {
                anthropic: {
                  cacheControl: { type: "ephemeral" },
                },
              },
            },
            {
              role: "user",
              content: `Endpoint Information:
Path: ${endpoint.path}
Method: ${endpoint.method}
Purpose: ${purpose}`,
            },
            {
              role: "user",
              content: `Responses:
${responsesXML}

Please provide enhanced information for each response status code. Be specific about what each status code means in the context of this particular endpoint.`,
            },
          ],
        },
      );

      // Extract the result array from the wrapper object
      const enhancedResponsesArray = result.result;

      // Convert to the expected format
      for (const resp of enhancedResponsesArray) {
        enhancedResponses[resp.statusCode] = {
          enhancedDescription: resp.enhancedDescription,
          resolutionSteps: resp.resolutionSteps,
        };
      }

      return enhancedResponses;
    } catch (error) {
      logger.error(
        `Error enhancing responses for ${endpoint.path}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      // Return fallback enhanced responses
      for (const [statusCode, response] of Object.entries(endpoint.responses)) {
        enhancedResponses[statusCode] = {
          enhancedDescription: response.description,
          resolutionSteps:
            statusCode.startsWith("4") || statusCode.startsWith("5")
              ? ["Verify your request parameters", "Check authentication"]
              : undefined,
        };
      }

      return enhancedResponses;
    }
  }
}
