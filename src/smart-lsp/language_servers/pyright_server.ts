import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { LogLevel } from '../../smart-edit/util/logging.js';
import { Language } from '../ls_config.js';
import {
  SmartLanguageServer,
  type LanguageServerConfigLike,
  type SmartLspSettingsInit,
  type SmartLanguageServerConstructor,
  registerLanguageServer
} from '../ls.js';
import { NodeLanguageServerHandler } from '../ls_handler.js';

const PYRIGHT_IGNORED_PATTERNS = [
  '**/__pycache__',
  '**/.venv',
  '**/.env',
  '**/build',
  '**/dist',
  '**/.pixi'
];

interface InitializeParamsLike {
  processId: number;
  rootPath: string;
  rootUri: string;
  initializationOptions: Record<string, unknown>;
  capabilities: Record<string, unknown>;
  workspaceFolders: { uri: string; name: string }[];
}

interface InitializeResponseLike {
  capabilities?: Record<string, unknown> | null;
}

function mergeIgnoredPaths(existing: string[] | undefined, additions: string[]): string[] {
  const merged = new Set(existing ?? []);
  for (const entry of additions) {
    merged.add(entry);
  }
  return Array.from(merged);
}

export class PyrightLanguageServer extends SmartLanguageServer {
  private readonly nodeHandler: NodeLanguageServerHandler;
  private initialized = false;
  private foundSourceFiles = false;

  constructor(
    config: LanguageServerConfigLike,
    loggerLike: { level?: number | LogLevel } | null,
    repositoryRootPath: string,
    options: {
      timeout?: number | null;
      smartLspSettings?: SmartLspSettingsInit;
    } = {}
  ) {
    const augmentedConfig: LanguageServerConfigLike = {
      ...config,
      ignoredPaths: mergeIgnoredPaths(config.ignoredPaths, PYRIGHT_IGNORED_PATTERNS)
    };

    const handler = new NodeLanguageServerHandler({
      cmd: 'python -m pyright.langserver --stdio',
      cwd: repositoryRootPath
    });

    super(augmentedConfig, loggerLike, repositoryRootPath, {
      ...options,
      handler,
      smartLspSettings: options?.smartLspSettings
    });

    this.nodeHandler = handler;
    this.registerHandlers();
  }

  override start(): this {
    const shouldInitialize = !this.initialized;
    super.start();
    if (shouldInitialize) {
      this.foundSourceFiles = false;
      this.initializeLanguageServer();
      this.initialized = true;
    }
    return this;
  }

  override stop(shutdownTimeout = 2.0): void {
    super.stop(shutdownTimeout);
    this.initialized = false;
    this.foundSourceFiles = false;
  }

  private registerHandlers(): void {
    const noop = () => undefined;
    this.nodeHandler.onRequest('client/registerCapability', noop);
    this.nodeHandler.onRequest('workspace/executeClientCommand', () => []);
    this.nodeHandler.onNotification('$/progress', noop);
    this.nodeHandler.onNotification('textDocument/publishDiagnostics', noop);
    this.nodeHandler.onNotification('language/status', noop);
    this.nodeHandler.onNotification('language/actionableNotification', noop);

    this.nodeHandler.onNotification('window/logMessage', (payload: unknown) => {
      const message = extractMessage(payload);
      if (message) {
        this.logger.info(`Pyright LSP message: ${message}`);
        if (/Found \d+ source files?/i.test(message)) {
          this.foundSourceFiles = true;
        }
      }
    });

    this.nodeHandler.onNotification('experimental/serverStatus', (payload: unknown) => {
      const params = payload as { quiescent?: boolean } | null;
      if (params?.quiescent && !this.foundSourceFiles) {
        this.logger.debug('Pyright reported experimental/serverStatus quiescent=true before finding sources.');
      }
    });
  }

  private initializeLanguageServer(): void {
    const params = this.buildInitializeParams();
    const response = this.nodeHandler.sendRequest('initialize', params) as InitializeResponseLike | null;

    if (!response || typeof response !== 'object') {
      throw new Error('Pyright language server returned an invalid initialize response.');
    }

    this.verifyCapabilities(response.capabilities ?? null);
    this.nodeHandler.notify.initialized({});
  }

  private verifyCapabilities(capabilities: Record<string, unknown> | null): void {
    if (!capabilities) {
      throw new Error('Pyright initialization response is missing capabilities.');
    }

    const hasTextDocumentSync = Object.prototype.hasOwnProperty.call(capabilities, 'textDocumentSync');
    const hasCompletionProvider = Object.prototype.hasOwnProperty.call(capabilities, 'completionProvider');
    const hasDefinitionProvider = Object.prototype.hasOwnProperty.call(capabilities, 'definitionProvider');

    if (!hasTextDocumentSync || !hasCompletionProvider || !hasDefinitionProvider) {
      throw new Error('Pyright language server does not expose required capabilities.');
    }
  }

  private buildInitializeParams(): InitializeParamsLike {
    const rootUri = pathToFileURL(this.repositoryRootPath).href;
    return {
      processId: process.pid,
      rootPath: this.repositoryRootPath,
      rootUri,
      initializationOptions: {
        exclude: [
          '**/__pycache__',
          '**/.venv',
          '**/.env',
          '**/build',
          '**/dist',
          '**/.pixi'
        ],
        reportMissingImports: 'error'
      },
      capabilities: {
        workspace: {
          workspaceEdit: { documentChanges: true },
          didChangeConfiguration: { dynamicRegistration: true },
          didChangeWatchedFiles: { dynamicRegistration: true },
          symbol: {
            dynamicRegistration: true,
            symbolKind: { valueSet: rangeArray(1, 27) }
          },
          executeCommand: { dynamicRegistration: true }
        },
        textDocument: {
          synchronization: {
            dynamicRegistration: true,
            willSave: true,
            willSaveWaitUntil: true,
            didSave: true
          },
          hover: {
            dynamicRegistration: true,
            contentFormat: ['markdown', 'plaintext']
          },
          signatureHelp: {
            dynamicRegistration: true,
            signatureInformation: {
              documentationFormat: ['markdown', 'plaintext'],
              parameterInformation: { labelOffsetSupport: true }
            }
          },
          definition: { dynamicRegistration: true },
          references: { dynamicRegistration: true },
          documentSymbol: {
            dynamicRegistration: true,
            symbolKind: { valueSet: rangeArray(1, 27) },
            hierarchicalDocumentSymbolSupport: true
          },
          publishDiagnostics: { relatedInformation: true }
        }
      },
      workspaceFolders: [
        {
          uri: rootUri,
          name: path.basename(this.repositoryRootPath)
        }
      ]
    };
  }
}

function extractMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const message = (payload as { message?: unknown }).message;
  return typeof message === 'string' ? message : null;
}

function rangeArray(start: number, endExclusive: number): number[] {
  const values: number[] = [];
  for (let value = start; value < endExclusive; value += 1) {
    values.push(value);
  }
  return values;
}

registerLanguageServer(Language.PYTHON, PyrightLanguageServer as SmartLanguageServerConstructor);
