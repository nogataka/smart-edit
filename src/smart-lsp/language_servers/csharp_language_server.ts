import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { createSmartEditLogger, type LogLevel, type SmartEditLogger } from '../../smart-edit/util/logging.js';
import { Language } from '../ls_config.js';
import { ensureDefaultSubprocessOptions } from '../util/subprocess_util.js';
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
import type { ProcessLaunchInfo } from '../lsp_protocol_handler/server.js';
import { RuntimeDependencyCollection, type RuntimeDependency, type RuntimeDependencyOverride } from './common.js';
import { SafeZipExtractor } from '../util/zip.js';

interface CSharpLanguageServerSettings {
  runtime_dependencies?: RuntimeDependencyOverride[];
  dotnet_runtime_url?: string;
}

interface InitializeParamsLike {
  workspaceFolders: { uri: string; name: string }[];
  processId: number;
  rootPath: string;
  rootUri: string;
  capabilities: Record<string, unknown>;
}

interface InitializeResponseLike {
  capabilities?: Record<string, unknown> | null;
}

const NUGET_SERVICE_INDEX = 'https://pkgs.dev.azure.com/azure-public/vside/_packaging/vs-impl/nuget/v3/index.json';

const RUNTIME_DEPENDENCIES: RuntimeDependency[] = [
  {
    id: 'CSharpLanguageServer',
    packageName: 'Microsoft.CodeAnalysis.LanguageServer.win-x64',
    packageVersion: '5.0.0-1.25329.6',
    platformId: 'win-x64',
    archiveType: 'nupkg',
    binaryName: 'Microsoft.CodeAnalysis.LanguageServer.dll',
    extractPath: 'content/LanguageServer/win-x64'
  },
  {
    id: 'CSharpLanguageServer',
    packageName: 'Microsoft.CodeAnalysis.LanguageServer.win-arm64',
    packageVersion: '5.0.0-1.25329.6',
    platformId: 'win-arm64',
    archiveType: 'nupkg',
    binaryName: 'Microsoft.CodeAnalysis.LanguageServer.dll',
    extractPath: 'content/LanguageServer/win-arm64'
  },
  {
    id: 'CSharpLanguageServer',
    packageName: 'Microsoft.CodeAnalysis.LanguageServer.osx-x64',
    packageVersion: '5.0.0-1.25329.6',
    platformId: 'osx-x64',
    archiveType: 'nupkg',
    binaryName: 'Microsoft.CodeAnalysis.LanguageServer.dll',
    extractPath: 'content/LanguageServer/osx-x64'
  },
  {
    id: 'CSharpLanguageServer',
    packageName: 'Microsoft.CodeAnalysis.LanguageServer.osx-arm64',
    packageVersion: '5.0.0-1.25329.6',
    platformId: 'osx-arm64',
    archiveType: 'nupkg',
    binaryName: 'Microsoft.CodeAnalysis.LanguageServer.dll',
    extractPath: 'content/LanguageServer/osx-arm64'
  },
  {
    id: 'CSharpLanguageServer',
    packageName: 'Microsoft.CodeAnalysis.LanguageServer.linux-x64',
    packageVersion: '5.0.0-1.25329.6',
    platformId: 'linux-x64',
    archiveType: 'nupkg',
    binaryName: 'Microsoft.CodeAnalysis.LanguageServer.dll',
    extractPath: 'content/LanguageServer/linux-x64'
  },
  {
    id: 'CSharpLanguageServer',
    packageName: 'Microsoft.CodeAnalysis.LanguageServer.linux-arm64',
    packageVersion: '5.0.0-1.25329.6',
    platformId: 'linux-arm64',
    archiveType: 'nupkg',
    binaryName: 'Microsoft.CodeAnalysis.LanguageServer.dll',
    extractPath: 'content/LanguageServer/linux-arm64'
  },
  {
    id: 'DotNetRuntime',
    url: 'https://builds.dotnet.microsoft.com/dotnet/Runtime/9.0.6/dotnet-runtime-9.0.6-win-x64.zip',
    platformId: 'win-x64',
    archiveType: 'zip',
    binaryName: 'dotnet.exe'
  },
  {
    id: 'DotNetRuntime',
    url: 'https://builds.dotnet.microsoft.com/dotnet/Runtime/9.0.6/dotnet-runtime-9.0.6-win-arm64.zip',
    platformId: 'win-arm64',
    archiveType: 'zip',
    binaryName: 'dotnet.exe'
  },
  {
    id: 'DotNetRuntime',
    url: 'https://builds.dotnet.microsoft.com/dotnet/Runtime/9.0.6/dotnet-runtime-9.0.6-linux-x64.tar.gz',
    platformId: 'linux-x64',
    archiveType: 'tar.gz',
    binaryName: 'dotnet'
  },
  {
    id: 'DotNetRuntime',
    url: 'https://builds.dotnet.microsoft.com/dotnet/Runtime/9.0.6/dotnet-runtime-9.0.6-linux-arm64.tar.gz',
    platformId: 'linux-arm64',
    archiveType: 'tar.gz',
    binaryName: 'dotnet'
  },
  {
    id: 'DotNetRuntime',
    url: 'https://builds.dotnet.microsoft.com/dotnet/Runtime/9.0.6/dotnet-runtime-9.0.6-osx-x64.tar.gz',
    platformId: 'osx-x64',
    archiveType: 'tar.gz',
    binaryName: 'dotnet'
  },
  {
    id: 'DotNetRuntime',
    url: 'https://builds.dotnet.microsoft.com/dotnet/Runtime/9.0.6/dotnet-runtime-9.0.6-osx-arm64.tar.gz',
    platformId: 'osx-arm64',
    archiveType: 'tar.gz',
    binaryName: 'dotnet'
  }
];

