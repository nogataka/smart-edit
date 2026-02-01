import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { createSmartEditLogger, type LogLevel } from '../../smart-edit/util/logging.js';
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
import { RuntimeDependencyCollection, type PlatformId, type RuntimeDependency } from './common.js';
import type { PayloadLike } from '../lsp_protocol_handler/server.js';

interface RuntimeDependencyPaths {
  gradlePath: string;
  jrePath: string;
  jreHomePath: string;
  lombokJarPath: string;
  jdtlsLauncherJarPath: string;
  jdtlsReadonlyConfigPath: string;
  intellicodeJarPath: string;
  intellisenseMembersPath: string;
}

interface VsCodeJavaDependency extends RuntimeDependency {
  relativeExtractionPath: string;
  jreHomePath: string;
  jreBinaryPath: string;
  lombokJarPath: string;
  launcherJarPath: string;
  readonlyConfigPath: string;
}

interface IntellicodeDependency extends RuntimeDependency {
  relativeExtractionPath: string;
  jarPath: string;
  membersPath: string;
  alternateUrl?: string;
}

const GRADLE_VERSION = '8.14.2';
const INTELLICODE_VERSION = '1.2.30';
const VSCODE_JAVA_VERSION = '1.42.0';

const GRADLE_DEPENDENCY: RuntimeDependency = {
  id: 'gradle',
  url: `https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip`,
  archiveType: 'zip'
};

const VSCODE_JAVA_DEPENDENCIES: Partial<Record<PlatformId | 'darwin-arm64', VsCodeJavaDependency>> = {
  'osx-arm64': {
    id: 'vscode-java',
    url: `https://github.com/redhat-developer/vscode-java/releases/download/v${VSCODE_JAVA_VERSION}/java-darwin-arm64-${VSCODE_JAVA_VERSION}-561.vsix`,
    archiveType: 'zip',
    relativeExtractionPath: 'vscode-java',
    jreHomePath: 'extension/jre/21.0.7-macosx-aarch64',
    jreBinaryPath: 'extension/jre/21.0.7-macosx-aarch64/bin/java',
    lombokJarPath: 'extension/lombok/lombok-1.18.36.jar',
    launcherJarPath: 'extension/server/plugins/org.eclipse.equinox.launcher_1.7.0.v20250424-1814.jar',
    readonlyConfigPath: 'extension/server/config_mac_arm'
  },
  'darwin-arm64': {
    id: 'vscode-java',
    url: `https://github.com/redhat-developer/vscode-java/releases/download/v${VSCODE_JAVA_VERSION}/java-darwin-arm64-${VSCODE_JAVA_VERSION}-561.vsix`,
    archiveType: 'zip',
    relativeExtractionPath: 'vscode-java',
    jreHomePath: 'extension/jre/21.0.7-macosx-aarch64',
    jreBinaryPath: 'extension/jre/21.0.7-macosx-aarch64/bin/java',
    lombokJarPath: 'extension/lombok/lombok-1.18.36.jar',
    launcherJarPath: 'extension/server/plugins/org.eclipse.equinox.launcher_1.7.0.v20250424-1814.jar',
    readonlyConfigPath: 'extension/server/config_mac_arm'
  },
  'osx-x64': {
    id: 'vscode-java',
    url: `https://github.com/redhat-developer/vscode-java/releases/download/v${VSCODE_JAVA_VERSION}/java-darwin-x64-${VSCODE_JAVA_VERSION}-561.vsix`,
    archiveType: 'zip',
    relativeExtractionPath: 'vscode-java',
    jreHomePath: 'extension/jre/21.0.7-macosx-x86_64',
    jreBinaryPath: 'extension/jre/21.0.7-macosx-x86_64/bin/java',
    lombokJarPath: 'extension/lombok/lombok-1.18.36.jar',
    launcherJarPath: 'extension/server/plugins/org.eclipse.equinox.launcher_1.7.0.v20250424-1814.jar',
    readonlyConfigPath: 'extension/server/config_mac'
  },
  'linux-x64': {
    id: 'vscode-java',
    url: `https://github.com/redhat-developer/vscode-java/releases/download/v${VSCODE_JAVA_VERSION}/java-linux-x64-${VSCODE_JAVA_VERSION}-561.vsix`,
    archiveType: 'zip',
    relativeExtractionPath: 'vscode-java',
    jreHomePath: 'extension/jre/21.0.7-linux-x86_64',
    jreBinaryPath: 'extension/jre/21.0.7-linux-x86_64/bin/java',
    lombokJarPath: 'extension/lombok/lombok-1.18.36.jar',
    launcherJarPath: 'extension/server/plugins/org.eclipse.equinox.launcher_1.7.0.v20250424-1814.jar',
    readonlyConfigPath: 'extension/server/config_linux'
  },
  'linux-arm64': {
    id: 'vscode-java',
    url: `https://github.com/redhat-developer/vscode-java/releases/download/v${VSCODE_JAVA_VERSION}/java-linux-arm64-${VSCODE_JAVA_VERSION}-561.vsix`,
    archiveType: 'zip',
    relativeExtractionPath: 'vscode-java',
    jreHomePath: 'extension/jre/21.0.7-linux-aarch64',
    jreBinaryPath: 'extension/jre/21.0.7-linux-aarch64/bin/java',
    lombokJarPath: 'extension/lombok/lombok-1.18.36.jar',
    launcherJarPath: 'extension/server/plugins/org.eclipse.equinox.launcher_1.7.0.v20250424-1814.jar',
    readonlyConfigPath: 'extension/server/config_linux'
  },
  'win-x64': {
    id: 'vscode-java',
    url: `https://github.com/redhat-developer/vscode-java/releases/download/v${VSCODE_JAVA_VERSION}/java-win32-x64-${VSCODE_JAVA_VERSION}-561.vsix`,
    archiveType: 'zip',
    relativeExtractionPath: 'vscode-java',
    jreHomePath: 'extension/jre/21.0.7-win32-x86_64',
    jreBinaryPath: 'extension/jre/21.0.7-win32-x86_64/bin/java.exe',
    lombokJarPath: 'extension/lombok/lombok-1.18.36.jar',
    launcherJarPath: 'extension/server/plugins/org.eclipse.equinox.launcher_1.7.0.v20250424-1814.jar',
    readonlyConfigPath: 'extension/server/config_win'
  }
};

