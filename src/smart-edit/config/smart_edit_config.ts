import fs from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import {
  DEFAULT_ENCODING,
  PROJECT_TEMPLATE_FILE,
  REPO_ROOT,
  SMART_EDIT_CONFIG_TEMPLATE_FILE,
  SMART_EDIT_MANAGED_DIR_IN_HOME,
  SMART_EDIT_MANAGED_DIR_NAME
} from '../constants.js';
import { createSmartEditLogger } from '../util/logging.js';
import { loadYaml, saveYaml } from '../util/general.js';
import type { YamlDocument, YamlObject } from '../util/general.js';
import { determineProgrammingLanguageComposition } from '../util/inspection.js';
import { singleton } from '../util/class_decorators.js';
import { ToolRegistry } from '../tools/tools_base.js';
import { Language, coerceLanguage, listLanguages, getLanguageFilenameMatcher } from '../../smart-lsp/ls_config.js';

const { logger: log } = createSmartEditLogger({ name: 'smart-edit.config' });

export interface ToolInclusionDefinitionInit {
  excludedTools?: Iterable<string>;
  includedOptionalTools?: Iterable<string>;
}

export class ToolInclusionDefinition {
  readonly excludedTools: string[];
  readonly includedOptionalTools: string[];

  constructor(options: ToolInclusionDefinitionInit = {}) {
    this.excludedTools = normalizeStringIterable(options.excludedTools);
    this.includedOptionalTools = normalizeStringIterable(options.includedOptionalTools);
  }

  protected createNext(options: ToolInclusionDefinitionInit): ToolInclusionDefinition {
    return new ToolInclusionDefinition({
      excludedTools: options.excludedTools ?? this.excludedTools,
      includedOptionalTools: options.includedOptionalTools ?? this.includedOptionalTools
    });
  }
}

export const DEFAULT_TOOL_TIMEOUT = 240;

const STRING_ARRAY_INPUT_SCHEMA = z
  .union([z.array(z.union([z.string(), z.number(), z.boolean()])), z.string(), z.number(), z.boolean(), z.null()])
  .optional()
  .transform((value): string[] => {
    if (value === undefined || value === null) {
      return [];
    }
    if (Array.isArray(value)) {
      return value
        .map((item) => {
          if (typeof item === 'string') {
            return item;
          }
          if (typeof item === 'number' || typeof item === 'boolean') {
            return String(item);
          }
          return null;
        })
        .filter((item): item is string => item !== null);
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return [String(value)];
    }
    return [];
  });

const BOOLEAN_INPUT_SCHEMA = z
  .union([z.boolean(), z.string(), z.number(), z.null()])
  .optional()
  .transform((value): boolean | undefined => {
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      if (value === 1) {
        return true;
      }
      if (value === 0) {
        return false;
      }
      return undefined;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) {
        return true;
      }
      if (['false', '0', 'no', 'n', 'off'].includes(normalized)) {
        return false;
      }
    }
    return undefined;
  });

const NUMBER_INPUT_SCHEMA = z
  .union([z.number(), z.string(), z.null()])
  .optional()
  .transform((value): number | undefined => {
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : undefined;
    }
    if (typeof value === 'string') {
      const parsed = Number.parseFloat(value);
      return Number.isNaN(parsed) ? undefined : parsed;
    }
    return undefined;
  });

const OPTIONAL_STRING_SCHEMA = z
  .union([z.string(), z.number()])
  .optional()
  .transform((value): string | undefined => {
    if (value === undefined) {
      return undefined;
    }
    return String(value);
  });

