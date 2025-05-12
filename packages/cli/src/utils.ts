import path from "path";
import fs from "fs/promises";
import { logger } from "./logger";

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_") // Replace non-alphanumeric characters with underscores
    .replace(/^_+|_+$/g, ""); // Remove leading/trailing underscores
}

export function resolvePath(input: string): string {
  return path.isAbsolute(input) ? input : path.join(process.cwd(), input);
}

export async function saveDebugOutput(
  data: unknown,
  stageName: string,
  debugDir: string,
): Promise<void> {
  try {
    const filePath = path.join(debugDir, `${stageName}.json`);
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    logger.debug(`Saved debug JSON: ${filePath}`);
  } catch {
    logger.warn(`Save debug failed (${stageName})`);
  }
}

export async function createDebugDirectory(
  debugEnabled: boolean,
): Promise<string | null> {
  if (!debugEnabled) return null;

  try {
    const baseDebugDir = path.join(process.cwd(), ".debug");
    await fs.mkdir(baseDebugDir, { recursive: true });

    const now = new Date();
    const timestamp = now.toISOString().replace(/:/g, "-").replace(/\..+/, "");
    const debugDir = path.join(baseDebugDir, timestamp);
    await fs.mkdir(debugDir, { recursive: true });

    logger.info(`Debug output will be saved to ${debugDir}`);
    return debugDir;
  } catch {
    logger.warn(`Debug dir init failed`);
    return null;
  }
}
