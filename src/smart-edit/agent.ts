import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';

import { ensureDefaultSubprocessOptions } from '../smart-lsp/util/subprocess_util.js';

import {
  ToolRegistry,
  type ToolClass,
  ToolMarkerCanEdit,
  ToolMarkerDoesNotRequireActiveProject,
  ToolMarkerOptional,
  ToolMarkerSymbolicEdit,
  ToolMarkerSymbolicRead,
  type SmartEditAgentLike,
  type AgentTaskHandle,
  type IssueTaskMetadata
} from './tools/tools_base.js';
import type { Tool } from './tools/tools_base.js';
import {
  SmartEditConfig,
  ToolInclusionDefinition,
  ToolSet,
  getSmartEditManagedInProjectDir,
  RegisteredTokenCountEstimator
} from './config/smart_edit_config.js';
import { SmartEditAgentContext, SmartEditAgentMode } from './config/context_mode.js';
import { createSmartEditLogger, MemoryLogHandler } from './util/logging.js';
import { SmartEditPromptFactory } from './prompt_factory.js';
import { SmartEditDashboardAPI, type DashboardThread } from './dashboard.js';
import { GuiLogViewer } from './gui_log_viewer.js';
import { smartEditVersion } from './version.js';
import { ToolUsageStats } from './analytics.js';
import type { SmartLanguageServer } from '../smart-lsp/ls.js';
import { LanguageServerCodeEditor } from './code_editor.js';
import { LanguageServerSymbolRetriever } from './symbol.js';
import { Project } from './project.js';
import { ExecuteShellCommandTool } from './tools/cmd_tools.js';
import { ActivateProjectTool, GetCurrentConfigTool, RemoveProjectTool, SwitchModesTool } from './tools/config_tools.js';
import {
  ReadFileTool,
  CreateTextFileTool,
  ListDirTool,
  FindFileTool,
  ReplaceRegexTool,
  DeleteLinesTool,
  ReplaceLinesTool,
  InsertAtLineTool,
  SearchForPatternTool
} from './tools/file_tools.js';
import { WriteMemoryTool, ReadMemoryTool, ListMemoriesTool, DeleteMemoryTool } from './tools/memory_tools.js';
import {
  RestartLanguageServerTool,
  GetSymbolsOverviewTool,
  FindSymbolTool,
  FindReferencingSymbolsTool,
  ReplaceSymbolBodyTool,
  InsertAfterSymbolTool,
  InsertBeforeSymbolTool
} from './tools/symbol_tools.js';
import {
  CheckOnboardingPerformedTool,
  OnboardingTool,
  CollectProjectSymbolsTool,
  ThinkAboutCollectedInformationTool,
  ThinkAboutTaskAdherenceTool,
  ThinkAboutWhetherYouAreDoneTool,
  SummarizeChangesTool,
  PrepareForNewConversationTool,
  InitialInstructionsTool
} from './tools/workflow_tools.js';
const { logger: log, memoryHandler: defaultMemoryHandler } = createSmartEditLogger({
  name: 'smart-edit.agent',
  emitToConsole: true,
  level: 'info'
});

const TOOL_MARKER_CANDIDATES = [
  ToolMarkerCanEdit,
  ToolMarkerDoesNotRequireActiveProject,
  ToolMarkerOptional,
  ToolMarkerSymbolicEdit,
  ToolMarkerSymbolicRead
] as const;

const IDE_ASSISTANT_CONTEXT_NAME = 'ide-assistant';

const DEFAULT_TOOL_CLASSES: ToolClass[] = [
  ExecuteShellCommandTool,
  ActivateProjectTool,
  RemoveProjectTool,
  SwitchModesTool,
  GetCurrentConfigTool,
  WriteMemoryTool,
  ReadMemoryTool,
  ListMemoriesTool,
  DeleteMemoryTool,
  ReadFileTool,
  CreateTextFileTool,
  ListDirTool,
  FindFileTool,
  ReplaceRegexTool,
  DeleteLinesTool,
  ReplaceLinesTool,
  InsertAtLineTool,
  SearchForPatternTool,
  RestartLanguageServerTool,
  GetSymbolsOverviewTool,
  FindSymbolTool,
  FindReferencingSymbolsTool,
  ReplaceSymbolBodyTool,
  InsertAfterSymbolTool,
  InsertBeforeSymbolTool,
  CheckOnboardingPerformedTool,
  OnboardingTool,
  CollectProjectSymbolsTool,
  ThinkAboutCollectedInformationTool,
  ThinkAboutTaskAdherenceTool,
  ThinkAboutWhetherYouAreDoneTool,
  SummarizeChangesTool,
  PrepareForNewConversationTool,
  InitialInstructionsTool
];

