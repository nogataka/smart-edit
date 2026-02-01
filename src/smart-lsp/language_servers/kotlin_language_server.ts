import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { createSmartEditLogger, type LogLevel, type SmartEditLogger } from '../../smart-edit/util/logging.js';
import { Language } from '../ls_config.js';
import {
  SmartLanguageServer,
  SmartLspSettings,
  type LanguageServerConfigLike,
  type SmartLanguageServerConstructor,
  type SmartLspSettingsInit,
  registerLanguageServer,
  coerceLogLevel
} from '../ls.js';
import { NodeLanguageServerHandler } from '../ls_handler.js';
import { Platform, RuntimeDependencyCollection, type PlatformId, type RuntimeDependency } from './common.js';

interface KotlinRuntimeDependencyPaths {
  javaPath: string;
  javaHomePath: string;
  kotlinExecutablePath: string;
}

interface JavaRuntimeDependency extends RuntimeDependency {
  javaHomePath: string;
  javaBinaryPath: string;
}

const KOTLIN_LSP_DEPENDENCY: RuntimeDependency = {
  id: 'kotlin-lsp',
  description: 'Kotlin Language Server',
  url: 'https://download-cdn.jetbrains.com/kotlin-lsp/0.253.10629/kotlin-0.253.10629.zip',
  archiveType: 'zip'
};

const JAVA_DEPENDENCIES: Partial<Record<PlatformId, JavaRuntimeDependency>> = {
  'win-x64': {
    id: 'vscode-java-runtime',
    description: 'VSCode Java JRE (win-x64)',
    url: 'https://github.com/redhat-developer/vscode-java/releases/download/v1.42.0/java-win32-x64-1.42.0-561.vsix',
    archiveType: 'zip',
    javaHomePath: 'extension/jre/21.0.7-win32-x86_64',
    javaBinaryPath: 'extension/jre/21.0.7-win32-x86_64/bin/java.exe'
  },
  'linux-x64': {
    id: 'vscode-java-runtime',
    description: 'VSCode Java JRE (linux-x64)',
    url: 'https://github.com/redhat-developer/vscode-java/releases/download/v1.42.0/java-linux-x64-1.42.0-561.vsix',
    archiveType: 'zip',
    javaHomePath: 'extension/jre/21.0.7-linux-x86_64',
    javaBinaryPath: 'extension/jre/21.0.7-linux-x86_64/bin/java'
  },
  'linux-arm64': {
    id: 'vscode-java-runtime',
    description: 'VSCode Java JRE (linux-arm64)',
    url: 'https://github.com/redhat-developer/vscode-java/releases/download/v1.42.0/java-linux-arm64-1.42.0-561.vsix',
    archiveType: 'zip',
    javaHomePath: 'extension/jre/21.0.7-linux-aarch64',
    javaBinaryPath: 'extension/jre/21.0.7-linux-aarch64/bin/java'
  },
  'osx-x64': {
    id: 'vscode-java-runtime',
    description: 'VSCode Java JRE (macOS x64)',
    url: 'https://github.com/redhat-developer/vscode-java/releases/download/v1.42.0/java-darwin-x64-1.42.0-561.vsix',
    archiveType: 'zip',
    javaHomePath: 'extension/jre/21.0.7-macosx-x86_64',
    javaBinaryPath: 'extension/jre/21.0.7-macosx-x86_64/bin/java'
  },
  'osx-arm64': {
    id: 'vscode-java-runtime',
    description: 'VSCode Java JRE (macOS arm64)',
    url: 'https://github.com/redhat-developer/vscode-java/releases/download/v1.42.0/java-darwin-arm64-1.42.0-561.vsix',
    archiveType: 'zip',
    javaHomePath: 'extension/jre/21.0.7-macosx-aarch64',
    javaBinaryPath: 'extension/jre/21.0.7-macosx-aarch64/bin/java'
  }
};

const JAVA_DEPENDENCY_FALLBACKS: Partial<Record<PlatformId, PlatformId>> = {
  'win-arm64': 'win-x64',
  'win-x86': 'win-x64',
  osx: 'osx-x64',
  'linux-musl-x64': 'linux-x64',
  'linux-musl-arm64': 'linux-arm64',
  'linux-x86': 'linux-x64'
};

