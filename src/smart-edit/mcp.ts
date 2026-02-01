import type { RegisteredTool, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  StreamableHTTPServerTransport,
  type StreamableHTTPServerTransportOptions
} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { ServerOptions } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ErrorCode,
  McpError,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  type Implementation,
  type CallToolResult,
  type ServerNotification,
  type ServerRequest
} from '@modelcontextprotocol/sdk/types.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { URL as NodeURL } from 'node:url';
import type { URL as NodeURLType } from 'node:url';

import {
  z,
  type AnyZodObject,
  type ZodDefault,
  type ZodEffects,
  type ZodNullable,
  type ZodOptional,
  type ZodRawShape,
  type ZodTypeAny
} from 'zod';
import { zodToJsonSchema, type JsonSchema7Type } from 'zod-to-json-schema';

import { DEFAULT_CONTEXT, DEFAULT_MODES } from './constants.js';
import { SmartEditAgentContext, SmartEditAgentMode } from './config/context_mode.js';
import { SmartEditConfig } from './config/smart_edit_config.js';
import { createRequire } from 'node:module';
import { showFatalExceptionSafe } from './util/exception.js';
import { createSmartEditLogger } from './util/logging.js';
import type { MemoryLogHandler } from './util/logging.js';
import type { MemoriesManagerLike, PromptFactoryLike, SmartEditAgentLike, Tool } from './tools/tools_base.js';
import { SmartEditAgent } from './agent.js';

const require = createRequire(import.meta.url);
const packageJson = require('../../package.json') as { version?: string; name?: string };

const { logger: log } = createSmartEditLogger({ name: 'smart-edit.mcp' });

export interface SmartEditMCPRequestContext {
  agent: SmartEditAgentLike;
}

export interface SmartEditAgentFactoryOptions {
  project: string | null;
  smartEditConfig: SmartEditConfig;
  context: SmartEditAgentContext;
  modes: SmartEditAgentMode[];
  memoryLogHandler?: MemoryLogHandler | null;
}

export type SmartEditAgentFactory = (options: SmartEditAgentFactoryOptions) => SmartEditAgentLike;

export interface SmartEditMCPServerOptions {
  host?: string;
  port?: number;
  modes?: Iterable<string>;
  enableWebDashboard?: boolean | null;
  enableGuiLogWindow?: boolean | null;
  logLevel?: 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL' | null;
  traceLspCommunication?: boolean | null;
  toolTimeout?: number | null;
  instructionsOverride?: string | null;
  serverInfo?: Implementation;
  serverOptions?: ServerOptions;
}

export type SmartEditHttpRequestHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

export interface SmartEditHttpServerOptions extends SmartEditMCPServerOptions {
  path?: string;
  transportOptions?: Partial<StreamableHTTPServerTransportOptions>;
  sessionIdGenerator?: (() => string) | null;
}

export interface SmartEditHttpServerInstance {
  httpServer: HttpServer;
  transport: StreamableHTTPServerTransport;
  mcpServer: McpServer;
  url: NodeURLType;
  close(): Promise<void>;
}

export interface SmartEditGrpcServerOptions extends SmartEditMCPServerOptions {
  address?: string;
}

function unwrapZodObject(schema: ZodTypeAny | undefined): AnyZodObject | undefined {
  if (!schema) {
    return undefined;
  }
  if (schema instanceof z.ZodObject) {
    return schema;
  }
  if (schema instanceof z.ZodEffects) {
    const inner = (schema as ZodEffects<AnyZodObject>)._def.schema;
    return unwrapZodObject(inner as ZodTypeAny);
  }
  if (schema instanceof z.ZodDefault) {
    const inner = (schema as ZodDefault<AnyZodObject>)._def.innerType;
    return unwrapZodObject(inner as ZodTypeAny);
  }
  if (schema instanceof z.ZodNullable || schema instanceof z.ZodOptional) {
    const base = (schema as ZodNullable<AnyZodObject> | ZodOptional<AnyZodObject>).unwrap();
    return unwrapZodObject(base as ZodTypeAny);
  }
  return undefined;
}

function toZodRawShape(schema: ZodTypeAny | undefined): ZodRawShape | undefined {
  const objectSchema = unwrapZodObject(schema);
  if (!objectSchema) {
    return undefined;
  }
  return objectSchema.shape as ZodRawShape;
}

type JsonPrimitive = string | number | boolean | null;
interface JsonObject {
  [key: string]: JsonSchemaNode | undefined;
}
type JsonSchemaNode = JsonPrimitive | JsonObject | JsonSchemaNode[];

