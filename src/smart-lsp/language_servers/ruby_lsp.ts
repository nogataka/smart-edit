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

const RUBY_LSP_ASSUME_ENV = 'SMART_EDIT_ASSUME_RUBY_LSP';
const RUBY_LSP_PATH_ENV = 'SMART_EDIT_RUBY_LSP_PATH';
const RUBY_LSP_LOGGER_NAME = 'smart-lsp.language_servers.ruby_lsp';
const DEFAULT_REQUEST_TIMEOUT = 30; // seconds

const RUBY_IGNORED_DIRECTORIES = [
  'vendor',
  '.bundle',
  'tmp',
  'log',
  'coverage',
  '.yardoc',
  'doc',
  'node_modules',
  'storage',
  'public/packs',
  'public/webpack',
  'public/assets'
];

interface InitializeResponseLike {
  capabilities?: Record<string, unknown> | null;
}

interface TextDocumentCapabilitiesLike {
  textDocumentSync?: unknown;
  completionProvider?: unknown;
}

export class RubyLspLanguageServer extends SmartLanguageServer {
  private readonly handlerInstance: NodeLanguageServerHandler;
  private initialized = false;

  constructor(
    config: LanguageServerConfigLike,
    loggerLike: { level?: number | LogLevel } | null,
    repositoryRootPath: string,
    options: { timeout?: number | null; smartLspSettings?: SmartLspSettingsInit } = {}
  ) {
    const augmentedConfig: LanguageServerConfigLike = {
      ...config,
      ignoredPaths: mergeIgnoredPaths(config.ignoredPaths, RUBY_IGNORED_DIRECTORIES)
    };

    const { logger: runtimeLogger } = createSmartEditLogger({
      name: RUBY_LSP_LOGGER_NAME,
      emitToConsole: false,
      level: loggerLike?.level === undefined ? undefined : coerceLogLevel(loggerLike.level)
    });

    const command = resolveRubyLspCommand(repositoryRootPath, runtimeLogger);

    const handler = new NodeLanguageServerHandler(
      {
        cmd: command,
        cwd: repositoryRootPath
      },
      {
        requestTimeoutSeconds: options?.timeout ?? DEFAULT_REQUEST_TIMEOUT
      }
    );

    super(augmentedConfig, loggerLike, repositoryRootPath, {
      ...options,
      handler,
      timeout: options?.timeout ?? DEFAULT_REQUEST_TIMEOUT,
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
    this.handlerInstance.onRequest('client/registerCapability', noop);
    this.handlerInstance.onRequest('workspace/executeClientCommand', () => []);
    this.handlerInstance.onNotification('language/status', (payload: unknown) => {
      const params = payload as { type?: string; message?: string } | null;
      if (params?.type) {
        this.logger.info(`ruby-lsp status: ${params.type}${params.message ? ` (${params.message})` : ''}`);
      }
    });
    this.handlerInstance.onNotification('$/progress', (payload: unknown) => {
      const info = payload && typeof payload === 'object' ? payload : null;
      if (info && 'value' in (info as Record<string, unknown>)) {
        this.logger.debug(`ruby-lsp progress: ${JSON.stringify(info)}`);
      }
    });
    this.handlerInstance.onNotification('window/logMessage', (payload: unknown) => {
      const message = extractWindowMessage(payload);
      if (message) {
        this.logger.info(`ruby-lsp: ${message}`);
      }
    });
    this.handlerInstance.onNotification('textDocument/publishDiagnostics', noop);
  }

  private initializeLanguageServer(): void {
    this.logger.info('ruby-lsp を初期化しています');
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
      initializationOptions: buildInitializationOptions(this.repositoryRootPath),
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
      throw new Error('ruby-lsp 初期化レスポンスに capabilities が含まれていません。');
    }

    const textDocumentCaps = capabilities as TextDocumentCapabilitiesLike;
    if (!Object.prototype.hasOwnProperty.call(textDocumentCaps, 'textDocumentSync')) {
      throw new Error('ruby-lsp が textDocumentSync capability を報告しませんでした。');
    }
    if (!Object.prototype.hasOwnProperty.call(textDocumentCaps, 'completionProvider')) {
      throw new Error('ruby-lsp が completionProvider capability を報告しませんでした。');
    }
  }
}

function resolveRubyLspCommand(repositoryRootPath: string, logger: SmartEditLogger): string[] {
  const override = process.env[RUBY_LSP_PATH_ENV]?.trim();
  if (override) {
    logger.info(`SMART_EDIT_RUBY_LSP_PATH を使用: ${override}`);
    return parseCommandOverride(override);
  }

  if (process.env[RUBY_LSP_ASSUME_ENV] === '1') {
    logger.info('SMART_EDIT_ASSUME_RUBY_LSP=1 のためランタイム検証をスキップします');
    const fallback = findCommand('ruby-lsp') ?? 'ruby-lsp';
    return [fallback];
  }

  ensureRubyAvailable(logger, repositoryRootPath);

  const gemfilePath = path.join(repositoryRootPath, 'Gemfile');
  const gemfileLockPath = path.join(repositoryRootPath, 'Gemfile.lock');
  const isBundlerProject = fs.existsSync(gemfilePath);

  if (isBundlerProject) {
    const bundleCommand = findBundleExecutable(repositoryRootPath);
    if (!bundleCommand) {
      logger.warn('Gemfile は見つかりましたが bundle コマンドが見つかりません。PATH または bin/bundle を確認してください。');
    } else if (gemfileLockContains(gemfileLockPath, 'ruby-lsp')) {
      logger.info(`bundle exec ruby-lsp を使用します (${bundleCommand})`);
      return [bundleCommand, 'exec', 'ruby-lsp'];
    } else {
      logger.warn('Gemfile.lock に ruby-lsp が含まれていません。グローバルインストールを探します。');
    }
  }

  const globalRubyLsp = findCommand('ruby-lsp');
  if (globalRubyLsp) {
    logger.info(`PATH から ruby-lsp を検出: ${globalRubyLsp}`);
    return [globalRubyLsp];
  }

  installGem('ruby-lsp', logger, repositoryRootPath);
  const installedRubyLsp = findCommand('ruby-lsp');
  if (installedRubyLsp) {
    logger.info(`gem install 後の ruby-lsp を検出: ${installedRubyLsp}`);
    return [installedRubyLsp];
  }

  logger.warn('ruby-lsp のパス解決に失敗しました。最終手段として ruby-lsp を直接実行します。');
  return ['ruby-lsp'];
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
      workspaceEdit: { documentChanges: true },
      configuration: true
    },
    window: {
      workDoneProgress: true
    },
    textDocument: {
      documentSymbol: {
        hierarchicalDocumentSymbolSupport: true,
        symbolKind: { valueSet: symbolKinds }
      },
      completion: {
        completionItem: {
          snippetSupport: true,
          commitCharactersSupport: true
        }
      }
    }
  } satisfies Record<string, unknown>;
}

function buildInitializationOptions(repositoryRootPath: string): Record<string, unknown> {
  return {
    experimentalFeaturesEnabled: false,
    featuresConfiguration: {},
    indexing: {
      includedPatterns: ['**/*.rb', '**/*.rake', '**/*.ru', '**/*.erb'],
      excludedPatterns: buildRubyExcludePatterns(repositoryRootPath)
    }
  } satisfies Record<string, unknown>;
}

function parseCommandOverride(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) {
    return ['ruby-lsp'];
  }
  const matches = trimmed.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g);
  if (!matches) {
    return [trimmed];
  }
  return matches.map((segment) => segment.replace(/^['"]|['"]$/g, ''));
}

registerLanguageServer(Language.RUBY, RubyLspLanguageServer as SmartLanguageServerConstructor);