interface InitializeResponseLike {
  capabilities?: Record<string, unknown> | null;
}

export class KotlinLanguageServer extends SmartLanguageServer {
  protected override readonly handler: NodeLanguageServerHandler;
  private readonly runtimePaths: KotlinRuntimeDependencyPaths;
  private initialized = false;

  constructor(
    config: LanguageServerConfigLike,
    loggerLike: { level?: number | LogLevel } | null,
    repositoryRootPath: string,
    options: { timeout?: number | null; smartLspSettings?: SmartLspSettingsInit } = {}
  ) {
    const solidSettings = new SmartLspSettings(options?.smartLspSettings);

    const { logger } = createSmartEditLogger({
      name: 'smart-lsp.language_servers.kotlin',
      emitToConsole: false,
      level: loggerLike?.level === undefined ? undefined : coerceLogLevel(loggerLike.level)
    });

    const runtimePaths = ensureRuntimeDependencies(solidSettings, logger);

    const handler = new NodeLanguageServerHandler(
      {
        cmd: [runtimePaths.kotlinExecutablePath, '--stdio'],
        env: {
          JAVA_HOME: runtimePaths.javaHomePath
        },
        cwd: repositoryRootPath
      },
      {
        requestTimeoutSeconds: options?.timeout ?? null
      }
    );

    super(config, loggerLike, repositoryRootPath, {
      ...options,
      handler,
      smartLspSettings: options?.smartLspSettings
    });

    this.handler = handler;
    this.runtimePaths = runtimePaths;
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
    this.handler.onRequest('workspace/executeClientCommand', () => []);
    this.handler.onNotification('language/status', noop);
    this.handler.onNotification('language/actionableNotification', noop);
    this.handler.onNotification('$/progress', noop);
    this.handler.onNotification('textDocument/publishDiagnostics', noop);
    this.handler.onNotification('experimental/serverStatus', (payload: unknown) => {
      const params = payload as { quiescent?: boolean } | null;
      if (params?.quiescent) {
        this.logger.debug('Kotlin language server reported experimental/serverStatus quiescent=true');
      }
    });
    this.handler.onNotification('window/logMessage', (payload: unknown) => {
      const message = extractWindowMessage(payload);
      if (message) {
        this.logger.info(`Kotlin LS message: ${message}`);
      }
    });
  }

  private initializeLanguageServer(): void {
    this.logger.info('Initializing Kotlin language server');
    const params = this.buildInitializeParams();
    const response = this.handler.sendRequest('initialize', params) as InitializeResponseLike | null;

    if (!response || typeof response !== 'object') {
      throw new Error('Kotlin language server returned an invalid initialize response.');
    }

    if (!response.capabilities || typeof response.capabilities !== 'object') {
      throw new Error('Kotlin language server did not return capabilities during initialization.');
    }

    this.handler.notify.initialized({});
  }

  private buildInitializeParams(): Record<string, unknown> {
    const repositoryAbsolutePath = path.resolve(this.repositoryRootPath);
    const rootUri = pathToFileURL(repositoryAbsolutePath).href;

    return {
      clientInfo: { name: 'Multilspy Kotlin Client', version: '1.0.0' },
      locale: 'en',
      processId: process.pid,
      rootPath: repositoryAbsolutePath,
      rootUri,
      capabilities: buildKotlinCapabilities(),
      initializationOptions: {
        workspaceFolders: [rootUri],
        storagePath: null,
        codegen: { enabled: false },
        compiler: { jvm: { target: 'default' } },
        completion: { snippets: { enabled: true } },
        diagnostics: { enabled: true, level: 4, debounceTime: 250 },
        scripts: { enabled: true, buildScriptsEnabled: true },
        indexing: { enabled: true },
        formatting: { enabled: true },
        references: { includeAllWorkspaceTargets: true },
        singledir: false,
        experimental: {
          dali: { enabled: false }
        },
        telemetry: { enabled: false },
        statistics: { enabled: false }
      },
      workspaceFolders: [
        {
          uri: rootUri,
          name: path.basename(repositoryAbsolutePath)
        }
      ]
    };
  }
}

