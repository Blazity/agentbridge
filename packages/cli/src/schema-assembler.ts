import { EnhancedInterim, EnhancedEndpoint } from "./enhanced-interim";
import {
  AgentBridgeOutput,
  AgentBridgeAction,
  AgentBridgeFlow,
  AgentBridgeEntity,
} from "@agent-bridge/core";
import { logger } from "./logger";

export class SchemaAssembler {
  async assembleOutput(
    enhancedInterim: EnhancedInterim,
  ): Promise<AgentBridgeOutput> {
    const output: AgentBridgeOutput = {
      $schema: "https://agentbridge.org/agentbridge.schema.json",
      metadata: {
        version: "1.0.0",
      },
      info: enhancedInterim.info,
      actions: this.assembleActions(enhancedInterim.endpoints),
      flows: this.assembleFlows(enhancedInterim.detectedFlows),
    };

    if (enhancedInterim.authentication) {
      output.authentication = enhancedInterim.authentication;
    }

    if (
      enhancedInterim.entities &&
      Object.keys(enhancedInterim.entities).length > 0
    ) {
      output.entities = this.assembleEntities(enhancedInterim.entities);
    }

    return output;
  }

  private assembleActions(
    endpoints: EnhancedEndpoint[],
  ): Record<string, AgentBridgeAction> {
    const actions: Record<string, AgentBridgeAction> = {};

    for (const endpoint of endpoints) {
      const action = this.convertEndpointToAction(endpoint);
      actions[action.id] = action;
    }

    return actions;
  }

  private convertEndpointToAction(
    endpoint: EnhancedEndpoint,
  ): AgentBridgeAction {
    const parameters: Record<
      string,
      {
        in: string;
        description: string;
        required?: boolean;
        example?: unknown;
        schema?: unknown;
      }
    > = {};

    for (const param of endpoint.parameters) {
      // Skip body parameters or parameters with unsupported locations
      if (param.in === "body" || !["path", "query"].includes(param.in)) {
        if (param.in !== "body") {
          logger.debug(
            `Filtered out parameter '${param.name}' with unsupported location '${param.in}' in endpoint ${endpoint.path}`,
          );
        }
        continue;
      }

      const enhancedParam = endpoint.enhancedParameters?.find(
        p => p.name === param.name,
      );

      parameters[param.name] = {
        in: param.in,
        description: enhancedParam?.enhancedDescription || param.description,
        required: param.required,
        example: param.example || enhancedParam?.commonValues?.[0],
        schema: param.schema,
      };
    }

    const errors = Object.entries(endpoint.responses)
      .filter(
        ([code]) =>
          (code !== "200" && code !== "201" && code.startsWith("4")) ||
          code.startsWith("5"),
      )
      .map(([code, response]) => {
        const enhancedResponse = endpoint.enhancedResponses?.[code];

        return {
          code: parseInt(code),
          reason: response.description,
          resolution: enhancedResponse?.resolutionSteps
            ? enhancedResponse.resolutionSteps.join(". ")
            : undefined,
        };
      });

    const successResponse =
      endpoint.responses["200"] ||
      endpoint.responses["201"] ||
      Object.values(endpoint.responses)[0];

    return {
      id: endpoint.id,
      description: endpoint.enhancedDescription || endpoint.description,
      endpoint: endpoint.path,
      method: endpoint.method,
      requestFormat: {
        contentType: endpoint.requestBody?.contentType || "application/json",
        parameters: Object.keys(parameters).length > 0 ? parameters : undefined,
        body: endpoint.requestBody?.schema,
      },
      responseFormat: (() => {
        if (successResponse && "contentType" in successResponse) {
          return {
            contentType: successResponse.contentType,
            schema: successResponse.schema,
          };
        }
        return {
          contentType: "application/json",
          schema: {},
        };
      })(),
      errors,
    };
  }

  private assembleFlows(
    detectedFlows: EnhancedInterim["detectedFlows"],
  ): Record<string, AgentBridgeFlow> {
    const flows: Record<string, AgentBridgeFlow> = {};

    for (const flow of detectedFlows) {
      const AgentBridgeFlow: AgentBridgeFlow = {
        id: flow.id,
        description: flow.description,
        parameters: flow.inputParameters.map(param => ({
          name: param.name,
          description: param.description,
          required: param.required,
          type: param.type,
          schema: param.schema, // Preserve full JSON Schema if available
        })),
        response: {
          schema: {
            type: "object",
            properties: Object.fromEntries(
              flow.outputParameters.map(param => [
                param.name,
                {
                  type: param.type,
                  description: param.description,
                },
              ]),
            ),
          },
        },
        steps: flow.steps.map(step => ({
          actionId: step.endpointId,
          description: step.description,
        })),
        dataFlow: flow.dataFlow.map(mapping => ({
          from: this.formatDataPath(mapping.from),
          to: this.formatDataPath(mapping.to),
          description: mapping.description,
        })),
      };

      flows[flow.id] = AgentBridgeFlow;
    }

    return flows;
  }

  private formatDataPath(point: {
    type: "input" | "endpoint" | "output";
    endpointId?: string;
    parameter: string;
    path?: string;
  }): string {
    if (point.type === "input") {
      return `$.${point.parameter}`;
    } else if (point.type === "endpoint") {
      const path = point.path ? `.${point.path}` : "";
      return `${point.endpointId}.${point.parameter}${path}`;
    } else {
      return `$.${point.parameter}`;
    }
  }

  private assembleEntities(
    entities: EnhancedInterim["entities"],
  ): Record<string, AgentBridgeEntity> {
    const agentBridgeEntities: Record<string, AgentBridgeEntity> = {};

    for (const [entityId, entity] of Object.entries(entities)) {
      const properties: Record<
        string,
        {
          type: string;
          description: string;
          items?: unknown;
        }
      > = {};

      for (const [propName, propInfo] of Object.entries(entity.properties)) {
        properties[propName] = {
          type: propInfo.type,
          description: propInfo.description,
        };

        if ("items" in propInfo) {
          properties[propName].items = propInfo.items;
        }
      }

      agentBridgeEntities[entityId] = {
        id: entity.id,
        properties,
      };
    }

    return agentBridgeEntities;
  }
}
