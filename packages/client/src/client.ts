import {
  AgentBridgeOutput,
  AgentBridgeAction,
  AgentBridgeFlow,
} from "@agent-bridge/core";
import { jsonSchema, tool, type ToolSet } from "ai";

export enum LogLevel {
  NONE = 0,
  ERROR = 1,
  WARN = 2,
  INFO = 3,
  DEBUG = 4,
  TRACE = 5,
}

export class AgentBridgeClient {
  private readonly schema: AgentBridgeOutput;
  private readonly credentials: Record<string, string>;
  private readonly baseUrl: string;
  private readonly logLevel: LogLevel;

  private readonly tools: ToolSet;

  /**
   * Creates a new AgentBridge client instance
   * @param schema The AgentBridge output object describing API and flows
   * @param credentials Authentication credentials for the API
   * @param logLevel Logging level for client operations
   */
  constructor(
    schema: AgentBridgeOutput,
    credentials: Record<string, string> = {},
    logLevel: LogLevel = LogLevel.INFO
  ) {
    this.schema = schema;
    this.credentials = credentials;
    this.baseUrl = schema.info.baseUrl.replace(/\/*$/, "");
    this.logLevel = logLevel;

    this.tools = this.buildTools();
    this.log(
      LogLevel.INFO,
      "AgentBridgeClient",
      `Initialized with base URL: ${this.baseUrl}`
    );
  }

  /**
   * Returns a list of all available API actions
   * @returns Array of AgentBridgeAction objects
   */
  public listActions(): AgentBridgeAction[] {
    return Object.values(this.schema.actions);
  }

  /**
   * Returns a list of all available flows
   * @returns Array of AgentBridgeFlow objects
   */
  public listFlows(): AgentBridgeFlow[] {
    return Object.values(this.schema.flows);
  }

  /**
   * Executes a single API action
   * @param actionId ID of the action to execute
   * @param params Parameters for the action
   * @param body Optional request body for the action
   * @returns Promise resolving to the action result
   */
  public async executeAction(
    actionId: string,
    params: Record<string, any> = {},
    body?: any
  ): Promise<any> {
    const startTime = Date.now();
    this.log(LogLevel.INFO, "executeAction", `Starting action '${actionId}'`);
    this.log(
      LogLevel.DEBUG,
      "executeAction",
      `Parameters: ${JSON.stringify(params)}`
    );
    if (body) {
      this.log(
        LogLevel.DEBUG,
        "executeAction",
        `Request body: ${JSON.stringify(body)}`
      );
    }

    const action = this.schema.actions[actionId];
    if (!action) {
      this.log(LogLevel.ERROR, "executeAction", `Unknown action '${actionId}'`);
      throw new Error(`Unknown action '${actionId}'`);
    }

    this.log(
      LogLevel.DEBUG,
      "executeAction",
      `Found action definition: ${action.method} ${action.endpoint}`
    );

    const { path, remainingParams } = this.substitutePathParams(
      action.endpoint,
      params
    );

    this.log(
      LogLevel.DEBUG,
      "executeAction",
      `Path after parameter substitution: ${path}`
    );
    this.log(
      LogLevel.TRACE,
      "executeAction",
      `Remaining parameters: ${JSON.stringify(remainingParams)}`
    );

    const url = new URL(`${this.baseUrl}${path}`);
    this.log(
      LogLevel.DEBUG,
      "executeAction",
      `Base URL constructed: ${url.toString()}`
    );

    if (this.schema.authentication?.implementation.queryParameters) {
      this.log(
        LogLevel.DEBUG,
        "executeAction",
        "Applying authentication query parameters"
      );
      for (const [qp, template] of Object.entries(
        this.schema.authentication.implementation.queryParameters
      )) {
        const value = this.applyAuthenticationTemplate(template);
        if (value) {
          url.searchParams.append(qp, value);
          this.log(
            LogLevel.TRACE,
            "executeAction",
            `Added auth query param: ${qp}`
          );
        }
      }
    }

    if (action.requestFormat.parameters) {
      this.log(
        LogLevel.DEBUG,
        "executeAction",
        "Processing request parameters"
      );
      for (const [name, def] of Object.entries(
        action.requestFormat.parameters
      )) {
        if (def.in === "query" && name in remainingParams) {
          const value = remainingParams[name];
          url.searchParams.append(name, String(value));
          this.log(
            LogLevel.TRACE,
            "executeAction",
            `Added query param: ${name}=${String(value)}`
          );
          delete remainingParams[name];
        }
      }
    }

    const headers: Record<string, string> = {
      "Content-Type": action.requestFormat.contentType,
    };
    this.log(
      LogLevel.DEBUG,
      "executeAction",
      `Content-Type: ${action.requestFormat.contentType}`
    );

    if (this.schema.authentication?.implementation.headers) {
      this.log(
        LogLevel.DEBUG,
        "executeAction",
        "Applying authentication headers"
      );
      for (const [name, template] of Object.entries(
        this.schema.authentication.implementation.headers
      )) {
        headers[name] = this.applyAuthenticationTemplate(template);
        this.log(LogLevel.TRACE, "executeAction", `Added auth header: ${name}`);
      }
    }

    this.log(
      LogLevel.INFO,
      "executeAction",
      `Sending ${action.method} request to ${url.toString()}`
    );

    try {
      const response = await fetch(url.toString(), {
        method: action.method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      this.log(
        LogLevel.INFO,
        "executeAction",
        `Response received: ${response.status} ${response.statusText}`
      );

      if (!response.ok) {
        const errorText = await response.text();
        this.log(
          LogLevel.ERROR,
          "executeAction",
          `Request failed (${response.status}): ${errorText}`
        );
        throw new Error(`Request failed (${response.status}): ${errorText}`);
      }

      const contentType = response.headers.get("content-type") || "";
      this.log(
        LogLevel.DEBUG,
        "executeAction",
        `Response content-type: ${contentType}`
      );

      let result;
      if (/json/i.test(contentType)) {
        try {
          result = await response.json();
          this.log(
            LogLevel.DEBUG,
            "executeAction",
            "Successfully parsed JSON response"
          );
          this.log(
            LogLevel.TRACE,
            "executeAction",
            `Response data: ${JSON.stringify(result)}`
          );
        } catch (error) {
          this.log(
            LogLevel.WARN,
            "executeAction",
            `Failed to parse JSON response: ${error}`
          );
          result = await response.text();
        }
      } else {
        result = await response.text();
        this.log(
          LogLevel.DEBUG,
          "executeAction",
          `Received text response (${result.length} chars)`
        );
      }

      const duration = Date.now() - startTime;
      this.log(
        LogLevel.INFO,
        "executeAction",
        `Completed action '${actionId}' in ${duration}ms`
      );

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.log(
        LogLevel.ERROR,
        "executeAction",
        `Failed action '${actionId}' after ${duration}ms: ${error}`
      );
      throw error;
    }
  }

  /**
   * Executes a multi-step flow
   * @param flowId ID of the flow to execute
   * @param params Parameters for the flow
   * @returns Promise resolving to the flow result
   */
  public async executeFlow(
    flowId: string,
    params: Record<string, any> = {}
  ): Promise<any> {
    const startTime = Date.now();
    this.log(LogLevel.INFO, "executeFlow", `Starting flow '${flowId}'`);
    this.log(
      LogLevel.DEBUG,
      "executeFlow",
      `Parameters: ${JSON.stringify(params)}`
    );

    const flow = this.schema.flows[flowId];
    if (!flow) {
      this.log(LogLevel.ERROR, "executeFlow", `Unknown flow '${flowId}'`);
      throw new Error(`Unknown flow '${flowId}'`);
    }

    this.log(
      LogLevel.DEBUG,
      "executeFlow",
      `Found flow definition with ${flow.steps.length} steps`
    );

    const context: Record<string, any> = { $: { ...params } };
    this.log(
      LogLevel.TRACE,
      "executeFlow",
      `Initial context: ${JSON.stringify(context)}`
    );

    for (let i = 0; i < flow.steps.length; i++) {
      const step = flow.steps[i];
      this.log(
        LogLevel.INFO,
        "executeFlow",
        `Executing step ${i + 1}/${flow.steps.length}: ${step.actionId}`
      );

      const action = this.schema.actions[step.actionId];
      if (!action) {
        this.log(
          LogLevel.ERROR,
          "executeFlow",
          `Step refers to unknown action '${step.actionId}'`
        );
        throw new Error(`Step refers to unknown action '${step.actionId}'`);
      }

      // Gather parameters for this step from dataFlow definitions
      const stepParams: Record<string, any> = {};
      this.log(
        LogLevel.DEBUG,
        "executeFlow",
        `Resolving parameters for action '${step.actionId}'`
      );

      for (const mapping of flow.dataFlow) {
        // We only care about mappings whose destination is this step
        if (mapping.to.startsWith(`${step.actionId}.`)) {
          const destParam = mapping.to.replace(`${step.actionId}.`, "");
          stepParams[destParam] = this.resolvePath(mapping.from, context);
          this.log(
            LogLevel.TRACE,
            "executeFlow",
            `Mapped '${mapping.from}' to '${step.actionId}.${destParam}'`
          );
        }
      }

      this.log(
        LogLevel.DEBUG,
        "executeFlow",
        `Resolved parameters for step: ${JSON.stringify(stepParams)}`
      );

      try {
        const stepStartTime = Date.now();
        const result = await this.executeAction(step.actionId, stepParams);
        const stepDuration = Date.now() - stepStartTime;

        this.log(
          LogLevel.INFO,
          "executeFlow",
          `Completed step ${i + 1}/${flow.steps.length} in ${stepDuration}ms`
        );
        context[step.actionId] = result;
        this.log(
          LogLevel.TRACE,
          "executeFlow",
          `Updated context with result from '${step.actionId}'`
        );
      } catch (error) {
        this.log(
          LogLevel.ERROR,
          "executeFlow",
          `Step ${i + 1} (${step.actionId}) failed: ${error}`
        );
        throw new Error(
          `Flow '${flowId}' failed at step ${i + 1} (${step.actionId}): ${error}`
        );
      }
    }

    // Build final response object according to flow.response schema (simple map)
    // Use the result of the last action as the flow output
    const lastStepId = flow.steps[flow.steps.length - 1]?.actionId;
    const output = lastStepId && context[lastStepId] ? context[lastStepId] : {};

    this.log(
      LogLevel.DEBUG,
      "executeFlow",
      "Using last step result as flow output"
    );

    const duration = Date.now() - startTime;
    this.log(
      LogLevel.INFO,
      "executeFlow",
      `Completed flow '${flowId}' in ${duration}ms`
    );
    this.log(
      LogLevel.DEBUG,
      "executeFlow",
      `Flow result: ${JSON.stringify(output)}`
    );

    return output;
  }

  /**
   * Returns AI tooling definitions for all API actions and flows
   * @returns ToolSet object with all available tools
   */
  public getTools(): ToolSet {
    return this.tools;
  }

  /**
   * Sets the logging level for the client
   * @param level The log level to use
   */
  public setLogLevel(level: LogLevel): void {
    this.log(
      LogLevel.INFO,
      "setLogLevel",
      `Changing log level from ${LogLevel[this.logLevel]} to ${LogLevel[level]}`
    );
    (this as any).logLevel = level; // Bypass readonly
  }

  /**
   * Logs a message at the specified level
   * @param level The log level
   * @param method The method name generating the log
   * @param message The message to log
   * @private
   */
  private log(level: LogLevel, method: string, message: string): void {
    if (level <= this.logLevel) {
      const timestamp = new Date().toISOString();
      const levelName = LogLevel[level];
      console.log(
        `[${timestamp}] [AgentBridgeClient] [${levelName}] [${method}] ${message}`
      );
    }
  }

  /**
   * Builds tool definitions for all API actions and flows
   * @returns ToolSet object with all available tools
   * @private
   */
  private buildTools() {
    this.log(LogLevel.DEBUG, "buildTools", "Building tool definitions");
    const tools: ToolSet = {};

    for (const action of Object.values(this.schema.actions)) {
      const requiredProperties = [];
      const parametersSchema: any = {
        type: "object",
        properties: {},
        required: [],
      };

      if (action.requestFormat.parameters) {
        requiredProperties.push("parameters");
        for (const [name, parameter] of Object.entries(
          action.requestFormat.parameters
        )) {
          parametersSchema.properties[name] = parameter.schema;
          if (parameter.required) {
            parametersSchema.required.push(name);
          }
        }
      }

      if (action.requestFormat.body) {
        requiredProperties.push("body");
      }

      const schema = {
        type: "object",
        required: requiredProperties,
        properties: {
          ...(action.requestFormat.body
            ? { body: action.requestFormat.body }
            : {}),
          ...(action.requestFormat.parameters
            ? { parameters: parametersSchema }
            : {}),
        },
      } as const;

      tools[action.id] = tool({
        description: action.description,
        parameters: jsonSchema<{
          body?: any;
          parameters?: Record<string, any>;
        }>(schema),
        execute: (parameters) => {
          this.log(
            LogLevel.TRACE,
            "buildTools",
            `Executing action tool: ${action.id}`
          );
          this.log(
            LogLevel.TRACE,
            "buildTools",
            `Parameters: ${JSON.stringify(parameters)}`
          );
          return this.executeAction(
            action.id,
            parameters.parameters,
            parameters.body
          );
        },
      });

      this.log(
        LogLevel.TRACE,
        "buildTools",
        `Built tool for action: ${action.id}\nSchema: ${JSON.stringify(schema)}`
      );
    }

    for (const flow of Object.values(this.schema.flows)) {
      const parametersSchema: any = {
        type: "object",
        properties: {},
        required: [],
      };

      if (flow.parameters) {
        for (const param of flow.parameters) {
          parametersSchema.properties[param.name] = param.schema;
          if (param.required) {
            parametersSchema.required.push(param.name);
          }
        }
      }

      tools[flow.id] = tool({
        description: flow.description,
        parameters: jsonSchema<any>(parametersSchema),
        execute: (parameters) => {
          this.log(
            LogLevel.TRACE,
            "buildTools",
            `Executing flow tool: ${flow.id}`
          );
          this.log(
            LogLevel.TRACE,
            "buildTools",
            `Parameters: ${JSON.stringify(parameters)}`
          );
          return this.executeFlow(flow.id, parameters);
        },
      });

      this.log(
        LogLevel.TRACE,
        "buildTools",
        `Built tool for flow: ${flow.id}\nSchema: ${JSON.stringify(parametersSchema)}`
      );
    }

    this.log(
      LogLevel.DEBUG,
      "buildTools",
      `Built ${Object.keys(tools).length} tools`
    );
    return tools;
  }

  /**
   * Substitutes path parameters in an endpoint template
   * @param endpoint Endpoint template with parameters in {brackes}
   * @param params Parameter values to substitute
   * @returns Object containing the substituted path and remaining parameters
   * @private
   */
  private substitutePathParams(
    endpoint: string,
    params: Record<string, any>
  ): { path: string; remainingParams: Record<string, any> } {
    this.log(
      LogLevel.DEBUG,
      "substitutePathParams",
      `Original endpoint: ${endpoint}`
    );

    let path = endpoint;
    const remaining: Record<string, any> = { ...params };

    path = path.replace(/\{([^}]+)\}/g, (_, key: string) => {
      if (!(key in params)) {
        this.log(
          LogLevel.ERROR,
          "substitutePathParams",
          `Missing path parameter '${key}'`
        );
        throw new Error(`Missing path parameter '${key}'`);
      }
      const value = params[key];
      delete remaining[key];
      this.log(
        LogLevel.TRACE,
        "substitutePathParams",
        `Substituted ${key} with ${value}`
      );
      return encodeURIComponent(String(value));
    });

    this.log(LogLevel.DEBUG, "substitutePathParams", `Final path: ${path}`);
    return { path, remainingParams: remaining };
  }

  /**
   * Applies credential values to an authentication template
   * @param template Template string with ${placeholders}
   * @returns String with placeholders replaced by credential values
   * @private
   */
  private applyAuthenticationTemplate(template: string): string {
    this.log(
      LogLevel.TRACE,
      "applyAuthenticationTemplate",
      `Applying template: ${template}`
    );

    return template.replace(/\$\{([^}]+)\}/g, (_, key: string) => {
      const val = this.credentials[key];
      if (val == null) {
        this.log(
          LogLevel.ERROR,
          "applyAuthenticationTemplate",
          `Missing credential '${key}'`
        );
        throw new Error(`Missing credential '${key}'`);
      }
      this.log(
        LogLevel.TRACE,
        "applyAuthenticationTemplate",
        `Applied credential for ${key}`
      );
      return val;
    });
  }

  /**
   * Resolves a data path from the execution context
   * @param path Path string (either $.foo or actionId.bar.baz format)
   * @param context Execution context with action results
   * @returns Resolved value from the path
   * @private
   */
  private resolvePath(path: string, context: Record<string, any>): any {
    this.log(
      LogLevel.TRACE,
      "resolvePath",
      `Resolving path: ${path}\nContext: ${JSON.stringify(context)}`
    );

    if (path.startsWith("$.")) {
      const result = this.getByPath(context["$"], path.substring(2));
      this.log(
        LogLevel.TRACE,
        "resolvePath",
        `Resolved $.${path.substring(2)} from input parameters`
      );
      return result;
    }

    const [actionId, rest] = path.split(/\.(.+)/, 2);
    if (!(actionId in context)) {
      this.log(
        LogLevel.ERROR,
        "resolvePath",
        `Cannot resolve path '${path}', no context for action '${actionId}'`
      );
      throw new Error(
        `Cannot resolve path '${path}', no context for action '${actionId}'`
      );
    }

    const result = this.getByPath(context[actionId], rest);
    this.log(
      LogLevel.TRACE,
      "resolvePath",
      `Resolved ${actionId}.${rest} from action result`
    );
    return result;
  }

  /**
   * Gets a nested property from an object using dot notation path
   * @param obj Source object to traverse
   * @param path Path string in dot notation, supports array indexing with brackets
   * @returns Value at the specified path or undefined if not found
   * @private
   */
  private getByPath(obj: any, path: string): any {
    if (!path) return obj;

    const parts = [];
    let current = "";
    let inBrackets = false;

    for (let i = 0; i < path.length; i++) {
      const char = path[i];

      if (char === "." && !inBrackets) {
        if (current) {
          parts.push(current);
          current = "";
        }
      } else if (char === "[") {
        if (current) {
          parts.push(current);
          current = "";
        }
        inBrackets = true;
        // Don't add the bracket to current
      } else if (char === "]" && inBrackets) {
        inBrackets = false;
        // Don't add the bracket to current
      } else {
        current += char;
      }
    }

    if (current) {
      parts.push(current);
    }

    // Navigate through object using the parsed parts
    const result = parts.reduce((acc, part) => {
      if (acc == null) return undefined;

      // If part is numeric, treat as array index
      const index = Number(part);
      if (!isNaN(index) && Array.isArray(acc)) {
        return acc[index];
      }

      return acc[part];
    }, obj);

    if (result === undefined) {
      this.log(
        LogLevel.WARN,
        "getByPath",
        `Path '${path}' resolved to undefined`
      );
    }

    return result;
  }
}