const PROJECT_CONFIG_YAML_SCHEMA = z
  .object({
    project_name: z.string({ required_error: 'project_name は必須です' }).min(1, 'project_name は必須です'),
    language: z.union([
      z.nativeEnum(Language),
      z.string({ required_error: 'language は必須です' }).min(1, 'language は必須です')
    ]),
    ignored_paths: STRING_ARRAY_INPUT_SCHEMA,
    excluded_tools: STRING_ARRAY_INPUT_SCHEMA,
    included_optional_tools: STRING_ARRAY_INPUT_SCHEMA,
    read_only: BOOLEAN_INPUT_SCHEMA,
    ignore_all_files_in_gitignore: BOOLEAN_INPUT_SCHEMA,
    initial_prompt: OPTIONAL_STRING_SCHEMA,
    encoding: z.string().optional()
  })
  .passthrough();

const SMART_EDIT_CONFIG_YAML_SCHEMA = z
  .object({
    gui_log_window: BOOLEAN_INPUT_SCHEMA,
    gui_log_window_enabled: BOOLEAN_INPUT_SCHEMA,
    web_dashboard: BOOLEAN_INPUT_SCHEMA,
    web_dashboard_open_on_launch: BOOLEAN_INPUT_SCHEMA,
    log_level: NUMBER_INPUT_SCHEMA,
    gui_log_level: NUMBER_INPUT_SCHEMA,
    trace_lsp_communication: BOOLEAN_INPUT_SCHEMA,
    tool_timeout: NUMBER_INPUT_SCHEMA,
    excluded_tools: STRING_ARRAY_INPUT_SCHEMA,
    included_optional_tools: STRING_ARRAY_INPUT_SCHEMA,
    jetbrains: BOOLEAN_INPUT_SCHEMA,
    record_tool_usage_stats: BOOLEAN_INPUT_SCHEMA,
    token_count_estimator: z.string().optional(),
    default_max_tool_answer_chars: NUMBER_INPUT_SCHEMA,
    ls_specific_settings: z.record(z.unknown()).optional(),
    projects: z.array(z.string(), {
      required_error: '`projects` key not found in Smart-Edit configuration.',
      invalid_type_error: '`projects` は文字列の配列である必要があります。'
    })
  })
  .passthrough();

function datetimeTag(): string {
  const now = new Date();
  const yyyy = now.getFullYear().toString().padStart(4, '0');
  const mm = (now.getMonth() + 1).toString().padStart(2, '0');
  const dd = now.getDate().toString().padStart(2, '0');
  const hh = now.getHours().toString().padStart(2, '0');
  const mi = now.getMinutes().toString().padStart(2, '0');
  const ss = now.getSeconds().toString().padStart(2, '0');
  return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
}

class SmartEditPathsImpl {
  readonly userConfigDir: string;

  constructor() {
    this.userConfigDir = SMART_EDIT_MANAGED_DIR_IN_HOME;
  }

  getNextLogFilePath(prefix: string): string {
    const dateDir = path.join(this.userConfigDir, 'logs', new Date().toISOString().slice(0, 10));
    fs.mkdirSync(dateDir, { recursive: true });
    return path.join(dateDir, `${prefix}_${datetimeTag()}.txt`);
  }
}

const SmartEditPathsSingleton = singleton(SmartEditPathsImpl);
export { SmartEditPathsSingleton as SmartEditPaths };
export type SmartEditPathsInstance = InstanceType<typeof SmartEditPathsImpl>;

export class ToolSet {
  private readonly toolNames: Set<string>;

  constructor(toolNames: Iterable<string>) {
    this.toolNames = new Set(toolNames);
  }

  static default(): ToolSet {
    const registry = new ToolRegistry();
    const defaultTools = registry.getToolNamesDefaultEnabled();
    return new ToolSet(defaultTools);
  }