function isJsonObject(value: JsonSchemaNode | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepCloneJsonValue(value: JsonSchemaNode): JsonSchemaNode {
  if (Array.isArray(value)) {
    return value.map((item) => deepCloneJsonValue(item));
  }
  if (isJsonObject(value)) {
    const clone: JsonObject = {};
    for (const [key, child] of Object.entries(value)) {
      clone[key] = child === undefined ? undefined : deepCloneJsonValue(child);
    }
    return clone;
  }
  return value;
}

function cloneJsonSchema(schema: JsonSchema7Type): JsonSchema7Type {
  const structured = (globalThis as { structuredClone?: <T>(value: T) => T }).structuredClone;
  if (typeof structured === 'function') {
    return structured(schema);
  }
  return deepCloneJsonValue(schema as unknown as JsonSchemaNode) as JsonSchema7Type;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeJsonSchemaForOpenAi(schema: JsonSchema7Type): JsonSchema7Type {
  const cloned = cloneJsonSchema(schema);

  const walk = (node: JsonSchemaNode): JsonSchemaNode => {
    if (Array.isArray(node)) {
      return node.map((item) => walk(item));
    }

    if (isJsonObject(node)) {
      const record = node;
      const typeValue = record['type'];

      if (typeof typeValue === 'string') {
        if (typeValue === 'integer') {
          record['type'] = 'number';
          if (record['multipleOf'] === undefined) {
            record['multipleOf'] = 1;
          }
        }
      } else if (Array.isArray(typeValue)) {
        const stringEntries = typeValue.filter((entry): entry is string => typeof entry === 'string');
        const filteredStrings = stringEntries
          .map((entry) => (entry === 'integer' ? 'number' : entry))
          .filter((entry) => entry !== 'null');
        if (filteredStrings.length === 0) {
          record['type'] = 'object';
        } else if (filteredStrings.length === 1) {
          record['type'] = filteredStrings[0];
        } else {
          record['type'] = filteredStrings;
        }
        if (stringEntries.includes('integer') || filteredStrings.includes('number')) {
          record['multipleOf'] = record['multipleOf'] ?? 1;
        }
      }

      const enumValue = record['enum'];
      if (Array.isArray(enumValue)) {
        const values = enumValue as JsonSchemaNode[];
        if (values.length > 0 && values.every((value) => typeof value === 'number' && Number.isInteger(value))) {
          record['type'] = record['type'] ?? 'number';
          record['multipleOf'] = record['multipleOf'] ?? 1;
        }
      }

      for (const key of ['oneOf', 'anyOf'] as const) {
        const value = record[key];
        if (Array.isArray(value)) {
          const sanitized = value.map((entry) => walk(entry));
          if (sanitized.length === 2) {
            const types = sanitized.map((entry) => (isJsonObject(entry) ? entry['type'] : undefined));
            if (types.includes('null')) {
              const nonNullIndex = types.findIndex((type) => type !== 'null');
              const nonNull = nonNullIndex >= 0 ? sanitized[nonNullIndex] : undefined;
              if (isJsonObject(nonNull)) {
                Object.assign(record, nonNull);
                delete record[key];
                continue;
              }
            }
          }

          try {
            const serialized = sanitized.map((entry) => JSON.stringify(entry));
            const unique = new Set(serialized);
            if (unique.size === 1) {
              const only = sanitized[0];
              if (isJsonObject(only)) {
                Object.assign(record, only);
                delete record[key];
                continue;
              }
            }
          } catch {
            // Keep original structure if serialization fails.
          }

          record[key] = sanitized;
        }
      }

      for (const [key, value] of Object.entries(record)) {
        if (value === undefined) {
          continue;
        }
        if (Array.isArray(value) || isJsonObject(value)) {
          record[key] = walk(value);
        }
      }

      return record;
    }

    return node;
  };

  return walk(cloned as JsonSchemaNode) as JsonSchema7Type;
}

function maybeCreateJsonSchema(schema: ZodTypeAny | undefined, options: { name: string; sanitizeForOpenAiTools?: boolean }): JsonSchema7Type | undefined {
  const objectSchema = unwrapZodObject(schema);
  if (!objectSchema) {
    return undefined;
  }
  const jsonSchema = zodToJsonSchema(objectSchema, {
    name: options.name,
    target: 'jsonSchema7',
    $refStrategy: 'none'
  }) as JsonSchema7Type;

  if (!jsonSchema || typeof jsonSchema !== 'object') {
    return undefined;
  }

  if (options.sanitizeForOpenAiTools) {
    return sanitizeJsonSchemaForOpenAi(jsonSchema);
  }

  return jsonSchema;
}

function createDefaultServerInfo(): Implementation {
  const version = typeof packageJson.version === 'string' ? packageJson.version : '0.0.0';
  return {
    name: 'smart-edit',
    version
  };
}

/*
 * NOTE: The MCP SDK currently ships without fully typed ESM re-exports, which
 * causes TypeScript to treat several helper methods as `any`. We perform
 * runtime guards before calling into the SDK and suppress the lint warnings
 * locally to avoid scattering disable directives at call sites.
 */
function registerToolWithServer<InputShape extends ZodRawShape>(
  server: McpServer,
  options: {
    name: string;
    description: string;
    inputSchema: InputShape;
    annotations?: Record<string, unknown>;
    callback: ToolCallback<InputShape>;
    outputSchema?: ZodRawShape;
  }
): RegisteredTool {
  const toolMethod: McpServer['tool'] = server.tool.bind(server);
  const registered =
    options.annotations && Object.keys(options.annotations).length > 0
      ? toolMethod(options.name, options.description, options.inputSchema, options.annotations, options.callback)
      : toolMethod(options.name, options.description, options.inputSchema, options.callback);
  if (options.outputSchema) {
    registered.update({ outputSchema: options.outputSchema });
  }
  const serverWithTracking = server as unknown as {
    __smartEditRegisteredTools?: Map<
      string,
      {
        description?: string;
        annotations?: Record<string, unknown>;
        _meta?: Record<string, unknown>;
        callback: ToolCallback<InputShape>;
      }
    >;
  };
  serverWithTracking.__smartEditRegisteredTools ??= new Map();
  const annotations =
    options.annotations && Object.keys(options.annotations).length > 0 ? options.annotations : undefined;
  serverWithTracking.__smartEditRegisteredTools.set(options.name, {
    description: options.description,
    annotations,
    _meta: undefined,
    callback: options.callback
  });
  return registered;
}

export abstract class SmartEditMCPFactory {
  protected readonly context: SmartEditAgentContext;
  protected readonly project: string | null;
  private agent: SmartEditAgentLike | null = null;
  private requestContext: SmartEditMCPRequestContext | null = null;

  protected constructor(context: string = DEFAULT_CONTEXT, project: string | null = null) {
    this.context = SmartEditAgentContext.load(context);
    this.project = project ?? null;
  }

  protected getAgent(): SmartEditAgentLike {
    if (!this.agent) {
      throw new Error('Smart-Edit agent has not been instantiated yet.');
    }
    return this.agent;
  }

  protected setAgent(agent: SmartEditAgentLike): void {
    this.agent = agent;
    this.requestContext = { agent };
  }

  protected getRequestContext(): SmartEditMCPRequestContext {
    if (!this.requestContext) {
      throw new Error('Request context not initialized.');
    }
    return this.requestContext;
  }

  protected abstract instantiateAgent(options: {
    smartEditConfig: SmartEditConfig;
    modes: SmartEditAgentMode[];
  }): SmartEditAgentLike;

  protected abstract iterTools(): Iterable<Tool>;

  protected abstract getInitialInstructions(): string;

  protected isOpenAiCompatibleContext(): boolean {
    return ['chatgpt', 'codex', 'oaicompat-agent'].includes(this.context.name);
  }

  private registerDefaultCapabilities(mcpServer: McpServer): void {
    const server = mcpServer.server;
    server.registerCapabilities({
      experimental: {},
      prompts: {
        listChanged: false
      },
      resources: {
        subscribe: false,
        listChanged: false
      }
    });

    const agent = this.getAgent();
    const promptFactory = agent.promptFactory;
    const memoriesManager = agent.memoriesManager;

    server.setRequestHandler(ListPromptsRequestSchema, () => ({
      prompts: this.buildPromptMetadata(promptFactory)
    }));

    server.setRequestHandler(GetPromptRequestSchema, (request) =>
      this.buildPromptResult(promptFactory, request.params.name, request.params.arguments ?? {})
    );

    server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: await this.buildResourceList(memoriesManager)
    }));

    server.setRequestHandler(ListResourceTemplatesRequestSchema, () => ({
      resourceTemplates: this.buildResourceTemplates(memoriesManager)
    }));

    server.setRequestHandler(ReadResourceRequestSchema, async (request) =>
      this.readResource(memoriesManager, request.params.uri)
    );
  }

  private buildPromptMetadata(promptFactory: PromptFactoryLike): {
    name: string;
    description?: string;
    arguments?: { name: string; description?: string; required?: boolean }[];
  }[] {
    const names = promptFactory.listPromptTemplateNames();
    return names.map((name: string) => {
      const params = promptFactory.getPromptTemplateParameters(name);
      return {
        name,
        description: this.describePromptTemplate(name),
        arguments:
          params.length === 0
            ? undefined
            : params.map((param: string) => ({
                name: param,
                required: true
              }))
      };
    });
  }

  private buildPromptResult(
    promptFactory: PromptFactoryLike,
    promptName: string,
    rawArgs: Record<string, unknown>
  ): {
    description?: string;
    messages: {
      role: 'assistant' | 'user';
      content: { type: 'text'; text: string }[];
    }[];
  } {
    if (!promptFactory.hasPromptTemplate(promptName)) {
      throw new McpError(ErrorCode.InvalidParams, `Prompt ${promptName} not found`);
    }
    const requiredParams = promptFactory.getPromptTemplateParameters(promptName);
    const missingParams = requiredParams.filter((param) => !(param in rawArgs));
    if (missingParams.length > 0) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Missing required arguments for prompt ${promptName}: ${missingParams.join(', ')}`
      );
    }
    const rendered = promptFactory.renderPrompt(promptName, rawArgs);
    return {
      description: this.describePromptTemplate(promptName),
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: rendered
            }
          ]
        }
      ]
    };
  }

  private describePromptTemplate(name: string): string | undefined {
    const readable = name.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!readable) {
      return undefined;
    }
    return readable.charAt(0).toUpperCase() + readable.slice(1);
  }

  private async buildResourceList(
    manager: MemoriesManagerLike | null
  ): Promise<
    {
      uri: string;
      name: string;
      description?: string;
      mimeType?: string;
    }[]
  > {
    if (!manager) {
      return [];
    }
    const names = await this.listMemories(manager);
    return names.map((name) => ({
      uri: this.formatMemoryUri(name),
      name,
      description: 'Smart-Edit project memory entry',
      mimeType: 'text/markdown'
    }));
  }

  private buildResourceTemplates(
    manager: MemoriesManagerLike | null
  ): {
    name: string;
    uriTemplate: string;
    description?: string;
    mimeType?: string;
  }[] {
    if (!manager) {
      return [];
    }
    return [
      {
        name: 'smart-edit-memory',
        uriTemplate: 'smart-edit://memory/{name}',
        description: 'Template for accessing Smart-Edit project memory entries',
        mimeType: 'text/markdown'
      }
    ];
  }

  private async readResource(
    manager: MemoriesManagerLike | null,
    uri: string
  ): Promise<{
    contents: { type: 'text'; text: string; mimeType?: string }[];
  }> {
    const memoryName = this.parseMemoryUri(uri);
    if (!memoryName) {
      throw new McpError(ErrorCode.InvalidParams, `Unsupported resource URI: ${uri}`);
    }
    if (!manager) {
      throw new McpError(ErrorCode.InvalidParams, 'Memory store is unavailable');
    }
    const content = await this.loadMemory(manager, memoryName);
    return {
      contents: [
        {
          type: 'text',
          text: content,
          mimeType: 'text/markdown'
        }
      ]
    };
  }

  private parseMemoryUri(uri: string): string | null {
    if (!uri.toLowerCase().startsWith('smart-edit://memory/')) {
      return null;
    }
    const suffix = uri.slice('smart-edit://memory/'.length);
    if (!suffix) {
      return null;
    }
    try {
      return decodeURIComponent(suffix);
    } catch {
      return suffix;
    }
  }

  private formatMemoryUri(name: string): string {
    return `smart-edit://memory/${encodeURIComponent(name)}`;
  }

  private async listMemories(manager: MemoriesManagerLike): Promise<string[]> {
    const listFn = this.bindManagerFunction(manager, ['listMemories', 'list_memories']) as () => unknown;
    const raw = await Promise.resolve(listFn());
    if (!raw) {
      return [];
    }
    if (Array.isArray(raw)) {
      return raw.map((entry) => this.stringifyUnknown(entry));
    }
    if (this.isIterable(raw)) {
      const result: string[] = [];
      for (const entry of raw) {
        result.push(this.stringifyUnknown(entry));
      }
      return result;
    }
    return [this.stringifyUnknown(raw)];
  }

  private async loadMemory(manager: MemoriesManagerLike, name: string): Promise<string> {
    const loadFn = this.bindManagerFunction(manager, ['loadMemory', 'load_memory']) as (name: string) => unknown;
    const raw = await Promise.resolve(loadFn(name));
    const text = this.stringifyUnknown(raw);
    return text;
  }

  private bindManagerFunction(
    manager: MemoriesManagerLike,
    candidateNames: readonly string[]
  ): (...args: unknown[]) => unknown {
    for (const candidate of candidateNames) {
      const fn = Reflect.get(manager as object, candidate) as unknown;
      if (typeof fn === 'function') {
        return (...fnArgs: unknown[]) => (fn as (...innerArgs: unknown[]) => unknown).apply(manager, fnArgs);
      }
    }
    throw new Error(`Memories manager does not implement any of: ${candidateNames.join(', ')}`);
  }

  private stringifyUnknown(value: unknown): string {
    if (value === undefined || value === null) {
      return '';
    }
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
      return value.toString();
    }
    if (typeof value === 'symbol') {
      return value.toString();
    }
    if (typeof value === 'function') {
      return '[function]';
    }
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch {
        return Object.prototype.toString.call(value);
      }
    }
    return '[unrecognized]';
  }

  private isIterable(value: unknown): value is Iterable<unknown> {
    return typeof value === 'object' && value !== null && Symbol.iterator in value;
  }

  protected registerTools(server: McpServer, openAiToolCompatible: boolean): void {
    const tools = Array.from(this.iterTools());
    for (const tool of tools) {
      this.registerTool(server, tool, openAiToolCompatible);
    }
    log.info(`Registered ${tools.length} MCP tools: ${tools.map((tool) => tool.getName()).join(', ')}`);
  }

  private registerTool(server: McpServer, tool: Tool, openAiToolCompatible: boolean): RegisteredTool {
    const toolName = tool.getName();
    const metadata = tool.getApplyFnMetadata();
    const descriptionOverride = this.context.toolDescriptionOverrides[toolName];
    let description = descriptionOverride ?? metadata.description ?? '';
    description = description.trim();
    if (description.length > 0 && !description.endsWith('.')) {
      description += '.';
    }

    const inputSchemaShape = toZodRawShape(metadata.inputSchema);
    if (!inputSchemaShape) {
      throw new Error(`Tool ${toolName} must expose a Zod object input schema.`);
    }
    const outputSchemaShape = toZodRawShape(metadata.outputSchema);

    const inputJsonSchema = openAiToolCompatible
      ? maybeCreateJsonSchema(metadata.inputSchema, {
          name: `${toolName}Input`,
          sanitizeForOpenAiTools: true
        })
      : undefined;

    const outputJsonSchema = metadata.outputSchema
      ? maybeCreateJsonSchema(metadata.outputSchema, {
          name: `${toolName}Output`,
          sanitizeForOpenAiTools: openAiToolCompatible
        })
      : undefined;

    const annotations: Record<string, unknown> | undefined = openAiToolCompatible
      ? {
          'smart-edit/openaiToolCompatible': true,
          ...(inputJsonSchema ? { 'smart-edit/openaiToolInputSchema': inputJsonSchema } : {}),
          ...(outputJsonSchema ? { 'smart-edit/openaiToolOutputSchema': outputJsonSchema } : {})
        }
      : undefined;

    type InputShape = typeof inputSchemaShape;
    const callback: ToolCallback<InputShape> = async (
      args: z.objectOutputType<InputShape, ZodTypeAny>,
      extra: RequestHandlerExtra<ServerRequest, ServerNotification>
    ): Promise<CallToolResult> => {
      try {
        const normalizedArgs = args as Record<string, unknown>;
        log.debug('MCP invoking tool', {
          tool: toolName,
          normalizedArgs,
          hasAgent: this.agent !== null
        });
        const result = await tool.applyEx(normalizedArgs, { logCall: true, catchExceptions: true });

        log.debug('Tool result before structured output handling', {
          tool: toolName,
          mode: metadata.structuredOutput ? 'structured' : 'text',
          result
        });

        if (metadata.structuredOutput && outputJsonSchema && metadata.outputSchema) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(result);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
              content: [
                {
                  type: 'text',
                  text: `Failed to parse structured output from tool ${toolName}: ${message}`
                }
              ],
              isError: true
            };
          }
          if (!isRecord(parsed)) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Tool ${toolName} must return a JSON object when structuredOutput is enabled.`
                }
              ],
              isError: true
            };
          }
          return {
            content: [],
            structuredContent: parsed
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: result
            }
          ]
        };
      } catch (error) {
        log.error('MCP tool execution threw an unexpected error', { err: error, tool: toolName, extra });
        throw error;
      }
    };

    const registered: RegisteredTool = registerToolWithServer(server, {
      name: toolName,
      description,
      inputSchema: inputSchemaShape,
      annotations,
      callback,
      outputSchema: outputSchemaShape
    });

    return registered;
  }

  createMcpServer(options: SmartEditMCPServerOptions = {}): McpServer {
    try {
      const config = SmartEditConfig.fromConfigFile();

      if (options.enableWebDashboard !== undefined && options.enableWebDashboard !== null) {
        config.webDashboard = options.enableWebDashboard;
      }
      if (options.enableGuiLogWindow !== undefined && options.enableGuiLogWindow !== null) {
        config.guiLogWindowEnabled = options.enableGuiLogWindow;
      }
      if (options.logLevel) {
        const normalized = options.logLevel.toUpperCase() as keyof typeof LOG_LEVEL_MAP;
        const level = LOG_LEVEL_MAP[normalized] ?? LOG_LEVEL_MAP.INFO;
        config.logLevel = level;
      }
      if (options.traceLspCommunication !== undefined && options.traceLspCommunication !== null) {
        config.traceLspCommunication = options.traceLspCommunication;
      }
      if (options.toolTimeout !== undefined && options.toolTimeout !== null) {
        config.toolTimeout = options.toolTimeout;
      }

      const modesInput = options.modes ? Array.from(options.modes) : Array.from(DEFAULT_MODES);
      const modes = modesInput.map((mode) => SmartEditAgentMode.load(mode));

      const agent = this.instantiateAgent({
        smartEditConfig: config,
        modes
      });
      this.setAgent(agent);

      const instructions =
        options.instructionsOverride !== undefined
          ? options.instructionsOverride ?? ''
          : this.getInitialInstructions();

      const serverInfo = options.serverInfo ?? createDefaultServerInfo();
      const serverOptions: ServerOptions = {
        ...(options.serverOptions ?? {}),
        instructions
      };

      const mcpServer = new McpServer(serverInfo, serverOptions);
      this.registerTools(mcpServer, this.isOpenAiCompatibleContext());
      this.registerDefaultCapabilities(mcpServer);

      return mcpServer;
    } catch (error) {
      void showFatalExceptionSafe(error);
      throw error;
    }
  }

  protected getLogger(): ReturnType<typeof createSmartEditLogger>['logger'] {
    return log;
  }
}

const LOG_LEVEL_MAP: Record<'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL', number> = {
  DEBUG: 10,
  INFO: 20,
  WARNING: 30,
  ERROR: 40,
  CRITICAL: 50
};

export interface SmartEditMCPFactorySingleProcessOptions {
  context?: string;
  project?: string | null;
  memoryLogHandler?: MemoryLogHandler | null;
  agentFactory?: SmartEditAgentFactory;
}

export class SmartEditMCPFactorySingleProcess extends SmartEditMCPFactory {
  private readonly memoryLogHandler: MemoryLogHandler | null;
  private readonly agentFactory?: SmartEditAgentFactory;
  private cachedTools: Tool[] | null = null;

  constructor(options: SmartEditMCPFactorySingleProcessOptions = {}) {
    super(options.context, options.project ?? null);
    this.memoryLogHandler = options.memoryLogHandler ?? null;
    this.agentFactory =
      options.agentFactory ??
      ((factoryOptions) =>
        new SmartEditAgent({
          project: factoryOptions.project,
          smartEditConfig: factoryOptions.smartEditConfig,
          context: factoryOptions.context,
          modes: factoryOptions.modes,
          memoryLogHandler: factoryOptions.memoryLogHandler ?? undefined
        }));
  }

  protected instantiateAgent({ smartEditConfig, modes }: { smartEditConfig: SmartEditConfig; modes: SmartEditAgentMode[] }): SmartEditAgentLike {
    if (!this.agentFactory) {
      throw new Error(
        'SmartEditAgent factory not provided. Inject a factory via SmartEditMCPFactorySingleProcessOptions.agentFactory once the agent implementation is available.'
      );
    }

    const agent = this.agentFactory({
      project: this.project,
      smartEditConfig,
      context: this.context,
      modes,
      memoryLogHandler: this.memoryLogHandler
    });

    const toolProvider = agent as unknown as {
      getExposedToolInstances?: () => Iterable<Tool>;
      get_exposed_tool_instances?: () => Iterable<Tool>;
    };
    if (typeof toolProvider.getExposedToolInstances === 'function') {
      this.cachedTools = Array.from(toolProvider.getExposedToolInstances());
    } else if (typeof toolProvider.get_exposed_tool_instances === 'function') {
      this.cachedTools = Array.from(toolProvider.get_exposed_tool_instances());
    } else {
      this.cachedTools = null;
    }
    return agent;
  }

  protected iterTools(): Iterable<Tool> {
    if (this.cachedTools !== null) {
      return this.cachedTools;
    }
    const agent = this.getAgent() as unknown as {
      getExposedToolInstances?: () => Iterable<Tool>;
      get_exposed_tool_instances?: () => Iterable<Tool>;
    };
    if (typeof agent.getExposedToolInstances === 'function') {
      const tools = Array.from(agent.getExposedToolInstances());
      this.cachedTools = tools;
      return tools;
    }
    if (typeof agent.get_exposed_tool_instances === 'function') {
      const tools = Array.from(agent.get_exposed_tool_instances());
      this.cachedTools = tools;
      return tools;
    }
    throw new Error('Agent does not expose tool discovery methods.');
  }

  protected getInitialInstructions(): string {
    const agent = this.getAgent() as unknown as {
      createSystemPrompt?: () => string;
      create_system_prompt?: () => string;
    };
    if (typeof agent.createSystemPrompt === 'function') {
      const prompt = agent.createSystemPrompt();
      if (typeof prompt === 'string' && prompt.length > 0) {
        return prompt;
      }
    }
    if (typeof agent.create_system_prompt === 'function') {
      const prompt = agent.create_system_prompt();
      if (typeof prompt === 'string' && prompt.length > 0) {
        return prompt;
      }
    }
    throw new Error('Agent did not provide a system prompt.');
  }
}

const DEFAULT_HTTP_PATH = '/mcp';

function normalizeHttpPath(path?: string): string {
  if (path === undefined || path === null || path === '') {
    return DEFAULT_HTTP_PATH;
  }
  return path.startsWith('/') ? path : `/${path}`;
}

function resolveRequestPath(req: IncomingMessage, defaultHost: string): string | null {
  if (!req.url) {
    return null;
  }
  try {
    const hostHeader = req.headers.host ?? defaultHost;
    const parsed = new NodeURL(req.url, `http://${hostHeader}`);
    return parsed.pathname;
  } catch {
    return null;
  }
}