const CSHARP_IGNORED_DIRECTORIES = new Set(['bin', 'obj', 'packages', '.vs']);

export class CSharpLanguageServer extends SmartLanguageServer {
  protected override readonly handler: NodeLanguageServerHandler;
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
      ignoredPaths: mergeIgnoredDirectories(config.ignoredPaths)
    };

    const solidSettings = new SmartLspSettings(options?.smartLspSettings);
    const runtimeDir = resolveRuntimeDirectory(solidSettings);
    const languageSettings = normalizeLanguageSettings(solidSettings.lsSpecificSettings?.[Language.CSHARP]);

    const { logger: installLogger } = createSmartEditLogger({
      name: 'smart-lsp.language_servers.csharp',
      emitToConsole: false,
      level: loggerLike?.level === undefined ? undefined : coerceLogLevel(loggerLike.level)
    });

    const { dotnetPath, languageServerPath } = ensureRuntimeAssets({
      runtimeDir,
      logger: installLogger,
      overrides: languageSettings.runtime_dependencies ?? [],
      dotnetRuntimeUrlOverride: languageSettings.dotnet_runtime_url
    });

    const logDir = path.join(runtimeDir, 'logs');
    fs.mkdirSync(logDir, { recursive: true });

    const processInfo: ProcessLaunchInfo = {
      cmd: buildCommand(dotnetPath, languageServerPath, logDir),
      cwd: repositoryRootPath
    };

    const handler = new NodeLanguageServerHandler(processInfo, {
      requestTimeoutSeconds: options?.timeout ?? null
    });

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

    this.handler.onNotification('window/logMessage', (payload: unknown) => {
      const message = extractLogMessage(payload);
      if (message) {
        this.logger.info(`C# LS: ${message}`);
      }
    });
    this.handler.onNotification('$/progress', noop);
    this.handler.onNotification('textDocument/publishDiagnostics', noop);

    this.handler.onRequest('workspace/configuration', (params: unknown) => {
      const items = (params as { items?: Record<string, unknown>[] } | null)?.items;
      return Array.isArray(items) ? items.map(() => ({})) : [];
    });

    this.handler.onRequest('window/workDoneProgress/create', noop);
    this.handler.onRequest('client/registerCapability', () => []);
    this.handler.onRequest('workspace/_roslyn_projectNeedsRestore', noop);
  }

  private initializeLanguageServer(): void {
    const params = this.buildInitializeParams();
    const response = this.handler.sendRequest('initialize', params) as InitializeResponseLike | null;

    if (!response || typeof response !== 'object') {
      throw new Error('C# language server returned an invalid initialize response.');
    }

    this.applyDiagnosticCapabilities(response);
    this.verifyCapabilities(response.capabilities ?? null);
    this.handler.notify.initialized({});

    this.openSolutionAndProjects();
  }

  private buildInitializeParams(): InitializeParamsLike {
    const rootUri = pathToFileURL(this.repositoryRootPath).href;
    return {
      workspaceFolders: [
        {
          uri: rootUri,
          name: path.basename(this.repositoryRootPath)
        }
      ],
      processId: process.pid,
      rootPath: this.repositoryRootPath,
      rootUri,
      capabilities: buildClientCapabilities()
    };
  }

  private applyDiagnosticCapabilities(response: InitializeResponseLike): void {
    if (!isRecord(response.capabilities)) {
      return;
    }
    const capabilities = response.capabilities;
    const diagnosticProvider = capabilities.diagnosticProvider;
    if (diagnosticProvider && typeof diagnosticProvider === 'object') {
      Object.assign(diagnosticProvider, {
        interFileDependencies: true,
        workDoneProgress: true,
        workspaceDiagnostics: true
      });
    } else {
      capabilities.diagnosticProvider = {
        interFileDependencies: true,
        workDoneProgress: true,
        workspaceDiagnostics: true
      };
    }
  }

  private verifyCapabilities(capabilities: Record<string, unknown> | null): void {
    if (!capabilities) {
      throw new Error('C# language server initialization response is missing capabilities.');
    }

    const required = ['textDocumentSync', 'definitionProvider', 'referencesProvider', 'documentSymbolProvider'];
    const missing = required.filter((key) => !(key in capabilities));
    if (missing.length > 0) {
      throw new Error(
        `C# language server is missing required capabilities: ${missing.join(', ')}. Ensure Microsoft.CodeAnalysis.LanguageServer is installed.`
      );
    }
  }

  private openSolutionAndProjects(): void {
    const solutionFile = findSolutionOrProjectFile(this.repositoryRootPath, '.sln');
    if (solutionFile) {
      const solutionUri = pathToFileURL(solutionFile).href;
      this.handler.sendNotification('solution/open', { solution: solutionUri });
      this.logger.info(`Opened solution file: ${solutionFile}`);
    }

    const projectFiles = findAllProjectFiles(this.repositoryRootPath, '.csproj');
    if (projectFiles.length > 0) {
      const projectUris = projectFiles.map((project) => pathToFileURL(project).href);
      this.handler.sendNotification('project/open', { projects: projectUris });
      this.logger.debug(`Opened project files: ${projectFiles.join(', ')}`);
    }
  }
}