  apply(...definitions: ToolInclusionDefinition[]): ToolSet {
    const registry = new ToolRegistry();
    const next = new Set(this.toolNames);

    for (const definition of definitions) {
      const included: string[] = [];
      const excluded: string[] = [];

      for (const tool of definition.includedOptionalTools) {
        if (!registry.isValidToolName(tool)) {
          throw new Error(`Invalid tool name '${tool}' provided for inclusion`);
        }
        if (!next.has(tool)) {
          next.add(tool);
          included.push(tool);
        }
      }

      for (const tool of definition.excludedTools) {
        if (!registry.isValidToolName(tool)) {
          throw new Error(`Invalid tool name '${tool}' provided for exclusion`);
        }
        if (next.delete(tool)) {
          excluded.push(tool);
        }
      }

      if (included.length > 0) {
        log.info(`${formatDefinition(definition)} included ${included.length} tools: ${included.join(', ')}`);
      }
      if (excluded.length > 0) {
        log.info(`${formatDefinition(definition)} excluded ${excluded.length} tools: ${excluded.join(', ')}`);
      }
    }

    return new ToolSet(next);
  }

  withoutEditingTools(): ToolSet {
    const registry = new ToolRegistry();
    const next = new Set(this.toolNames);

    for (const toolName of this.toolNames) {
      try {
        const toolClass = registry.getToolClassByName(toolName);
        if (toolClass.canEdit()) {
          next.delete(toolName);
        }
      } catch {
        // ToolRegistry は現段階でプレースホルダーのため、未実装メソッドがあれば無視する
      }
    }

    return new ToolSet(next);
  }

  getToolNames(): Set<string> {
    return new Set(this.toolNames);
  }

  includesName(toolName: string): boolean {
    return this.toolNames.has(toolName);
  }
}

export interface ProjectConfigInit extends ToolInclusionDefinitionInit {
  projectName: string;
  language: Language;
  ignoredPaths?: string[];
  readOnly?: boolean;
  ignoreAllFilesInGitignore?: boolean;
  initialPrompt?: string;
  encoding?: string;
}

export class ProjectConfig extends ToolInclusionDefinition {
  readonly projectName: string;
  readonly language: Language;
  readonly ignoredPaths: string[];
  readonly readOnly: boolean;
  readonly ignoreAllFilesInGitignore: boolean;
  readonly initialPrompt: string;
  readonly encoding: string;

  static readonly SMART_EDIT_DEFAULT_PROJECT_FILE = 'project.yml';

  constructor(init: ProjectConfigInit) {
    super(init);
    this.projectName = init.projectName;
    this.language = init.language;
    this.ignoredPaths = [...(init.ignoredPaths ?? [])];
    this.readOnly = init.readOnly ?? false;
    this.ignoreAllFilesInGitignore = init.ignoreAllFilesInGitignore ?? true;
    this.initialPrompt = init.initialPrompt ?? '';
    this.encoding = init.encoding ?? DEFAULT_ENCODING;
  }

  static autogenerate(
    projectRoot: string,
    options: {
      projectName?: string | null;
      projectLanguage?: Language | null;
      saveToDisk?: boolean;
    } = {}
  ): ProjectConfig {
    const resolvedRoot = path.resolve(projectRoot);
    if (!fs.existsSync(resolvedRoot)) {
      throw new Error(`Project root not found: ${resolvedRoot}`);
    }

    const saveToDisk = options.saveToDisk ?? true;
    const name = options.projectName ?? path.basename(resolvedRoot);

    let language = options.projectLanguage;
    if (!language) {
      const languageDefinitions = listLanguages().map((lang) => ({
        name: lang,
        matcher: getLanguageFilenameMatcher(lang)
      }));
      const composition = determineProgrammingLanguageComposition(resolvedRoot, { languages: languageDefinitions });
      const entries = Object.entries(composition);
      if (entries.length === 0) {
        const relativePath = path.join(resolvedRoot, this.relPathToProjectYml());
        throw new Error(
          [
            `No source files found in ${resolvedRoot}`,
            '',
            'Smart-Edit を利用するには以下のいずれかを行ってください:',
            '1. 対応言語のソースファイルを追加 (Python, JavaScript/TypeScript, Java, C#, Rust, Go, Ruby, C++, PHP, Swift, Elixir, Terraform, Bash)',
            `2. 次の場所に project.yml を手動で作成: ${relativePath}`,
            '',
            'project.yml の例:',
            `  project_name: ${name}`,
            '  language: python  # 例: typescript, java, csharp, rust, go, ruby, cpp, php, swift, elixir, terraform, bash'
          ].join('\n')
        );
      }

      entries.sort((a, b) => b[1] - a[1]);
      language = coerceLanguage(entries[0][0]);
    }

    const template = loadYaml(PROJECT_TEMPLATE_FILE, true);
    assignYamlValue(template, 'project_name', name);
    assignYamlValue(template, 'language', language);

    if (saveToDisk) {
      const destination = path.join(resolvedRoot, this.relPathToProjectYml());
      saveYaml(destination, template, true);
    }

    const plain = yamlToObject(template);
    return this.fromDict(plain);
  }