function ensureRuntimeDependencies(settings: SmartLspSettings, logger: SmartEditLogger): KotlinRuntimeDependencyPaths {
  const runtimeRoot = path.join(settings.languageServersStaticDir, 'kotlin_language_server');
  fs.mkdirSync(runtimeRoot, { recursive: true });

  const kotlinExecutablePath = ensureKotlinExecutable(runtimeRoot, logger);
  const { javaHomePath, javaPath } = ensureJavaRuntime(runtimeRoot, logger);

  return { javaHomePath, javaPath, kotlinExecutablePath };
}

function ensureKotlinExecutable(runtimeRoot: string, logger: SmartEditLogger): string {
  const scriptName = process.platform === 'win32' ? 'kotlin-lsp.cmd' : 'kotlin-lsp.sh';
  const scriptPath = path.join(runtimeRoot, scriptName);

  if (!fs.existsSync(scriptPath)) {
    if (shouldSkipRuntimeInstall()) {
      throw new Error(
        `Kotlin language server script not found at ${scriptPath}. Set SMART_EDIT_SKIP_RUNTIME_INSTALL=0 or install Kotlin LSP manually.`
      );
    }

    logger.info('Downloading Kotlin language server runtime dependency.');
    const dependencies = new RuntimeDependencyCollection([KOTLIN_LSP_DEPENDENCY]);
    dependencies.install(logger, runtimeRoot);
  }

  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Kotlin language server script not found at ${scriptPath} even after installation.`);
  }

  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(scriptPath, 0o755);
    } catch {
      // ignore chmod errors
    }
  }

  return scriptPath;
}

function ensureJavaRuntime(runtimeRoot: string, logger: SmartEditLogger): {
  javaHomePath: string;
  javaPath: string;
} {
  const javaDir = path.join(runtimeRoot, 'java');
  fs.mkdirSync(javaDir, { recursive: true });

  const platform = Platform.current();
  const dependency = resolveJavaDependency(platform);
  const javaHomePath = path.join(javaDir, dependency.javaHomePath);
  const javaBinaryPath = path.join(javaDir, dependency.javaBinaryPath);

  if (!fs.existsSync(javaBinaryPath)) {
    if (shouldSkipRuntimeInstall()) {
      throw new Error(
        `Kotlin language server requires a Java runtime. Expected executable at ${javaBinaryPath}. Allow runtime download or install manually.`
      );
    }

    logger.info(`Downloading Java runtime dependency for platform ${platform}.`);
    const dependencies = new RuntimeDependencyCollection([dependency]);
    dependencies.install(logger, javaDir);
  }

  if (!fs.existsSync(javaBinaryPath)) {
    throw new Error(`Failed to provision Java runtime at ${javaBinaryPath}.`);
  }

  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(javaBinaryPath, 0o755);
    } catch {
      // ignore chmod errors
    }
  }

  return { javaHomePath, javaPath: javaBinaryPath };
}

function resolveJavaDependency(platform: PlatformId): JavaRuntimeDependency {
  const direct = JAVA_DEPENDENCIES[platform];
  if (direct) {
    return direct;
  }

  const fallbackId = JAVA_DEPENDENCY_FALLBACKS[platform];
  if (fallbackId) {
    const fallback = JAVA_DEPENDENCIES[fallbackId];
    if (fallback) {
      return fallback;
    }
  }

  throw new Error(`Unsupported platform for Kotlin language server Java runtime: ${platform}`);
}

function shouldSkipRuntimeInstall(): boolean {
  return process.env.SMART_EDIT_SKIP_RUNTIME_INSTALL === '1';
}

function extractWindowMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const maybeMessage = (payload as { message?: unknown }).message;
  return typeof maybeMessage === 'string' ? maybeMessage : null;
}

function buildKotlinCapabilities(): Record<string, unknown> {
  const symbolKinds = rangeArray(1, 27);
  const completionKinds = rangeArray(1, 26);
  const tokenTypes = [
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
  ];
  const tokenModifiers = [
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
  ];

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
      didChangeConfiguration: { dynamicRegistration: true },
      didChangeWatchedFiles: { dynamicRegistration: true, relativePatternSupport: true },
      symbol: {
        dynamicRegistration: true,
        symbolKind: { valueSet: symbolKinds },
        tagSupport: { valueSet: [1] },
        resolveSupport: { properties: ['location.range'] }
      },
      codeLens: { refreshSupport: true },
      executeCommand: { dynamicRegistration: true },
      configuration: true,
      workspaceFolders: true,
      semanticTokens: { refreshSupport: true },
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
      completion: {
        dynamicRegistration: true,
        contextSupport: true,
        completionItem: {
          snippetSupport: false,
          commitCharactersSupport: true,
          documentationFormat: ['markdown', 'plaintext'],
          deprecatedSupport: true,
          preselectSupport: true,
          tagSupport: { valueSet: [1] },
          insertReplaceSupport: false,
          resolveSupport: { properties: ['documentation', 'detail', 'additionalTextEdits'] },
          insertTextModeSupport: { valueSet: [1, 2] },
          labelDetailsSupport: true
        },
        insertTextMode: 2,
        completionItemKind: { valueSet: completionKinds },
        completionList: { itemDefaults: ['commitCharacters', 'editRange', 'insertTextFormat', 'insertTextMode'] }
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
      codeAction: {
        dynamicRegistration: true,
        isPreferredSupport: true,
        disabledSupport: true,
        dataSupport: true,
        resolveSupport: { properties: ['edit'] },
        codeActionLiteralSupport: {
          codeActionKind: {
            valueSet: ['', 'quickfix', 'refactor', 'refactor.extract', 'refactor.inline', 'refactor.rewrite', 'source', 'source.organizeImports']
          }
        },
        honorsChangeAnnotations: false
      },
      codeLens: { dynamicRegistration: true },
      documentLink: {
        dynamicRegistration: true,
        tooltipSupport: true
      },
      colorProvider: { dynamicRegistration: true },
      formatting: { dynamicRegistration: true },
      rangeFormatting: { dynamicRegistration: true },
      onTypeFormatting: { dynamicRegistration: true },
      rename: {
        dynamicRegistration: true,
        prepareSupport: true,
        honorsChangeAnnotations: false
      },
      foldingRange: {
        dynamicRegistration: true,
        lineFoldingOnly: true,
      },
      selectionRange: { dynamicRegistration: true },
      publishDecorations: { dynamicRegistration: true },
      callHierarchy: { dynamicRegistration: true },
      semanticTokens: {
        dynamicRegistration: true,
        tokenTypes,
        tokenModifiers,
        formats: ['relative'],
        requests: { range: true, full: { delta: true } },
        multilineTokenSupport: false,
        overlappingTokenSupport: false,
        serverCancelSupport: true,
        augmentsSyntaxTokens: true
      },
      linkedEditingRange: { dynamicRegistration: true },
      typeHierarchy: { dynamicRegistration: true },
      inlineValue: { dynamicRegistration: true },
      inlayHint: {
        dynamicRegistration: true,
        resolveSupport: { properties: ['tooltip', 'textEdits', 'label.tooltip', 'label.location', 'label.command'] }
      },
      diagnostic: { dynamicRegistration: true, relatedDocumentSupport: false }
    },
    window: {
      showMessage: { messageActionItem: { additionalPropertiesSupport: true } },
      showDocument: { support: true },
      workDoneProgress: true
    },
    general: {
      staleRequestSupport: {
        cancel: true,
        retryOnContentModified: [
          'textDocument/semanticTokens/full',
          'textDocument/semanticTokens/range',
          'textDocument/semanticTokens/full/delta'
        ]
      },
      regularExpressions: { engine: 'ECMAScript', version: 'ES2020' },
      markdown: { parser: 'marked', version: '1.1.0' },
      positionEncodings: ['utf-16']
    },
    notebookDocument: {
      synchronization: { dynamicRegistration: true, executionSummarySupport: true }
    }
  };
}

function rangeArray(start: number, end: number): number[] {
  const result: number[] = [];
  for (let value = start; value < end; value += 1) {
    result.push(value);
  }
  return result;
}

registerLanguageServer(Language.KOTLIN, KotlinLanguageServer as SmartLanguageServerConstructor);
