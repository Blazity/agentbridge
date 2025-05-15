import SwaggerParser from "@apidevtools/swagger-parser";
import {
  NormalizedEndpoint,
  NormalizedInterim,
  NormalizedParameter,
  NormalizedRequestBody,
  NormalizedResponse,
  NormalizedEmptyResponse,
} from "./normalized-interim";
import { Entity } from "./enhanced-interim";
import { sanitizeName } from "./utils";
import { logger } from "./logger";
import { OpenAPI, OpenAPIV3, OpenAPIV3_1 } from "openapi-types";

type V3Document = OpenAPIV3.Document | OpenAPIV3_1.Document;

export class OpenAPISpecNormalizer {
  async parseAndNormalize(openApiSpec: unknown): Promise<NormalizedInterim> {
    try {
      const parsedSpec = await SwaggerParser.validate(
        openApiSpec as OpenAPI.Document,
      );

      if (!("openapi" in parsedSpec)) {
        logger.info(
          "Detected Swagger 2.0 specification, converting to OpenAPI 3.0...",
        );
        const convertedSpec = await this.convertSwagger2ToOpenAPI3(parsedSpec);
        return this.normalize(convertedSpec);
      }

      return this.normalize(parsedSpec);
    } catch (error) {
      logger.error("Error parsing OpenAPI spec");
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid OpenAPI specification: ${errorMessage}`);
    }
  }

  private async convertSwagger2ToOpenAPI3(swagger2Spec: OpenAPI.Document) {
    try {
      logger.startSpinner("Converting Swagger 2.0 to OpenAPI 3.0...");
      const response = await fetch("https://converter.swagger.io/api/convert", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(swagger2Spec),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Conversion failed: ${response.status} ${errorText}`);
      }