  static relPathToProjectYml(): string {
    return path.join(SMART_EDIT_MANAGED_DIR_NAME, this.SMART_EDIT_DEFAULT_PROJECT_FILE);
  }

  static load(projectRoot: string, autogenerate = false): ProjectConfig {
    const resolvedRoot = path.resolve(projectRoot);
    const yamlPath = path.join(resolvedRoot, this.relPathToProjectYml());
    if (!fs.existsSync(yamlPath)) {
      if (autogenerate) {
        return this.autogenerate(resolvedRoot);
      }
      throw new Error(`Project configuration file not found: ${yamlPath}`);
    }

    const data = loadYaml(yamlPath);
    if (typeof data !== 'object' || data === null) {
      throw new Error(`Invalid project configuration file: ${yamlPath}`);
    }

    const plain = data as Record<string, unknown>;
    if (typeof plain.project_name !== 'string' || plain.project_name.length === 0) {
      plain.project_name = path.basename(resolvedRoot);
    }

    return this.fromDict(plain);
  }

  private static fromDict(data: Record<string, unknown>): ProjectConfig {
    const parsedResult = PROJECT_CONFIG_YAML_SCHEMA.safeParse(data);
    if (!parsedResult.success) {
      throw new SmartEditConfigError(formatZodIssues('project.yml', parsedResult.error));
    }

    const parsed = parsedResult.data;
    const projectName = parsed.project_name;
    const languageValue = coerceLanguage(String(parsed.language));

    let ignoredPaths = parsed.ignored_paths;
    if (ignoredPaths.length === 0 && 'ignored_dirs' in data) {
      const legacyIgnored = data['ignored_dirs'];
      ignoredPaths = normalizeStringIterable(legacyIgnored);
    }

    return new ProjectConfig({
      projectName,
      language: languageValue,
      ignoredPaths,
      excludedTools: parsed.excluded_tools,
      includedOptionalTools: parsed.included_optional_tools,
      readOnly: parsed.read_only ?? false,
      ignoreAllFilesInGitignore: parsed.ignore_all_files_in_gitignore ?? true,
      initialPrompt: parsed.initial_prompt ?? '',
      encoding: parsed.encoding ?? DEFAULT_ENCODING
    });
  }
}

export interface ProjectLike {
  projectRoot: string;
  projectConfig: ProjectConfig;
}

export interface RegisteredProjectInit {
  projectRoot: string;
  projectConfig: ProjectConfig;
  projectInstance?: ProjectLike;
}

export class RegisteredProject {
  readonly projectRoot: string;
  readonly projectConfig: ProjectConfig;
  private projectInstance?: ProjectLike;

  constructor(init: RegisteredProjectInit) {
    this.projectRoot = path.resolve(init.projectRoot);
    this.projectConfig = init.projectConfig;
    this.projectInstance = init.projectInstance;
  }

  get projectName(): string {
    return this.projectConfig.projectName;
  }

  static fromProjectInstance(projectInstance: ProjectLike): RegisteredProject {
    return new RegisteredProject({
      projectRoot: projectInstance.projectRoot,
      projectConfig: projectInstance.projectConfig,
      projectInstance
    });
  }

