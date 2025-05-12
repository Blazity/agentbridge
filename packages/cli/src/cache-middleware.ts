import {
  type LanguageModelV1,
  type LanguageModelV1Middleware,
  type LanguageModelV1StreamPart,
  simulateReadableStream,
} from "ai";
import Database from "better-sqlite3";
import path from "path";
import os from "os";
import fs from "fs";
import { logger } from "./logger";

class SQLiteCacheManager {
  private db: Database.Database;

  constructor() {
    const cacheDir = path.join(os.tmpdir(), "agentbridge-cli");
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    const dbPath = path.join(cacheDir, "cache.db");
    this.db = new Database(dbPath);
    this.initDatabase();
    logger.debug(`LLM cache initialized at: ${dbPath}`);
  }

  /**
   * Initialize the database schema
   */
  private initDatabase(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS llm_cache (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      )
    `);
  }

  /**
   * Get a value from the cache
   */
  async get(key: string): Promise<unknown> {
    const stmt = this.db.prepare("SELECT value FROM llm_cache WHERE key = ?");
    const row = stmt.get(key) as { value: string } | undefined;

    // Determine if it's a hit or miss
    const result = row ? JSON.parse(row.value) : null;
    const found = result !== null;

    logger.debug(
      `Cache ${found ? "HIT" : "MISS"} for key: ${key.substring(0, 100)}...`,
    );
    return result;
  }

  /**
   * Store a value in the cache
   */
  async set(key: string, value: unknown): Promise<void> {
    const timestamp = Date.now();
    const stmt = this.db.prepare(
      "INSERT OR REPLACE INTO llm_cache (key, value, timestamp) VALUES (?, ?, ?)",
    );
    stmt.run(key, JSON.stringify(value), timestamp);
    logger.debug(`Cached value for key: ${key.substring(0, 100)}...`);
  }

  /**
   * Clear the entire cache
   */
  async clear(): Promise<void> {
    this.db.exec("DELETE FROM llm_cache");
    logger.debug("LLM cache cleared");
  }
}

const cacheManager = new SQLiteCacheManager();

export const cacheMiddleware: LanguageModelV1Middleware = {
  wrapGenerate: async ({ doGenerate, params }) => {
    const cacheKey = JSON.stringify(params);

    logger.debug(`Checking cache for generate request`);

    const cached = (await cacheManager.get(cacheKey)) as Awaited<
      ReturnType<LanguageModelV1["doGenerate"]>
    > | null;

    if (cached !== null) {
      logger.debug(`Using cached LLM response`);
      return {
        ...cached,
        response: {
          ...cached.response,
          timestamp: cached?.response?.timestamp
            ? new Date(cached?.response?.timestamp)
            : undefined,
        },
      };
    }

    logger.debug(`Cache miss, calling model`);
    const result = await doGenerate();

    await cacheManager.set(cacheKey, result);
    logger.debug(`Cached new response`);

    return result;
  },
  wrapStream: async ({ doStream, params }) => {
    const cacheKey = JSON.stringify(params);

    logger.debug(`Checking cache for stream request`);

    // Check if the result is in the cache
    const cached = await cacheManager.get(cacheKey);

    // If cached, return a simulated ReadableStream that yields the cached result
    if (cached !== null) {
      logger.debug(`Using cached stream`);
      // Format the timestamps in the cached response
      const formattedChunks = (cached as LanguageModelV1StreamPart[]).map(p => {
        if (p.type === "response-metadata" && p.timestamp) {
          return { ...p, timestamp: new Date(p.timestamp) };
        } else return p;
      });
      return {
        stream: simulateReadableStream({
          initialDelayInMs: 0,
          chunkDelayInMs: 10,
          chunks: formattedChunks,
        }),
        rawCall: { rawPrompt: null, rawSettings: {} },
      };
    }

    // If not cached, proceed with streaming
    logger.debug(`Cache miss, streaming from model`);
    const { stream, ...rest } = await doStream();

    const fullResponse: LanguageModelV1StreamPart[] = [];

    const transformStream = new TransformStream<
      LanguageModelV1StreamPart,
      LanguageModelV1StreamPart
    >({
      transform(chunk, controller) {
        fullResponse.push(chunk);
        controller.enqueue(chunk);
      },
      flush() {
        // Store the full response in the cache after streaming is complete
        cacheManager.set(cacheKey, fullResponse);
        logger.debug(`Cached streamed response`);
      },
    });

    return {
      stream: stream.pipeThrough(transformStream),
      ...rest,
    };
  },
};
