import fs from 'node:fs';
import path from 'node:path';

import { z, type ZodTypeAny } from 'zod';

import { createSmartEditLogger } from '../util/logging.js';
import { singleton } from '../util/class_decorators.js';
import type { SmartEditAgentMode } from '../config/context_mode.js';
import type { Language } from '../../smart-lsp/ls_config.js';
import type { SmartEditPromptFactory } from '../prompt_factory.js';
import type { SmartLanguageServer } from '../../smart-lsp/ls.js';
import type { LanguageServerSymbolRetriever } from '../symbol.js';
import type { LanguageServerCodeEditor } from '../code_editor.js';
import type { LinesRead } from '../agent.js';

const { logger: log } = createSmartEditLogger({ name: 'smart-edit.tools.base' });

export function assertIsBufferEncoding(value: string): asserts value is BufferEncoding {
  if (!Buffer.isEncoding(value)) {
    throw new Error(`Unsupported file encoding '${value}'`);
  }
}

function resolveProjectEncoding(encodingValue: string | undefined): BufferEncoding {
  const candidate = encodingValue ?? 'utf-8';
  assertIsBufferEncoding(candidate);
  return candidate;
}

export const SUCCESS_RESULT = 'OK';

export const ToolMarkerCanEdit = 'can-edit' as const;
export const ToolMarkerDoesNotRequireActiveProject = 'does-not-require-active-project' as const;
export const ToolMarkerOptional = 'optional' as const;
export const ToolMarkerSymbolicRead = 'symbolic-read' as const;
export const ToolMarkerSymbolicEdit = 'symbolic-edit' as const;

export type ToolMarker =
  | typeof ToolMarkerCanEdit
  | typeof ToolMarkerDoesNotRequireActiveProject
  | typeof ToolMarkerOptional
  | typeof ToolMarkerSymbolicRead
  | typeof ToolMarkerSymbolicEdit;

export interface SmartEditConfigLike {
  defaultMaxToolAnswerChars: number;
  toolTimeout: number;
  projectNames: string[];
  removeProject?(projectName: string): void;
}

export interface ProjectConfigLike {
  encoding: string;
  language?: Language | { value: string } | string;
  initialPrompt?: string;
  projectName?: string;
}

export interface ProjectLike {
  projectRoot: string;
  projectConfig: ProjectConfigLike;
  isNewlyCreated?: boolean;
  pathToProjectYml?: () => string;
}

export type PromptFactoryLike = SmartEditPromptFactory;

export interface MemoriesManagerLike {
  listMemories(): string[] | Promise<string[]> | Iterable<unknown> | Promise<Iterable<unknown>>;
  list_memories?(): string[] | Promise<string[]> | Iterable<unknown> | Promise<Iterable<unknown>>;
  saveMemory?(name: string, content: string): string | Promise<string>;
  save_memory?(name: string, content: string): string | Promise<string>;
  loadMemory?(name: string): string | Promise<string>;
  load_memory?(name: string): string | Promise<string>;
  deleteMemory?(name: string): string | Promise<string>;
  delete_memory?(name: string): string | Promise<string>;
}

export type LinesReadLike = LinesRead;

export type LanguageServerLike = SmartLanguageServer;

export type CodeEditorLike = LanguageServerCodeEditor;

export type LanguageServerSymbolRetrieverLike = LanguageServerSymbolRetriever;

export interface IssueTaskMetadata {
  name?: string;
}

export interface AgentTaskHandle<T> {
  result(options?: { timeout?: number }): Promise<T>;
}

export interface SmartEditAgentLike {
  readonly promptFactory: PromptFactoryLike;
  readonly memoriesManager: MemoriesManagerLike | null;
  readonly smartEditConfig: SmartEditConfigLike;
  readonly languageServer: LanguageServerLike | null;
  readonly linesRead: LinesReadLike | null;

  getProjectRoot(): string;
  getActiveProject(): ProjectLike | null;
  getActiveProjectOrThrow(): ProjectLike;
  getActiveToolNames(): string[];

  toolIsActive(toolClass: ToolClass | string): boolean;
  isUsingLanguageServer(): boolean;
  isLanguageServerRunning(): boolean;
  resetLanguageServer(): void | Promise<void>;

  activateProjectFromPathOrName(project: string): Promise<ProjectLike>;
  setModes(modes: SmartEditAgentMode[]): void | Promise<void>;
  getCurrentConfigOverview(): string | Promise<string>;

  createLanguageServerSymbolRetriever(): LanguageServerSymbolRetrieverLike;
  createCodeEditor(): CodeEditorLike;

  recordToolUsageIfEnabled(
    args: Record<string, unknown>,
    result: string | Record<string, unknown>,
    tool: Tool
  ): void | Promise<void>;

