import {
  NormalizedEndpoint,
  NormalizedInterim,
  NormalizedParameter,
} from "./normalized-interim";

/**
 * Enhanced Interim Format - adds semantic understanding and relationships
 */
export type EnhancedInterim = {
  endpoints: EnhancedEndpoint[];
  detectedFlows: DetectedFlow[];
  entities: Record<string, Entity>;
} & Omit<NormalizedInterim, "endpoints">

export type EnhancedEndpoint = {
  enhancedDescription: string; // LLM-improved description
  purpose: string; // Inferred purpose
  resourceType: string; // Type of resource being manipulated
  operationType: string; // CRUD or custom operation type
  relatedEndpoints: string[]; // IDs of related endpoints
  potentialFlowSteps: {
    // Flow potential analysis
    asFirst: boolean;
    asMiddle: boolean;
    asLast: boolean;
  };
  enhancedParameters: EnhancedParameter[];
  enhancedResponses: Record<
    string,
    {
      enhancedDescription: string;
      resolutionSteps?: string[]; // For error responses
    }
  >;
} & NormalizedEndpoint

type EnhancedParameter = {
  enhancedDescription: string;
  importance: "critical" | "important" | "optional";
  commonValues?: unknown[];
} & NormalizedParameter

export type DetectedFlow = {
  id: string;
  name: string;
  description: string;
  purpose: string;
  steps: FlowStep[];
  inputParameters: FlowParameter[];
  outputParameters: FlowOutput[];
  dataFlow: DataFlowMapping[];
}

type FlowStep = {
  endpointId: string;
  description: string;
  isOptional: boolean;
}

type FlowParameter = {
  name: string;
  description: string;
  required: boolean;
  type: string;
  schema?: unknown;
}

type FlowOutput = {
  name: string;
  description: string;
  type: string;
  sourceEndpointId: string;
  sourcePath: string;
  schema?: unknown;
}

type DataFlowMapping = {
  from: DataFlowPoint;
  to: DataFlowPoint;
  description: string;
}

type DataFlowPoint = {
  type: "input" | "endpoint" | "output";
  endpointId?: string;
  parameter: string;
  path?: string;
}

export type Entity = {
  id: string;
  description: string;
  properties: Record<
    string,
    {
      type: string;
      description: string;
      format?: string;
      related?: {
        entityId: string;
        relationship:
          | "one-to-one"
          | "one-to-many"
          | "many-to-one"
          | "many-to-many";
      };
    }
  >;
}
