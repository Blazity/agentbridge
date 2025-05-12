import { ActionAnalyzer } from "./action-analyzer";
import { DataFlowMapper } from "./data-flow-mapper";
import { FlowDetector } from "./flow-detector";
import { OpenAPISpecNormalizer } from "./normalizer";
import { ModelIntegration } from "./model-integration";
import { logger } from "./logger";
import { SchemaAssembler } from "./schema-assembler";
import { SchemaValidator } from "./schema-validator";
import { SemanticEnricher } from "./semantic-enricher";
import { EnhancedInterim } from "./enhanced-interim";
import { AgentBridgeOutput } from "@agent-bridge/core";
import { createDebugDirectory, saveDebugOutput } from "./utils";

export async function processOpenAPI(
  openApiSpec: unknown,
  modelIntegration: ModelIntegration,
  options: { debug?: boolean; verbose?: boolean; concurrency?: number } = {},
): Promise<AgentBridgeOutput> {
  const debugDir = await createDebugDirectory(!!options.debug);
  if (debugDir)
    await saveDebugOutput(openApiSpec, "01-raw-openapi-spec", debugDir);

  const normalizer = new OpenAPISpecNormalizer();
  const normalizedInterim = await normalizer.parseAndNormalize(openApiSpec);
  logger.info("API specification parsed and normalized successfully");

  if (debugDir)
    await saveDebugOutput(normalizedInterim, "02-normalized-spec", debugDir);

  logger.step("Enhancing endpoints");

  logger.startSpinner("Enhancing endpoint descriptions...");
  const semanticEnricher = new SemanticEnricher(modelIntegration);
  const enrichedEndpoints = await semanticEnricher.enhanceEndpoints(
    normalizedInterim.endpoints,
    options.concurrency,
  );
  logger.stopSpinner("Descriptions enhanced");

  if (debugDir)
    await saveDebugOutput(enrichedEndpoints, "03-enriched-endpoints", debugDir);

  logger.startSpinner("Analyzing actions...");
  const actionAnalyzer = new ActionAnalyzer(modelIntegration);
  const analyzedEndpoints =
    await actionAnalyzer.analyzeEndpoints(enrichedEndpoints);
  logger.stopSpinner("Actions analyzed");

  if (debugDir)
    await saveDebugOutput(analyzedEndpoints, "04-analyzed-endpoints", debugDir);

  logger.startSpinner("Detecting flows...");
  const flowDetector = new FlowDetector(modelIntegration);
  const detectedFlows = await flowDetector.detectFlows(analyzedEndpoints);
  logger.stopSpinner("Flows detected");

  if (debugDir)
    await saveDebugOutput(detectedFlows, "05-detected-flows", debugDir);

  logger.startSpinner("Mapping data flows...");
  const dataFlowMapper = new DataFlowMapper(modelIntegration);
  const mappedFlows = await dataFlowMapper.mapDataFlows(
    detectedFlows,
    analyzedEndpoints,
  );
  logger.stopSpinner("Data flows mapped");

  if (debugDir)
    await saveDebugOutput(mappedFlows, "06-mapped-data-flows", debugDir);

  const enhancedInterim: EnhancedInterim = {
    ...normalizedInterim,
    endpoints: analyzedEndpoints,
    detectedFlows: mappedFlows,
    entities: normalizedInterim.entities || {},
  };

  if (debugDir)
    await saveDebugOutput(enhancedInterim, "07-enhanced-interim", debugDir);

  logger.step("📝 Assembling & validating output");

  logger.startSpinner("Assembling output...");
  const schemaAssembler = new SchemaAssembler();
  const output = await schemaAssembler.assembleOutput(enhancedInterim);
  logger.stopSpinner("Output assembled");

  if (debugDir) await saveDebugOutput(output, "08-assembled-output", debugDir);

  logger.startSpinner("Validating output...");
  const validator = new SchemaValidator();
  const validationResult = await validator.validate(output);

  if (debugDir)
    await saveDebugOutput(validationResult, "09-validation-result", debugDir);

  if (!validationResult.valid && validationResult.errors) {
    logger.warn("Output validation issues:");
    for (const error of validationResult.errors) {
      logger.warn(`- ${JSON.stringify(error)}`);
    }
  } else {
    logger.stopSpinner("Output validation passed");
  }

  if (debugDir) await saveDebugOutput(output, "10-final-output", debugDir);

  return output;
}
