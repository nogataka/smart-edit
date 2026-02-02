import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';

import { Command, Option } from 'commander';

import {
  DEFAULT_CONTEXT,
  DEFAULT_MODES,
  PROMPT_TEMPLATES_DIR_IN_USER_HOME,
  PROMPT_TEMPLATES_DIR_INTERNAL,
  SMART_EDIT_MANAGED_DIR_IN_HOME,
  SMART_EDITS_OWN_CONTEXT_YAMLS_DIR,
  SMART_EDITS_OWN_MODE_YAMLS_DIR,
  SMART_EDIT_LOG_FORMAT,
  USER_CONTEXT_YAMLS_DIR,
  USER_MODE_YAMLS_DIR
} from './constants.js';
import {
  SmartEditAgentContext,
  SmartEditAgentMode
} from './config/context_mode.js';
import {
  ProjectConfig,
  SmartEditConfig,
  SmartEditPaths
} from './config/smart_edit_config.js';
import {
  createSmartEditLogger,
  setConsoleLoggingEnabled
} from './util/logging.js';
import type {
  MemoryLogHandler
} from './util/logging.js';
import { SmartEditAgent } from './agent.js';
import {
  SmartEditMCPFactorySingleProcess,
  createSmartEditHttpServer,
  type SmartEditHttpServerOptions,
  createSmartEditStdioServer
} from './mcp.js';
import {
  DEFAULT_DASHBOARD_PORT,
  registerInstance,
  unregisterInstance,
  findAvailablePort,
  type InstanceInfo
} from './instance-registry.js';
import {
  ToolRegistry
} from './tools/tools_base.js';
import {
  coerceLanguage
} from '../smart-lsp/ls_config.js';
import { ensureDefaultSubprocessOptions } from '../smart-lsp/util/subprocess_util.js';
import { smartEditVersion } from './version.js';

type TransportChoice = 'stdio' | 'sse' | 'streamable-http';

interface CliLoggingContext {
  logger: ReturnType<typeof createSmartEditLogger>['logger'];
  memoryHandler: MemoryLogHandler;
  logFilePath: string;
  dispose(): void;
}

interface CreateCliOptions {
  writeOut?: (str: string) => void;
  writeErr?: (str: string) => void;
  enableExitOverride?: boolean;
}

interface StartMcpServerOpts {
  project?: string | null;
  projectFile?: string | null;
  context: string;
  modes: string[];
  transport: TransportChoice;
  host: string;
  port: number;
  enableWebDashboard?: boolean | null;
  enableGuiLogWindow?: boolean | null;
  logLevel?: LogLevelName | null;
  traceLspCommunication?: boolean | null;
  toolTimeout?: number | null;
  instructionsOverride?: string | null;
}

interface StartMcpServerCliOptions {
  project?: unknown;
  projectFile?: unknown;
  noProject?: unknown;
  context?: unknown;
  mode?: unknown;
  modes?: unknown;
  transport?: unknown;
  host?: unknown;
  port?: unknown;
  enableWebDashboard?: unknown;
  enableGuiLogWindow?: unknown;
  logLevel?: unknown;
  traceLspCommunication?: unknown;
  toolTimeout?: unknown;
  instructionsOverride?: unknown;
}

const LOG_LEVEL_NAMES = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'] as const;
type LogLevelName = (typeof LOG_LEVEL_NAMES)[number];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isTransportChoice(value: string): value is TransportChoice {
  return value === 'stdio' || value === 'sse' || value === 'streamable-http';
}

function isLogLevelName(value: string): value is LogLevelName {
  return LOG_LEVEL_NAMES.some((name) => name === value);
}

function parseOptionalBoolean(value: string | undefined): boolean {
  if (value === undefined) {
    return true;
  }
  const normalized = value.toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'off'].includes(normalized)) {
    return false;
  }
  throw new Error(`ブーリアン値として解釈できません: ${value}`);
}

function parseInteger(value: string, optionName: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`${optionName} は整数で指定してください: ${value}`);
  }
  return parsed;
}

function parseFloatSeconds(value: string): number {
  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`秒数は数値で指定してください: ${value}`);
  }
  return parsed;
}

