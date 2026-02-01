import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { LogLevel } from '../../smart-edit/util/logging.js';
import { ensureDefaultSubprocessOptions } from '../util/subprocess_util.js';
import {
  SmartLanguageServer,
  type LanguageServerConfigLike,
  type ReferenceInSymbol,
  type ReferencingSymbolsOptions,
  type SmartLanguageServerConstructor,
  type SmartLspSettingsInit,
  registerLanguageServer
} from '../ls.js';
import { Language } from '../ls_config.js';
import { NodeLanguageServerHandler } from '../ls_handler.js';

const SOURCEKIT_ASSUME_ENV = 'SMART_EDIT_ASSUME_SOURCEKIT';
const SOURCEKIT_PATH_ENV = 'SMART_EDIT_SOURCEKIT_PATH';
const SOURCEKIT_INITIAL_DELAY_ENV = 'SMART_EDIT_SOURCEKIT_REFERENCE_INITIAL_DELAY_MS';
const SOURCEKIT_RETRY_DELAY_ENV = 'SMART_EDIT_SOURCEKIT_REFERENCE_RETRY_DELAY_MS';

const SOURCEKIT_IGNORED_DIRECTORIES = ['.build', '.swiftpm', 'node_modules', 'dist', 'build'];

const CAPABILITIES_TEMPLATE = Object.freeze({
  general: {
    markdown: { parser: 'marked', version: '1.1.0' },
    positionEncodings: ['utf-16'],
    regularExpressions: { engine: 'ECMAScript', version: 'ES2020' },
    staleRequestSupport: {
      cancel: true,
      retryOnContentModified: [
        'textDocument/semanticTokens/full',
        'textDocument/semanticTokens/range',
        'textDocument/semanticTokens/full/delta'
      ]
    }
  },
  notebookDocument: {
    synchronization: { dynamicRegistration: true, executionSummarySupport: true }
  },
  textDocument: {
    callHierarchy: { dynamicRegistration: true },
    codeAction: {
      codeActionLiteralSupport: {
        codeActionKind: {
          valueSet: [
            '',
            'quickfix',
            'refactor',
            'refactor.extract',
            'refactor.inline',
            'refactor.rewrite',
            'source',
            'source.organizeImports'
          ]
        }
      },
      dataSupport: true,
      disabledSupport: true,
      dynamicRegistration: true,
      honorsChangeAnnotations: true,
      isPreferredSupport: true,
      resolveSupport: { properties: ['edit'] }
    },
    codeLens: { dynamicRegistration: true },
    colorProvider: { dynamicRegistration: true },
    completion: {
      completionItem: {
        commitCharactersSupport: true,
        deprecatedSupport: true,
        documentationFormat: ['markdown', 'plaintext'],
        insertReplaceSupport: true,
        insertTextModeSupport: { valueSet: [1, 2] },
        labelDetailsSupport: true,
        preselectSupport: true,
        resolveSupport: { properties: ['documentation', 'detail', 'additionalTextEdits'] },
        snippetSupport: true,
        tagSupport: { valueSet: [1] }
      },
      completionItemKind: {
        valueSet: Array.from({ length: 25 }, (_, index) => index + 1)
      },
      completionList: {
        itemDefaults: ['commitCharacters', 'editRange', 'insertTextFormat', 'insertTextMode', 'data']
      },
      contextSupport: true,
      dynamicRegistration: true,
      insertTextMode: 2
    },
    declaration: { dynamicRegistration: true, linkSupport: true },
    definition: { dynamicRegistration: true, linkSupport: true },
    diagnostic: { dynamicRegistration: true, relatedDocumentSupport: false },
    documentHighlight: { dynamicRegistration: true },
    documentLink: { dynamicRegistration: true, tooltipSupport: true },
    documentSymbol: {
      dynamicRegistration: true,
      hierarchicalDocumentSymbolSupport: true,
      labelSupport: true,
      symbolKind: { valueSet: Array.from({ length: 26 }, (_, index) => index + 1) },
      tagSupport: { valueSet: [1] }
    },
    foldingRange: {
      dynamicRegistration: true,
      foldingRange: { collapsedText: false },
      foldingRangeKind: { valueSet: ['comment', 'imports', 'region'] },
      lineFoldingOnly: true,
      rangeLimit: 5000
    },
    formatting: { dynamicRegistration: true },
    hover: { contentFormat: ['markdown', 'plaintext'], dynamicRegistration: true },
    implementation: { dynamicRegistration: true, linkSupport: true },
    inlayHint: {
      dynamicRegistration: true,
      resolveSupport: { properties: ['tooltip', 'textEdits', 'label.tooltip', 'label.location', 'label.command'] }
    },
    inlineValue: { dynamicRegistration: true },
    linkedEditingRange: { dynamicRegistration: true },
    onTypeFormatting: { dynamicRegistration: true },
    publishDiagnostics: {
      codeDescriptionSupport: true,
      dataSupport: true,
      relatedInformation: true,
      tagSupport: { valueSet: [1, 2] },
      versionSupport: false
    },
    rangeFormatting: { dynamicRegistration: true, rangesSupport: true },
    references: { dynamicRegistration: true },
    rename: {
      dynamicRegistration: true,
      honorsChangeAnnotations: true,
      prepareSupport: true,
      prepareSupportDefaultBehavior: 1
    },
    selectionRange: { dynamicRegistration: true },
    semanticTokens: {
      augmentsSyntaxTokens: true,
      dynamicRegistration: true,
      formats: ['relative'],
      multilineTokenSupport: false,
      overlappingTokenSupport: false,
      requests: { full: { delta: true }, range: true },
      serverCancelSupport: true,
      tokenModifiers: [
        'declaration',
        'definition',
        'readonly',
        'static',
        'deprecated',
        'abstract',
        'async',
        'modification',
        'documentation',
        'defaultLibrary'
      ],
      tokenTypes: [
        'namespace',
        'type',
        'class',
        'enum',
        'interface',
        'struct',
        'typeParameter',
        'parameter',
        'variable',
        'property',
        'enumMember',
        'event',
        'function',
        'method',
        'macro',
        'keyword',
        'modifier',
        'comment',
        'string',
        'number',
        'regexp',
        'operator',
        'decorator'
      ]
    },
    signatureHelp: {
      contextSupport: true,
      dynamicRegistration: true,
      signatureInformation: {
        activeParameterSupport: true,
        documentationFormat: ['markdown', 'plaintext'],
        parameterInformation: { labelOffsetSupport: true }
      }
    },
    synchronization: {
      didSave: true,
      dynamicRegistration: true,
      willSave: true,
      willSaveWaitUntil: true
    },
    typeDefinition: { dynamicRegistration: true, linkSupport: true },
    typeHierarchy: { dynamicRegistration: true }
  },
  window: {
    showDocument: { support: true },
    showMessage: { messageActionItem: { additionalPropertiesSupport: true } },
    workDoneProgress: true
  },
  workspace: {
    applyEdit: true,
    codeLens: { refreshSupport: true },
    configuration: true,
    diagnostics: { refreshSupport: true },
    didChangeConfiguration: { dynamicRegistration: true },
    didChangeWatchedFiles: { dynamicRegistration: true, relativePatternSupport: true },
    executeCommand: { dynamicRegistration: true },
    fileOperations: {
      didCreate: true,
      didDelete: true,
      didRename: true,
      dynamicRegistration: true,
      willCreate: true,
      willDelete: true,
      willRename: true
    },
    foldingRange: { refreshSupport: true },
    inlayHint: { refreshSupport: true },
    inlineValue: { refreshSupport: true },
    semanticTokens: { refreshSupport: false },
    symbol: {
      dynamicRegistration: true,
      resolveSupport: { properties: ['location.range'] },
      symbolKind: { valueSet: Array.from({ length: 26 }, (_, index) => index + 1) },
      tagSupport: { valueSet: [1] }
    },
    workspaceEdit: {
      changeAnnotationSupport: { groupsOnLabel: true },
      documentChanges: true,
      failureHandling: 'textOnlyTransactional',
      normalizesLineEndings: true,
      resourceOperations: ['create', 'rename', 'delete']
    },
    workspaceFolders: true
  }
});