  matchesRootPath(candidate: string): boolean {
    return this.projectRoot === path.resolve(candidate);
  }

  hasProjectInstance(): boolean {
    return this.projectInstance !== undefined;
  }

  getProjectInstance(): ProjectLike {
    if (!this.projectInstance) {
      throw new Error('Project インスタンスはまだ割り当てられていません。Project モジュールの移植完了後に再度呼び出してください。');
    }
    return this.projectInstance;
  }

  attachProjectInstance(instance: ProjectLike): void {
    this.projectInstance = instance;
  }
}

export enum RegisteredTokenCountEstimator {
  TIKTOKEN_GPT4O = 'TIKTOKEN_GPT4O',
  ANTHROPIC_CLAUDE_SONNET_4 = 'ANTHROPIC_CLAUDE_SONNET_4'
}

export interface SmartEditConfigInit extends ToolInclusionDefinitionInit {
  projects?: RegisteredProject[];
  guiLogWindowEnabled?: boolean;
  logLevel?: number;
  traceLspCommunication?: boolean;
  webDashboard?: boolean;
  webDashboardOpenOnLaunch?: boolean;
  toolTimeout?: number;
  loadedCommentedYaml?: YamlDocument | YamlObject;
  configFilePath?: string | null;
  jetbrains?: boolean;
  recordToolUsageStats?: boolean;
  tokenCountEstimator?: RegisteredTokenCountEstimator;
  defaultMaxToolAnswerChars?: number;
  lsSpecificSettings?: Record<string, unknown>;
}

export class SmartEditConfig extends ToolInclusionDefinition {
  projects: RegisteredProject[];
  guiLogWindowEnabled: boolean;
  logLevel: number;
  traceLspCommunication: boolean;
  webDashboard: boolean;
  webDashboardOpenOnLaunch: boolean;
  toolTimeout: number;
  loadedCommentedYaml?: YamlDocument | YamlObject;
  configFilePath?: string | null;
  jetbrains: boolean;
  recordToolUsageStats: boolean;
  tokenCountEstimator: RegisteredTokenCountEstimator;
  defaultMaxToolAnswerChars: number;
  lsSpecificSettings: Record<string, unknown>;

  static readonly CONFIG_FILE = 'smart_edit_config.yml';
  static readonly CONFIG_FILE_DOCKER = 'smart_edit_config.docker.yml';

  constructor(init: SmartEditConfigInit = {}) {
    super(init);
    this.projects = [...(init.projects ?? [])];
    this.guiLogWindowEnabled = init.guiLogWindowEnabled ?? false;
    this.logLevel = init.logLevel ?? 20;
    this.traceLspCommunication = init.traceLspCommunication ?? false;
    this.webDashboard = init.webDashboard ?? true;
    this.webDashboardOpenOnLaunch = init.webDashboardOpenOnLaunch ?? true;
    this.toolTimeout = init.toolTimeout ?? DEFAULT_TOOL_TIMEOUT;
    this.loadedCommentedYaml = init.loadedCommentedYaml;
    this.configFilePath = init.configFilePath ?? null;
    this.jetbrains = init.jetbrains ?? false;
    this.recordToolUsageStats = init.recordToolUsageStats ?? false;
    this.tokenCountEstimator = init.tokenCountEstimator ?? RegisteredTokenCountEstimator.TIKTOKEN_GPT4O;
    this.defaultMaxToolAnswerChars = init.defaultMaxToolAnswerChars ?? 150_000;
    this.lsSpecificSettings = { ...(init.lsSpecificSettings ?? {}) };
  }

  static generateConfigFile(configFilePath: string): void {
    log.info(`Auto-generating Smart-Edit configuration file in ${configFilePath}`);
    const template = loadYaml(SMART_EDIT_CONFIG_TEMPLATE_FILE, true);
    saveYaml(configFilePath, template, true);
  }

