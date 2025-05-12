import { z } from "zod";
import { DetectedFlow, EnhancedEndpoint } from "./enhanced-interim";
import { logger } from "./logger";
import { ModelIntegration } from "./model-integration";
import { objectToXML } from "./xml-formatter";
import { CoreMessage } from "ai";

// Schema for data flow mapping
const DataFlowSchema = z.object({
  inputParameters: z
    .array(
      z.object({
        name: z.string().describe("Name of the input parameter"),
        description: z
          .string()
          .describe(
            "Clear description of what this parameter is used for in the workflow",
          ),
        required: z
          .boolean()
          .describe("Whether this parameter is required to start the workflow"),
        type: z
          .string()
          .describe(
            "Data type of the parameter (string, number, boolean, object, array)",
          ),
        schema: z
          .unknown()
          .describe(
            "JSON Schema for the parameter. MUST conform to the JSON schema specification",
          ),
      }),
    )
    .describe(
      "Parameters that must be provided externally to start the workflow",
    ),
  outputParameters: z
    .array(
      z.object({
        name: z.string().describe("Name of the output parameter"),
        description: z
          .string()
          .describe(
            "Explanation of what this output represents in business terms",
          ),
        type: z
          .string()
          .describe(
            "Data type of the output (string, number, boolean, object, array)",
          ),
        sourceEndpointId: z
          .string()
          .describe("ID of the endpoint that produces this output value"),
        sourcePath: z
          .string()
          .describe(
            "Path to the specific field in the response that contains this value",
          ),
        schema: z
          .unknown()
          .optional()
          .describe("Full JSON Schema for the output"),
      }),
    )
    .describe("Data produced by the workflow that represents the final result"),

  dataFlow: z
    .array(
      z.object({
        from: z
          .object({
            type: z
              .enum(["input", "endpoint"])
              .describe(
                "Source type - either workflow input or endpoint response",
              ),
            endpointId: z
              .string()
              .optional()
              .describe("For endpoint sources, the ID of the source endpoint"),
            parameter: z
              .string()
              .describe("Name of the parameter or response field"),
            path: z
              .string()
              .optional()
              .describe("For nested data, path to the specific field"),
          })
          .describe("Source of data for this flow connection"),

        to: z
          .object({
            type: z
              .enum(["endpoint", "output"])
              .describe(
                "Destination type - either endpoint parameter or workflow output",
              ),
            endpointId: z
              .string()
              .optional()
              .describe(
                "For endpoint destinations, the ID of the target endpoint",
              ),
            parameter: z
              .string()
              .describe("Name of the parameter or output field"),
          })
          .describe("Destination for data in this flow connection"),

        description: z
          .string()
          .describe("Clear explanation of this data connection's purpose"),
      }),
    )
    .describe(
      "Explicit connections showing how data moves through the workflow",
    ),
});

/**
 * Maps data flows between endpoints in workflows
 */
export class DataFlowMapper {
  private modelIntegration: ModelIntegration;
  // Allow a limited number of automatic correction rounds when validation fails
  private readonly maxCorrectionAttempts = 2;

  constructor(modelIntegration: ModelIntegration) {
    this.modelIntegration = modelIntegration;
  }

