import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { LogLevel } from '../../smart-edit/util/logging.js';
import { Language } from '../ls_config.js';
import { ensureDefaultSubprocessOptions } from '../util/subprocess_util.js';
import {
  SmartLanguageServer,
  type LanguageServerConfigLike,
  type SmartLanguageServerConstructor,
  type SmartLspSettingsInit,
  registerLanguageServer
} from '../ls.js';
import { NodeLanguageServerHandler } from '../ls_handler.js';

const R_ASSUME_ENV = 'SMART_EDIT_ASSUME_R';
const R_BINARY_ENV = 'SMART_EDIT_R_BINARY';
const DEFAULT_R_BINARY = process.platform === 'win32' ? 'R.exe' : 'R';

const R_IGNORED_PATTERNS = [
  '**/renv',
  '**/renv/**',
  '**/packrat',
  '**/packrat/**',
  '**/.Rproj.user',
  '**/.Rproj.user/**',
  '**/vignettes',
  '**/vignettes/**'
];

interface InitializeResponseLike {
  capabilities?: Record<string, unknown> | null;
}

interface CapabilitiesWithTextDocument {
  textDocumentSync?: unknown;
}

export class RLanguageServer extends SmartLanguageServer {
  protected override readonly handler: NodeLanguageServerHandler;
  private initialized = false;

  constructor(
    config: LanguageServerConfigLike,
    loggerLike: { level?: number | LogLevel } | null,
    repositoryRootPath: string,
    options: { timeout?: number | null; smartLspSettings?: SmartLspSettingsInit } = {}
  ) {
    ensureRRuntimeAvailable();

    const augmentedConfig: LanguageServerConfigLike = {
      ...config,
      ignoredPaths: mergeIgnoredPatterns(config.ignoredPaths, R_IGNORED_PATTERNS)
    };

    const handler = new NodeLanguageServerHandler(
      {
        cmd: buildRCommand(),
        cwd: repositoryRootPath
      },
      {
        requestTimeoutSeconds: options?.timeout ?? null
      }
    );

    super(augmentedConfig, loggerLike, repositoryRootPath, {
      ...options,
      handler,
      smartLspSettings: options?.smartLspSettings
    });

    this.handler = handler;
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
    this.handler.onRequest('client/registerCapability', noop);
    this.handler.onNotification('window/logMessage', (payload: unknown) => {
      const message = extractWindowMessage(payload);
      if (message) {
        this.logger.info(`R language server: ${message}`);
      }
    });
    this.handler.onNotification('$/progress', noop);
    this.handler.onNotification('textDocument/publishDiagnostics', noop);
  }

  private initializeLanguageServer(): void {
    this.logger.info('Initializing R language server');
    const params = this.buildInitializeParams();
    const response = this.handler.sendRequest('initialize', params) as InitializeResponseLike | null;
    this.verifyCapabilities(response?.capabilities ?? null);
    this.handler.notify.initialized({});
  }

  private buildInitializeParams(): Record<string, unknown> {
    const repositoryAbsolutePath = path.resolve(this.repositoryRootPath);
    const rootUri = pathToFileURL(repositoryAbsolutePath).href;

    return {
      locale: 'en',
      capabilities: buildClientCapabilities(),
      processId: process.pid,
      rootPath: repositoryAbsolutePath,
      rootUri,
      workspaceFolders: [
        {
          uri: rootUri,
          name: path.basename(repositoryAbsolutePath)
        }
      ]
    } satisfies Record<string, unknown>;
  }

  private verifyCapabilities(capabilities: Record<string, unknown> | null): void {
    if (!capabilities || typeof capabilities !== 'object') {
      throw new Error('R language server did not return capabilities during initialization.');
    }

    const textDocumentCaps = capabilities as CapabilitiesWithTextDocument;
    if (!Object.prototype.hasOwnProperty.call(textDocumentCaps, 'textDocumentSync')) {
      throw new Error('R language server initialization response is missing textDocumentSync capability.');
    }
  }
}

function ensureRRuntimeAvailable(): void {
  if (process.env[R_ASSUME_ENV] === '1') {
    return;
  }

  const binary = process.env[R_BINARY_ENV] ?? DEFAULT_R_BINARY;
  const versionResult = spawnSync(binary, ['--version'], ensureDefaultSubprocessOptions({ encoding: 'utf-8' }));

  if (versionResult.error || versionResult.status !== 0) {
    throw new Error('R が見つかりません。https://www.r-project.org/ から R をインストールし、PATH に追加してください。');
  }

  const packageCheck = spawnSync(binary, [
    '--vanilla',
    '--quiet',
    '--slave',
    '-e',
    "if (!require('languageserver', quietly=TRUE)) quit(status=1)"
  ], ensureDefaultSubprocessOptions({ encoding: 'utf-8' }));

  if (packageCheck.error || packageCheck.status !== 0) {
    throw new Error('R languageserver パッケージが見つかりません。`R -e "install.packages(\'languageserver\')"` でインストールしてください。');
  }
}

function buildRCommand(): string[] {
  const binary = process.env[R_BINARY_ENV] ?? DEFAULT_R_BINARY;
  return [
    binary,
    '--vanilla',
    '--quiet',
    '--slave',
    '-e',
    'options(languageserver.debug_mode = FALSE); languageserver::run()'
  ];
}

function mergeIgnoredPatterns(existing: string[] | undefined, additions: string[]): string[] {
  const merged = new Set(existing ?? []);
  for (const pattern of additions) {
    merged.add(pattern);
  }
  return Array.from(merged);
}

function extractWindowMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const maybeMessage = (payload as { message?: unknown }).message;
  return typeof maybeMessage === 'string' ? maybeMessage : null;
}

function buildClientCapabilities(): Record<string, unknown> {
  const symbolKinds = Array.from({ length: 26 }, (_, index) => index + 1);
  return {
    textDocument: {
      synchronization: { didSave: true, dynamicRegistration: true },
      completion: {
        dynamicRegistration: true,
        completionItem: {
          snippetSupport: true,
          commitCharactersSupport: true,
          documentationFormat: ['markdown', 'plaintext'],
          deprecatedSupport: true,
          preselectSupport: true
        }
      },
      hover: { dynamicRegistration: true, contentFormat: ['markdown', 'plaintext'] },
      definition: { dynamicRegistration: true },
      references: { dynamicRegistration: true },
      documentSymbol: {
        dynamicRegistration: true,
        hierarchicalDocumentSymbolSupport: true,
        symbolKind: { valueSet: symbolKinds }
      },
      formatting: { dynamicRegistration: true },
      rangeFormatting: { dynamicRegistration: true }
    },
    workspace: {
      workspaceFolders: true,
      didChangeConfiguration: { dynamicRegistration: true },
      symbol: {
        dynamicRegistration: true,
        symbolKind: { valueSet: symbolKinds }
      }
    }
  } satisfies Record<string, unknown>;
}

registerLanguageServer(Language.R, RLanguageServer as SmartLanguageServerConstructor);
