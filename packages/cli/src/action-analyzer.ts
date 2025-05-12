import { ModelIntegration } from "./model-integration";
import { EnhancedEndpoint } from "./enhanced-interim";
import { z } from "zod";
import { objectToXML } from "./xml-formatter";
import { logger } from "./logger";

const EndpointRelationshipsSchema = z.object({
  relatedEndpoints: z
    .array(z.string())
    .default([])
    .describe(
      "Array of endpoint IDs that are functionally related to the target endpoint",
    ),
  potentialFlowSteps: z
    .object({
      asFirst: z
        .boolean()
        .describe(
          "Whether this endpoint can serve as the first step in a workflow",
        ),
      asMiddle: z
        .boolean()
        .describe(
          "Whether this endpoint can serve as an intermediate step in a workflow",
        ),
      asLast: z
        .boolean()
        .describe(
          "Whether this endpoint can serve as the final step in a workflow",
        ),
    })
    .describe("Analysis of the endpoint's potential position in workflows"),
});

/**
 * Analyzes endpoints to detect relationships and flow potential
 */
export class ActionAnalyzer {
  private modelIntegration: ModelIntegration;

  constructor(modelIntegration: ModelIntegration) {
    this.modelIntegration = modelIntegration;
  }

  /**
   * Analyze a batch of endpoints to detect relationships
   */
  async analyzeEndpoints(
    endpoints: EnhancedEndpoint[],
  ): Promise<EnhancedEndpoint[]> {
    const analyzedEndpoints: EnhancedEndpoint[] = [];

    // Group endpoints by resource type to help with analysis
    const resourceGroups = this.groupByResourceType(endpoints);

    for (const endpoint of endpoints) {
      try {
        logger.debug(`Analyzing endpoint relationships: ${endpoint.path}`);

        // Get endpoints of the same resource type
        const resourceEndpoints = resourceGroups[endpoint.resourceType] || [];

        // Find related endpoints using LLM
        const relationships = await this.detectRelationships(
          endpoint,
          resourceEndpoints,
        );

        // Create the analyzed endpoint with relationships
        analyzedEndpoints.push({
          ...endpoint,
          relatedEndpoints: relationships.relatedEndpoints || [],
          potentialFlowSteps: relationships.potentialFlowSteps,
        });
      } catch (error) {
        logger.error(
          `Error analyzing endpoint ${endpoint.path}: ${error instanceof Error ? error.message : String(error)}`,
        );

        // Fallback to rule-based analysis
        const relationships = this.detectRelationshipsRuleBased(
          endpoint,
          endpoints,
        );
        analyzedEndpoints.push({
          ...endpoint,
          relatedEndpoints: relationships.relatedEndpoints || [],
          potentialFlowSteps: relationships.potentialFlowSteps,
        });
      }
    }

    return analyzedEndpoints;
  }

  /**
   * Group endpoints by resource type
   */
  private groupByResourceType(
    endpoints: EnhancedEndpoint[],
  ): Record<string, EnhancedEndpoint[]> {
    const groups: Record<string, EnhancedEndpoint[]> = {};

    for (const endpoint of endpoints) {
      const resourceType = endpoint.resourceType;
      if (!groups[resourceType]) {
        groups[resourceType] = [];
      }
      groups[resourceType].push(endpoint);
    }

    return groups;
  }

