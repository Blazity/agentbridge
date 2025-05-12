import { Validator } from "jsonschema";
import fs from "fs/promises";
import path from "path";
import { AgentBridgeOutput } from "@agent-bridge/core";
import { fileURLToPath } from "url";

export class SchemaValidator {
  private validator: Validator;
  private schemaPath: string;

  constructor() {
    this.validator = new Validator();

    // Get the directory where this script is located
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    // Use the script's directory as the base path
    this.schemaPath = path.join(__dirname, "..", "agentbridge.schema.json");
  }

  async validate(agentBridgeOutput: AgentBridgeOutput): Promise<{
    valid: boolean;
    errors?: {
      keyword?: string;
      dataPath?: string;
      schemaPath?: string;
      params?: Record<string, unknown>;
      message?: string;
    }[];
  }> {
    const schemaContent = await fs.readFile(this.schemaPath, "utf-8");
    const schema = JSON.parse(schemaContent);

    const result = this.validator.validate(agentBridgeOutput, schema);

    if (!result.valid) {
      return {
        valid: false,
        errors: result.errors.map(error => ({
          keyword: error.name,
          dataPath: error.property,
          schemaPath: error.path.map(String).join("."),
          params: error.argument || {},
          message: error.message,
        })),
      };
    }

    return { valid: true };
  }
}