export class ProjectNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectNotFoundError';
  }
}

export class LinesRead {
  private readonly files = new Map<string, Set<string>>();

  addLinesRead(relativePath: string, lines: [number, number]): void {
    const key = formatLineRange(lines);
    const existing = this.files.get(relativePath) ?? new Set<string>();
    existing.add(key);
    this.files.set(relativePath, existing);
  }

  wereLinesRead(relativePath: string, lines: [number, number]): boolean {
    const key = formatLineRange(lines);
    const ranges = this.files.get(relativePath);
    if (!ranges) {
      return false;
    }
    return ranges.has(key);
  }

  invalidateLinesRead(relativePath: string): void {
    this.files.delete(relativePath);
  }
}

export class MemoriesManager {
  private readonly memoryDir: string;

  constructor(projectRoot: string) {
    this.memoryDir = path.join(getSmartEditManagedInProjectDir(projectRoot), 'memories');
    fs.mkdirSync(this.memoryDir, { recursive: true });
  }

  private resolveMemoryPath(name: string): string {
    const normalized = name.replace(/\.md$/iu, '');
    return path.join(this.memoryDir, `${normalized}.md`);
  }

  loadMemory(name: string): string {
    const memoryPath = this.resolveMemoryPath(name);
    if (!fs.existsSync(memoryPath)) {
      return `Memory file ${name} not found, consider creating it with the write_memory tool if you need it.`;
    }
    return fs.readFileSync(memoryPath, { encoding: 'utf-8' });
  }

  saveMemory(name: string, content: string): string {
    const memoryPath = this.resolveMemoryPath(name);
    fs.writeFileSync(memoryPath, content, { encoding: 'utf-8' });
    return `Memory ${name} written.`;
  }

  listMemories(): string[] {
    return fs
      .readdirSync(this.memoryDir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name.replace(/\.md$/iu, ''));
  }

  deleteMemory(name: string): string {
    const memoryPath = this.resolveMemoryPath(name);
    if (!fs.existsSync(memoryPath)) {
      throw new Error(`Memory ${name} not found.`);
    }
    fs.unlinkSync(memoryPath);
    return `Memory ${name} deleted.`;
  }
}

class AvailableTools {
  readonly tools: Tool[];
  readonly toolNames: string[];
  readonly toolMarkerNames: Set<string>;

  constructor(tools: Iterable<Tool>) {
    this.tools = Array.from(tools);
    this.toolNames = this.tools.map((tool) => tool.getName());
    this.toolMarkerNames = new Set<string>();

    for (const marker of TOOL_MARKER_CANDIDATES) {
      if (this.tools.some((tool) => tool.hasMarker(marker))) {
        this.toolMarkerNames.add(marker);
      }
    }
  }

  get size(): number {
    return this.tools.length;
  }
}

class SerializedTaskExecutor {
  private queue: Promise<void> = Promise.resolve();
  private index = 1;

  issue<T>(task: () => Promise<T> | T, metadata: IssueTaskMetadata | undefined, timeoutLabelLogger = log): AgentTaskHandle<T> {
    const taskName = `Task-${this.index++}[${metadata?.name ?? task.name ?? 'anonymous'}]`;

    let resolveFn: ((value: T) => void) | undefined;
    let rejectFn: ((reason: unknown) => void) | undefined;

    const resultPromise = new Promise<T>((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });

    const wrapped = async (): Promise<void> => {
      timeoutLabelLogger.info(`Scheduling ${taskName}`);
      const start = Date.now();
      try {
        const value = await Promise.resolve(task());
        resolveFn?.(value);
      } catch (error) {
        rejectFn?.(error);
      } finally {
        const elapsed = Date.now() - start;
        timeoutLabelLogger.info(`${taskName} finished in ${elapsed} ms`);
      }
    };

    this.queue = this.queue.then(wrapped).catch((error) => {
      timeoutLabelLogger.error(`Error executing ${taskName}`, error);
    });

    return new AgentTaskHandleImpl<T>(resultPromise, taskName);
  }
}

