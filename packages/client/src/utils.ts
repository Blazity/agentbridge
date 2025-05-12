import fs from "fs/promises";
import path from "path";
import { AgentBridgeOutput } from "@agent-bridge/core";

/**
 * Reads a schema from a local file
 * @param filePath Path to the schema JSON file
 * @returns Promise resolving to the parsed AgentBridgeOutput
 * @throws Error if the file cannot be read or parsed
 */
export async function readSchemaFromFile(
  filePath: string
): Promise<AgentBridgeOutput> {
  try {
    const absolutePath = path.resolve(filePath);
    const content = await fs.readFile(absolutePath, "utf-8");
    const schema = JSON.parse(content) as AgentBridgeOutput;
    return schema;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to read schema from file: ${error.message}`);
    }
    throw new Error("Failed to read schema from file");
  }
}

/**
 * Fetches a schema from a URL
 * @param url URL to fetch the schema from
 * @returns Promise resolving to the parsed AgentBridgeOutput
 * @throws Error if the schema cannot be fetched or parsed
 */
export async function fetchSchemaFromUrl(
  url: string
): Promise<AgentBridgeOutput> {
  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
    }

    const schema = (await response.json()) as AgentBridgeOutput;
    return schema;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to fetch schema from URL: ${error.message}`);
    }
    throw new Error("Failed to fetch schema from URL");
  }
}
