import { cancel, intro, isCancel, outro, text, password } from "@clack/prompts";
import { Command } from "commander";
import { existsSync } from "fs";
import fs from "fs/promises";
import { ModelIntegration } from "./model-integration";
import { processOpenAPI } from "./pipeline";
import { logger } from "./logger";
import { resolvePath } from "./utils";

type ProgramOptions = {
  output: string;
  cache: boolean;
  debug: boolean;
  silent: boolean;
  verbose: boolean;
  concurrency: number;
};

async function main() {
  const program = new Command();

  program
    .name("agentbridge-cli")
    .description(
      "Convert OpenAPI/Swagger specifications to AgentBridge Protocol",
    )
    .version("1.0.0");

  program
    .option("-o, --output <path>", "output file path", "agentbridge.json")
    .option("--no-cache", "disable LLM response caching")
    .option("-d, --debug", "enable debug mode with detailed output")
    .option("-v, --verbose", "enable verbose logging")
    .option(
      "-c, --concurrency <number>",
      "number of endpoints to process in parallel (default: 3)",
      parseInt,
      3,
    );

  program.parse();
  const opts = program.opts<ProgramOptions>();

  intro("AgentBridge Integration Generator - OpenAPI to AgentBridge Protocol");

  if (opts.debug) {
    logger.info("🐛 Debug mode - saving stages to .debug");
  }

  if (opts.verbose) {
    logger.setVerboseMode(true);
    logger.info("📝 Verbose mode enabled");
  }

  const inputSource = await text({
    message: "Enter the path to your OpenAPI/Swagger file or a URL",
    placeholder: "Path or URL to your API definition",
    validate(value) {
      if (value.length === 0) return "Input source is required";
    },
  });

  if (isCancel(inputSource)) {
    cancel("Cancelled");
    process.exit(0);
  }

  let swagger;

  if (inputSource.toString().startsWith("http")) {
    logger.startSpinner("Fetching OpenAPI spec");
    const response = await fetch(inputSource.toString());
    const swaggerContent = await response.text();
    swagger = JSON.parse(swaggerContent);
    logger.stopSpinner("Successfully fetched OpenAPI spec");
  } else {
    const swaggerPath = resolvePath(inputSource.toString());
    if (!existsSync(swaggerPath)) {
      cancel(`File not found: ${swaggerPath}`);
      process.exit(1);
    }

    const swaggerContent = await fs.readFile(swaggerPath, "utf-8");
    swagger = JSON.parse(swaggerContent);
  }

  if (!process.env["ANTHROPIC_API_KEY"]) {
    const apiKey = await password({
      message: "Enter your Anthropic API key",
      validate: v => (v.length === 0 ? "API key is required" : undefined),
    });
    if (isCancel(apiKey)) {
      cancel("Anthropic API key is required to proceed");
      process.exit(1);
    }
    process.env["ANTHROPIC_API_KEY"] = apiKey;
  }

  const modelIntegration = new ModelIntegration({
    cacheEnabled: opts.cache,
    maxRateLimitRetries: Math.max(5, Math.min(10, opts.concurrency * 2)),
  });

  const output = await processOpenAPI(swagger, modelIntegration, {
    debug: opts.debug,
    verbose: opts.verbose,
    concurrency: opts.concurrency,
  });

  const outputPath = resolvePath(opts.output);

  logger.startSpinner("Writing output...");
  await fs.writeFile(outputPath, JSON.stringify(output, null, 2));
  logger.stopSpinner(`Saved output to ${outputPath}`);

  logger.info("💰 Usage stats");
  logger.info(modelIntegration.reportUsage());

  if (opts.debug) {
    logger.info("🐛 Debug info saved to .debug");
  }

  outro("AgentBridge integration generation completed successfully!");
}

if (import.meta.url === import.meta.resolve(process.argv[1])) {
  main().catch(error => {
    cancel(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
