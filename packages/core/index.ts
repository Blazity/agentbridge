export type AgentBridgeOutput = {
  $schema: string;
  metadata: {
    version: string;
  };
  info: {
    title: string;
    description?: string;
    version: string;
    baseUrl: string;
  };
  authentication?: {
    type: string;
    parameters: Record<
      string,
      {
        description: string;
        schema?: unknown;
      }
    >;
    implementation: {
      headers?: Record<string, string>;
      queryParameters?: Record<string, string>;
    };
  };
  actions: Record<string, AgentBridgeAction>;
  flows: Record<string, AgentBridgeFlow>;
  entities?: Record<string, AgentBridgeEntity>;
};

export type AgentBridgeAction = {
  id: string;
  description: string;
  endpoint: string;
  method: string;
  requestFormat: {
    contentType: string;
    parameters?: Record<
      string,
      {
        description: string;
        in: "path" | "query";
        required?: boolean;
        example?: unknown;
        schema?: unknown;
      }
    >;
    body?: unknown;
  };
  responseFormat: {
    contentType: string;
    schema?: unknown;
    example?: unknown;
  };
  errors: {
    code: number;
    reason: string;
    resolution?: string;
  }[];
};

export type AgentBridgeFlow = {
  id: string;
  description: string;
  parameters: {
    name: string;
    description: string;
    required?: boolean;
    type: string;
    schema?: unknown;
  }[];
  response: {
    schema: {
      type: "object";
      properties: Record<
        string,
        {
          type: string;
          description: string;
        }
      >;
    };
  };
  steps: {
    actionId: string;
    description: string;
  }[];
  dataFlow: {
    from: string; // Format: "$.paramName" or "actionId.field.path"
    to: string; // Format: "actionId.paramName" or "$.outputField"
    description: string;
  }[];
};

export type AgentBridgeEntity = {
  id: string;
  properties: Record<
    string,
    {
      type: string;
      description: string;
      items?: unknown;
    }
  >;
};