registerLanguageServer(Language.CSHARP, CSharpLanguageServer as SmartLanguageServerConstructor);

function ensureRuntimeAssets(options: {
  runtimeDir: string;
  logger: SmartEditLogger;
  overrides: RuntimeDependencyOverride[];
  dotnetRuntimeUrlOverride?: string | null;
}): { dotnetPath: string; languageServerPath: string } {
  const { runtimeDir, logger, overrides, dotnetRuntimeUrlOverride } = options;

  const dotnetDir = path.join(runtimeDir, 'dotnet-runtime-9.0');
  const languageServerDir = path.join(runtimeDir, 'language-server');

  const dotnetDependency = resolveDependency('DotNetRuntime', overrides);
  const languageDependency = resolveDependency('CSharpLanguageServer', overrides);

  const dotnetPath = ensureDotnetRuntime({
    logger,
    targetDir: dotnetDir,
    dependency: applyUrlOverride(dotnetDependency, dotnetRuntimeUrlOverride)
  });

  const languageServerPath = ensureLanguageServer({
    logger,
    targetDir: languageServerDir,
    dependency: languageDependency
  });

  return { dotnetPath, languageServerPath };
}

function ensureDotnetRuntime(options: {
  logger: SmartEditLogger;
  targetDir: string;
  dependency: RuntimeDependency;
}): string {
  const { logger, targetDir, dependency } = options;

  const systemDotnet = findDotnetRuntimeFromSystem(logger);
  if (systemDotnet) {
    return systemDotnet;
  }

  const binaryPath = path.join(targetDir, dependency.binaryName ?? inferDotnetBinaryName());
  if (fs.existsSync(binaryPath)) {
    return binaryPath;
  }

  if (process.env.SMART_EDIT_SKIP_RUNTIME_INSTALL === '1') {
    throw new Error(
      `dotnet runtime was not found at ${binaryPath}. Set SMART_EDIT_SKIP_RUNTIME_INSTALL=0 to allow downloads or place dotnet manually.`
    );
  }

  fs.mkdirSync(targetDir, { recursive: true });
  logger.info('Downloading .NET runtime for C# language server.');

  const collection = new RuntimeDependencyCollection([dependency]);
  collection.install(logger, targetDir);

  if (!fs.existsSync(binaryPath)) {
    throw new Error(`dotnet binary not found after installation (expected at ${binaryPath}).`);
  }

  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(binaryPath, 0o755);
    } catch {
      // best effort
    }
  }

  return binaryPath;
}