  private static determineConfigFilePath(): string {
    if (isRunningInDocker()) {
      return path.join(REPO_ROOT, this.CONFIG_FILE_DOCKER);
    }

    const configPath = path.join(SMART_EDIT_MANAGED_DIR_IN_HOME, this.CONFIG_FILE);
    if (!fs.existsSync(configPath)) {
      const legacy = path.join(REPO_ROOT, this.CONFIG_FILE);
      if (fs.existsSync(legacy)) {
        log.info(`Moving Smart-Edit configuration file from ${legacy} to ${configPath}`);
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.renameSync(legacy, configPath);
      }
    }

    return configPath;
  }

  static fromConfigFile(options: { generateIfMissing?: boolean } = {}): SmartEditConfig {
    const generateIfMissing = options.generateIfMissing ?? true;
    const configFilePath = this.determineConfigFilePath();

    if (!fs.existsSync(configFilePath)) {
      if (!generateIfMissing) {
        throw new Error(`Smart-Edit configuration file not found: ${configFilePath}`);
      }
      log.info(`Smart-Edit configuration file not found at ${configFilePath}, autogenerating...`);
      this.generateConfigFile(configFilePath);
    }

    log.info(`Loading Smart-Edit configuration from ${configFilePath}`);
    const loaded = loadYaml(configFilePath, true);
    const data = yamlToObject(loaded);
    const parsedResult = SMART_EDIT_CONFIG_YAML_SCHEMA.safeParse(data);
    if (!parsedResult.success) {
      throw new SmartEditConfigError(formatZodIssues(configFilePath, parsedResult.error));
    }
    const parsed = parsedResult.data;

    const projectEntries = parsed.projects;

    const projects: RegisteredProject[] = [];
    let numMigrations = 0;

    for (const entry of projectEntries) {
      const rawPath = path.resolve(entry);
      if (!fs.existsSync(rawPath)) {
        log.warn(`Project path ${rawPath} does not exist, skipping.`);
        continue;
      }

      let resolvedPath = rawPath;
      if (fs.statSync(rawPath).isFile()) {
        const migrated = this.migrateOutOfProjectConfigFile(rawPath);
        if (!migrated) {
          continue;
        }
        resolvedPath = migrated;
        numMigrations += 1;
      }

      const configPath = path.join(resolvedPath, ProjectConfig.relPathToProjectYml());
      if (!fs.existsSync(configPath)) {
        log.warn(`Project path ${resolvedPath} does not contain ${ProjectConfig.relPathToProjectYml()}, skipping.`);
        continue;
      }

      try {
        const projectConfig = ProjectConfig.load(resolvedPath);
        projects.push(
          new RegisteredProject({
            projectRoot: resolvedPath,
            projectConfig
          })
        );
      } catch (error) {
        log.error(`Failed to load project configuration for ${resolvedPath}`, error);
      }
    }

    const config = new SmartEditConfig({
      projects,
      guiLogWindowEnabled: isRunningInDocker()
        ? false
        : asBoolean(parsed.gui_log_window ?? parsed.gui_log_window_enabled, false),
      webDashboard: asBoolean(parsed.web_dashboard, true),
      webDashboardOpenOnLaunch: asBoolean(parsed.web_dashboard_open_on_launch, true),
      toolTimeout: parsed.tool_timeout ?? DEFAULT_TOOL_TIMEOUT,
      traceLspCommunication: asBoolean(parsed.trace_lsp_communication, false),
      excludedTools: parsed.excluded_tools,
      includedOptionalTools: parsed.included_optional_tools,
      logLevel: normalizeLogLevel(parsed.log_level ?? parsed.gui_log_level),
      jetbrains: asBoolean(parsed.jetbrains, false),
      recordToolUsageStats: asBoolean(parsed.record_tool_usage_stats, false),
      tokenCountEstimator: normalizeEstimator(parsed.token_count_estimator),
      defaultMaxToolAnswerChars: parsed.default_max_tool_answer_chars ?? 150_000,
      lsSpecificSettings: parsed.ls_specific_settings ?? {},
      loadedCommentedYaml: loaded,
      configFilePath
    });

    if (numMigrations > 0) {
      log.info(
        `Migrated ${numMigrations} project configurations from legacy format to in-project configuration; re-saving configuration`
      );
      config.save();
    }

    return config;
  }

