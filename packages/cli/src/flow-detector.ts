import { ModelIntegration } from "./model-integration";
import { DetectedFlow, EnhancedEndpoint } from "./enhanced-interim";
import { z } from "zod";
import { sanitizeName } from "./utils";
import { objectToXML } from "./xml-formatter";
import { logger } from "./logger";

const FlowSchema = z.object({
  name: z
    .string()
    .describe(
      "Clear, descriptive name for the workflow that indicates its purpose",
    ),
  description: z
    .string()
    .describe("Detailed explanation of what this workflow accomplishes"),
  purpose: z
    .string()
    .describe("Business purpose or user goal this workflow fulfills"),
  steps: z
    .array(
      z.object({
        endpointId: z
          .string()
          .describe("ID of the endpoint to call at this step"),
        description: z
          .string()
          .describe("Explanation of why this endpoint is needed at this step"),
        isOptional: z
          .boolean()
          .default(false)
          .describe("Whether this step can be skipped in some scenarios"),
      }),
    )
    .describe("Ordered sequence of API endpoints that comprise this workflow"),
});

// Wrap array schema in an object with result property
const FlowsArraySchema = z.object({
  result: z.array(FlowSchema).describe("Array of detected API workflows"),
});

/**
 * Detects logical flows between API endpoints
 */
export class FlowDetector {
  private modelIntegration: ModelIntegration;

  constructor(modelIntegration: ModelIntegration) {
    this.modelIntegration = modelIntegration;
  }

  /**
   * Detect flows between endpoints
   */
  async detectFlows(endpoints: EnhancedEndpoint[]): Promise<DetectedFlow[]> {
    // If there are very few endpoints, there may not be any meaningful flows
    if (endpoints.length < 2) {
      return [];
    }

    try {
      logger.debug("Detecting flows across endpoints...");

      // 1. First detect flows using the LLM
      const detectedFlows = await this.detectFlowsWithLLM(endpoints);

      // 2. Validate the detected flows
      const validFlows = this.validateFlows(detectedFlows, endpoints);

      // 3. Generate IDs for the flows
      return validFlows.map(flow => ({
        ...flow,
        id: sanitizeName(flow.name),
        // These will be filled in by the DataFlowMapper
        inputParameters: [],
        outputParameters: [],
        dataFlow: [],
      }));
    } catch (error) {
      logger.error(
        `Error detecting flows: ${error instanceof Error ? error.message : String(error)}`,
      );

      // Return simple flow if available
      return this.detectBasicFlows(endpoints);
    }
  }