const INITIALIZATION_OPTIONS_TEMPLATE = Object.freeze({
  backgroundIndexing: true,
  backgroundPreparationMode: 'enabled',
  'textDocument/codeLens': {
    supportedCommands: { 'swift.debug': 'swift.debug', 'swift.run': 'swift.run' }
  },
  'window/didChangeActiveDocument': true,
  'workspace/getReferenceDocument': true,
  'workspace/peekDocuments': true
});

interface InitializeResponseLike {
  capabilities?: Record<string, unknown> | null;
}

interface SourcekitBinaryResolution {
  command: string;
  version: string;
  assumed: boolean;
}

export class SourceKitLanguageServer extends SmartLanguageServer {
  protected override readonly handler: NodeLanguageServerHandler;
  private readonly versionDescription: string;
  private initialized = false;
  private firstReferenceDelayApplied = false;
  private initializationTimestamp: number | null = null;

  constructor(
    config: LanguageServerConfigLike,
    loggerLike: { level?: number | LogLevel } | null,
    repositoryRootPath: string,
    options: { timeout?: number | null; smartLspSettings?: SmartLspSettingsInit } = {}
  ) {
    const augmentedConfig: LanguageServerConfigLike = {
      ...config,
      ignoredPaths: mergeIgnoredPaths(config.ignoredPaths, SOURCEKIT_IGNORED_DIRECTORIES)
    };

    const { command, version, assumed } = resolveSourcekitBinary();

    const handler = new NodeLanguageServerHandler(
      {
        cmd: command,
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
    this.versionDescription = assumed ? `${version} (assumed)` : version;
    this.registerHandlers();

    if (this.versionDescription && this.versionDescription.trim().length > 0) {
      this.logger.info(`Starting sourcekit-lsp with version: ${this.versionDescription}`);
    } else {
      this.logger.info('Starting sourcekit-lsp (version unknown)');
    }
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
    this.firstReferenceDelayApplied = false;
    this.initializationTimestamp = null;
  }

  override requestReferencingSymbols(options: ReferencingSymbolsOptions): ReferenceInSymbol[] {
    this.applyInitialReferenceDelay();
    let references = super.requestReferencingSymbols(options);

    if (process.env.CI && references.length === 0) {
      const retryDelay = resolveDelayFromEnv(SOURCEKIT_RETRY_DELAY_ENV, 5000);
      if (retryDelay > 0) {
        this.logger.info(
          `No references found in CI - retrying after additional ${(retryDelay / 1000).toFixed(1)}s delay`
        );
        sleepMilliseconds(retryDelay);
      }
      references = super.requestReferencingSymbols(options);
    }

    return references;
  }

  private registerHandlers(): void {
    const noop = () => undefined;
    this.handler.onRequest('client/registerCapability', noop);
    this.handler.onNotification('window/logMessage', (payload: unknown) => {
      const message = extractWindowMessage(payload);
      if (message) {
        this.logger.info(`SourceKit LSP message: ${message}`);
      }
    });
    this.handler.onNotification('$/progress', noop);
    this.handler.onNotification('textDocument/publishDiagnostics', noop);
  }

  private initializeLanguageServer(): void {
    const params = this.buildInitializeParams();
    const response = this.handler.sendRequest('initialize', params) as InitializeResponseLike | null;

    if (!response || typeof response !== 'object') {
      throw new Error('sourcekit-lsp returned an invalid initialize response.');
    }

    const capabilities = response.capabilities;
    if (!capabilities || typeof capabilities !== 'object') {
      throw new Error('sourcekit-lsp did not return capabilities during initialization.');
    }

    const capabilityKeys = Object.keys(capabilities);
    this.logger.info(`SourceKit LSP capabilities: ${capabilityKeys.join(', ')}`);

    if (!('textDocumentSync' in capabilities)) {
      throw new Error('sourcekit-lsp initialize response missing textDocumentSync capability.');
    }
    if (!('definitionProvider' in capabilities)) {
      throw new Error('sourcekit-lsp initialize response missing definitionProvider capability.');
    }

    this.handler.notify.initialized({});
    this.firstReferenceDelayApplied = false;
    this.initializationTimestamp = Date.now();
  }

  private buildInitializeParams(): Record<string, unknown> {
    const repositoryAbsolutePath = path.resolve(this.repositoryRootPath);
    const rootUri = pathToFileURL(repositoryAbsolutePath).href;

    return {
      capabilities: deepClone(CAPABILITIES_TEMPLATE),
      clientInfo: { name: 'Visual Studio Code', version: '1.102.2' },
      initializationOptions: deepClone(INITIALIZATION_OPTIONS_TEMPLATE),
      locale: 'en',
      processId: process.pid,
      rootPath: repositoryAbsolutePath,
      rootUri,
      workspaceFolders: [
        {
          uri: rootUri,
          name: path.basename(repositoryAbsolutePath)
        }
      ]
    };
  }

  private applyInitialReferenceDelay(): void {
    if (this.firstReferenceDelayApplied) {
      return;
    }

    const delayMs = this.computeInitialReferenceDelayMs();
    if (delayMs > 0) {
      this.logger.info(
        `Sleeping ${(delayMs / 1000).toFixed(1)}s before requesting references for the first time (CI needs extra indexing time)`
      );
      sleepMilliseconds(delayMs);
    }

    this.firstReferenceDelayApplied = true;
  }

  private computeInitialReferenceDelayMs(): number {
    const override = resolveDelayFromEnv(SOURCEKIT_INITIAL_DELAY_ENV, null);
    if (override !== null) {
      return override;
    }

    const baseDelaySeconds = process.env.CI ? 15 : 5;

    if (this.initializationTimestamp) {
      const elapsedSeconds = (Date.now() - this.initializationTimestamp) / 1000;
      const remainingSeconds = Math.max(2, baseDelaySeconds - elapsedSeconds);
      return Math.max(0, Math.round(remainingSeconds * 1000));
    }

    return baseDelaySeconds * 1000;
  }
}

function mergeIgnoredPaths(existing: string[] | undefined, additions: string[]): string[] {
  const merged = new Set(existing ?? []);
  for (const entry of additions) {
    merged.add(entry);
  }
  return Array.from(merged);
}

function resolveSourcekitBinary(): SourcekitBinaryResolution {
  const command = (process.env[SOURCEKIT_PATH_ENV] ?? 'sourcekit-lsp').trim() || 'sourcekit-lsp';
  const assumed = process.env[SOURCEKIT_ASSUME_ENV] === '1';
  if (assumed) {
    return { command, version: 'assumed', assumed: true };
  }

  try {
    const result = spawnSync(command, ['-h'], ensureDefaultSubprocessOptions({ encoding: 'utf-8' }));
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      const stderr = (result.stderr ?? '').toString().trim();
      throw new Error(
        `sourcekit-lsp '-h' exited with status ${result.status}. ${stderr || 'Install sourcekit-lsp and ensure it is on PATH.'}`
      );
    }

    const stdout = (result.stdout ?? '').toString().trim();
    const stderr = (result.stderr ?? '').toString().trim();
    const version = stdout || stderr || 'unknown';
    return { command, version, assumed: false };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Unknown error while probing sourcekit-lsp. Install sourcekit-lsp and make sure it is on your PATH.';
    throw new Error(
      `${message} See https://github.com/apple/sourcekit-lsp#installation for installation instructions.`
    );
  }
}

function resolveDelayFromEnv(envName: string, fallbackMs: number | null): number {
  const raw = process.env[envName];
  if (raw === undefined) {
    return fallbackMs ?? 0;
  }

  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    return fallbackMs ?? 0;
  }
  return value;
}

function extractWindowMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const message = (payload as { message?: unknown }).message;
  return typeof message === 'string' ? message : null;
}

function sleepMilliseconds(durationMs: number): void {
  if (durationMs <= 0) {
    return;
  }

  if (typeof SharedArrayBuffer !== 'undefined' && typeof Atomics?.wait === 'function') {
    const shared = new SharedArrayBuffer(4);
    const view = new Int32Array(shared);
    Atomics.wait(view, 0, 0, durationMs);
    return;
  }

  const end = Date.now() + durationMs;
  while (Date.now() < end) {
    // busy-wait fallback if Atomics.wait is unavailable
  }
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

registerLanguageServer(Language.SWIFT, SourceKitLanguageServer as SmartLanguageServerConstructor);