class AgentTaskHandleImpl<T> implements AgentTaskHandle<T> {
  private readonly promise: Promise<T>;
  private readonly taskName: string;

  constructor(promise: Promise<T>, taskName: string) {
    this.promise = promise;
    this.taskName = taskName;
  }

  async result(options: { timeout?: number } = {}): Promise<T> {
    const { timeout } = options;
    if (timeout === undefined || timeout === null) {
      return this.promise;
    }
    return withTimeout(this.promise, timeout, this.taskName);
  }
}

interface CreateLanguageServerOptions {
  logLevel: number;
  lsTimeout: number | null;
  traceLspCommunication: boolean;
  lsSpecificSettings: Record<string, unknown>;
}

type RegisteredProject = SmartEditConfig['projects'][number];
type ProjectConfig = RegisteredProject['projectConfig'];

interface AgentProject {
  projectRoot: string;
  isNewlyCreated?: boolean;
  projectConfig: ProjectConfig;
  projectName?: string;
  createLanguageServer(options: CreateLanguageServerOptions): SmartLanguageServer;
}

export interface SmartEditAgentOptions {
  project?: string | null;
  projectActivationCallback?: () => void;
  smartEditConfig?: SmartEditConfig;
  context?: SmartEditAgentContext;
  modes?: SmartEditAgentMode[];
  memoryLogHandler?: MemoryLogHandler;
}

export class SmartEditAgent implements SmartEditAgentLike {
  readonly smartEditConfig: SmartEditConfig;
  readonly promptFactory: SmartEditPromptFactory;
  languageServer: SmartLanguageServer | null = null;
  memoriesManager: MemoriesManager | null = null;
  linesRead: LinesRead | null = null;

  private readonly projectActivationCallback?: () => void;
  private readonly taskExecutor = new SerializedTaskExecutor();
  private readonly memoryLogHandler: MemoryLogHandler;
  private readonly toolRegistry = new ToolRegistry();

  private _context: SmartEditAgentContext;
  private _modes: SmartEditAgentMode[];
  private _allTools = new Map<ToolClass, Tool>();
  private _activeTools = new Map<ToolClass, Tool>();
  private _exposedTools = new AvailableTools([]);
  private _baseToolSet: ToolSet;
  private _activeProject: AgentProject | null = null;
  private _dashboardApi: SmartEditDashboardAPI | null = null;
  private _dashboardThread: DashboardThread | null = null;
  private _dashboardPort: number | null = null;
  private _guiLogViewer: GuiLogViewer | null = null;
  private _toolUsageStats: ToolUsageStats | null = null;
  private disposed = false;

  constructor(options: SmartEditAgentOptions = {}) {
    this.smartEditConfig = options.smartEditConfig ?? SmartEditConfig.fromConfigFile();
    this.memoryLogHandler = options.memoryLogHandler ?? defaultMemoryHandler ?? new MemoryLogHandler();
    this.projectActivationCallback = options.projectActivationCallback;

    this._context = options.context ?? SmartEditAgentContext.loadDefault();
    this._modes = options.modes ?? SmartEditAgentMode.loadDefaultModes();

    this.promptFactory = new SmartEditPromptFactory();

    this.instantiateAllTools();
    this._baseToolSet = this.computeBaseToolSet(options.project ?? null);
    this._exposedTools = new AvailableTools(
      Array.from(this._allTools.values()).filter((tool) => this._baseToolSet.includesName(tool.getName()))
    );

    if (this.smartEditConfig.recordToolUsageStats) {
      this._toolUsageStats = new ToolUsageStats(this.smartEditConfig.tokenCountEstimator ?? RegisteredTokenCountEstimator.TIKTOKEN_GPT4O);
      log.info(
        `Will record tool usage statistics with token count estimator: ${this._toolUsageStats.tokenEstimatorName}.`
      );
    }

    if (this.smartEditConfig.webDashboard) {
      const dashboardApi = new SmartEditDashboardAPI(
        this.memoryLogHandler,
        this._exposedTools.toolNames,
        this,
        {
          shutdownCallback: () => this.dispose(),
          toolUsageStats: this._toolUsageStats
        }
      );
      this._dashboardApi = dashboardApi;

      void dashboardApi
        .runInThread()
        .then(([thread, port]) => {
          this._dashboardThread = thread;
          this._dashboardPort = port;
          if (this.smartEditConfig.webDashboardOpenOnLaunch && port > 0) {
            this.openDashboard(`http://127.0.0.1:${port}/dashboard/index.html`);
          }
        })
        .catch((error) => {
          this._dashboardApi = null;
          log.warn('Failed to start Smart-Edit dashboard.', error instanceof Error ? error : undefined);
        });
    }

    if (this.smartEditConfig.guiLogWindowEnabled) {
      if (process.platform === 'darwin') {
        log.warn('GUI log window is not supported on macOS');
      } else {
        this._guiLogViewer = new GuiLogViewer('dashboard', {
          title: 'Smart-Edit Logs',
          memoryLogHandler: this.memoryLogHandler,
          autoOpen: false
        });
        void this._guiLogViewer.start().catch((error) => {
          log.warn('Failed to start GUI log viewer', error instanceof Error ? error : undefined);
        });
        this._guiLogViewer.setToolNames(this._exposedTools.toolNames);
      }
    }

    log.info(
      `Starting Smart-Edit server (version=${smartEditVersion()}, process id=${process.pid}, parent process id=${process.ppid})`
    );
    log.info(`Configuration file: ${this.smartEditConfig.configFilePath ?? '(not persisted)'}`);
    log.info(`Available projects: ${this.smartEditConfig.projectNames.join(', ') || '(none)'}`);
    log.info(
      `Loaded tools (${this._allTools.size}): ${Array.from(this._allTools.values())
        .map((tool) => tool.getName())
        .join(', ')}`
    );

    this.checkShellSettings();
    this._updateActiveTools();
    log.info(`Number of exposed tools: ${this._exposedTools.size}`);

    if (options.project) {
      this.activateProjectFromPathOrName(options.project).catch((error) => {
        log.error(`Error activating project '${options.project}' at startup`, error instanceof Error ? error : undefined);
      });
    }
  }