const INTELLICODE_DEPENDENCY: IntellicodeDependency = {
  id: 'intellicode',
  url: `https://VisualStudioExptTeam.gallery.vsassets.io/_apis/public/gallery/publisher/VisualStudioExptTeam/extension/vscodeintellicode/${INTELLICODE_VERSION}/assetbyname/Microsoft.VisualStudio.Services.VSIXPackage`,
  alternateUrl: `https://marketplace.visualstudio.com/_apis/public/gallery/publishers/VisualStudioExptTeam/vsextensions/vscodeintellicode/${INTELLICODE_VERSION}/vspackage`,
  archiveType: 'zip',
  relativeExtractionPath: 'intellicode',
  jarPath: 'extension/dist/com.microsoft.jdtls.intellicode.core-0.7.0.jar',
  membersPath: 'extension/dist/bundledModels/java_intellisense-members'
};

interface InitializeParamsLike {
  locale: string;
  rootPath: string;
  rootUri: string;
  capabilities: Record<string, unknown>;
  initializationOptions: Record<string, unknown>;
  trace: string;
  processId: number;
  workspaceFolders: { uri: string; name: string }[];
}

interface RegisterCapabilityParams {
  registrations?: {
    method?: string;
    registerOptions?: Record<string, unknown>;
  }[];
}

interface LanguageStatusParams {
  type?: string;
  message?: string;
}

export class EclipseJdtLanguageServer extends SmartLanguageServer {
  protected override readonly handler: NodeLanguageServerHandler;
  private readonly runtimePaths: RuntimeDependencyPaths;
  private initialized = false;
  private sentIntellicodeCommand = false;

