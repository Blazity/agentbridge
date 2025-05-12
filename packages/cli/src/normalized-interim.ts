type NonArraySchemaObjectType =
  | "boolean"
  | "object"
  | "number"
  | "string"
  | "integer";
type ArraySchemaObjectType = "array";
type SchemaObject = ArraySchemaObject | NonArraySchemaObject;
type ArraySchemaObject = {
  type: ArraySchemaObjectType;
  items: SchemaObject;
} & BaseSchemaObject
type NonArraySchemaObject = {
  type?: NonArraySchemaObjectType;
} & BaseSchemaObject
type BaseSchemaObject = {
  title?: string;
  description?: string;
  format?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default?: any;
  multipleOf?: number;
  maximum?: number;
  exclusiveMaximum?: boolean;
  minimum?: number;
  exclusiveMinimum?: boolean;
  maxLength?: number;
  minLength?: number;
  pattern?: string;
  required?: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  enum?: any[];
  properties?: Record<string, SchemaObject>;
  nullable?: boolean;
}

export type NormalizedInterim = {
  info: {
    title: string;
    description?: string;
    version: string;
    baseUrl: string;
  };
  authentication?: {
    type: string;
    parameters: Record<string, { description: string }>;
    implementation: {
      headers?: Record<string, string>;
      queryParameters?: Record<string, string>;
    };
  };
  endpoints: NormalizedEndpoint[];
  schemas: Record<string, unknown>;
  entities?: Record<
    string,
    {
      id: string;
      description: string;
      properties: Record<
        string,
        {
          type: string;
          description: string;
          format?: string;
        }
      >;
    }
  >;
}

export type NormalizedRequestBody = {
  contentType: string;
  schema: SchemaObject;
};

export type NormalizedResponse = {
  description: string;
  contentType: string;
  schema: SchemaObject;
  example?: unknown;
};

export type NormalizedEmptyResponse = {
  description?: string;
};

export type NormalizedEndpoint = {
  id: string; // Generated unique ID
  path: string; // Original path with parameters
  method: string; // HTTP method
  operationId: string; // Original or generated operation ID
  summary: string; // Brief description
  description: string; // Full description
  parameters: NormalizedParameter[];
  requestBody?: NormalizedRequestBody;
  responses: Record<string, NormalizedResponse | NormalizedEmptyResponse>;
  tags: string[]; // Original grouping tags
};

export type NormalizedParameter = {
  name: string;
  in: string; // path, query, header, body
  required: boolean;
  description: string;
  schema: SchemaObject;
  example?: unknown;
};