function respondWithJson(res: ServerResponse, statusCode: number, body: unknown): void {
  if (res.headersSent) {
    return;
  }
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(body));
}

export function createSmartEditHttpRequestHandler({
  transport,
  path,
  defaultHost
}: {
  transport: StreamableHTTPServerTransport;
  path?: string;
  defaultHost?: string;
}): SmartEditHttpRequestHandler {
  const normalizedPath = normalizeHttpPath(path);
  const fallbackHost = defaultHost ?? '127.0.0.1';

  return async (req, res) => {
    const requestPath = resolveRequestPath(req, fallbackHost);

    if (requestPath !== normalizedPath) {
      respondWithJson(res, 404, {
        jsonrpc: '2.0',
        error: {
          code: -32601,
          message: 'Not Found'
        },
        id: null
      });
      return;
    }

    try {
      await transport.handleRequest(req, res);
    } catch (error) {
      log.error('Unhandled error while processing HTTP MCP request', { err: error });
      if (!res.headersSent) {
        respondWithJson(res, 500, {
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Internal Server Error',
            data: error instanceof Error ? error.message : String(error)
          },
          id: null
        });
      } else {
        try {
          res.end();
        } catch {
          // ignore secondary failures when the connection is already broken
        }
      }
    }
  };
}

async function listenHttpServer(server: HttpServer, port: number, host: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.listen(port, host, onListening);
  });
}