      const convertedSpec = await response.json();
      logger.stopSpinner("Successfully converted to OpenAPI 3.0");
      return convertedSpec as V3Document;
    } catch (error) {
      logger.error("Error converting Swagger 2.0 to OpenAPI 3.0");
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Conversion failed: ${errorMessage}`);
    }
  }

  private normalize(spec: V3Document): NormalizedInterim {
    const baseUrl = this.getBaseUrl(spec);
    const authentication = this.getAuthentication(spec);
    const endpoints = this.getEndpoints(spec);
    const schemas = this.extractSchemas(spec);
    const entities = this.extractEntities(schemas);

    return {
      info: {
        title: spec.info.title,
        description: spec.info.description,
        version: spec.info.version,
        baseUrl,
      },
      authentication,
      endpoints,
      schemas,
      entities,
    };
  }

  private getBaseUrl(spec: V3Document): string {
    if (spec.servers && spec.servers.length > 0) {
      return spec.servers[0].url;
    }

    throw new Error("No base URL found in OpenAPI spec");
  }

  private getAuthentication(
    spec: V3Document,
  ): NormalizedInterim["authentication"] {
    if (spec.components?.securitySchemes) {
      for (const scheme of Object.values(spec.components.securitySchemes)) {
        if ("type" in scheme && scheme.type === "apiKey") {
          const implementationType =
            scheme.in === "header" ? "headers" : "queryParameters";

          return {
            type: "credential",
            parameters: {
              api_key: {
                description: scheme.description ?? "API Key for authentication",
              },
            },
            implementation: {
              [implementationType]: {
                [scheme.name]: "${api_key}",
              },
            },
          };
        }

        if (
          "type" in scheme &&
          scheme.type === "http" &&
          scheme.scheme === "bearer"
        ) {
          return {
            type: "credential",
            parameters: {
              bearer_token: {
                description:
                  scheme.description ?? "Bearer token for authentication",
              },
            },
            implementation: {
              headers: {
                Authorization: "Bearer ${bearer_token}",
              },
            },
          };
        }
      }
    }

    return undefined;
  }

  private getEndpoints(spec: V3Document): NormalizedEndpoint[] {
    if (spec.paths) {
      return Object.entries(spec.paths)
        .map(([path, pathItem]) => {
          if (!pathItem) return;
          for (const [method, operation] of Object.entries(pathItem)) {
            if (
              !Object.values(OpenAPIV3.HttpMethods).includes(
                method as OpenAPIV3.HttpMethods,
              )
            ) {
              continue;
            }

            const pathLevelParams =
              (pathItem as OpenAPIV3.PathItemObject).parameters ?? [];

            return this.normalizeEndpoint(
              path,
              method.toUpperCase(),
              operation as OpenAPIV3.OperationObject,
              pathLevelParams as OpenAPIV3.ParameterObject[],
            );
          }
        })
        .filter(endpoint => endpoint !== undefined && endpoint !== null);
    }

    throw new Error("No endpoints found in OpenAPI spec");
  }

  private normalizeEndpoint(
    path: string,
    method: string,
    operation: OpenAPIV3.OperationObject,
    pathParameters: OpenAPIV3.ParameterObject[] = [],
  ): NormalizedEndpoint | null {
    const operationId = sanitizeName(
      operation.operationId || `${method}_${path}`,
    );

    const combinedParams: OpenAPIV3.ParameterObject[] = [
      ...pathParameters,
      ...(operation.parameters ?? []),
    ].filter(Boolean) as OpenAPIV3.ParameterObject[];

    const seen = new Set<string>();
    const parameters = combinedParams
      .filter(param => {
        const key = `${param.in}:${param.name}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map(param => this.normalizeParameter(param));

    if (path.includes("{")) {
      const pathParams = path.match(/{([^}]+)}/g) || [];
      for (const pathParam of pathParams) {
        const paramName = pathParam.slice(1, -1);
        if (!parameters.some(p => p.name === paramName && p.in === "path")) {
          parameters.push({
            name: paramName,
            in: "path",
            required: true,
            description: `${paramName} parameter`,
            schema: { type: "string" },
          });
        }
      }
    }

    const requestBody = operation.requestBody
      ? this.normalizeRequestBody(
          operation.requestBody as OpenAPIV3.RequestBodyObject,
        )
      : undefined;

    if (requestBody === null) {
      // TODO: Extend support for other content types, for now we skip the endpoint if the
      // input format is not application/json
      return null;
    }

    const responses = this.normalizeResponses(operation.responses);

    return {
      id: operationId,
      path,
      method,
      operationId,
      summary: operation.summary ?? "",
      description: operation.description ?? "",
      parameters,
      requestBody,
      responses,
      tags: operation.tags ?? [],
    };
  }

  private normalizeParameter(
    param: OpenAPIV3.ParameterObject,
  ): NormalizedParameter {
    return {
      name: param.name,
      in: param.in,
      required: param.required || false,
      description: param.description || `${param.name} parameter`,
      // @ts-expect-error TODO: Incompatible because of $ref options, we dereference the entire schema
      // when parsing, so we should figure out how to exclude the $ref from types to avoid ts errors
      schema: param.schema as OpenAPIV3.SchemaObject,
      example: param.example,
    };
  }

  private normalizeRequestBody(
    requestBody: OpenAPIV3.RequestBodyObject,
  ): NormalizedRequestBody | null {
    if (!requestBody || !requestBody.content) {
      return null;
    }

    if ("application/json" in requestBody.content) {
      return {
        contentType: "application/json",
        // @ts-expect-error TODO: Incompatible because of $ref options, we dereference the entire schema
        // when parsing, so we should figure out how to exclude the $ref from types to avoid ts errors
        schema: requestBody.content["application/json"]
          .schema as OpenAPIV3.SchemaObject,
      };
    }

    return null;
  }

  private normalizeResponses(responses: OpenAPIV3.ResponsesObject) {
    const normalizedResponses: Record<
      string,
      NormalizedResponse | NormalizedEmptyResponse
    > = {};

    for (const [statusCode, response] of Object.entries(responses)) {
      const typedResponse = response as OpenAPIV3.ResponseObject;

      if (!typedResponse.content) {
        normalizedResponses[statusCode] = {
          description: typedResponse.description,
        };
        continue;
      }

      if ("application/json" in typedResponse.content) {
        normalizedResponses[statusCode] = {
          description: typedResponse.description,
          contentType: "application/json",
          // @ts-expect-error TODO: Incompatible because of $ref options, we dereference the entire schema
          // when parsing, so we should figure out how to exclude the $ref from types to avoid ts errors
          schema: typedResponse.content["application/json"]
            .schema as OpenAPIV3.SchemaObject,
          example: typedResponse.content["application/json"].example,
        };
      }
    }

    return normalizedResponses;
  }

  private extractSchemas(spec: V3Document): Record<string, unknown> {
    return spec.components?.schemas ?? {};
  }

  private extractEntities(
    schemas: Record<string, unknown>,
  ): Record<string, Entity> {
    const entities: Record<string, Entity> = {};

    for (const [schemaName, schema] of Object.entries(schemas)) {
      const sch = schema as {
        description?: string;
        properties?: Record<string, unknown>;
      };

      const properties = this.extractEntityProperties(sch.properties || {});

      // Skip entities that have no valid properties (would fail schema minProperties)
      if (Object.keys(properties).length === 0) {
        continue;
      }

      entities[schemaName] = {
        id: schemaName,
        description: sch.description || schemaName,
        properties,
      };
    }

    return entities;
  }

  private extractEntityProperties(
    schemaProperties: Record<string, unknown>,
  ): Record<string, { type: string; description: string; format?: string }> {
    const properties: Record<
      string,
      { type: string; description: string; format?: string }
    > = {};

    for (const [propName, propSchema] of Object.entries(schemaProperties)) {
      if (propName.startsWith("@")) continue;

      const cleanName = sanitizeName(propName);
      if (!cleanName) continue;

      const ps = propSchema as {
        type?: string;
        description?: string;
        format?: string;
      };

      properties[cleanName] = {
        type: (ps.type as string) || "string",
        description: ps.description || "",
      };
      if (ps.format) properties[cleanName].format = ps.format;
    }

    return properties;
  }
}