  /**
   * Map data flows for detected flows
   */
  async mapDataFlows(
    flows: DetectedFlow[],
    endpoints: EnhancedEndpoint[],
  ): Promise<DetectedFlow[]> {
    const mappedFlows: DetectedFlow[] = [];

    for (const flow of flows) {
      try {
        logger.debug(`Mapping data flow for flow: ${flow.name}`);

        // Find the endpoints used in this flow
        const flowEndpoints = flow.steps
          .map(step => endpoints.find(e => e.id === step.endpointId))
          .filter(Boolean) as EnhancedEndpoint[];

        if (flowEndpoints.length < 2) {
          logger.warn(`Flow ${flow.name} has fewer than 2 valid endpoints`);
          mappedFlows.push(flow);
          continue;
        }

        // Map the data flow with the LLM
        const mappedFlow = await this.mapFlowWithLLM(flow, flowEndpoints);
        mappedFlows.push(mappedFlow);
      } catch (error) {
        logger.error(
          `Error mapping data flow for flow ${flow.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return mappedFlows;
  }

  /**
   * Map a flow's data flow using the LLM
   */
  private async mapFlowWithLLM(
    flow: DetectedFlow,
    flowEndpoints: EnhancedEndpoint[],
  ): Promise<DetectedFlow> {
    // Prepare endpoint details for the prompt
    const endpointDetails = flowEndpoints.map(e => ({
      id: e.id,
      path: e.path,
      method: e.method,
      description: e.enhancedDescription || e.description || "",
      parameters: e.enhancedParameters || e.parameters,
      responses: Object.entries(e.responses).map(([code, resp]) => ({
        statusCode: code,
        schema: resp.schema,
      })),
    }));

    // Format as XML for better LLM understanding
    const endpointsXML = objectToXML({
      endpoints: {
        endpoint: endpointDetails.map(endpoint => ({
          id: endpoint.id,
          path: endpoint.path,
          method: endpoint.method,
          description: endpoint.description ?? "",
          parameters: endpoint.parameters,
          responses: endpoint.responses,
        })),
      },
    });

    const stepsXML = objectToXML({
      steps: {
        step: flow.steps.map((step, index) => ({
          order: index + 1,
          endpointId: step.endpointId,
          description: step.description || "",
          isOptional: step.isOptional ? "true" : "false",
        })),
      },
    });

    try {
      const mappingResult = await this.modelIntegration.generateObject(
        DataFlowSchema,
        {
          useSmart: true, // Use the smart model for complex data flow mapping
          estimatedInputTokens: 4000, // Provide token estimate for rate limiting
          estimatedOutputTokens: 1500,
          messages: [
            {
              role: "system",
              content: `You are an API integration architect specializing in data flow analysis between API operations.

Think systematically about data dependencies in multi-step API workflows:

## Data Flow Types
1. EXTERNAL INPUTS: Parameters that must be provided by the user to start the workflow
   - Authentication credentials
   - Resource identifiers
   - Search queries
   - Configuration options

2. INTER-ENDPOINT TRANSFERS: How data moves between steps
   - Response fields from one endpoint become parameters for subsequent endpoints
   - Typical patterns: IDs from list/search endpoints used in detail endpoints
   - Transforms needed (e.g., array element selection, field extraction)
   
3. WORKFLOW OUTPUTS: Data that represents the final result
   - Most valuable data for the user based on workflow purpose
   - Often from the final endpoint's response, but may include data from earlier steps

## Analysis Process
For each workflow step:
1. Examine input parameters required by the endpoint
2. Determine which parameters must come from external inputs vs. previous steps
3. For parameters from previous steps, identify exact response fields to use
4. Provide clear descriptions of data movement between steps

## Output Format
Respond with XML tags for the analysis portion, followed by the requested JSON format:

<analysis>
  <step_1>
    Analysis of the first endpoint's requirements and where its inputs come from
  </step_1>
  <step_2>
    Analysis of the second endpoint and data dependencies
  </step_2>
  <!-- Continue for all steps -->
  <workflow_outputs>
    Analysis of what data should be returned from the entire workflow
  </workflow_outputs>
</analysis>

Then provide the JSON data flow mapping as specified in the example.

Pay special attention to:
- Parameter types and formats (ensuring correct data typing)
- Path parameters vs. query parameters vs. body parameters
- Nested response structures in complex APIs
- Array handling when selecting specific items from collections`,
              experimental_providerMetadata: {
                anthropic: {
                  cacheControl: { type: "ephemeral" },
                },
              },
            },
            {
              role: "user",
              content: `# Endpoint Specifications

${endpointsXML}`,
              experimental_providerMetadata: {
                anthropic: {
                  cacheControl: { type: "ephemeral" },
                },
              },
            },
            {
              role: "user",
              content: `# Workflow Information
Name: ${flow.name}
Description: ${flow.description}

${stepsXML}

## Your Task
Analyze this workflow and provide a comprehensive data flow mapping that identifies:

1. External input parameters required to initiate the workflow
2. Data transfer between endpoints (how output from one step becomes input for another)
3. Final output parameters that represent the workflow's meaningful results

Think step-by-step:
1. First, identify what parameters are needed for the first endpoint
2. For each subsequent endpoint, determine which parameters can be provided from previous endpoint responses
3. Map the exact path to access each piece of data (e.g., "response.items[0].id")
4. Identify which data from the final endpoint(s) should be presented as workflow outputs

Ensure your response includes:
1. Complete dataFlow mappings for EVERY parameter in EVERY step
2. For EACH outputParameter, include a corresponding dataFlow mapping from an endpoint to that output

## Response Format Example
For a product search and purchase flow with endpoints like "search_products", "get_product_details", and "place_order":

{
  "inputParameters": [
    {"name": "searchQuery", "description": "Product search keywords", "required": true, "type": "string", "schema": {"type": "string"}},
    {"name": "maxPrice", "description": "Maximum product price filter", "required": false, "type": "number", "schema": {"type": "number"}},
    {"name": "paymentMethodId", "description": "Payment method identifier", "required": true, "type": "string", "schema": {"type": "string"}}
  ],
  "outputParameters": [
    {"name": "orderId", "description": "Unique identifier for the created order", "type": "string", "sourceEndpointId": "place_order", "sourcePath": "id", "schema": {"type": "string"}},
    {"name": "orderStatus", "description": "Current status of the order", "type": "string", "sourceEndpointId": "place_order", "sourcePath": "status", "schema": {"type": "string"}},
  ],
  "dataFlow": [
    {
      "from": {"type": "input", "parameter": "searchQuery"},
      "to": {"type": "endpoint", "endpointId": "search_products", "parameter": "query"},
      "description": "Search query from user passed to product search endpoint"
    },
    {
      "from": {"type": "endpoint", "endpointId": "search_products", "parameter": "products", "path": "[0].id"},
      "to": {"type": "endpoint", "endpointId": "get_product_details", "parameter": "productId"},
      "description": "ID of first product from search results used to fetch detailed product information"
    },
    {
      "from": {"type": "endpoint", "endpointId": "get_product_details", "parameter": "id"},
      "to": {"type": "endpoint", "endpointId": "place_order", "parameter": "productId"},
      "description": "Product ID from details endpoint passed to order creation"
    },
    {
      "from": {"type": "input", "parameter": "paymentMethodId"},
      "to": {"type": "endpoint", "endpointId": "place_order", "parameter": "paymentMethod"},
      "description": "Payment method identifier from user input passed to order creation"
    },
    {
      "from": {"type": "endpoint", "endpointId": "place_order", "parameter": "id"},
      "to": {"type": "output", "parameter": "orderId"},
      "description": "Order ID from place_order response mapped to workflow output"
    },
    {
      "from": {"type": "endpoint", "endpointId": "place_order", "parameter": "status"},
      "to": {"type": "output", "parameter": "orderStatus"},
      "description": "Order status from place_order response mapped to workflow output"
    }
  ]
}`,
            },
          ],
        },
      );

      let enrichedFlow = {
        ...flow,
        inputParameters: this.enrichInputSchemas(
          mappingResult.inputParameters,
          flowEndpoints,
        ),
        outputParameters: this.enrichOutputSchemas(
          mappingResult.outputParameters,
          flowEndpoints,
        ),
        dataFlow: mappingResult.dataFlow,
      } as DetectedFlow;

      // Validate schema compatibility for data flow connections
      this.validateSchemaCompatibility(enrichedFlow, flowEndpoints);

      // Validate completeness of mappings (e.g., every output referenced)
      let completenessIssues = this.validateCompleteness(enrichedFlow);

      // Attempt automatic correction by providing the issues back to the LLM
      let attempt = 0;
      while (
        completenessIssues.length > 0 &&
        attempt < this.maxCorrectionAttempts
      ) {
        logger.warn(
          `Flow "${flow.name}" has completeness issues (attempt ${attempt + 1}/${this.maxCorrectionAttempts}):\n${completenessIssues.join("\n")}`,
        );

        const correctionMessages: CoreMessage[] = [
          {
            role: "system",
            content:
              "You are an API integration architect. Fix the data flow mapping so that it passes validation. Return JSON ONLY matching the provided schema.",
          },
          {
            role: "user",
            content: `# Endpoint Specifications\n\n${endpointsXML}`,
          },
          {
            role: "user",
            content: `# Workflow Information\nName: ${flow.name}\nDescription: ${flow.description}\n\n${stepsXML}\n\n## Issues to Fix\n${completenessIssues.join("\n")}\n\nPlease return a corrected data flow mapping.`,
          },
        ];

        const corrected = await this.modelIntegration.generateObject(
          DataFlowSchema,
          {
            useSmart: true,
            estimatedInputTokens: 4000,
            estimatedOutputTokens: 1500,
            messages: correctionMessages,
          },
        );

        enrichedFlow = {
          ...flow,
          inputParameters: this.enrichInputSchemas(
            corrected.inputParameters,
            flowEndpoints,
          ),
          outputParameters: this.enrichOutputSchemas(
            corrected.outputParameters,
            flowEndpoints,
          ),
          dataFlow: corrected.dataFlow,
        } as DetectedFlow;

        this.validateSchemaCompatibility(enrichedFlow, flowEndpoints);
        completenessIssues = this.validateCompleteness(enrichedFlow);
        attempt += 1;
      }

      if (completenessIssues.length > 0) {
        logger.warn(
          `Flow "${flow.name}" still has unresolved validation issues after ${this.maxCorrectionAttempts} attempts.`,
        );
      }

      return enrichedFlow;
    } catch (error) {
      logger.error(
        `Error mapping flow ${flow.name} with LLM: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  /**
   * Ensure each input parameter has a JSON Schema. If the LLM didn't provide one,
   * derive it from the first endpoint where the parameter appears.
   */
  private enrichInputSchemas(
    params: {
      name: string;
      description: string;
      required: boolean;
      type: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      schema?: any;
    }[],
    endpoints: EnhancedEndpoint[],
  ) {
    return params.map(param => {
      if (param.schema) return param;
      // Find schema in endpoints
      let foundSchema: unknown | undefined;
      for (const ep of endpoints) {
        const p = ep.parameters.find(pp => pp.name === param.name);
        if (p && p.schema) {
          foundSchema = p.schema;
          break;
        }
        // Check body param named 'body'
        if (param.name === "body" && ep.requestBody?.schema) {
          foundSchema = ep.requestBody.schema;
          break;
        }
      }
      return { ...param, schema: foundSchema };
    });
  }

  /**
   * Ensure each output parameter has a JSON Schema by referencing the
   * endpoint's success response schema.
   */
  private enrichOutputSchemas(
    outputs: {
      name: string;
      description: string;
      type: string;
      sourceEndpointId: string;
      sourcePath: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      schema?: any;
    }[],
    endpoints: EnhancedEndpoint[],
  ) {
    return outputs.map(output => {
      if (output.schema) return output;
      const ep = endpoints.find(e => e.id === output.sourceEndpointId);
      let foundSchema: unknown | undefined;
      if (ep) {
        // Attempt to attach full response schema
        const successResponse =
          ep.responses["200"] ||
          ep.responses["201"] ||
          Object.values(ep.responses)[0];
        if (successResponse && "schema" in successResponse) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          foundSchema = (successResponse as any).schema;
        }
      }
      return { ...output, schema: foundSchema };
    });
  }

  /**
   * Compare source and destination schemas for each dataFlow mapping and log a
   * warning if root "type" fields are incompatible.
   */
  private validateSchemaCompatibility(
    flow: DetectedFlow,
    endpoints: EnhancedEndpoint[],
  ) {
    const inputSchemaMap = new Map<string, unknown>();
    flow.inputParameters.forEach(p => {
      if (p.schema) inputSchemaMap.set(p.name, p.schema);
    });

    const outputSchemaMap = new Map<string, unknown>();
    flow.outputParameters.forEach(o => {
      if (o.schema) outputSchemaMap.set(o.name, o.schema);
    });

    const getEndpointSchema = (
      epId: string | undefined,
      paramName: string,
    ): unknown | undefined => {
      if (!epId) return undefined;
      const ep = endpoints.find(e => e.id === epId);
      if (!ep) return undefined;
      if (paramName === "body") {
        return ep.requestBody?.schema;
      }
      const p = ep.parameters.find(pp => pp.name === paramName);
      return p?.schema;
    };

    for (const mapping of flow.dataFlow) {
      let sourceSchema: unknown | undefined;
      switch (mapping.from.type) {
        case "input":
          sourceSchema = inputSchemaMap.get(mapping.from.parameter);
          break;
        case "endpoint":
          sourceSchema = getEndpointSchema(
            mapping.from.endpointId,
            mapping.from.parameter,
          );
          break;
        default:
          break;
      }

      let destSchema: unknown | undefined;
      switch (mapping.to.type) {
        case "endpoint":
          destSchema = getEndpointSchema(
            mapping.to.endpointId,
            mapping.to.parameter,
          );
          break;
        case "output":
          destSchema = outputSchemaMap.get(mapping.to.parameter);
          break;
        default:
          break;
      }

      if (sourceSchema && destSchema) {
        const sourceType = (sourceSchema as { type?: string }).type;
        const destType = (destSchema as { type?: string }).type;
        if (sourceType && destType && sourceType !== destType) {
          logger.warn(
            `Schema mismatch in flow "${flow.name}": source (${mapping.from.parameter}) type "${sourceType}" => destination (${mapping.to.parameter}) type "${destType}"`,
          );
        } else {
          logger.debug(
            `Schema match in flow "${flow.name}": source (${mapping.from.parameter}) type "${sourceType}" => destination (${mapping.to.parameter}) type "${destType}"`,
          );
        }
      }
    }
  }

  /**
   * Check that each output is referenced in a dataFlow mapping and that
   * references inside dataFlow point to existing inputs, outputs and endpoints.
   * Returns an array of human-readable issues; empty means everything looks good.
   */
  private validateCompleteness(flow: DetectedFlow): string[] {
    const issues: string[] = [];

    // 1. Ensure every output parameter is referenced by at least one mapping
    const referencedOutputs = new Set(
      flow.dataFlow
        .filter(df => df.to.type === "output")
        .map(df => df.to.parameter),
    );
    for (const out of flow.outputParameters) {
      if (!referencedOutputs.has(out.name)) {
        issues.push(
          `Output parameter "${out.name}" is not referenced in any dataFlow mapping.`,
        );
      }
    }

    // 2. Validate that all referenced inputs / outputs / endpoints actually exist
    const inputNames = new Set(flow.inputParameters.map(p => p.name));
    const outputNames = new Set(flow.outputParameters.map(o => o.name));
    const endpointIds = new Set(flow.steps.map(s => s.endpointId));

    for (const df of flow.dataFlow) {
      // Validate source
      if (df.from.type === "input" && !inputNames.has(df.from.parameter)) {
        issues.push(
          `DataFlow source references unknown input parameter "${df.from.parameter}"`,
        );
      }
      if (
        df.from.type === "endpoint" &&
        (!df.from.endpointId || !endpointIds.has(df.from.endpointId))
      ) {
        issues.push(
          `DataFlow source references unknown endpoint "${df.from.endpointId}"`,
        );
      }

      // Validate destination
      if (
        df.to.type === "endpoint" &&
        (!df.to.endpointId || !endpointIds.has(df.to.endpointId))
      ) {
        issues.push(
          `DataFlow destination references unknown endpoint "${df.to.endpointId}"`,
        );
      }
      if (df.to.type === "output" && !outputNames.has(df.to.parameter)) {
        issues.push(
          `DataFlow destination references unknown output parameter "${df.to.parameter}"`,
        );
      }
    }

    return issues;
  }
}