  constructor(
    config: LanguageServerConfigLike,
    loggerLike: { level?: number | LogLevel } | null,
    repositoryRootPath: string,
    options: { timeout?: number | null; smartLspSettings?: SmartLspSettingsInit } = {}
  ) {
    const solidSettings = new SmartLspSettings(options?.smartLspSettings);
    const runtimePaths = ensureRuntimeDependencies(solidSettings, loggerLike?.level);

    const { command, env, workspaceDir } = createLaunchConfiguration(runtimePaths, solidSettings);

    const handler = new NodeLanguageServerHandler(
      {
        cmd: command,
        env,
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
    this.registerHandlers(workspaceDir.sharedCacheDir);
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
    this.sentIntellicodeCommand = false;
  }

  private registerHandlers(sharedCacheDir: string): void {
    this.handler.onRequest('client/registerCapability', (params: unknown) => {
      this.handleRegisterCapability(params as RegisterCapabilityParams | null);
      return [];
    });

    this.handler.onNotification('language/status', (params: unknown) => {
      const payload = params as LanguageStatusParams | null;
      if (payload?.type === 'ServiceReady' && payload.message === 'ServiceReady') {
        this.logger.info('Eclipse JDT Language Server reported ServiceReady.');
      }
    });

    this.handler.onNotification('window/logMessage', (payload: unknown) => {
      const message = extractMessage(payload);
      if (message) {
        this.logger.info(`Eclipse JDT LS: ${message}`);
      }
    });

    const noop = () => undefined;
    this.handler.onNotification('$/progress', noop);
    this.handler.onNotification('textDocument/publishDiagnostics', noop);
    this.handler.onNotification('language/actionableNotification', noop);

    this.handler.onRequest('workspace/executeClientCommand', (params: unknown) => {
      if ((params as { command?: string } | null)?.command === '_java.reloadBundles.command') {
        return [];
      }
      return [];
    });

    // ensure shared cache directory exists
    fs.mkdirSync(sharedCacheDir, { recursive: true });
  }

  private initializeLanguageServer(): void {
    const params = this.buildInitializeParams();
    const response = this.handler.sendRequest('initialize', params) as { capabilities?: Record<string, unknown> } | null;

    if (!response || typeof response !== 'object') {
      throw new Error('Eclipse JDT language server returned an invalid initialize response.');
    }

    this.verifyCapabilities(response.capabilities ?? null);

    this.handler.notify.initialized({});
    this.sendWorkspaceConfiguration(params);
  }

  private sendWorkspaceConfiguration(params: InitializeParamsLike): void {
    const settings = params.initializationOptions?.settings;
    if (!settings || typeof settings !== 'object') {
      return;
    }

    const payload = { settings } as Record<string, unknown>;
    this.handler.sendNotification('workspace/didChangeConfiguration', payload as unknown as PayloadLike);
  }

  private buildInitializeParams(): InitializeParamsLike {
    const rootUri = pathToFileUrl(this.repositoryRootPath);
    const initializationOptions = buildInitializationOptions(this.runtimePaths);
    const params: InitializeParamsLike = {
      locale: 'en',
      rootPath: this.repositoryRootPath,
      rootUri,
      capabilities: buildClientCapabilities(),
      initializationOptions,
      trace: 'verbose',
      processId: process.pid,
      workspaceFolders: [
        {
          uri: rootUri,
          name: path.basename(this.repositoryRootPath)
        }
      ]
    };
    return params;
  }

  private verifyCapabilities(capabilities: Record<string, unknown> | null): void {
    if (!capabilities) {
      throw new Error('Eclipse JDT initialization response is missing capabilities.');
    }

    const textDocumentSync = (capabilities as { textDocumentSync?: { change?: number } }).textDocumentSync;
    if (textDocumentSync?.change !== 2) {
      throw new Error('Eclipse JDT language server must expose incremental textDocumentSync capability.');
    }

    if ('completionProvider' in capabilities || 'executeCommandProvider' in capabilities) {
      throw new Error('Eclipse JDT language server returned unexpected completion/executeCommand provider capabilities.');
    }
  }

  private handleRegisterCapability(params: RegisterCapabilityParams | null): void {
    if (!params?.registrations) {
      return;
    }

    for (const registration of params.registrations) {
      if (!registration) {
        continue;
      }

      if (registration.method === 'textDocument/completion') {
        this.logger.debug('Eclipse JDT LS registered completion provider.');
      }

      if (registration.method === 'workspace/executeCommand') {
        const commands = (registration.registerOptions as { commands?: string[] } | null)?.commands ?? [];
        if (!this.sentIntellicodeCommand && commands.includes('java.intellicode.enable')) {
          this.sentIntellicodeCommand = true;
          this.enableIntellicode();
        }
      }
    }
  }

  private enableIntellicode(): void {
    const membersPath = this.runtimePaths.intellisenseMembersPath;
    if (!fs.existsSync(membersPath)) {
      this.logger.warn(`Intellicode members path not found at ${membersPath}; skipping enable command.`);
      return;
    }

    const result = this.handler.sendRequest('workspace/executeCommand', {
      command: 'java.intellicode.enable',
      arguments: [true, membersPath]
    });

    if (!result) {
      throw new Error('Failed to enable Java Intellicode support.');
    }
  }
}

registerLanguageServer(Language.JAVA, EclipseJdtLanguageServer as SmartLanguageServerConstructor);

function ensureRuntimeDependencies(settings: SmartLspSettings, loggerLevel?: LogLevel | number): RuntimeDependencyPaths {
  const runtimeRoot = path.join(settings.languageServersStaticDir, 'eclipse-jdtls');
  fs.mkdirSync(runtimeRoot, { recursive: true });

  const { logger } = createSmartEditLogger({
    name: 'smart-lsp.language_servers.eclipse_jdtls',
    emitToConsole: false,
    level: loggerLevel === undefined ? undefined : coerceLogLevel(loggerLevel)
  });

  const gradlePath = ensureGradle(runtimeRoot, logger);
  const vscodePaths = ensureVsCodeJava(runtimeRoot, logger);
  const intellicodePaths = ensureIntellicode(runtimeRoot, logger);

  return {
    gradlePath,
    jrePath: vscodePaths.jrePath,
    jreHomePath: vscodePaths.jreHomePath,
    lombokJarPath: vscodePaths.lombokJarPath,
    jdtlsLauncherJarPath: vscodePaths.launcherJarPath,
    jdtlsReadonlyConfigPath: vscodePaths.readonlyConfigPath,
    intellicodeJarPath: intellicodePaths.jarPath,
    intellisenseMembersPath: intellicodePaths.membersPath
  };
}

function ensureGradle(runtimeRoot: string, logger: ReturnType<typeof createSmartEditLogger>['logger']): string {
  const expectedDir = path.join(runtimeRoot, `gradle-${GRADLE_VERSION}`);
  if (fs.existsSync(expectedDir)) {
    return expectedDir;
  }

  if (process.env.SMART_EDIT_SKIP_RUNTIME_INSTALL === '1') {
    throw new Error(`gradle-${GRADLE_VERSION} not found at ${expectedDir}. Allow runtime downloads or install manually.`);
  }

  const collection = new RuntimeDependencyCollection([GRADLE_DEPENDENCY]);
  logger.info(`Installing Gradle ${GRADLE_VERSION} runtime for Eclipse JDT LS.`);
  collection.install(logger, runtimeRoot);

  if (!fs.existsSync(expectedDir)) {
    throw new Error(`Failed to install Gradle runtime. Expected directory at ${expectedDir}.`);
  }
  return expectedDir;
}

function ensureVsCodeJava(runtimeRoot: string, logger: ReturnType<typeof createSmartEditLogger>['logger']): {
  jrePath: string;
  jreHomePath: string;
  lombokJarPath: string;
  launcherJarPath: string;
  readonlyConfigPath: string;
} {
  const platform = determinePlatformId();
  const dependency = VSCODE_JAVA_DEPENDENCIES[platform] ?? VSCODE_JAVA_DEPENDENCIES['darwin-arm64'];
  if (!dependency) {
    throw new Error(`Unsupported platform '${platform}' for Eclipse JDT LS runtime.`);
  }

  const targetDir = path.join(runtimeRoot, dependency.relativeExtractionPath);
  const jreHomePath = path.join(targetDir, dependency.jreHomePath);
  const jrePath = path.join(targetDir, dependency.jreBinaryPath);
  const lombokJarPath = path.join(targetDir, dependency.lombokJarPath);
  const launcherJarPath = path.join(targetDir, dependency.launcherJarPath);
  const readonlyConfigPath = path.join(targetDir, dependency.readonlyConfigPath);

  if (!pathsExist([jreHomePath, jrePath, lombokJarPath, launcherJarPath, readonlyConfigPath])) {
    if (process.env.SMART_EDIT_SKIP_RUNTIME_INSTALL === '1') {
      throw new Error(
        `VS Code Java runtime not found at ${targetDir}. Allow downloads or pre-install the extension contents manually.`
      );
    }

    const collection = new RuntimeDependencyCollection([dependency]);
    logger.info(`Installing VS Code Java extension runtime for platform ${platform}.`);
    collection.install(logger, targetDir);
  }

  if (!pathsExist([jreHomePath, jrePath, lombokJarPath, launcherJarPath, readonlyConfigPath])) {
    throw new Error(`VS Code Java runtime incomplete. Expected assets under ${targetDir}.`);
  }

  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(jrePath, 0o755);
    } catch {
      // best effort
    }
  }

