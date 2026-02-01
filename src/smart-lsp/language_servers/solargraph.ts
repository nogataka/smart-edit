import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  createSmartEditLogger,
  type LogLevel,
  type SmartEditLogger
} from '../../smart-edit/util/logging.js';
import { Language } from '../ls_config.js';
import {
  SmartLanguageServer,
  type LanguageServerConfigLike,
  type SmartLanguageServerConstructor,
  type SmartLspSettingsInit,
  registerLanguageServer,
  coerceLogLevel
} from '../ls.js';
import { NodeLanguageServerHandler } from '../ls_handler.js';
import {
  buildRubyExcludePatterns,
  ensureRubyAvailable,
  findBundleExecutable,
  findCommand,
  gemfileLockContains,
  installGem
} from './ruby_common.js';

const SOLARGRAPH_ASSUME_ENV = 'SMART_EDIT_ASSUME_SOLARGRAPH';
const SOLARGRAPH_PATH_ENV = 'SMART_EDIT_SOLARGRAPH_PATH';
const SOLARGRAPH_LOGGER_NAME = 'smart-lsp.language_servers.solargraph';
const DEFAULT_TIMEOUT = 120; // seconds

const SOLARGRAPH_IGNORED_DIRECTORIES = [
  'vendor',
  '.bundle',
  'tmp',
  'log',
  'coverage',
  '.yardoc',
  'doc',
  'node_modules',
  'storage'
];

interface InitializeResponseLike {
  capabilities?: Record<string, unknown> | null;
}

interface TextDocumentCapabilitiesLike {
  textDocumentSync?: unknown;
  completionProvider?: unknown;
}

export class SolargraphLanguageServer extends SmartLanguageServer {
  private readonly handlerInstance: NodeLanguageServerHandler;
  private initialized = false;

  constructor(
    config: LanguageServerConfigLike,
    loggerLike: { level?: number | LogLevel } | null,
    repositoryRootPath: string,
    options: { timeout?: number | null; smartLspSettings?: SmartLspSettingsInit } = {}
  ) {
    const adjustedConfig: LanguageServerConfigLike = {
      ...config,
      ignoredPaths: mergeIgnoredPaths(config.ignoredPaths, SOLARGRAPH_IGNORED_DIRECTORIES)
    };

    const { logger: runtimeLogger } = createSmartEditLogger({
      name: SOLARGRAPH_LOGGER_NAME,
      emitToConsole: false,
      level: loggerLike?.level === undefined ? undefined : coerceLogLevel(loggerLike.level)
    });

    const command = resolveSolargraphCommand(repositoryRootPath, runtimeLogger);

    const handler = new NodeLanguageServerHandler(
      {
        cmd: command,
        cwd: repositoryRootPath
      },
      {
        requestTimeoutSeconds: options?.timeout ?? DEFAULT_TIMEOUT
      }
    );

    super(adjustedConfig, loggerLike, repositoryRootPath, {
      ...options,
      handler,
      timeout: options?.timeout ?? DEFAULT_TIMEOUT,
      smartLspSettings: options?.smartLspSettings
    });

    this.handlerInstance = handler;
    this.registerHandlers();
  }

  override start(): this {
    const shouldInitialize = !this.initialized;
    super.start();
    if (shouldInitialize) {
      this.initializeLanguageServer();
      this.initialized = true;
    }
    return this;
  }

  override stop(shutdownTimeout = 2.0): void {
    super.stop(shutdownTimeout);
    this.initialized = false;
  }

  private registerHandlers(): void {
    const noop = () => undefined;
    this.handlerInstance.onRequest('client/registerCapability', (params: unknown) => {
      this.logger.debug(`solargraph registerCapability: ${JSON.stringify(params)}`);
      return [];
    });
    this.handlerInstance.onRequest('workspace/executeClientCommand', () => []);
    this.handlerInstance.onNotification('language/status', (payload: unknown) => {
      const params = payload as { type?: string; message?: string } | null;
      if (params?.type) {
        this.logger.info(`solargraph status: ${params.type}${params.message ? ` (${params.message})` : ''}`);
      }
    });
    this.handlerInstance.onNotification('window/logMessage', (payload: unknown) => {
      const message = extractWindowMessage(payload);
      if (message) {
        this.logger.info(`solargraph: ${message}`);
      }
    });
    this.handlerInstance.onNotification('$/progress', noop);
    this.handlerInstance.onNotification('textDocument/publishDiagnostics', noop);
    this.handlerInstance.onNotification('language/actionableNotification', noop);
  }

  private initializeLanguageServer(): void {
    this.logger.info('Solargraph を初期化しています');
    const params = this.buildInitializeParams();
    const response = this.handlerInstance.sendRequest('initialize', params) as InitializeResponseLike | null;
    this.verifyCapabilities(response?.capabilities ?? null);
    this.handlerInstance.notify.initialized({});
  }