function normalizeStartMcpServerOptions(raw: StartMcpServerCliOptions): StartMcpServerOpts {
  const context = isNonEmptyString(raw.context) ? raw.context : DEFAULT_CONTEXT;

  const rawModes = raw.modes ?? raw.mode;
  const normalizedModes = (() => {
    if (Array.isArray(rawModes)) {
      const filtered = rawModes.filter(isNonEmptyString);
      return filtered.length > 0 ? filtered : Array.from(DEFAULT_MODES);
    }
    if (isNonEmptyString(rawModes)) {
      return [rawModes];
    }
    return Array.from(DEFAULT_MODES);
  })();

  const transportCandidate = typeof raw.transport === 'string' ? raw.transport : 'stdio';
  if (!isTransportChoice(transportCandidate)) {
    throw new Error(`未知のトランスポートが指定されました: ${String(raw.transport)}`);
  }
  const transport = transportCandidate;

  const host = isNonEmptyString(raw.host) ? raw.host : '0.0.0.0';
  const port = typeof raw.port === 'number' ? raw.port : 8000;

  const coerceBoolean = (value: unknown): boolean | null | undefined => {
    if (value === undefined) {
      return undefined;
    }
    if (value === null) {
      return null;
    }
    if (typeof value === 'boolean') {
      return value;
    }
    return undefined;
  };

  const coerceLogLevel = (value: unknown): LogLevelName | null | undefined => {
    if (value === undefined) {
      return undefined;
    }
    if (value === null) {
      return null;
    }
    if (typeof value === 'string') {
      const normalized = value.toUpperCase();
      if (isLogLevelName(normalized)) {
        return normalized;
      }
    }
    return undefined;
  };

  // プロジェクトの決定ロジック:
  // 1. --no-project が指定された場合: null（プロジェクトなしで起動）
  // 2. --project が指定された場合: 指定されたパス
  // 3. --project-file が指定された場合: 指定されたパス（後方互換）
  // 4. どれも指定されていない場合: カレントディレクトリを使用
  const resolveProject = (): string | null => {
    if (raw.noProject === true) {
      return null;
    }
    if (isNonEmptyString(raw.project)) {
      return raw.project;
    }
    if (isNonEmptyString(raw.projectFile)) {
      return raw.projectFile;
    }
    return process.cwd();
  };

  return {
    project: resolveProject(),
    projectFile: isNonEmptyString(raw.projectFile) ? raw.projectFile : null,
    context,
    modes: normalizedModes.slice(),
    transport,
    host,
    port,
    enableWebDashboard: coerceBoolean(raw.enableWebDashboard) ?? null,
    enableGuiLogWindow: coerceBoolean(raw.enableGuiLogWindow) ?? null,
    logLevel: coerceLogLevel(raw.logLevel) ?? null,
    traceLspCommunication: coerceBoolean(raw.traceLspCommunication) ?? null,
    toolTimeout: typeof raw.toolTimeout === 'number' ? raw.toolTimeout : null,
    instructionsOverride: typeof raw.instructionsOverride === 'string' ? raw.instructionsOverride : null
  };
}

function isPathInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function normalizeProjectArgument(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const resolved = path.resolve(value);
  try {
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
      return resolved;
    }
  } catch {
    // ignore resolution errors and fall back to the raw value
  }
  return value;
}