  return {
    jrePath,
    jreHomePath,
    lombokJarPath,
    launcherJarPath,
    readonlyConfigPath
  };
}

function ensureIntellicode(runtimeRoot: string, logger: ReturnType<typeof createSmartEditLogger>['logger']): {
  jarPath: string;
  membersPath: string;
} {
  const targetDir = path.join(runtimeRoot, INTELLICODE_DEPENDENCY.relativeExtractionPath);
  const jarPath = path.join(targetDir, INTELLICODE_DEPENDENCY.jarPath);
  const membersPath = path.join(targetDir, INTELLICODE_DEPENDENCY.membersPath);

  if (!pathsExist([jarPath, membersPath])) {
    if (process.env.SMART_EDIT_SKIP_RUNTIME_INSTALL === '1') {
      throw new Error(
        `Intellicode runtime assets not found at ${targetDir}. Allow downloads or pre-install the VSIX contents manually.`
      );
    }

    const download = (url: string) => {
      const collection = new RuntimeDependencyCollection([{ ...INTELLICODE_DEPENDENCY, url }]);
      collection.install(logger, targetDir);
    };

    try {
      logger.info('Installing IntelliCode support for Eclipse JDT LS.');
      download(INTELLICODE_DEPENDENCY.url ?? '');
    } catch (error) {
      if (INTELLICODE_DEPENDENCY.alternateUrl) {
        logger.warn('Primary IntelliCode download failed, retrying alternate URL.');
        download(INTELLICODE_DEPENDENCY.alternateUrl);
      } else {
        throw error;
      }
    }
  }

  if (!pathsExist([jarPath, membersPath])) {
    throw new Error(`Failed to install IntelliCode assets. Expected jar and members under ${targetDir}.`);
  }

  return { jarPath, membersPath };
}