  issueTask<T>(task: () => Promise<T> | T, metadata?: IssueTaskMetadata): AgentTaskHandle<T>;
}

export type ToolApplyFunction<Input = Record<string, unknown>, Output = string> = (input: Input) => Promise<Output> | Output;

export interface ToolApplyMetadata {
  inputSchema: ZodTypeAny;
  outputSchema?: ZodTypeAny;
  structuredOutput?: boolean;
  description?: string;
}

export interface ToolExecutionOptions {
  logCall?: boolean;
  catchExceptions?: boolean;
  maxAnswerChars?: number;
}

export type ToolClass<T extends Tool = Tool> = (new (agent: SmartEditAgentLike) => T) & typeof Tool;

function formatDictionary(value: Record<string, unknown>): string {
  const parts = Object.entries(value).map(([key, val]) => {
    try {
      return `${key}=${JSON.stringify(val)}`;
    } catch {
      return `${key}=${String(val)}`;
    }
  });
  return `{${parts.join(', ')}}`;
}

function describeError(error: unknown): string {
  if (error instanceof Error && typeof error.message === 'string' && error.message.length > 0) {
    return error.message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function isSmartLspTerminationError(error: unknown): error is { isLanguageServerTerminated(): boolean } {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  if (!('isLanguageServerTerminated' in error)) {
    return false;
  }
  const candidate = (error as { isLanguageServerTerminated?: unknown }).isLanguageServerTerminated;
  return typeof candidate === 'function';
}

export abstract class Component {
  protected readonly agent: SmartEditAgentLike;

  constructor(agent: SmartEditAgentLike) {
    this.agent = agent;
  }

  getProjectRoot(): string {
    return this.agent.getProjectRoot();
  }

  protected get promptFactory(): PromptFactoryLike {
    return this.agent.promptFactory;
  }

  protected get memoriesManager(): MemoriesManagerLike {
    const manager = this.agent.memoriesManager;
    if (!manager) {
      throw new Error('Memories manager is not initialized.');
    }
    return manager;
  }

  protected createLanguageServerSymbolRetriever(): LanguageServerSymbolRetrieverLike {
    if (!this.agent.isUsingLanguageServer()) {
      throw new Error('Cannot create LanguageServerSymbolRetriever; agent is not in language server mode.');
    }
    return this.agent.createLanguageServerSymbolRetriever();
  }

  protected get project(): ProjectLike {
    return this.agent.getActiveProjectOrThrow();
  }

  protected createCodeEditor(): CodeEditorLike {
    return this.agent.createCodeEditor();
  }

  protected get linesRead(): LinesReadLike {
    const value = this.agent.linesRead;
    if (!value) {
      throw new Error('linesRead not initialized on agent.');
    }
    return value;
  }
}

export abstract class Tool extends Component {
  protected static readonly markers: ReadonlySet<ToolMarker> = new Set();
  static readonly inputSchema: ZodTypeAny = z.object({}).passthrough();
  static readonly outputSchema: ZodTypeAny | undefined;
  static readonly structuredOutput: boolean | undefined;
  static readonly description: string | undefined;

  abstract apply(args: unknown): Promise<string>;

  static getNameFromCls(): string {
    const name = this.name.endsWith('Tool') ? this.name.slice(0, -4) : this.name;
    const snake = name
      .replace(/([A-Z]+)/g, '_$1')
      .replace(/^_/, '')
      .toLowerCase();
    return snake;
  }

  getName(): string {
    return (this.constructor as typeof Tool).getNameFromCls();
  }

  static hasMarker(marker: ToolMarker): boolean {
    return this.markers.has(marker);
  }

  hasMarker(marker: ToolMarker): boolean {
    return (this.constructor as typeof Tool).hasMarker(marker);
  }

  getApplyFn(): ToolApplyFunction<Record<string, unknown>, string> {
    const applyFn = (this as unknown as { apply?: ToolApplyFunction<Record<string, unknown>, string> }).apply;
    if (!applyFn) {
      throw new Error(`apply not defined in ${this.constructor.name}. Did you forget to implement it?`);
    }
    return applyFn.bind(this);
  }

  static canEdit(): boolean {
    return this.hasMarker(ToolMarkerCanEdit) || this.hasMarker(ToolMarkerSymbolicEdit);
  }

  static getToolDescription(): string {
    return (this.description ?? '').trim();
  }

  getApplyDocstring(): string {
    const metadata = this.getApplyFnMetadata();
    return metadata.description ?? '';
  }

  static getApplyFnMetadata(): ToolApplyMetadata {
    return {
      inputSchema: this.inputSchema,
      outputSchema: this.outputSchema,
      structuredOutput: this.structuredOutput,
      description: this.getToolDescription()
    };
  }

  getApplyFnMetadata(): ToolApplyMetadata {
    return (this.constructor as typeof Tool).getApplyFnMetadata();
  }

  protected _limitLength(result: string, maxAnswerChars: number): string {
    let limit = maxAnswerChars;
    if (limit === -1 || limit === undefined || limit === null) {
      limit = this.agent.smartEditConfig.defaultMaxToolAnswerChars;
    }
    if (limit <= 0) {
      throw new Error(`Must be positive or the default (-1), got: maxAnswerChars=${limit}`);
    }
    if (result.length > limit) {
      return `The answer is too long (${result.length} characters). Please try a more specific tool query or raise the max_answer_chars parameter.`;
    }
    return result;
  }

  isActive(): boolean {
    return this.agent.toolIsActive(this.constructor as ToolClass);
  }

  async applyEx(
    args: Record<string, unknown> = {},
    options: ToolExecutionOptions = {}
  ): Promise<string> {
    const { logCall = true, catchExceptions = true, maxAnswerChars = -1 } = options;
    const applyFn = this.getApplyFn();
    const metadata = this.getApplyFnMetadata();

    const validatedArgs =
      metadata.inputSchema !== undefined ? (metadata.inputSchema.parse(args) as Record<string, unknown>) : args;

    const task = async (): Promise<string> => {
      try {
        if (!this.isActive()) {
          return `Error: Tool '${this.getName()}' is not active. Active tools: ${this.agent.getActiveToolNames().join(', ')}`;
        }
      } catch (error) {
        return `RuntimeError while checking if tool ${this.getName()} is active: ${describeError(error)}`;
      }

      if (logCall) {
        log.info(`${this.getName()}: ${formatDictionary(validatedArgs)}`);
      }

      try {
        if (!this.hasMarker(ToolMarkerDoesNotRequireActiveProject)) {
          const activeProject = this.agent.getActiveProject();
          if (!activeProject) {
            const projects = this.agent.smartEditConfig.projectNames;
            return [
              `Error: No active project. Ask the user to provide the project path or to select a project from this list of known projects:`,
              projects.join(', ') || '(none)'
            ].join(' ');
          }
          if (this.agent.isUsingLanguageServer() && !this.agent.isLanguageServerRunning()) {
            log.info('Language server is not running. Starting it ...');
            await Promise.resolve(this.agent.resetLanguageServer());
          }
        }

        let result: string;
        try {
          const output = await Promise.resolve(applyFn(validatedArgs));
          result = typeof output === 'string' ? output : String(output);
        } catch (error) {
          if (isSmartLspTerminationError(error)) {
            log.error(
              `Language server terminated while executing tool (${describeError(error)}). Restarting the language server and retrying ...`
            );
            await Promise.resolve(this.agent.resetLanguageServer());
            const retryOutput = await Promise.resolve(applyFn(validatedArgs));
            result = typeof retryOutput === 'string' ? retryOutput : String(retryOutput);
          } else {
            throw error;
          }
        }

        const limited = this._limitLength(result, maxAnswerChars);
        await Promise.resolve(this.agent.recordToolUsageIfEnabled(validatedArgs, limited, this));

        if (logCall) {
          log.info(`Result: ${limited}`);
        }

        try {
          const languageServer = this.agent.languageServer;
          if (languageServer) {
            await Promise.resolve(languageServer.saveCache());
          }
        } catch (error) {
          log.error(`Error saving language server cache: ${describeError(error)}`);
        }

        return limited;
      } catch (error) {
        if (!catchExceptions) {
          throw error;
        }
        const message = `Error executing tool: ${describeError(error)}`;
        log.error(message, error instanceof Error ? error : undefined);
        if (logCall) {
          log.info(`Result: ${message}`);
        }
        return message;
      }
    };

    const future = this.agent.issueTask(task, { name: this.constructor.name });
    return future.result({ timeout: this.agent.smartEditConfig.toolTimeout });
  }
}

class EditedFileContextImpl {
  private readonly project: ProjectLike;
  private readonly absolutePath: string;
  private readonly originalContent: string;
  private updatedContent: string | null = null;

  constructor(relativePath: string, agent: SmartEditAgentLike) {
    const project = agent.getActiveProject();
    if (!project) {
      throw new Error('No active project configured.');
    }
    this.project = project;
    this.absolutePath = path.join(project.projectRoot, relativePath);
    if (!fs.existsSync(this.absolutePath) || !fs.statSync(this.absolutePath).isFile()) {
      throw new Error(`File ${this.absolutePath} does not exist.`);
    }
    const encoding: BufferEncoding = resolveProjectEncoding(project.projectConfig.encoding);
    this.originalContent = fs.readFileSync(this.absolutePath, { encoding });
  }

  getOriginalContent(): string {
    return this.originalContent;
  }

  setUpdatedContent(content: string): void {
    this.updatedContent = content;
  }

  async commit(): Promise<void> {
    if (this.updatedContent === null) {
      return;
    }
    const encoding: BufferEncoding = resolveProjectEncoding(this.project.projectConfig.encoding);
    await fs.promises.writeFile(this.absolutePath, this.updatedContent, { encoding });
    log.info(`Updated content written to ${this.absolutePath}`);
  }
}

export class EditedFileContext {
  static async use<T>(
    relativePath: string,
    agent: SmartEditAgentLike,
    handler: (context: EditedFileContextImpl) => Promise<T> | T
  ): Promise<T> {
    const context = new EditedFileContextImpl(relativePath, agent);
    const result = await handler(context);
    await context.commit();
    return result;
  }
}

interface RegisteredTool {
  toolClass: ToolClass;
  isOptional: boolean;
  toolName: string;
}

class ToolRegistryImpl {
  private readonly toolMap = new Map<string, RegisteredTool>();

  registerToolClass(toolClass: ToolClass): void {
    const toolName = toolClass.getNameFromCls();
    if (this.toolMap.has(toolName)) {
      throw new Error(`Duplicate tool name found: ${toolName}. Tool classes must have unique names.`);
    }
    this.toolMap.set(toolName, {
      toolClass,
      isOptional: toolClass.hasMarker(ToolMarkerOptional),
      toolName
    });
  }

  registerMany(toolClasses: Iterable<ToolClass>): void {
    for (const toolClass of toolClasses) {
      this.registerToolClass(toolClass);
    }
  }

  getToolClassByName(toolName: string): ToolClass {
    const entry = this.toolMap.get(toolName);
    if (!entry) {
      throw new Error(`Tool ${toolName} is not registered.`);
    }
    return entry.toolClass;
  }

  getAllToolClasses(): ToolClass[] {
    return Array.from(this.toolMap.values(), (entry) => entry.toolClass);
  }

  getToolClassesDefaultEnabled(): ToolClass[] {
    return Array.from(this.toolMap.values())
      .filter((entry) => !entry.isOptional)
      .map((entry) => entry.toolClass);
  }

  getToolClassesOptional(): ToolClass[] {
    return Array.from(this.toolMap.values())
      .filter((entry) => entry.isOptional)
      .map((entry) => entry.toolClass);
  }

  getToolNamesDefaultEnabled(): string[] {
    return Array.from(this.toolMap.values())
      .filter((entry) => !entry.isOptional)
      .map((entry) => entry.toolName);
  }

  getToolNamesOptional(): string[] {
    return Array.from(this.toolMap.values())
      .filter((entry) => entry.isOptional)
      .map((entry) => entry.toolName);
  }

  getToolNames(): string[] {
    return Array.from(this.toolMap.keys());
  }

  isValidToolName(toolName: string): boolean {
    return this.toolMap.has(toolName);
  }

  printToolOverview(
    tools?: Iterable<ToolClass | Tool>,
    options: { includeOptional?: boolean; onlyOptional?: boolean } = {}
  ): void {
    let selection = tools;
    if (!selection) {
      if (options.onlyOptional) {
        selection = this.getToolClassesOptional();
      } else if (options.includeOptional) {
        selection = this.getAllToolClasses();
      } else {
        selection = this.getToolClassesDefaultEnabled();
      }
    }

    const catalog = new Map<string, ToolClass | Tool>();
    for (const tool of selection) {
      if (typeof tool === 'function') {
        catalog.set(tool.getNameFromCls(), tool);
      } else {
        catalog.set(tool.getName(), tool);
      }
    }

    const sortedNames = Array.from(catalog.keys()).sort();
    for (const toolName of sortedNames) {
      const item = catalog.get(toolName);
      if (!item) {
        continue;
      }
      const toolClass = typeof item === 'function' ? item : (item.constructor as typeof Tool);
      const description = toolClass.getToolDescription();
      console.log(` * \`${toolName}\`: ${description}`);
    }
  }

  /** @internal */
  resetForTesting(): void {
    this.toolMap.clear();
  }
}

const ToolRegistrySingleton = singleton(ToolRegistryImpl);

export type ToolRegistry = InstanceType<typeof ToolRegistryImpl>;
export { ToolRegistrySingleton as ToolRegistry };

export function registerToolClass(toolClass: ToolClass): void {
  const registry = new ToolRegistrySingleton();
  registry.registerToolClass(toolClass);
}