  get context(): SmartEditAgentContext {
    return this._context;
  }

  getContext(): SmartEditAgentContext {
    return this._context;
  }

  getToolDescriptionOverride(toolName: string): string | null {
    return this._context.toolDescriptionOverrides[toolName] ?? null;
  }

  get toolUsageStats(): ToolUsageStats | null {
    return this._toolUsageStats;
  }

  get toolUsageStatsEnabled(): boolean {
    return this._toolUsageStats !== null;
  }

  getActiveProject(): AgentProject | null {
    return this._activeProject;
  }

  getActiveProjectOrThrow(): AgentProject {
    const project = this.getActiveProject();
    if (!project) {
      throw new Error('No active project. Please activate a project first.');
    }
    return project;
  }

  getProjectRoot(): string {
    const project = this.getActiveProjectOrThrow();
    return project.projectRoot;
  }

  getActiveToolNames(): string[] {
    return Array.from(this._activeTools.values())
      .map((tool) => tool.getName())
      .sort();
  }

  getActiveToolClasses(): ToolClass[] {
    return Array.from(this._activeTools.keys());
  }

  getExposedToolInstances(): Tool[] {
    return [...this._exposedTools.tools];
  }

  toolIsActive(toolClass: ToolClass | string): boolean {
    if (typeof toolClass === 'string') {
      return this.getActiveToolNames().includes(toolClass);
    }
    return this._activeTools.has(toolClass);
  }

  setModes(modes: SmartEditAgentMode[]): void {
    this._modes = [...modes];
    this._updateActiveTools();
    log.info(`Set modes to ${this._modes.map((mode) => mode.name).join(', ')}`);
  }

  getActiveModes(): SmartEditAgentMode[] {
    return [...this._modes];
  }

  createSystemPrompt(): string {
    log.info('Generating system prompt with available_tools=(see exposed tools), available_markers=%s', [
      ...this._exposedTools.toolMarkerNames
    ]);
    const systemPrompt = this.promptFactory.createSystemPrompt({
      contextSystemPrompt: this.formatPrompt(this._context.prompt),
      modeSystemPrompts: this._modes.map((mode) => this.formatPrompt(mode.prompt)),
      availableTools: this._exposedTools.toolNames,
      availableMarkers: this._exposedTools.toolMarkerNames
    });
    log.info(`System prompt:\n${systemPrompt}`);
    return systemPrompt;
  }

  issueTask<T>(task: () => Promise<T> | T, metadata?: IssueTaskMetadata): AgentTaskHandle<T> {
    return this.taskExecutor.issue(task, metadata);
  }

  async executeTask<T>(task: () => Promise<T> | T): Promise<T> {
    const future = this.issueTask(task);
    return future.result();
  }