function createLaunchConfiguration(
  runtimePaths: RuntimeDependencyPaths,
  settings: SmartLspSettings
): {
  command: string[];
  env: Record<string, string>;
  workspaceDir: { root: string; configDir: string; sharedCacheDir: string };
} {
  const workspaceRoot = path.join(settings.languageServersStaticDir, 'EclipseJDTLS', 'workspaces');
  fs.mkdirSync(workspaceRoot, { recursive: true });
  const workspaceId = crypto.randomUUID();
  const wsDir = path.join(workspaceRoot, workspaceId);
  const dataDir = path.join(wsDir, 'data_dir');
  const configDir = path.join(wsDir, 'config_path');
  const sharedCacheDir = path.join(settings.languageServersStaticDir, 'lsp', 'EclipseJDTLS', 'sharedIndex');

  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(sharedCacheDir, { recursive: true });

  if (!fs.existsSync(configDir)) {
    copyDirectory(runtimePaths.jdtlsReadonlyConfigPath, configDir);
  }

  const command = [
    runtimePaths.jrePath,
    '--add-modules=ALL-SYSTEM',
    '--add-opens',
    'java.base/java.util=ALL-UNNAMED',
    '--add-opens',
    'java.base/java.lang=ALL-UNNAMED',
    '--add-opens',
    'java.base/sun.nio.fs=ALL-UNNAMED',
    '-Declipse.application=org.eclipse.jdt.ls.core.id1',
    '-Dosgi.bundles.defaultStartLevel=4',
    '-Declipse.product=org.eclipse.jdt.ls.core.product',
    '-Djava.import.generatesMetadataFilesAtProjectRoot=false',
    '-Dfile.encoding=utf8',
    '-noverify',
    '-XX:+UseParallelGC',
    '-XX:GCTimeRatio=4',
    '-XX:AdaptiveSizePolicyWeight=90',
    '-Dsun.zip.disableMemoryMapping=true',
    '-Djava.lsp.joinOnCompletion=true',
    '-Xmx3G',
    '-Xms100m',
    '-Xlog:disable',
    '-Dlog.level=ALL',
    `-javaagent:${runtimePaths.lombokJarPath}`,
    `-Djdt.core.sharedIndexLocation=${sharedCacheDir}`,
    '-jar',
    runtimePaths.jdtlsLauncherJarPath,
    '-configuration',
    configDir,
    '-data',
    dataDir
  ];

  const env = {
    syntaxserver: 'false',
    JAVA_HOME: runtimePaths.jreHomePath
  };

  return {
    command,
    env,
    workspaceDir: { root: wsDir, configDir, sharedCacheDir }
  };
}