  /**
   * Detect flows using the LLM
   */
  private async detectFlowsWithLLM(
    endpoints: EnhancedEndpoint[],
  ): Promise<
    Omit<
      DetectedFlow,
      "id" | "inputParameters" | "outputParameters" | "dataFlow"
    >[]
  > {
    const endpointsInfo = endpoints.map(e => ({
      id: e.id,
      path: e.path,
      method: e.method,
      description: e.description ?? "",
      purpose: e.purpose ?? "",
      resourceType: e.resourceType ?? "",
      operationType: e.operationType ?? "",
    }));

    // Format endpoints as XML for better LLM understanding
    const endpointsXML = objectToXML({
      endpoints: {
        endpoint: endpointsInfo.map(endpoint => ({
          id: endpoint.id,
          path: endpoint.path,
          method: endpoint.method,
          description: endpoint.description ?? "",
          purpose: endpoint.purpose ?? "",
          resourceType: endpoint.resourceType ?? "",
          operationType: endpoint.operationType ?? "",
        })),
      },
    });

    try {
      const result = await this.modelIntegration.generateObject(
        FlowsArraySchema,
        {
          useSmart: true, // Use the smart model for complex flow detection
          estimatedInputTokens: 3000, // Provide token estimate for rate limiting
          estimatedOutputTokens: 1200,
          messages: [
            {
              role: "system",
              content: `You are an API integration architect specialized in identifying logical sequences of API endpoints that work together to accomplish meaningful tasks.

## Your Expertise
- Recognizing common API usage patterns and workflows
- Understanding resource relationships and dependencies
- Identifying standard CRUD operation sequences
- Detecting complex multi-step business processes

## Workflow Detection Guidelines
When analyzing API endpoints, look for:

1. RESOURCE LIFECYCLE FLOWS
   - Create → Read → Update → Delete sequences
   - List/Search → Get Detail patterns
   - Import → Process → Export sequences

2. BUSINESS PROCESS FLOWS
   - Authentication → Authorization → Access
   - Search → Select → Configure → Submit patterns
   - Multi-stage operations with discrete steps

3. RELATIONSHIP FLOWS
   - Parent → Child resource operations
   - Association/Disassociation sequences
   - Aggregation and composition patterns

## Thinking Approach
- First, group endpoints by resource type and operation type
- Identify potential starting points (list/search/create operations)
- Map out logical sequences based on data dependencies
- Consider business value and common user journeys

## Output Format
Respond with an <analysis> tag containing your step-by-step reasoning, followed by a <workflows> tag containing up to 3 workflow definitions.

Example structure:
<analysis>
Your detailed analysis here explaining how you identified the workflows
</analysis>

<workflows>
  <workflow>
    <name>Clear descriptive name</name>
    <description>Detailed explanation of what this workflow accomplishes</description>
    <purpose>Business purpose this fulfills</purpose>
    <steps>
      <step>
        <endpoint_id>endpoint_id_1</endpoint_id>
        <description>Why this step is needed</description>
        <optional>false</optional>
      </step>
      <!-- Additional steps as needed -->
    </steps>
  </workflow>
  <!-- Additional workflows as needed -->
</workflows>

The list of available endpoints is provided in the <endpoints> tag.`,
              experimental_providerMetadata: {
                anthropic: {
                  cacheControl: { type: "ephemeral" },
                },
              },
            },
            {
              role: "user",
              content: endpointsXML,
              experimental_providerMetadata: {
                anthropic: {
                  cacheControl: { type: "ephemeral" },
                },
              },
            },
            {
              role: "user",
              content: `# Analysis Request

Please identify up to 3 of the most important practical workflows that could be created by combining these endpoints.

## For each workflow, provide:
1. A clear, descriptive name (e.g., "User Authentication and Profile Management")
2. A thorough description of what the workflow accomplishes
3. The business purpose it fulfills
4. A step-by-step sequence showing which endpoints would be called in order

## Focus on workflows that:
- Represent common user journeys or business processes
- Have clear data dependencies between steps
- Deliver tangible value to API consumers
- Follow logical progression from start to completion

Be specific about why each endpoint is needed in the workflow sequence and how they connect to form a coherent process.

Think step-by-step about how data flows through these workflows, identifying how the output of one endpoint becomes the input for another. Then format your response using the XML structure specified in the instructions.`,
            },
          ],
        },
      );

      // Extract the result array and ensure each step has a defined isOptional
      return result.result.map(flow => ({
        ...flow,
        steps: flow.steps.map(step => ({
          ...step,
          isOptional: step.isOptional === undefined ? false : step.isOptional,
        })),
      }));
    } catch (error) {
      logger.error(
        `Error detecting flows with LLM: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  /**
   * Validate detected flows against available endpoints
   */
  private validateFlows(
    flows: Omit<
      DetectedFlow,
      "id" | "inputParameters" | "outputParameters" | "dataFlow"
    >[],
    endpoints: EnhancedEndpoint[],
  ): Omit<
    DetectedFlow,
    "id" | "inputParameters" | "outputParameters" | "dataFlow"
  >[] {
    const endpointIds = new Set(endpoints.map(e => e.id));

    return flows.filter(flow => {
      // Check that all endpoints in the flow exist
      const invalidSteps = flow.steps.filter(
        step => !endpointIds.has(step.endpointId),
      );

      if (invalidSteps.length > 0) {
        logger.warn(
          `Flow "${flow.name}" contains invalid endpoint IDs: ${invalidSteps
            .map(s => s.endpointId)
            .join(", ")}`,
        );
        return false;
      }

      // Check that the flow has at least 2 steps
      if (flow.steps.length < 2) {
        logger.warn(`Flow "${flow.name}" has fewer than 2 steps`);
        return false;
      }

      return true;
    });
  }

  /**
   * Detect basic flows based on resource types and CRUD operations
   * Fallback for when LLM detection fails
   */
  private detectBasicFlows(endpoints: EnhancedEndpoint[]): DetectedFlow[] {
    const flows: DetectedFlow[] = [];

    // Group endpoints by resource type
    const resourceGroups: Record<string, EnhancedEndpoint[]> = {};
    for (const endpoint of endpoints) {
      if (!resourceGroups[endpoint.resourceType]) {
        resourceGroups[endpoint.resourceType] = [];
      }
      resourceGroups[endpoint.resourceType].push(endpoint);
    }

    // For each resource type with multiple endpoints, create a basic flow
    for (const [resourceType, resourceEndpoints] of Object.entries(
      resourceGroups,
    )) {
      if (resourceEndpoints.length < 2) {
        continue;
      }

      // Find CRUD endpoints
      const getEndpoint = resourceEndpoints.find(
        e => e.operationType === "READ",
      );
      const listEndpoint = resourceEndpoints.find(
        e => e.operationType === "LIST",
      );
      const createEndpoint = resourceEndpoints.find(
        e => e.operationType === "CREATE",
      );
      const updateEndpoint = resourceEndpoints.find(
        e => e.operationType === "UPDATE",
      );
      const deleteEndpoint = resourceEndpoints.find(
        e => e.operationType === "DELETE",
      );

      // Create flow for "Manage Resource" if at least two CRUD operations exist
      const crudEndpoints = [
        getEndpoint,
        listEndpoint,
        createEndpoint,
        updateEndpoint,
        deleteEndpoint,
      ].filter(Boolean);
      if (crudEndpoints.length >= 2) {
        const flowId = sanitizeName(`manage_${resourceType.toLowerCase()}`);

        flows.push({
          id: flowId,
          name: `Manage ${resourceType}`,
          description: `Complete lifecycle management of ${resourceType} resources`,
          purpose: `Allow users to manage ${resourceType} resources`,
          steps: crudEndpoints.map(e => {
            // Since we filtered null/undefined with .filter(Boolean), we know e exists
            // But TypeScript doesn't know that, so we need to handle the case anyway
            if (!e) {
              return {
                endpointId: "unknown",
                description: `Unknown operation for ${resourceType}`,
                isOptional: true,
              };
            }
            return {
              endpointId: e.id,
              description: `${e.operationType} operation for ${resourceType}`,
              isOptional:
                e.operationType !== "READ" && e.operationType !== "LIST",
            };
          }),
          inputParameters: [], // Will be filled by DataFlowMapper
          outputParameters: [], // Will be filled by DataFlowMapper
          dataFlow: [], // Will be filled by DataFlowMapper
        });
      }

      // Create flow for "Find and View Resource" if LIST and GET exist
      if (listEndpoint && getEndpoint) {
        const flowId = sanitizeName(`find_view_${resourceType.toLowerCase()}`);

        flows.push({
          id: flowId,
          name: `Find and View ${resourceType}`,
          description: `Search for ${resourceType} items and view details`,
          purpose: `Allow users to find and view ${resourceType} details`,
          steps: [
            {
              endpointId: listEndpoint.id,
              description: `Search for ${resourceType} items`,
              isOptional: false,
            },
            {
              endpointId: getEndpoint.id,
              description: `View details of a specific ${resourceType}`,
              isOptional: false,
            },
          ],
          inputParameters: [], // Will be filled by DataFlowMapper
          outputParameters: [], // Will be filled by DataFlowMapper
          dataFlow: [], // Will be filled by DataFlowMapper
        });
      }
    }

    return flows;
  }
}
