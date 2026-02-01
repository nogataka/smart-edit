import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { LogLevel } from '../../smart-edit/util/logging.js';
import { Language } from '../ls_config.js';
import {
  SmartLanguageServer,
  type LanguageServerConfigLike,
  type SmartLanguageServerConstructor,
  type SmartLspSettingsInit,
  registerLanguageServer
} from '../ls.js';
import { NodeLanguageServerHandler } from '../ls_handler.js';

const JEDI_IGNORED_PATTERNS = ['**/venv', '**/.venv', '**/__pycache__'];

interface InitializeResponseLike {
  capabilities?: Record<string, unknown> | null;
}

interface TextDocumentSyncLike {
  change?: number;
}

interface CompletionProviderLike {
  triggerCharacters?: unknown;
  resolveProvider?: unknown;
}

export class JediLanguageServer extends SmartLanguageServer {
  private readonly nodeHandler: NodeLanguageServerHandler;
  private initialized = false;

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
      ignoredPaths: mergeIgnoredPaths(config.ignoredPaths, JEDI_IGNORED_PATTERNS)
    };

    const handler = new NodeLanguageServerHandler({
      cmd: 'jedi-language-server',
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
    this.nodeHandler.onRequest('client/registerCapability', noop);
    this.nodeHandler.onNotification('language/status', noop);
    this.nodeHandler.onNotification('$/progress', noop);
    this.nodeHandler.onNotification('textDocument/publishDiagnostics', noop);
    this.nodeHandler.onNotification('language/actionableNotification', noop);
    this.nodeHandler.onNotification('experimental/serverStatus', (payload: unknown) => {
      const params = payload as { quiescent?: boolean } | null;
      if (params?.quiescent) {
        this.logger.debug('jedi-language-server reported experimental/serverStatus quiescent=true');
      }
    });

    this.nodeHandler.onRequest('workspace/executeClientCommand', () => []);

    this.nodeHandler.onNotification('window/logMessage', (payload: unknown) => {
      const message = extractWindowMessage(payload);
      if (message) {
        this.logger.info(`Jedi LSP message: ${message}`);
      }
    });
  }

  private initializeLanguageServer(): void {
    this.logger.info('Initializing jedi-language-server');
    const params = this.buildInitializeParams();
    const response = this.nodeHandler.sendRequest('initialize', params) as InitializeResponseLike | null;

    this.verifyCapabilities(response?.capabilities ?? null);
    this.nodeHandler.notify.initialized({});
  }

  private verifyCapabilities(capabilities: Record<string, unknown> | null): void {
    if (!capabilities) {
      throw new Error('Jedi language server initialization response is missing capabilities.');
    }

    const { textDocumentSync, completionProvider } = capabilities as {
      textDocumentSync?: TextDocumentSyncLike;
      completionProvider?: CompletionProviderLike;
    };

    if (textDocumentSync?.change !== 2) {
      throw new Error('Jedi language server does not advertise required textDocumentSync capability.');
    }

    if (completionProvider?.resolveProvider !== true) {
      throw new Error('Jedi language server does not expose a resolve-capable completion provider.');
    }

    const triggerCandidates = completionProvider?.triggerCharacters;
    const triggerCharacters = Array.isArray(triggerCandidates)
      ? triggerCandidates
      : [];
    for (const expected of [".", "'", "\""]) {
      if (!triggerCharacters.includes(expected)) {
        throw new Error(`Jedi language server missing completion trigger character "${expected}".`);
      }
    }
  }

  private buildInitializeParams(): Record<string, unknown> {
    const rootUri = pathToFileURL(this.repositoryRootPath).href;
    return {
      processId: process.pid,
      clientInfo: { name: 'Smart-Edit', version: '0.1.0' },
      locale: 'en',
      rootPath: this.repositoryRootPath,
      rootUri,
      capabilities: buildCapabilities(),
      initializationOptions: {
        workspace: {
          symbols: {
            ignoreFolders: ['.nox', '.tox', '.venv', '__pycache__', 'venv'],
            maxSymbols: 0
          }
        }
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
}

function mergeIgnoredPaths(existing: string[] | undefined, additions: string[]): string[] {
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

function buildCapabilities(): Record<string, unknown> {
  const symbolKinds = rangeArray(1, 27);
  return {
    workspace: {
      applyEdit: true,
      workspaceEdit: {
        documentChanges: true,
        resourceOperations: ['create', 'rename', 'delete'],
        failureHandling: 'textOnlyTransactional',
        normalizesLineEndings: true,
        changeAnnotationSupport: { groupsOnLabel: true }
      },
      configuration: true,
      didChangeWatchedFiles: { dynamicRegistration: true, relativePatternSupport: true },
      symbol: {
        dynamicRegistration: true,
        symbolKind: { valueSet: symbolKinds },
        tagSupport: { valueSet: [1] },
        resolveSupport: { properties: ['location.range'] }
      },
      workspaceFolders: true,
      fileOperations: {
        dynamicRegistration: true,
        didCreate: true,
        didRename: true,
        didDelete: true,
        willCreate: true,
        willRename: true,
        willDelete: true
      },
      inlineValue: { refreshSupport: true },
      inlayHint: { refreshSupport: true },
      diagnostics: { refreshSupport: true }
    },
    textDocument: {
      publishDiagnostics: {
        relatedInformation: true,
        versionSupport: false,
        tagSupport: { valueSet: [1, 2] },
        codeDescriptionSupport: true,
        dataSupport: true
      },
      synchronization: {
        dynamicRegistration: true,
        willSave: true,
        willSaveWaitUntil: true,
        didSave: true
      },
      hover: { dynamicRegistration: true, contentFormat: ['markdown', 'plaintext'] },
      signatureHelp: {
        dynamicRegistration: true,
        signatureInformation: {
          documentationFormat: ['markdown', 'plaintext'],
          parameterInformation: { labelOffsetSupport: true },
          activeParameterSupport: true
        },
        contextSupport: true
      },
      definition: { dynamicRegistration: true, linkSupport: true },
      references: { dynamicRegistration: true },
      documentHighlight: { dynamicRegistration: true },
      documentSymbol: {
        dynamicRegistration: true,
        symbolKind: { valueSet: symbolKinds },
        hierarchicalDocumentSymbolSupport: true,
        tagSupport: { valueSet: [1] },
        labelSupport: true
      },
      documentLink: { dynamicRegistration: true, tooltipSupport: true },
      typeDefinition: { dynamicRegistration: true, linkSupport: true },
      implementation: { dynamicRegistration: true, linkSupport: true },
      declaration: { dynamicRegistration: true, linkSupport: true },
      selectionRange: { dynamicRegistration: true },
      callHierarchy: { dynamicRegistration: true },
      linkedEditingRange: { dynamicRegistration: true },
      typeHierarchy: { dynamicRegistration: true },
      inlineValue: { dynamicRegistration: true },
      inlayHint: {
        dynamicRegistration: true,
        resolveSupport: {
          properties: ['tooltip', 'textEdits', 'label.tooltip', 'label.location', 'label.command']
        }
      },
      diagnostic: { dynamicRegistration: true, relatedDocumentSupport: false }
    },
    notebookDocument: {
      synchronization: {
        dynamicRegistration: true,
        executionSummarySupport: true
      }
    },
    experimental: {
      serverStatusNotification: true,
      openServerLogs: true
    }
  };
}

function rangeArray(start: number, endExclusive: number): number[] {
  const values: number[] = [];
  for (let value = start; value < endExclusive; value += 1) {
    values.push(value);
  }
  return values;
}

registerLanguageServer(Language.PYTHON_JEDI, JediLanguageServer as SmartLanguageServerConstructor);