  /**
   * Detect relationships between endpoints using LLM
   */
  private async detectRelationships(
    endpoint: EnhancedEndpoint,
    resourceEndpoints: EnhancedEndpoint[],
  ) {
    // If there are no other endpoints, use rule-based detection
    if (resourceEndpoints.length <= 1) {
      return this.detectRelationshipsRuleBased(endpoint, [endpoint]);
    }

    // Format ALL endpoints as XML for better LLM understanding and caching
    const allEndpointsXML = objectToXML({
      endpoints: {
        endpoint: resourceEndpoints.map(e => ({
          id: e.id,
          path: e.path,
          method: e.method,
          description: e.enhancedDescription || e.description || "",
          purpose: e.purpose || "",
          operationType: e.operationType || "",
          resourceType: e.resourceType || "",
        })),
      },
    });

    // This is a simpler task, so we can use the light model
    return this.modelIntegration.generateObject(EndpointRelationshipsSchema, {
      useSmart: false, // Use the light model for this simpler task
      estimatedInputTokens: 1500, // Provide token estimate for rate limiting
      estimatedOutputTokens: 300,
      messages: [
        {
          role: "system",
          content: `You are an API relationship architect who specializes in analyzing connections between API endpoints.

## Assessment Framework
When analyzing endpoint relationships, consider these key aspects:

1. DATA DEPENDENCIES
   - Which endpoints generate data consumed by others
   - Which endpoints require data produced by others
   - How information flows between related operations

2. FUNCTIONAL GROUPINGS
   - Endpoints operating on the same resource type
   - Endpoints that form complete business processes
   - Complementary operations (create/read, list/detail, etc.)

3. SEQUENTIAL PATTERNS
   - Typical ordered sequences (e.g., authenticate → list → get → update)
   - Natural progression of operations
   - Prerequisite relationships

## Workflow Position Analysis
For the target endpoint, carefully assess:
   - FIRST POSITION: Can initiate workflows (search, list, create operations)
   - MIDDLE POSITION: Can process data from earlier steps (get details, validate, transform)
   - LAST POSITION: Can finalize workflows (confirm, complete, delete operations)

## Output Format
Provide your analysis in XML format with clearly tagged sections:
<analysis>
  <related_endpoints>
    <endpoint>endpoint_id_1</endpoint>
    <endpoint>endpoint_id_2</endpoint>
  </related_endpoints>
  <workflow_positions>
    <first>true/false</first>
    <middle>true/false</middle>
    <last>true/false</last>
  </workflow_positions>
  <reasoning>Your step-by-step analysis explaining these decisions</reasoning>
</analysis>

Be specific, precise, and conservative in your assessment. Only identify truly meaningful relationships rather than tenuous connections.`,
          experimental_providerMetadata: {
            anthropic: {
              cacheControl: { type: "ephemeral" },
            },
          },
        },
        {
          role: "user",
          content: `All API Endpoints:
${allEndpointsXML}`,
          experimental_providerMetadata: {
            anthropic: {
              cacheControl: { type: "ephemeral" },
            },
          },
        },
        {
          role: "user",
          content: `# Target Endpoint for Analysis

## Basic Information
- ID: ${endpoint.id}
- Path: ${endpoint.path}
- Method: ${endpoint.method}
- Description: ${endpoint.enhancedDescription || endpoint.description}
- Purpose: ${endpoint.purpose}
- Resource Type: ${endpoint.resourceType}
- Operation Type: ${endpoint.operationType}

## Your Analysis Task
1. Examine the list of all available API endpoints.
2. Identify endpoints that are directly related to this target endpoint.
3. Assess the target endpoint's potential position in workflows:
   - Can it serve as the FIRST step in a workflow? (initiates processes)
   - Can it serve as a MIDDLE step? (processes data from earlier steps)
   - Can it serve as the LAST step? (completes processes)

## Guidelines
- Focus on strong, meaningful relationships that would occur in real-world usage.
- Consider data dependencies and logical operation sequences.
- For CRUD operations, consider natural sequences (list→get→update→delete).
- Be conservative - only mark an endpoint as related if there's a clear connection.
- Think step-by-step about workflow positions and explain your reasoning.
- Provide your analysis in the XML format specified in the instructions.`,
        },
      ],
    });
  }

  /**
   * Rule-based relationship detection (fallback method)
   */
  private detectRelationshipsRuleBased(
    endpoint: EnhancedEndpoint,
    allEndpoints: EnhancedEndpoint[],
  ): {
    relatedEndpoints: string[];
    potentialFlowSteps: {
      asFirst: boolean;
      asMiddle: boolean;
      asLast: boolean;
    };
  } {
    const resourceType = endpoint.resourceType;
    const relatedEndpoints: string[] = [];

    // Find endpoints with the same resource type
    for (const other of allEndpoints) {
      if (other.id !== endpoint.id && other.resourceType === resourceType) {
        relatedEndpoints.push(other.id);
      }
    }

    // Determine flow potential based on operation type
    let asFirst = false;
    let asMiddle = false;
    let asLast = false;

    switch (endpoint.operationType) {
      case "LIST":
      case "SEARCH":
        asFirst = true;
        asMiddle = true;
        asLast = false;
        break;
      case "READ":
        asFirst = false;
        asMiddle = true;
        asLast = true;
        break;
      case "CREATE":
        asFirst = true;
        asMiddle = false;
        asLast = true;
        break;
      case "UPDATE":
      case "DELETE":
        asFirst = false;
        asMiddle = false;
        asLast = true;
        break;
      default:
        // Default to middle for unknown operation types
        asMiddle = true;
        break;
    }

    return {
      relatedEndpoints,
      potentialFlowSteps: { asFirst, asMiddle, asLast },
    };
  }
}