  isUsingLanguageServer(): boolean {
    return !this.smartEditConfig.jetbrains;
  }

  isLanguageServerRunning(): boolean {
    return this.languageServer?.isRunning() ?? false;
  }

  resetLanguageServer(): void {
    const toolTimeout = this.smartEditConfig.toolTimeout;
    const lsTimeout =
      toolTimeout === undefined || toolTimeout === null || toolTimeout < 0
        ? null
        : toolTimeout < 10
          ? (() => {
              throw new Error(`Tool timeout must be at least 10 seconds, but is ${toolTimeout} seconds`);
            })()
          : toolTimeout - 5;

    if (this.isLanguageServerRunning() && this.languageServer) {
      log.info(`Stopping the current language server at ${this.languageServer.getRepositoryRootPath()} ...`);
      this.languageServer.stop();
      this.languageServer = null;
    }

    const project = this.getActiveProjectOrThrow();
    this.languageServer = project.createLanguageServer({
      logLevel: this.smartEditConfig.logLevel,
      lsTimeout,
      traceLspCommunication: this.smartEditConfig.traceLspCommunication,
      lsSpecificSettings: this.smartEditConfig.lsSpecificSettings
    });

    log.info(`Starting the language server for ${resolveProjectName(project)}`);
    this.languageServer.start();
    if (!this.languageServer.isRunning()) {
      throw new Error(
        `Failed to start the language server for ${resolveProjectName(project)} at ${project.projectRoot}`
      );
    }
  }

  activateProjectFromPathOrName(projectRootOrName: string): Promise<AgentProject> {
    const project = this.loadProjectFromPathOrName(projectRootOrName, true);
    if (!project) {
      throw new ProjectNotFoundError(
        `Project '${projectRootOrName}' not found: Not a valid project name or directory. Existing project names: ${this.smartEditConfig.projectNames.join(', ')}`
      );
    }
    this.activateProject(project);
    return Promise.resolve(project);
  }

  markFileModified(relativePath: string): void {
    this.linesRead?.invalidateLinesRead(relativePath);
  }