async function closeHttpServer(server: HttpServer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function deriveServerUrl(address: string | AddressInfo | null, path: string, fallbackHost: string): NodeURLType {
  if (!address) {
    throw new Error('Failed to determine HTTP server address.');
  }
  if (typeof address === 'string') {
    const normalized = address.endsWith('/') ? address.slice(0, -1) : address;
    if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
      return new NodeURL(`${normalized}${path}`);
    }
    return new NodeURL(`http://${fallbackHost}${path}`);
  }

  const host = address.family === 'IPv6' ? `[${address.address}]` : address.address;
  const resolvedHost = host === '::' || host === '0.0.0.0' ? fallbackHost : host;
  return new NodeURL(`http://${resolvedHost}:${address.port}${path}`);
}

export async function createSmartEditHttpServer(
  factory: SmartEditMCPFactory,
  options: SmartEditHttpServerOptions = {}
): Promise<SmartEditHttpServerInstance> {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 0;
  const path = normalizeHttpPath(options.path);
  const transportOptions = options.transportOptions ?? {};

  const sessionIdGenerator =
    options.sessionIdGenerator === null
      ? undefined
      : options.sessionIdGenerator ?? transportOptions.sessionIdGenerator ?? (() => randomUUID());

  const httpTransport = new StreamableHTTPServerTransport({
    ...transportOptions,
    sessionIdGenerator
  });

  const mcpServer = factory.createMcpServer(options);
  await mcpServer.connect(httpTransport);

  const handler = createSmartEditHttpRequestHandler({
    transport: httpTransport,
    path,
    defaultHost: host
  });

  const httpServer = createServer((req, res) => {
    void handler(req, res);
  });

  await listenHttpServer(httpServer, port, host);
  const addressInfo = httpServer.address();
  const url = deriveServerUrl(addressInfo, path, host);

  return {
    httpServer,
    transport: httpTransport,
    mcpServer,
    url,
    async close() {
      await Promise.allSettled([httpTransport.close(), mcpServer.close()]);
      await closeHttpServer(httpServer);
    }
  };
}