function ensureLanguageServer(options: {
  logger: SmartEditLogger;
  targetDir: string;
  dependency: RuntimeDependency;
}): string {
  const { logger, targetDir, dependency } = options;

  const version = dependency.packageVersion ?? 'unknown';
  const packageName = dependency.packageName ?? 'Microsoft.CodeAnalysis.LanguageServer';
  const installationDir = path.join(targetDir, `${packageName}.${version}`);
  const dllPath = path.join(installationDir, dependency.binaryName ?? 'Microsoft.CodeAnalysis.LanguageServer.dll');

  if (fs.existsSync(dllPath)) {
    return dllPath;
  }

  if (process.env.SMART_EDIT_SKIP_RUNTIME_INSTALL === '1') {
    throw new Error(
      `C# language server DLL not found at ${dllPath}. Allow downloads or place Microsoft.CodeAnalysis.LanguageServer manually.`
    );
  }

  fs.mkdirSync(targetDir, { recursive: true });

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-edit-csharp-ls-'));
  try {
    const extractDir = path.join(tempDir, 'extracted');
    fs.mkdirSync(extractDir, { recursive: true });

    const packagePath = downloadNugetPackage({
      logger,
      dependency,
      extractDir
    });

    copyDependencyPayload({
      dependency,
      packageRoot: packagePath,
      targetDir: installationDir
    });
  } finally {
    safeRemove(tempDir);
  }

  if (!fs.existsSync(dllPath)) {
    throw new Error(
      `Microsoft.CodeAnalysis.LanguageServer.dll not found after extraction (expected at ${dllPath}).`
    );
  }

  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(dllPath, 0o755);
    } catch {
      // ignore chmod errors
    }
  }

  return dllPath;
}

function downloadNugetPackage(options: {
  logger: SmartEditLogger;
  dependency: RuntimeDependency;
  extractDir: string;
}): string {
  const { logger, dependency, extractDir } = options;
  const packageName = dependency.packageName;
  const packageVersion = dependency.packageVersion;

  if (!packageName || !packageVersion) {
    throw new Error('C# language server dependency must specify packageName and packageVersion.');
  }

  const serviceIndex = downloadServiceIndex(logger);
  const baseAddress = findPackageBaseAddress(serviceIndex);
  const packageUrl = buildPackageUrl(baseAddress, packageName, packageVersion);

  const archivePath = path.join(extractDir, `${packageName}.${packageVersion}.nupkg`);
  downloadWithCurl(packageUrl, archivePath, logger);

  const packageRoot = path.join(extractDir, `${packageName}.${packageVersion}`);
  fs.mkdirSync(packageRoot, { recursive: true });
  extractZipArchive(archivePath, packageRoot);
  return packageRoot;
}

function downloadServiceIndex(logger: SmartEditLogger): unknown {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-edit-nuget-index-'));
  const indexPath = path.join(tempDir, 'index.json');
  try {
    downloadWithCurl(NUGET_SERVICE_INDEX, indexPath, logger);
    const data = fs.readFileSync(indexPath, 'utf-8');
    return JSON.parse(data);
  } finally {
    safeRemove(tempDir);
  }
}

function findPackageBaseAddress(serviceIndex: unknown): string {
  if (!serviceIndex || typeof serviceIndex !== 'object') {
    throw new Error('Invalid NuGet service index payload.');
  }
  const resources = (serviceIndex as { resources?: Record<string, unknown>[] }).resources;
  if (!Array.isArray(resources)) {
    throw new Error('NuGet service index is missing resources array.');
  }
  for (const entry of resources) {
    const baseAddress = entry?.['@id'];
    if (entry?.['@type'] === 'PackageBaseAddress/3.0.0' && typeof baseAddress === 'string') {
      return baseAddress;
    }
  }
  throw new Error('Failed to locate NuGet PackageBaseAddress in service index.');
}

function buildPackageUrl(baseAddress: string, packageName: string, packageVersion: string): string {
  const lowerName = packageName.toLowerCase();
  const lowerVersion = packageVersion.toLowerCase();
  return `${baseAddress.replace(/\/?$/, '/')}${lowerName}/${lowerVersion}/${lowerName}.${lowerVersion}.nupkg`;
}