function buildInitializationOptions(runtimePaths: RuntimeDependencyPaths): Record<string, unknown> {
  const initializationOptions: Record<string, unknown> = {
    bundles: ['intellicode-core.jar'],
    settings: {
      java: {
        home: null,
        jdt: {
          ls: {
            java: {
              home: runtimePaths.jreHomePath
            }
          }
        },
        configuration: {
          runtimes: [
            {
              name: 'JavaSE-21',
              path: runtimePaths.jreHomePath,
              default: true
            }
          ]
        },
        import: {
          gradle: {
            enabled: true,
            wrapper: {
              enabled: true
            },
            user: {
              home: runtimePaths.gradlePath
            },
            java: {
              home: runtimePaths.jrePath
            }
          }
        }
      }
    },
    workspaceFolders: []
  };

  return initializationOptions;
}

function buildClientCapabilities(): Record<string, unknown> {
  const symbolKinds = rangeArray(1, 27);
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
        completionItemKind: { valueSet: rangeArray(1, 26) },
        completionList: { itemDefaults: ['commitCharacters', 'editRange', 'insertTextFormat', 'insertTextMode'] }
      },
      hover: { dynamicRegistration: true, contentFormat: ['markdown', 'plaintext'] },
      signatureHelp: {
        dynamicRegistration: true,
        signatureInformation: {
          documentationFormat: ['markdown', 'plaintext'],
          parameterInformation: { labelOffsetSupport: true },
          activeParameterSupport: true
        }
      },
      definition: { dynamicRegistration: true, linkSupport: true },
      references: { dynamicRegistration: true },
      documentSymbol: {
        dynamicRegistration: true,
        symbolKind: { valueSet: symbolKinds },
        hierarchicalDocumentSymbolSupport: true,
        tagSupport: { valueSet: [1] },
        labelSupport: true
      },
      rename: {
        dynamicRegistration: true,
        prepareSupport: true,
        prepareSupportDefaultBehavior: 1,
        honorsChangeAnnotations: true
      },
      documentLink: { dynamicRegistration: true, tooltipSupport: true },
      typeDefinition: { dynamicRegistration: true, linkSupport: true },
      implementation: { dynamicRegistration: true, linkSupport: true },
      colorProvider: { dynamicRegistration: true },
      declaration: { dynamicRegistration: true, linkSupport: true },
      selectionRange: { dynamicRegistration: true },
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
      typeHierarchy: { dynamicRegistration: true },
      inlineValue: { dynamicRegistration: true },
      diagnostic: { dynamicRegistration: true, relatedDocumentSupport: false }
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
      positionEncodings: ['utf-16']
    },
    notebookDocument: {
      synchronization: { dynamicRegistration: true, executionSummarySupport: true }
    }
  };
}

function rangeArray(start: number, endExclusive: number): number[] {
  const result: number[] = [];
  for (let i = start; i < endExclusive; i += 1) {
    result.push(i);
  }
  return result;
}

function determinePlatformId(): PlatformId | 'darwin-arm64' {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'win32') {
    return 'win-x64';
  }
  if (platform === 'darwin') {
    return arch === 'arm64' ? 'osx-arm64' : 'osx-x64';
  }
  if (platform === 'linux') {
    return arch === 'arm64' ? 'linux-arm64' : 'linux-x64';
  }
  // fallback for unsupported platforms
  return 'linux-x64';
}

function pathsExist(paths: string[]): boolean {
  return paths.every((candidate) => fs.existsSync(candidate));
}

function copyDirectory(source: string, destination: string): void {
  if (!fs.existsSync(source)) {
    throw new Error(`Cannot copy directory – source path '${source}' does not exist.`);
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (fs.existsSync(destination)) {
    return;
  }

  fs.cpSync(source, destination, { recursive: true });
}

function extractMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const message = (payload as { message?: unknown }).message;
  return typeof message === 'string' ? message : null;
}

function pathToFileUrl(candidate: string): string {
  return pathToFileURL(candidate).href;
}