export interface SmartEditStdioServerInstance {
  transport: StdioServerTransport;
  mcpServer: McpServer;
  close(): Promise<void>;
}

class SmartEditStdioServerTransport extends StdioServerTransport {
  private readonly stdin: NodeJS.ReadStream;
  private readonly handleStreamEnd: () => void;
  private readonly handleStreamClose: () => void;
  private closePromise: Promise<void> | null = null;

  constructor(stdin: NodeJS.ReadStream = process.stdin, stdout: NodeJS.WriteStream = process.stdout) {
    super(stdin, stdout);
    this.stdin = stdin;
    this.handleStreamEnd = () => {
      void this.ensureClosed().catch((error) => {
        this.reportError(error);
      });
    };
    this.handleStreamClose = () => {
      void this.ensureClosed().catch((error) => {
        this.reportError(error);
      });
    };
    this.stdin.on('end', this.handleStreamEnd);
    this.stdin.on('close', this.handleStreamClose);
  }

  private ensureClosed(): Promise<void> {
    if (!this.closePromise) {
      this.stdin.off('end', this.handleStreamEnd);
      this.stdin.off('close', this.handleStreamClose);
      this.closePromise = super.close();
    }
    return this.closePromise;
  }

  override async close(): Promise<void> {
    await this.ensureClosed();
  }