function copyDependencyPayload(options: {
  dependency: RuntimeDependency;
  packageRoot: string;
  targetDir: string;
}): void {
  const { dependency, packageRoot, targetDir } = options;
  const extractPath = dependency.extractPath ?? 'lib/net9.0';

  const primaryPath = path.join(packageRoot, extractPath);
  const fallbackLocations = [
    path.join(packageRoot, 'tools', 'net9.0', 'any'),
    path.join(packageRoot, 'lib', 'net9.0'),
    path.join(packageRoot, 'contentFiles', 'any', 'net9.0')
  ];

  const candidates = [primaryPath, ...fallbackLocations];
  const existing = candidates.find((candidate) => fs.existsSync(candidate));
  if (!existing) {
    throw new Error(`Could not locate language server payload inside ${packageRoot}.`);
  }

  fs.mkdirSync(targetDir, { recursive: true });
  copyDirectory(existing, targetDir);
}

function mergeIgnoredDirectories(existing: string[] | undefined): string[] {
  const set = new Set(existing ?? []);
  for (const entry of CSHARP_IGNORED_DIRECTORIES) {
    set.add(entry);
    set.add(`**/${entry}`);
  }
  return Array.from(set);
}

function resolveRuntimeDirectory(settings: SmartLspSettings): string {
  const dir = path.join(settings.languageServersStaticDir, 'csharp');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function normalizeLanguageSettings(raw: unknown): CSharpLanguageServerSettings {
  if (!raw || typeof raw !== 'object') {
    return {};
  }

  const settings = raw as Record<string, unknown>;
  const runtimeOverrides: RuntimeDependencyOverride[] = [];
  const maybeOverrides = settings.runtime_dependencies;

  if (Array.isArray(maybeOverrides)) {
    for (const entry of maybeOverrides) {
      if (entry && typeof entry === 'object') {
        runtimeOverrides.push(entry as RuntimeDependencyOverride);
      }
    }
  }

  return {
    runtime_dependencies: runtimeOverrides,
    dotnet_runtime_url: typeof settings.dotnet_runtime_url === 'string' ? settings.dotnet_runtime_url : undefined
  };
}

function resolveDependency(id: string, overrides: RuntimeDependencyOverride[]): RuntimeDependency {
  const platform = currentPlatformId();
  const candidates = RUNTIME_DEPENDENCIES.filter((entry) => entry.id === id && matchesPlatform(entry.platformId, platform));

  if (candidates.length === 0) {
    throw new Error(`No runtime dependency found for ${id} on platform ${platform ?? 'unknown'}.`);
  }

  const base = { ...candidates[0] };
  const override = overrides.find((entry) => entry.id === id && matchesPlatform(entry.platformId, platform));
  return override ? { ...base, ...override } : base;
}

function matchesPlatform(candidate: string | null | undefined, platform: string | null): boolean {
  if (!candidate || candidate === 'any' || candidate === 'platform-agnostic') {
    return true;
  }
  if (!platform) {
    return false;
  }
  return candidate.toLowerCase() === platform.toLowerCase();
}

function currentPlatformId(): string | null {
  if (process.platform === 'win32') {
    return process.arch === 'arm64' ? 'win-arm64' : 'win-x64';
  }
  if (process.platform === 'darwin') {
    return process.arch === 'arm64' ? 'osx-arm64' : 'osx-x64';
  }
  if (process.platform === 'linux') {
    if (process.arch === 'arm64') {
      return 'linux-arm64';
    }
    return 'linux-x64';
  }
  return null;
}

function findDotnetRuntimeFromSystem(logger: SmartEditLogger): string | null {
  const dotnetPath = whichBinary('dotnet');
  if (!dotnetPath) {
    return null;
  }

  const result = spawnSync(
    dotnetPath,
    ['--list-runtimes'],
    ensureDefaultSubprocessOptions({ encoding: 'utf-8' })
  );
  if (result.status === 0 && typeof result.stdout === 'string' && result.stdout.includes('Microsoft.NETCore.App 9.')) {
    logger.info('Found system .NET 9 runtime.');
    return dotnetPath;
  }

  return null;
}

function whichBinary(command: string): string | null {
  const locator = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(locator, [command], ensureDefaultSubprocessOptions({ encoding: 'utf-8' }));
  if (result.status === 0 && typeof result.stdout === 'string') {
    const [first] = result.stdout.split(/\r?\n/);
    if (first && first.trim().length > 0) {
      return first.trim();
    }
  }
  return null;
}

function inferDotnetBinaryName(): string {
  return process.platform === 'win32' ? 'dotnet.exe' : 'dotnet';
}

function buildCommand(dotnetPath: string, languageServerPath: string, logDir: string): string[] {
  return [
    dotnetPath,
    languageServerPath,
    '--logLevel=Information',
    `--extensionLogDirectory=${quoteForArgument(logDir)}`,
    '--stdio'
  ];
}

function extractLogMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const value = (payload as { message?: unknown }).message;
  return typeof value === 'string' ? value : null;
}