  private static migrateOutOfProjectConfigFile(filePath: string): string | null {
    log.info(`Found legacy project configuration file ${filePath}, migrating to in-project configuration.`);
    try {
      const content = loadYaml(filePath);
      if (!content || typeof content !== 'object') {
        throw new Error('Invalid project configuration content');
      }
      const plain = content as Record<string, unknown>;
      if (typeof plain.project_name !== 'string' || plain.project_name.length === 0) {
        plain.project_name = path.parse(filePath).name;
        saveYaml(filePath, plain);
      }
      const projectRootValue = plain.project_root;
      if (typeof projectRootValue !== 'string' || projectRootValue.length === 0) {
        throw new Error('Legacy project configuration missing `project_root` field');
      }
      const projectRoot = projectRootValue;
      const destination = path.join(projectRoot, ProjectConfig.relPathToProjectYml());
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.renameSync(filePath, destination);
      return path.resolve(projectRoot);
    } catch (error) {
      log.error(`Error migrating configuration file: ${String(error)}`);
      return null;
    }
  }

  get projectPaths(): string[] {
    return this.projects.map((project) => project.projectRoot).sort();
  }

  get projectNames(): string[] {
    return this.projects.map((project) => project.projectName).sort();
  }

  getProject(projectRootOrName: string): ProjectLike | undefined {
    const byName = this.projects.filter((project) => project.projectName === projectRootOrName);
    if (byName.length === 1 && byName[0].hasProjectInstance()) {
      return byName[0].getProjectInstance();
    }
    if (byName.length > 1) {
      throw new Error(
        `Multiple projects found with name '${projectRootOrName}'. Please activate it by location instead. Locations: ${byName
          .map((p) => p.projectRoot)
          .join(', ')}`
      );
    }

    const resolved = path.resolve(projectRootOrName);
    for (const project of this.projects) {
      if (project.matchesRootPath(resolved) && project.hasProjectInstance()) {
        return project.getProjectInstance();
      }
    }
    return undefined;
  }