  private reportError(error: unknown): void {
    if (error instanceof Error) {
      this.onerror?.(error);
      return;
    }
    let message: string;
    if (typeof error === 'string') {
      message = error;
    } else {
      try {
        message = JSON.stringify(error);
      } catch {
        message = '[unknown error]';
      }
    }
    this.onerror?.(new Error(message));
  }
}

export async function createSmartEditStdioServer(
  factory: SmartEditMCPFactory,
  options: SmartEditMCPServerOptions = {}
): Promise<SmartEditStdioServerInstance> {
  const transport = new SmartEditStdioServerTransport();
  const mcpServer = factory.createMcpServer(options);
  await mcpServer.connect(transport);

  return {
    transport,
    mcpServer,
    async close() {
      await Promise.allSettled([transport.close(), mcpServer.close()]);
    }
  };
}

export async function createSmartEditGrpcServer(
  _factory: SmartEditMCPFactory,
  _options: SmartEditGrpcServerOptions = {}
): Promise<never> {
  try {
    await import('@grpc/grpc-js');
  } catch (error) {
    throw new Error(
      'gRPCトランスポートPoCは未実装です。@grpc/grpc-js を導入後に createSmartEditGrpcServer を拡張してください。',
      { cause: error }
    );
  }

  throw new Error('gRPCトランスポートPoCは未実装です。HTTPモードのPoCは createSmartEditHttpServer を利用してください。');
}