  private buildInitializeParams(): Record<string, unknown> {
    const rootUri = pathToFileURL(this.repositoryRootPath).href;
    return {
      processId: process.pid,
      rootPath: this.repositoryRootPath,
      rootUri,
      capabilities: buildClientCapabilities(),
      initializationOptions: {
        exclude: buildRubyExcludePatterns(this.repositoryRootPath)
      },
      trace: 'verbose',
      workspaceFolders: [
        {
          uri: rootUri,
          name: path.basename(this.repositoryRootPath)
        }
      ]
    } satisfies Record<string, unknown>;
  }

  private verifyCapabilities(capabilities: Record<string, unknown> | null): void {
    if (!capabilities || typeof capabilities !== 'object') {
      throw new Error('Solargraph 初期化レスポンスに capabilities が含まれていません。');
    }

    const textDocumentCaps = capabilities as TextDocumentCapabilitiesLike;
    if (!Object.prototype.hasOwnProperty.call(textDocumentCaps, 'textDocumentSync')) {
      throw new Error('Solargraph が textDocumentSync capability を報告しませんでした。');
    }
    if (!Object.prototype.hasOwnProperty.call(textDocumentCaps, 'completionProvider')) {
      throw new Error('Solargraph が completionProvider capability を報告しませんでした。');
    }
  }
}

function resolveSolargraphCommand(repositoryRootPath: string, logger: SmartEditLogger): string[] {
  const override = process.env[SOLARGRAPH_PATH_ENV]?.trim();
  if (override) {
    logger.info(`SMART_EDIT_SOLARGRAPH_PATH を使用: ${override}`);
    return parseCommandOverride(override, true);
  }

  if (process.env[SOLARGRAPH_ASSUME_ENV] === '1') {
    logger.info('SMART_EDIT_ASSUME_SOLARGRAPH=1 によりランタイム検証をスキップします');
    const fallback = findCommand('solargraph') ?? 'solargraph';
    return [fallback, 'stdio'];
  }

  ensureRubyAvailable(logger, repositoryRootPath);

  const gemfilePath = path.join(repositoryRootPath, 'Gemfile');
  const gemfileLockPath = path.join(repositoryRootPath, 'Gemfile.lock');
  const isBundlerProject = fs.existsSync(gemfilePath);

  if (isBundlerProject) {
    const bundleCommand = findBundleExecutable(repositoryRootPath);
    if (!bundleCommand) {
      throw new Error('Bundler プロジェクトですが bundle コマンドが見つかりません。Bundler をインストールし PATH を設定してください。');
    }
    if (!gemfileLockContains(gemfileLockPath, 'solargraph')) {
      throw new Error(
        "Gemfile.lock に solargraph が含まれていません。Gemfile に `gem 'solargraph'` を追加して `bundle install` を実行してください。"
      );
    }
    logger.info(`bundle exec solargraph を使用します (${bundleCommand})`);
    return [bundleCommand, 'exec', 'solargraph', 'stdio'];
  }

  const globalSolargraph = findCommand('solargraph');
  if (globalSolargraph) {
    logger.info(`PATH から solargraph を検出: ${globalSolargraph}`);
    return [globalSolargraph, 'stdio'];
  }

  installGem('solargraph', logger, repositoryRootPath);
  const installedSolargraph = findCommand('solargraph');
  if (installedSolargraph) {
    logger.info(`gem install 後の solargraph を検出: ${installedSolargraph}`);
    return [installedSolargraph, 'stdio'];
  }

  logger.warn('solargraph のパス解決に失敗しました。最終手段として solargraph stdio を使用します。');
  return ['solargraph', 'stdio'];
}

function mergeIgnoredPaths(existing: string[] | undefined, additions: string[]): string[] {
  const merged = new Set(existing ?? []);
  for (const entry of additions) {
    merged.add(entry);
  }
  return Array.from(merged);
}

function extractWindowMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const message = (payload as { message?: unknown }).message;
  return typeof message === 'string' ? message : null;
}

function buildClientCapabilities(): Record<string, unknown> {
  const symbolKinds = Array.from({ length: 26 }, (_, index) => index + 1);
  return {
    workspace: {
      workspaceEdit: { documentChanges: true }
    },
    textDocument: {
      documentSymbol: {
        hierarchicalDocumentSymbolSupport: true,
        symbolKind: { valueSet: symbolKinds }
      }
    }
  } satisfies Record<string, unknown>;
}

function parseCommandOverride(value: string, appendStdio: boolean): string[] {
  const trimmed = value.trim();
  if (!trimmed) {
    return appendStdio ? ['solargraph', 'stdio'] : ['solargraph'];
  }
  const matches = trimmed.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g);
  const parts = matches ? matches.map((segment) => segment.replace(/^['"]|['"]$/g, '')) : [trimmed];
  if (appendStdio && parts[parts.length - 1] !== 'stdio') {
    parts.push('stdio');
  }
  return parts;
}

registerLanguageServer(Language.RUBY_SOLARGRAPH, SolargraphLanguageServer as SmartLanguageServerConstructor);