  addProjectFromPath(projectRoot: string): RegisteredProject {
    const resolved = path.resolve(projectRoot);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Error: Path does not exist: ${resolved}`);
    }
    if (!fs.statSync(resolved).isDirectory()) {
      throw new Error(`Error: Path is not a directory: ${resolved}`);
    }

    for (const project of this.projects) {
      if (project.matchesRootPath(resolved)) {
        throw new Error(`Project with path ${resolved} was already added with name '${project.projectName}'.`);
      }
    }

    const projectConfig = ProjectConfig.load(resolved, true);
    const registered = new RegisteredProject({
      projectRoot: resolved,
      projectConfig
    });
    this.projects.push(registered);
    this.save();
    return registered;
  }

  removeProject(projectName: string): void {
    const index = this.projects.findIndex((project) => project.projectName === projectName);
    if (index === -1) {
      throw new Error(`Project '${projectName}' not found in Smart-Edit configuration; valid project names: ${this.projectNames.join(', ')}`);
    }

    this.projects.splice(index, 1);
    this.save();
  }

  save(): void {
    if (!this.configFilePath) {
      return;
    }

    const yamlData = this.loadedCommentedYaml ?? {};
    const uniqueProjects = Array.from(new Set(this.projects.map((project) => project.projectRoot))).sort();

    assignYamlValue(yamlData, 'projects', uniqueProjects);
    assignYamlValue(yamlData, 'gui_log_window', this.guiLogWindowEnabled);
    assignYamlValue(yamlData, 'web_dashboard', this.webDashboard);
    assignYamlValue(yamlData, 'web_dashboard_open_on_launch', this.webDashboardOpenOnLaunch);
    assignYamlValue(yamlData, 'tool_timeout', this.toolTimeout);
    assignYamlValue(yamlData, 'trace_lsp_communication', this.traceLspCommunication);
    assignYamlValue(yamlData, 'excluded_tools', this.excludedTools);
    assignYamlValue(yamlData, 'included_optional_tools', this.includedOptionalTools);
    assignYamlValue(yamlData, 'jetbrains', this.jetbrains);
    assignYamlValue(yamlData, 'record_tool_usage_stats', this.recordToolUsageStats);
    assignYamlValue(yamlData, 'token_count_estimator', this.tokenCountEstimator);
    assignYamlValue(yamlData, 'default_max_tool_answer_chars', this.defaultMaxToolAnswerChars);
    assignYamlValue(yamlData, 'ls_specific_settings', this.lsSpecificSettings);
    assignYamlValue(yamlData, 'log_level', this.logLevel);

    saveYaml(this.configFilePath, yamlData, isYamlDocument(yamlData));
  }
}

export class SmartEditConfigError extends Error {}

export function getSmartEditManagedInProjectDir(projectRoot: string): string {
  return path.join(projectRoot, SMART_EDIT_MANAGED_DIR_NAME);
}

export function isRunningInDocker(): boolean {
  if (fs.existsSync('/.dockerenv')) {
    return true;
  }

  try {
    const cgroup = fs.readFileSync('/proc/self/cgroup', 'utf-8');
    return cgroup.includes('docker');
  } catch {
    return false;
  }
}

function formatDefinition(definition: ToolInclusionDefinition): string {
  return `ToolInclusionDefinition(excluded=${definition.excludedTools.length}, included=${definition.includedOptionalTools.length})`;
}

function normalizeStringIterable(value: unknown): string[] {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  if (typeof value === 'string') {
    return [value];
  }
  if (Symbol.iterator in Object(value)) {
    const result: string[] = [];
    for (const item of value as Iterable<unknown>) {
      if (typeof item === 'string') {
        result.push(item);
      }
    }
    return result;
  }
  return [];
}

function formatZodIssues(source: string, error: z.ZodError): string {
  const details = error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
  return `${source} のスキーマ検証に失敗しました: ${details}`;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') {
      return true;
    }
    if (value.toLowerCase() === 'false') {
      return false;
    }
  }
  return fallback;
}

function normalizeLogLevel(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return 20;
}

function normalizeEstimator(value: unknown): RegisteredTokenCountEstimator {
  if (typeof value === 'string') {
    const upper = value.toUpperCase();
    if (upper in RegisteredTokenCountEstimator) {
      return RegisteredTokenCountEstimator[upper as keyof typeof RegisteredTokenCountEstimator];
    }
  }
  return RegisteredTokenCountEstimator.TIKTOKEN_GPT4O;
}

function isYamlDocument(value: YamlObject | YamlDocument): value is YamlDocument {
  return typeof value === 'object' && value !== null && typeof (value as YamlDocument).toString === 'function';
}

function assignYamlValue(target: YamlObject | YamlDocument, key: string, value: unknown): void {
  if (isYamlDocument(target) && typeof target.set === 'function') {
    target.set(key, value);
    return;
  }

  (target as Record<string, unknown>)[key] = value;
}

function yamlToObject(data: YamlObject | YamlDocument): Record<string, unknown> {
  if (isYamlDocument(data) && typeof data.toJSON === 'function') {
    const json = data.toJSON();
    if (json && typeof json === 'object') {
      return { ...(json as Record<string, unknown>) };
    }
  }
  return { ...(data as Record<string, unknown>) };
}