  recordToolUsageIfEnabled(input: Record<string, unknown>, toolResult: string | Record<string, unknown>, tool: Tool): void {
    if (!this._toolUsageStats) {
      log.debug(`Tool usage statistics recording is disabled, not recording usage of '${tool.getName()}'.`);
      return;
    }
    const inputStr = JSON.stringify(input);
    const outputStr = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult);
    log.debug(`Recording tool usage for tool '${tool.getName()}'`);
    this._toolUsageStats.recordToolUsage(tool.getName(), inputStr, outputStr);
  }

  getCurrentConfigOverview(): string {
    const lines: string[] = [];
    lines.push('Current configuration:');
    lines.push(`Smart-Edit version: ${smartEditVersion()}`);
    lines.push(`Loglevel: ${this.smartEditConfig.logLevel}, trace_lsp_communication=${this.smartEditConfig.traceLspCommunication}`);
    const project = this.getActiveProject();
    if (project) {
      lines.push(`Active project: ${resolveProjectName(project)}`);
    } else {
      lines.push('No active project');
    }
    lines.push(`Available projects:\n${this.smartEditConfig.projectNames.join('\n') || '(none)'}`);
    lines.push(`Active context: ${this._context.name}`);

    const activeModeNames = this.getActiveModes().map((mode) => mode.name);
    lines.push(`Active modes: ${activeModeNames.join(', ') || '(none)'}`);

    const inactiveModes = SmartEditAgentMode.listRegisteredModeNames().filter((name) => !activeModeNames.includes(name));
    if (inactiveModes.length > 0) {
      lines.push(`Available but not active modes: ${inactiveModes.join(', ')}`);
    }

    lines.push('Active tools (after all exclusions from the project, context, and modes):');
    lines.push(chunkedList(this.getActiveToolNames(), 4));

    const allToolNames = Array.from(this._allTools.values())
      .map((tool) => tool.getName())
      .sort();
    const inactiveToolNames = allToolNames.filter((tool) => !this.getActiveToolNames().includes(tool));
    if (inactiveToolNames.length > 0) {
      lines.push('Available but not active tools:');
      lines.push(chunkedList(inactiveToolNames, 4));
    }

    return lines.join('\n') + '\n';
  }

  getTool(toolClass: ToolClass): Tool {
    const tool = this._allTools.get(toolClass);
    if (!tool) {
      throw new Error(`Tool ${toolClass.name} is not registered.`);
    }
    return tool;
  }

  getToolByName(toolName: string): Tool {
    const toolClass = this.toolRegistry.getToolClassByName(toolName);
    return this.getTool(toolClass);
  }

  printToolOverview(): void {
    this.toolRegistry.printToolOverview(this._activeTools.values());
  }

  createLanguageServerSymbolRetriever(): LanguageServerSymbolRetriever {
    if (!this.isUsingLanguageServer() || !this.languageServer) {
      throw new Error('Cannot create LanguageServerSymbolRetriever; agent is not using a language server.');
    }
    return new LanguageServerSymbolRetriever(this.languageServer, this);
  }

  createCodeEditor(): LanguageServerCodeEditor {
    if (!this.isUsingLanguageServer() || !this.languageServer) {
      throw new Error('Cannot create CodeEditor; agent is not using a language server.');
    }
    const retriever = this.createLanguageServerSymbolRetriever();
    return new LanguageServerCodeEditor(retriever, this);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    log.info('SmartEditAgent is shutting down ...');
    if (this.languageServer?.isRunning()) {
      log.info('Stopping the language server ...');
      this.languageServer.saveCache();
      this.languageServer.stop();
    }
    if (this._guiLogViewer) {
      void this._guiLogViewer.stop().catch((error) => {
        log.warn('Failed to stop GUI log viewer', error instanceof Error ? error : undefined);
      });
    }
    this._dashboardThread?.stop();
    this._dashboardThread = null;
    this._dashboardApi = null;
  }

  private instantiateAllTools(): void {
    if (this.toolRegistry.getAllToolClasses().length === 0) {
      this.toolRegistry.registerMany(DEFAULT_TOOL_CLASSES);
    }
    for (const toolClass of this.toolRegistry.getAllToolClasses()) {
      const toolInstance = new toolClass(this);
      this._allTools.set(toolClass, toolInstance);
    }
  }

  private computeBaseToolSet(initialProject: string | null): ToolSet {
    const definitions: ToolInclusionDefinition[] = [this.smartEditConfig, this._context];
    if (this._context.name === IDE_ASSISTANT_CONTEXT_NAME) {
      definitions.push(...this.ideAssistantContextToolInclusionDefinitions(initialProject));
    }
    if (this.smartEditConfig.jetbrains) {
      definitions.push(SmartEditAgentMode.fromNameInternal('jetbrains'));
    }
    return ToolSet.default().apply(...definitions);
  }

  private ideAssistantContextToolInclusionDefinitions(projectRootOrName: string | null): ToolInclusionDefinition[] {
    const definitions: ToolInclusionDefinition[] = [];
    if (!projectRootOrName) {
      return definitions;
    }

    const project = this.loadProjectFromPathOrName(projectRootOrName, false);
    if (!project) {
      return definitions;
    }

    definitions.push(
      new ToolInclusionDefinition({
        excludedTools: [ActivateProjectTool.getNameFromCls(), GetCurrentConfigTool.getNameFromCls()]
      })
    );
    definitions.push(project.projectConfig);
    return definitions;
  }

  private activateProject(project: AgentProject): void {
    log.info(`Activating ${resolveProjectName(project)} at ${project.projectRoot}`);
    this._activeProject = project;
    this._updateActiveTools();
    this.memoriesManager = new MemoriesManager(project.projectRoot);
    this.linesRead = new LinesRead();

    if (this.isUsingLanguageServer()) {
      this.issueTask(() => this.resetLanguageServer(), { name: 'LanguageServerInitialization' });
    }

    this.projectActivationCallback?.();
  }

  private loadProjectFromPathOrName(projectRootOrName: string, autogenerate: boolean): AgentProject | null {
    const registered = this.resolveRegisteredProject(projectRootOrName);
    if (registered) {
      return materializeProject(registered);
    }

    if (autogenerate && fs.existsSync(projectRootOrName) && fs.statSync(projectRootOrName).isDirectory()) {
      const newProject = this.smartEditConfig.addProjectFromPath(projectRootOrName);
      return materializeProject(newProject);
    }

    return null;
  }

  private resolveRegisteredProject(projectRootOrName: string): RegisteredProject | null {
    const byName = this.smartEditConfig.projects.filter((project) => project.projectName === projectRootOrName);
    if (byName.length === 1) {
      return byName[0];
    }
    if (byName.length > 1) {
      throw new Error(
        `Multiple projects found with name '${projectRootOrName}'. Please activate it by location instead. Locations: ${byName
          .map((p) => p.projectRoot)
          .join(', ')}`
      );
    }

    const resolved = path.resolve(projectRootOrName);
    for (const project of this.smartEditConfig.projects) {
      if (project.matchesRootPath(resolved)) {
        return project;
      }
    }
    return null;
  }

  private checkShellSettings(): void {
    if (process.platform !== 'win32') {
      return;
    }
    const comspec = process.env.COMSPEC ?? '';
    if (comspec.toLowerCase().includes('bash')) {
      process.env.COMSPEC = '';
      log.info(`Adjusting COMSPEC environment variable to use the default shell instead of '${comspec}'`);
    }
  }

  private updateGuiLogViewerToolNames(): void {
    if (this._guiLogViewer) {
      this._guiLogViewer.setToolNames(this._exposedTools.toolNames);
    }
    this._dashboardApi?.setToolNames(this._exposedTools.toolNames);
  }

  private openDashboard(url: string): void {
    try {
      if (process.platform === 'darwin') {
        spawn('open', [url], ensureDefaultSubprocessOptions({ detached: true, stdio: 'ignore' })).unref();
      } else if (process.platform === 'win32') {
        spawn(
          'cmd',
          ['/c', 'start', '', url],
          ensureDefaultSubprocessOptions({ detached: true, stdio: 'ignore' })
        ).unref();
      } else {
        spawn('xdg-open', [url], ensureDefaultSubprocessOptions({ detached: true, stdio: 'ignore' })).unref();
      }
    } catch (error) {
      log.warn(`Failed to open dashboard automatically. Please open ${url} manually.`, error as Error);
    }
  }

  private _updateActiveTools(): void {
    let toolSet = this._baseToolSet.apply(...this._modes);
    if (this._activeProject) {
      toolSet = toolSet.apply(this._activeProject.projectConfig);
      if (this._activeProject.projectConfig.readOnly) {
        toolSet = toolSet.withoutEditingTools();
      }
    }

    this._activeTools = new Map(
      Array.from(this._allTools.entries()).filter(([, tool]) => toolSet.includesName(tool.getName()))
    );

    log.info(`Active tools (${this._activeTools.size}): ${this.getActiveToolNames().join(', ')}`);
    this.updateGuiLogViewerToolNames();
  }

  private formatPrompt(template: string): string {
    const replacements: Record<string, string> = {
      available_tools: this._exposedTools.toolNames.join(', '),
      available_markers: Array.from(this._exposedTools.toolMarkerNames).join(', ')
    };
    return template.replace(/{{\s*([a-zA-Z_]+)\s*}}/g, (_match, key: string) => replacements[key] ?? '');
  }
}