async function openInEditor(targetPath: string): Promise<void> {
  if (process.env.SMART_EDIT_SKIP_EDITOR === '1') {
    return;
  }

  const run = (command: string, args: string[], options: { shell?: boolean } = {}): Promise<void> =>
    new Promise((resolve, reject) => {
      const child = spawn(command, args, ensureDefaultSubprocessOptions({
        stdio: 'ignore',
        detached: false,
        shell: options.shell ?? false
      }));
      child.on('error', reject);
      child.on('close', () => resolve());
    });

  try {
    const editor = process.env.EDITOR;
    if (editor && editor.trim().length > 0) {
      await run(editor, [targetPath], { shell: true });
      return;
    }

    if (process.platform === 'win32') {
      await run('cmd', ['/c', 'start', '', `"${targetPath}"`], { shell: true });
      return;
    }

    if (process.platform === 'darwin') {
      await run('open', [targetPath]);
      return;
    }

    await run('xdg-open', [targetPath]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to open ${targetPath}: ${message}`);
  }
}

function setupCliLogging(
  prefix: string,
  options: { emitToConsole: boolean; duplicateToStderr?: boolean }
): CliLoggingContext {
  const { logger, memoryHandler } = createSmartEditLogger({
    level: 'info',
    emitToConsole: options.emitToConsole,
    name: `smart-edit.cli.${prefix}`
  });

  const paths = new SmartEditPaths();
  const logFilePath = paths.getNextLogFilePath(prefix);
  const stream = fs.createWriteStream(logFilePath, { encoding: 'utf-8', flags: 'w' });

  const callback = (message: string) => {
    stream.write(`${message}\n`);
    if (options.duplicateToStderr) {
      process.stderr.write(`${message}\n`);
    }
  };
  memoryHandler.addEmitCallback(callback);

  const dispose = (): void => {
    memoryHandler.removeEmitCallback(callback);
    stream.end();
  };

  return { logger, memoryHandler, logFilePath, dispose };
}

async function handleStartMcpServer(options: StartMcpServerOpts, projectArg?: string | null): Promise<void> {
  const suppressConsoleLogs = options.transport === 'stdio';
  let restoreConsoleLogging = (): void => {
    // noop
  };
  if (suppressConsoleLogs) {
    setConsoleLoggingEnabled(false);
    restoreConsoleLogging = () => setConsoleLoggingEnabled(true);
  }

  const cliLog = setupCliLogging('mcp', {
    emitToConsole: !suppressConsoleLogs,
    duplicateToStderr: suppressConsoleLogs
  });
  const { logger } = cliLog;
  logger.info('Initializing Smart-Edit MCP server');
  logger.info(`Storing logs in ${cliLog.logFilePath}`);
  logger.info(`Smart-Edit CLI log format: ${SMART_EDIT_LOG_FORMAT}`);

  const project = normalizeProjectArgument(projectArg ?? options.projectFile ?? options.project ?? null);
  if (projectArg && projectArg !== project) {
    logger.warn('--project 引数の代わりに位置引数を使用する方法は非推奨です (--project を使用してください)。');
  }

  const modes = options.modes.length > 0 ? options.modes : Array.from(DEFAULT_MODES);
  const factory = new SmartEditMCPFactorySingleProcess({
    context: options.context ?? DEFAULT_CONTEXT,
    project,
    memoryLogHandler: cliLog.memoryHandler,
    agentFactory: (agentOptions) =>
      new SmartEditAgent({
        project: agentOptions.project,
        smartEditConfig: agentOptions.smartEditConfig,
        context: agentOptions.context,
        modes: agentOptions.modes,
        memoryLogHandler: agentOptions.memoryLogHandler ?? undefined
      })
  });

  // Track registered instance for cleanup
  let registeredInstance: InstanceInfo | null = null;

  try {
    const serverOptions: SmartEditHttpServerOptions = {
      host: options.host,
      port: options.port,
      modes,
      enableWebDashboard: options.enableWebDashboard ?? undefined,
      enableGuiLogWindow: options.enableGuiLogWindow ?? undefined,
      logLevel: options.logLevel ?? undefined,
      traceLspCommunication: options.traceLspCommunication ?? undefined,
      toolTimeout: options.toolTimeout ?? undefined,
      instructionsOverride: options.instructionsOverride ?? undefined
    };

    switch (options.transport) {
      case 'streamable-http': {
        const server = await createSmartEditHttpServer(factory, serverOptions);
        const serverPort = server.url.port ? Number.parseInt(server.url.port, 10) : options.port;
        logger.info(`Streamable HTTP MCP server started: ${server.url.href}`);
        logger.info('Press Ctrl+C to exit.');

        // Register instance (skip in test environment)
        if (!process.env.SMART_EDIT_SKIP_EDITOR) {
          registeredInstance = registerInstance({
            port: serverPort,
            project,
            pid: process.pid,
            transport: 'streamable-http'
          });
          logger.info(`Registered instance ${registeredInstance.id} in registry`);
        }

        await new Promise<void>((resolve) => {
          const shutdown = async (): Promise<void> => {
            logger.info('Stopping HTTP MCP server...');
            if (registeredInstance) {
              unregisterInstance(registeredInstance.id);
              logger.info(`Unregistered instance ${registeredInstance.id} from registry`);
            }
            await server.close();
            resolve();
          };
          process.once('SIGINT', () => {
            void shutdown();
          });
          process.once('SIGTERM', () => {
            void shutdown();
          });
        });
        break;
      }
      case 'stdio': {
        const server = await createSmartEditStdioServer(factory, serverOptions);
        logger.info('STDIO MCP server started. Press Ctrl+C to exit.');

        // For stdio transport, find an available port for the dashboard API (skip in test environment)
        if (!process.env.SMART_EDIT_SKIP_EDITOR) {
          const dashboardPort = findAvailablePort();
          registeredInstance = registerInstance({
            port: dashboardPort,
            project,
            pid: process.pid,
            transport: 'stdio'
          });
          logger.info(`Registered instance ${registeredInstance.id} in registry (dashboard port: ${dashboardPort})`);
        }

        await new Promise<void>((resolve) => {
          let settled = false;
          const finalize = async (reason: 'signal' | 'transport-close'): Promise<void> => {
            if (settled) {
              return;
            }
            settled = true;
            logger.info('Stopping STDIO MCP server...');
            if (registeredInstance) {
              unregisterInstance(registeredInstance.id);
              logger.info(`Unregistered instance ${registeredInstance.id} from registry`);
            }
            if (reason === 'signal') {
              await server.close();
            }
            resolve();
          };

          server.transport.onclose = () => {
            void finalize('transport-close');
          };
          server.transport.onerror = (error) => {
            logger.error('STDIO MCP トランスポートでエラーが発生しました。', error);
            void finalize('transport-close');
          };

          const onSignal = (signal: NodeJS.Signals) => {
            logger.info(`Received signal ${signal}`);
            void finalize('signal');
          };
          process.once('SIGINT', onSignal);
          process.once('SIGTERM', onSignal);
        });
        break;
      }
      case 'sse':
        throw new Error('SSE トランスポートは TypeScript 版では未実装です。HTTP モード (--transport streamable-http) を利用してください。');
      default:
        throw new Error(`未知のトランスポートが指定されました: ${options.transport as string}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Smart-Edit MCP サーバーの起動に失敗しました: ${message}`);
    // Unregister instance on error
    if (registeredInstance) {
      unregisterInstance(registeredInstance.id);
      logger.info(`Unregistered instance ${registeredInstance.id} from registry (error cleanup)`);
    }
    throw error;
  } finally {
    cliLog.dispose();
    restoreConsoleLogging();
  }
}

function formatModeLine(name: string, yamlPath: string): string {
  const isInternal = isPathInside(yamlPath, SMART_EDITS_OWN_MODE_YAMLS_DIR);
  const descriptor = isInternal ? '(internal)' : `(at ${yamlPath})`;
  return `${name}    ${descriptor}`;
}

function formatContextLine(name: string, yamlPath: string): string {
  const isInternal = isPathInside(yamlPath, SMART_EDITS_OWN_CONTEXT_YAMLS_DIR);
  const descriptor = isInternal ? '(internal)' : `(at ${yamlPath})`;
  return `${name}    ${descriptor}`;
}

function ensureDirExists(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function handleModeCreate(options: { name?: string | null; fromInternal?: string | null }): string {
  const { name, fromInternal } = options;
  if (!name && !fromInternal) {
    throw new Error('--name か --from-internal のいずれかを指定してください。');
  }
  const modeName = name ?? fromInternal ?? '';
  const destination = path.join(USER_MODE_YAMLS_DIR, `${modeName}.yml`);
  const source = fromInternal
    ? path.join(SMART_EDITS_OWN_MODE_YAMLS_DIR, `${fromInternal}.yml`)
    : path.join(SMART_EDITS_OWN_MODE_YAMLS_DIR, 'mode.template.yml');

  if (!fs.existsSync(source)) {
    const available = SmartEditAgentMode.listRegisteredModeNames().join(', ');
    throw new Error(`内部モード '${fromInternal ?? ''}' が見つかりません。利用可能なモード: ${available}`);
  }

  ensureDirExists(path.dirname(destination));
  fs.copyFileSync(source, destination);
  return destination;
}

function handleContextCreate(options: { name?: string | null; fromInternal?: string | null }): string {
  const { name, fromInternal } = options;
  if (!name && !fromInternal) {
    throw new Error('--name か --from-internal のいずれかを指定してください。');
  }
  const contextName = name ?? fromInternal ?? '';
  const destination = path.join(USER_CONTEXT_YAMLS_DIR, `${contextName}.yml`);
  const source = fromInternal
    ? path.join(SMART_EDITS_OWN_CONTEXT_YAMLS_DIR, `${fromInternal}.yml`)
    : path.join(SMART_EDITS_OWN_CONTEXT_YAMLS_DIR, 'context.template.yml');

  if (!fs.existsSync(source)) {
    const available = SmartEditAgentContext.listRegisteredContextNames().join(', ');
    throw new Error(`内部コンテキスト '${fromInternal ?? ''}' が見つかりません。利用可能なコンテキスト: ${available}`);
  }

  ensureDirExists(path.dirname(destination));
  fs.copyFileSync(source, destination);
  return destination;
}

function formatPromptListLine(promptYamlName: string, userPromptYamlPath: string): string {
  if (fs.existsSync(userPromptYamlPath)) {
    return `${userPromptYamlPath} merged with default prompts in ${promptYamlName}`;
  }
  return promptYamlName;
}

function getUserPromptPath(promptYamlName: string): string {
  ensureDirExists(PROMPT_TEMPLATES_DIR_IN_USER_HOME);
  return path.join(PROMPT_TEMPLATES_DIR_IN_USER_HOME, promptYamlName);
}

function ensurePromptYamlName(promptYamlName: string): string {
  return promptYamlName.endsWith('.yml') ? promptYamlName : `${promptYamlName}.yml`;
}

export function createSmartEditCli(options: CreateCliOptions = {}): Command {
  const program = new Command('smart-edit');
  program
    .version(smartEditVersion(), '-v, --version', 'バージョンを表示します')
    .description('Smart-Edit CLI commands. 各コマンドの詳細は `<command> --help` を参照してください。')
    .showHelpAfterError('(ヘルプ: smart-edit --help)')
    .configureOutput({
      writeOut: options.writeOut ?? ((str: string) => process.stdout.write(str)),
      writeErr: options.writeErr ?? ((str: string) => process.stderr.write(str)),
      outputError: (str: string, write: (str: string) => void) => write(str)
    });

  if (options.enableExitOverride) {
    program.exitOverride();
  }

  const startMcpServerCommand = new Command('start-mcp-server')
    .description('Smart-Edit MCP サーバーを起動します。')
    .option('--project [project]', '起動時にアクティブ化するプロジェクトパス。省略時はカレントディレクトリを使用。')
    .option('--no-project', 'プロジェクトなしで起動。後から activate_project ツールで指定可能。')
    .option('--project-file [project]', '[非推奨] --project の旧名称。')
    .argument('[project]', '[非推奨] プロジェクトの位置引数。')
    .option('--context <context>', 'ビルトインコンテキスト名またはカスタム YAML へのパス。')
    .addOption(
      new Option('--mode <mode...>', 'ビルトインモード名またはカスタムモード YAML を複数指定できます。')
        .default(Array.from(DEFAULT_MODES))
    )
    .addOption(
      new Option('--transport <transport>', '使用するトランスポート。')
        .choices(['stdio', 'sse', 'streamable-http'])
        .default('stdio')
    )
    .option('--host <host>', 'サーバーのバインドホスト。', '0.0.0.0')
    .option('--port <port>', 'サーバーのポート。', (value) => parseInteger(value, '--port'), 8000)
    .option('--enable-web-dashboard [value]', 'Config の web_dashboard 設定を上書きします。', parseOptionalBoolean, undefined)
    .option(
      '--enable-gui-log-window [value]',
      'Config の gui_log_window 設定を上書きします。',
      parseOptionalBoolean,
      undefined
    )
    .addOption(
      new Option('--log-level <level>', 'Config の log_level を上書きします。')
        .choices([...LOG_LEVEL_NAMES])
    )
    .option(
      '--trace-lsp-communication [value]',
      'LSP 通信のトレースを有効／無効にします。',
      parseOptionalBoolean,
      undefined
    )
    .option('--tool-timeout <seconds>', 'ツール実行のタイムアウト(秒)。', (value) => parseFloatSeconds(value))
    .option('--instructions-override <prompt>', 'ツールに公開する初期インストラクションを明示的に上書きします。', undefined)
    .action(async function (this: Command, projectArg?: string) {
      const opts = normalizeStartMcpServerOptions(this.optsWithGlobals<StartMcpServerCliOptions>());
      const normalizedProjectArg = projectArg ?? null;
      try {
        await handleStartMcpServer(opts, normalizedProjectArg);
      } catch (error) {
        // In test environment, rethrow the error so vitest can display it properly
        // (this.error() calls process.exit which vitest intercepts, hiding the actual error)
        if (process.env.SMART_EDIT_SKIP_EDITOR) {
          throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        this.error(`${message}\n`, { exitCode: 1 });
      }
    });

  program.addCommand(startMcpServerCommand);

  const startDashboardCommand = new Command('start-dashboard')
    .description('統合ダッシュボードを起動します（MCPサーバーなし）。複数のMCPインスタンスを一括管理できます。')
    .option('--port <port>', 'ダッシュボードのポート番号。', (value) => parseInteger(value, '--port'), DEFAULT_DASHBOARD_PORT)
    .action(async function (this: Command) {
      const opts = this.optsWithGlobals<{ port?: number }>();
      const port = typeof opts.port === 'number' ? opts.port : DEFAULT_DASHBOARD_PORT;
      try {
        const { runStandaloneDashboard } = await import('./standalone-dashboard.js');
        await runStandaloneDashboard({ port });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.error(`${message}\n`, { exitCode: 1 });
      }
    });

  program.addCommand(startDashboardCommand);

  const modeCommand = new Command('mode')
    .description('Smart-Edit モードを管理します。');

  modeCommand
    .command('list')
    .description('利用可能なモードを一覧表示します。')
    .action(() => {
      const modes = SmartEditAgentMode.listRegisteredModeNames();
      const output = modes
        .map((name) => {
          const yamlPath = SmartEditAgentMode.getPath(name);
          return formatModeLine(name, yamlPath);
        })
        .join('\n');
      if (output.length > 0) {
        console.log(output);
      }
    });

  modeCommand
    .command('create')
    .description('新しいモードを作成するか、内部モードをコピーします。')
    .option('--name <name>', '新しいモード名。')
    .option('--from-internal <name>', '内部モードからコピーします。')
    .action(async (options: { name?: string; fromInternal?: string }) => {
      try {
        const destination = handleModeCreate({
          name: options.name ?? null,
          fromInternal: options.fromInternal ?? null
        });
        console.log(`Created mode '${path.parse(destination).name}' at ${destination}`);
        await openInEditor(destination);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${message}`);
      }
    });

  modeCommand
    .command('edit')
    .description('カスタムモード YAML を編集します。')
    .argument('<modeName>', 'モード名')
    .action(async (modeName: string) => {
      const destination = path.join(USER_MODE_YAMLS_DIR, `${modeName}.yml`);
      if (!fs.existsSync(destination)) {
        if (SmartEditAgentMode.listRegisteredModeNames(false).includes(modeName)) {
          throw new Error(
            `Mode '${modeName}' は内部モードのため直接編集できません。'mode create --from-internal ${modeName}' を使用してカスタムモードを作成してください。`
          );
        }
        throw new Error(`カスタムモード '${modeName}' が見つかりません。'mode create --name ${modeName}' を使用してください。`);
      }
      await openInEditor(destination);
    });

  modeCommand
    .command('delete')
    .description('カスタムモードファイルを削除します。')
    .argument('<modeName>', 'モード名')
    .action((modeName: string) => {
      const destination = path.join(USER_MODE_YAMLS_DIR, `${modeName}.yml`);
      if (!fs.existsSync(destination)) {
        throw new Error(`カスタムモード '${modeName}' が存在しません。`);
      }
      fs.rmSync(destination);
      console.log(`Deleted custom mode '${modeName}'.`);
    });

  program.addCommand(modeCommand);

  const contextCommand = new Command('context')
    .description('Smart-Edit コンテキストを管理します。');

  contextCommand
    .command('list')
    .description('利用可能なコンテキストを一覧表示します。')
    .action(() => {
      const contexts = SmartEditAgentContext.listRegisteredContextNames();
      const output = contexts
        .map((name) => {
          const yamlPath = SmartEditAgentContext.getPath(name);
          return formatContextLine(name, yamlPath);
        })
        .join('\n');
      if (output.length > 0) {
        console.log(output);
      }
    });

  contextCommand
    .command('create')
    .description('新しいコンテキストを作成するか、内部コンテキストをコピーします。')
    .option('--name <name>', '新しいコンテキスト名。')
    .option('--from-internal <name>', '内部コンテキストからコピーします。')
    .action(async (options: { name?: string; fromInternal?: string }) => {
      try {
        const destination = handleContextCreate({
          name: options.name ?? null,
          fromInternal: options.fromInternal ?? null
        });
        console.log(`Created context '${path.parse(destination).name}' at ${destination}`);
        await openInEditor(destination);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${message}`);
      }
    });

  contextCommand
    .command('edit')
    .description('カスタムコンテキスト YAML を編集します。')
    .argument('<contextName>', 'コンテキスト名')
    .action(async (contextName: string) => {
      const destination = path.join(USER_CONTEXT_YAMLS_DIR, `${contextName}.yml`);
      if (!fs.existsSync(destination)) {
        if (SmartEditAgentContext.listRegisteredContextNames(false).includes(contextName)) {
          throw new Error(
            `Context '${contextName}' は内部コンテキストのため直接編集できません。'context create --from-internal ${contextName}' を使用してカスタムコンテキストを作成してください。`
          );
        }
        throw new Error(
          `カスタムコンテキスト '${contextName}' が見つかりません。'context create --name ${contextName}' を使用してください。`
        );
      }
      await openInEditor(destination);
    });

  contextCommand
    .command('delete')
    .description('カスタムコンテキストファイルを削除します。')
    .argument('<contextName>', 'コンテキスト名')
    .action((contextName: string) => {
      const destination = path.join(USER_CONTEXT_YAMLS_DIR, `${contextName}.yml`);
      if (!fs.existsSync(destination)) {
        throw new Error(`カスタムコンテキスト '${contextName}' は存在しません。`);
      }
      fs.rmSync(destination);
      console.log(`Deleted custom context '${contextName}'.`);
    });

  program.addCommand(contextCommand);

  const configCommand = new Command('config')
    .description('Smart-Edit の設定ファイルを扱います。');

  configCommand
    .command('edit')
    .description('smart_edit_config.yml を既定のエディタで開きます。')
    .action(async () => {
      const configPath = path.join(SMART_EDIT_MANAGED_DIR_IN_HOME, 'smart_edit_config.yml');
      if (!fs.existsSync(configPath)) {
        ensureDirExists(path.dirname(configPath));
        SmartEditConfig.generateConfigFile(configPath);
      }
      await openInEditor(configPath);
    });

  program.addCommand(configCommand);

  const projectCommand = new Command('project')
    .description('Smart-Edit プロジェクト関連の操作。');

  projectCommand
    .command('generate-yml')
    .description('プロジェクトの project.yml を生成します。')
    .argument('[projectPath]', 'プロジェクトディレクトリ (既定: カレントディレクトリ)。', process.cwd())
    .option('--language <language>', 'プロジェクトの言語。指定しない場合は自動推測。')
    .action((projectPath: string, options: { language?: string }) => {
      const resolved = path.resolve(projectPath);
      try {
        const language = options.language ? coerceLanguage(options.language) : undefined;
        const config = ProjectConfig.autogenerate(resolved, {
          projectLanguage: language ?? null
        });
        console.log(
          `Generated project.yml with language ${config.language} at ${path.join(resolved, ProjectConfig.relPathToProjectYml())}.`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(message);
      }
    });

  program.addCommand(projectCommand);

  const toolsCommand = new Command('tools')
    .description('Smart-Edit のツール情報を表示します。');

  toolsCommand
    .command('list')
    .description('利用可能なツールの概要を表示します。')
    .option('--quiet', '-q', 'ツール名のみを表示します。')
    .option('--all', '-a', 'オプションツールを含め全て表示します。')
    .option('--only-optional', 'オプションツールのみ表示します。')
    .action((options: { quiet?: boolean; all?: boolean; onlyOptional?: boolean }) => {
      const registry = new ToolRegistry();
      if (options.quiet) {
        let toolNames: string[];
        if (options.onlyOptional) {
          toolNames = registry.getToolNamesOptional();
        } else if (options.all) {
          toolNames = registry.getToolNames();
        } else {
          toolNames = registry.getToolNamesDefaultEnabled();
        }
        console.log(toolNames.join('\n'));
        return;
      }
      registry.printToolOverview(undefined, {
        includeOptional: options.all,
        onlyOptional: options.onlyOptional
      });
    });

  program.addCommand(toolsCommand);

  const promptsCommand = new Command('prompts')
    .description('プロンプト関連のコマンド。');

  promptsCommand
    .command('list')
    .description('プロンプト定義に使用される YAML を一覧表示します。')
    .action(() => {
      const names = fs
        .readdirSync(PROMPT_TEMPLATES_DIR_INTERNAL, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.yml'))
        .map((entry) => entry.name)
        .sort();
      const lines = names.map((name) => formatPromptListLine(name, getUserPromptPath(name)));
      console.log(lines.join('\n'));
    });

  promptsCommand
    .command('create-override')
    .description('内部プロンプト YAML のオーバーライドを作成します。')
    .argument('<promptYamlName>', 'プロンプト YAML 名')
    .action(async (promptYamlName: string) => {
      const normalized = ensurePromptYamlName(promptYamlName);
      const destination = getUserPromptPath(normalized);
      if (fs.existsSync(destination)) {
        throw new Error(`${destination} は既に存在します。`);
      }
      const source = path.join(PROMPT_TEMPLATES_DIR_INTERNAL, normalized);
      if (!fs.existsSync(source)) {
        throw new Error(`内部プロンプト '${normalized}' が見つかりません。'prompts list' で確認してください。`);
      }
      fs.copyFileSync(source, destination);
      await openInEditor(destination);
    });

  promptsCommand
    .command('edit-override')
    .description('既存のプロンプトオーバーライドを編集します。')
    .argument('<promptYamlName>', 'プロンプト YAML 名')
    .action(async (promptYamlName: string) => {
      const normalized = ensurePromptYamlName(promptYamlName);
      const destination = getUserPromptPath(normalized);
      if (!fs.existsSync(destination)) {
        throw new Error(`Override file '${normalized}' は存在しません。'prompts create-override ${normalized}' を使用してください。`);
      }
      await openInEditor(destination);
    });

  promptsCommand
    .command('list-overrides')
    .description('既存のプロンプトオーバーライドを一覧表示します。')
    .action(() => {
      ensureDirExists(PROMPT_TEMPLATES_DIR_IN_USER_HOME);
      const overrides = fs
        .readdirSync(PROMPT_TEMPLATES_DIR_IN_USER_HOME, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.yml'))
        .map((entry) => path.join(PROMPT_TEMPLATES_DIR_IN_USER_HOME, entry.name))
        .sort();
      for (const filePath of overrides) {
        console.log(filePath);
      }
    });

  promptsCommand
    .command('delete-override')
    .description('プロンプトオーバーライドファイルを削除します。')
    .argument('<promptYamlName>', 'プロンプト YAML 名')
    .action((promptYamlName: string) => {
      const normalized = ensurePromptYamlName(promptYamlName);
      const destination = getUserPromptPath(normalized);
      if (!fs.existsSync(destination)) {
        throw new Error(`Override file '${normalized}' は存在しません。`);
      }
      fs.rmSync(destination);
      console.log(`Deleted override file '${normalized}'.`);
    });

  program.addCommand(promptsCommand);

  return program;
}

export async function runSmartEditCli(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const cli = createSmartEditCli();
  await cli.parseAsync(argv, { from: 'user' });
}

export default runSmartEditCli;