function downloadWithCurl(url: string, destination: string, logger: SmartEditLogger): void {
  logger.info(`Downloading ${url}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const args = ['-L', url, '-o', destination];
  const result = spawnSync('curl', args, ensureDefaultSubprocessOptions({ stdio: 'inherit' }));
  if (result.status === 0) {
    return;
  }

  if (process.platform !== 'win32') {
    const wget = spawnSync(
      'wget',
      ['-O', destination, url],
      ensureDefaultSubprocessOptions({ stdio: 'inherit' })
    );
    if (wget.status === 0) {
      return;
    }
  } else {
    const ps = spawnSync(
      'powershell',
      [
        '-NoLogo',
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `Invoke-WebRequest -Uri ${JSON.stringify(url)} -OutFile ${JSON.stringify(destination)} -UseBasicParsing`
      ],
      ensureDefaultSubprocessOptions({ stdio: 'inherit' })
    );
    if (ps.status === 0) {
      return;
    }
  }

  throw new Error(`Failed to download ${url}. Ensure curl, wget, or PowerShell is available.`);
}

function extractZipArchive(archivePath: string, targetDir: string): void {
  const extractor = new SafeZipExtractor(archivePath, targetDir, { verbose: false });
  extractor.extractAll();
}

function copyDirectory(source: string, destination: string): void {
  fs.mkdirSync(destination, { recursive: true });
  const entries = fs.readdirSync(source, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, destinationPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(sourcePath, destinationPath);
      if (process.platform !== 'win32') {
        try {
          fs.chmodSync(destinationPath, 0o755);
        } catch {
          // ignore chmod failures
        }
      }
    }
  }
}

function safeRemove(targetPath: string): void {
  try {
    fs.rmSync(targetPath, { recursive: true, force: true });
  } catch {
    // best effort cleanup
  }
}

function buildClientCapabilities(): Record<string, unknown> {
  const valueSet = Array.from({ length: 27 }, (_, index) => index + 1);
  return {
    window: {
      workDoneProgress: true,
      showMessage: { messageActionItem: { additionalPropertiesSupport: true } },
      showDocument: { support: true }
    },
    workspace: {
      applyEdit: true,
      workspaceEdit: { documentChanges: true },
      didChangeConfiguration: { dynamicRegistration: true },
      didChangeWatchedFiles: { dynamicRegistration: true },
      symbol: {
        dynamicRegistration: true,
        symbolKind: { valueSet }
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
        hierarchicalDocumentSymbolSupport: true,
        symbolKind: { valueSet }
      }
    }
  };
}

function findSolutionOrProjectFile(rootDir: string, extension: string): string | null {
  for (const candidate of breadthFirstFileScan(rootDir)) {
    if (candidate.toLowerCase().endsWith(extension.toLowerCase())) {
      return candidate;
    }
  }
  return null;
}

function findAllProjectFiles(rootDir: string, extension: string): string[] {
  const results: string[] = [];
  for (const candidate of breadthFirstFileScan(rootDir)) {
    if (candidate.toLowerCase().endsWith(extension.toLowerCase())) {
      results.push(candidate);
    }
  }
  return results;
}

function* breadthFirstFileScan(rootDir: string): Generator<string> {
  const queue: string[] = [rootDir];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) {
      continue;
    }
    visited.add(current);

    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) {
        continue;
      }

      const candidatePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(candidatePath);
      } else if (entry.isFile()) {
        yield candidatePath;
      }
    }
  }
}

function applyUrlOverride(dep: RuntimeDependency, overrideUrl?: string | null): RuntimeDependency {
  if (!overrideUrl) {
    return dep;
  }
  return { ...dep, url: overrideUrl };
}

function quoteForArgument(value: string): string {
  if (/\s/.test(value)) {
    return `"${value}"`;
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