function materializeProject(registered: RegisteredProject): AgentProject {
  if (registered.hasProjectInstance()) {
    const instance = registered.getProjectInstance() as AgentProject;
    return ensureProjectHasLanguageServer(instance, registered);
  }
  const project = new Project({
    projectRoot: registered.projectRoot,
    projectConfig: registered.projectConfig
  });
  registered.attachProjectInstance(project);
  return project;
}

function ensureProjectHasLanguageServer(project: AgentProject, registered: RegisteredProject): AgentProject {
  if (typeof project.createLanguageServer === 'function') {
    return project;
  }
  const fallback = new Project({
    projectRoot: registered.projectRoot,
    projectConfig: registered.projectConfig
  });
  registered.attachProjectInstance(fallback);
  return fallback;
}

function resolveProjectName(project: AgentProject): string {
  return project.projectName ?? project.projectConfig.projectName;
}

function chunkedList(values: string[], chunkSize: number): string {
  if (values.length === 0) {
    return '  (none)';
  }
  const chunks: string[] = [];
  for (let i = 0; i < values.length; i += chunkSize) {
    chunks.push(`  ${values.slice(i, i + chunkSize).join(', ')}`);
  }
  return chunks.join('\n');
}

function formatLineRange([start, end]: [number, number]): string {
  return `${start}:${end}`;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, taskName: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      reject(new Error(`Timeout waiting for ${taskName} after ${timeoutMs} ms`));
    }, timeoutMs);
    promise
      .then((value) => {
        globalThis.clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        globalThis.clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
  });
}
