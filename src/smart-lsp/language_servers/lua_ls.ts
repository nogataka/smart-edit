import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { createSmartEditLogger, type LogLevel } from '../../smart-edit/util/logging.js';
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
import {
  RuntimeDependencyCollection,
  type RuntimeDependency,
  quoteWindowsPath
} from './common.js';

const LUA_LS_VERSION = '3.15.0';

const LUA_LS_DEPENDENCIES: RuntimeDependency[] = [
  {
    id: 'lua-language-server',
    platformId: 'linux-x64',
    url: `https://github.com/LuaLS/lua-language-server/releases/download/${LUA_LS_VERSION}/lua-language-server-${LUA_LS_VERSION}-linux-x64.tar.gz`,
    archiveType: 'tar',
    binaryName: `lua-language-server-${LUA_LS_VERSION}-linux-x64/bin/lua-language-server`
  },
  {
    id: 'lua-language-server',
    platformId: 'linux-arm64',
    url: `https://github.com/LuaLS/lua-language-server/releases/download/${LUA_LS_VERSION}/lua-language-server-${LUA_LS_VERSION}-linux-arm64.tar.gz`,
    archiveType: 'tar',
    binaryName: `lua-language-server-${LUA_LS_VERSION}-linux-arm64/bin/lua-language-server`
  },
  {
    id: 'lua-language-server',
    platformId: 'osx-x64',
    url: `https://github.com/LuaLS/lua-language-server/releases/download/${LUA_LS_VERSION}/lua-language-server-${LUA_LS_VERSION}-darwin-x64.tar.gz`,
    archiveType: 'tar',
    binaryName: `lua-language-server-${LUA_LS_VERSION}-darwin-x64/bin/lua-language-server`
  },
  {
    id: 'lua-language-server',
    platformId: 'osx-arm64',
    url: `https://github.com/LuaLS/lua-language-server/releases/download/${LUA_LS_VERSION}/lua-language-server-${LUA_LS_VERSION}-darwin-arm64.tar.gz`,
    archiveType: 'tar',
    binaryName: `lua-language-server-${LUA_LS_VERSION}-darwin-arm64/bin/lua-language-server`
  },
  {
    id: 'lua-language-server',
    platformId: 'win-x64',
    url: `https://github.com/LuaLS/lua-language-server/releases/download/${LUA_LS_VERSION}/lua-language-server-${LUA_LS_VERSION}-win32-x64.zip`,
    archiveType: 'zip',
    binaryName: `lua-language-server-${LUA_LS_VERSION}-win32-x64/bin/lua-language-server.exe`
  }
];

const LUA_IGNORED_DIRECTORIES = ['.luarocks', 'lua_modules', 'node_modules', 'build', 'dist', '.cache'];

interface InitializeResponseLike {
  capabilities?: Record<string, unknown> | null;
}

interface TextDocumentCapabilitiesLike {
  textDocumentSync?: unknown;
  definitionProvider?: unknown;
  documentSymbolProvider?: unknown;
  referencesProvider?: unknown;
}

export class LuaLanguageServer extends SmartLanguageServer {
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
      ignoredPaths: mergeIgnoredPaths(config.ignoredPaths, LUA_IGNORED_DIRECTORIES)
    };

    const solidSettings = new SmartLspSettings(options?.smartLspSettings);
    const runtimeDir = resolveRuntimeDirectory(solidSettings);
    const dependencies = new RuntimeDependencyCollection(LUA_LS_DEPENDENCIES);
    const binaryPath = ensureLuaLanguageServerBinary(runtimeDir, dependencies, loggerLike?.level);

    const handler = new NodeLanguageServerHandler({
      cmd: quoteWindowsPath(binaryPath),
      cwd: repositoryRootPath
    });

    super(augmentedConfig, loggerLike, repositoryRootPath, {
      ...options,
      handler,
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
    this.handlerInstance.onNotification('window/logMessage', (payload: unknown) => {
      const message = extractWindowMessage(payload);
      if (message) {
        this.logger.info(`lua-language-server: ${message}`);
      }
    });
    this.handlerInstance.onNotification('$/progress', noop);
    this.handlerInstance.onNotification('textDocument/publishDiagnostics', noop);
  }

  private initializeLanguageServer(): void {
    const params = this.buildInitializeParams();
    const response = this.handlerInstance.sendRequest('initialize', params) as InitializeResponseLike | null;
    this.verifyCapabilities(response?.capabilities ?? null);
    this.handlerInstance.notify.initialized({});
  }

  private buildInitializeParams(): Record<string, unknown> {
    const rootUri = pathToFileURL(this.repositoryRootPath).href;
    return {
      processId: process.pid,
      locale: 'en',
      rootPath: this.repositoryRootPath,
      rootUri,
      capabilities: buildClientCapabilities(),
      initializationOptions: buildInitializationOptions(),
      workspaceFolders: [
        {
          uri: rootUri,
          name: path.basename(this.repositoryRootPath)
        }
      ]
    } satisfies Record<string, unknown>;
  }

  private verifyCapabilities(capabilities: Record<string, unknown> | null): void {
    if (!capabilities) {
      throw new Error('Lua language server initialize response is missing capabilities.');
    }

    const textDocumentCaps = capabilities as TextDocumentCapabilitiesLike;
    if (!('textDocumentSync' in textDocumentCaps)) {
      throw new Error('Lua language server did not advertise textDocumentSync capability.');
    }
    if (!('definitionProvider' in textDocumentCaps)) {
      throw new Error('Lua language server did not advertise definitionProvider capability.');
    }
    if (!('documentSymbolProvider' in textDocumentCaps)) {
      throw new Error('Lua language server did not advertise documentSymbolProvider capability.');
    }
    if (!('referencesProvider' in textDocumentCaps)) {
      throw new Error('Lua language server did not advertise referencesProvider capability.');
    }
  }
}

function mergeIgnoredPaths(existing: string[] | undefined, additions: string[]): string[] {
  const merged = new Set(existing ?? []);
  for (const entry of additions) {
    merged.add(entry);
  }
  return Array.from(merged);
}

function resolveRuntimeDirectory(settings: SmartLspSettings): string {
  const runtimeDir = path.join(settings.languageServersStaticDir, 'lua-language-server');
  fs.mkdirSync(runtimeDir, { recursive: true });
  return runtimeDir;
}

function ensureLuaLanguageServerBinary(
  runtimeDir: string,
  dependencies: RuntimeDependencyCollection,
  loggerLevel?: LogLevel | number
): string {
  const overridePath = process.env.SMART_EDIT_LUA_LS_PATH;
  if (overridePath && fs.existsSync(overridePath)) {
    return overridePath;
  }

  const fromPath = whichBinary(process.platform === 'win32' ? 'lua-language-server.exe' : 'lua-language-server');
  if (fromPath && fs.existsSync(fromPath)) {
    return fromPath;
  }

  const known = locateInKnownLocations(runtimeDir);
  if (known) {
    return known;
  }

  const maybeInstalled = locateInstalledBinary(runtimeDir, dependencies);
  if (maybeInstalled) {
    return maybeInstalled;
  }

  if (process.env.SMART_EDIT_SKIP_RUNTIME_INSTALL === '1') {
    throw new Error(
      'lua-language-server binary not found. Allow downloads by unsetting SMART_EDIT_SKIP_RUNTIME_INSTALL or set SMART_EDIT_LUA_LS_PATH.'
    );
  }

  const { logger } = createSmartEditLogger({
    name: 'smart-lsp.language_servers.lua',
    emitToConsole: false,
    level: loggerLevel === undefined ? undefined : coerceLogLevel(loggerLevel)
  });

  logger.info('Downloading lua-language-server runtime dependency.');
  dependencies.install(logger, runtimeDir);

  const installed = locateInstalledBinary(runtimeDir, dependencies);
  if (!installed) {
    throw new Error('Failed to locate lua-language-server binary after installation.');
  }

  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(installed, 0o755);
    } catch {
      // ignore chmod failures
    }
  }

  return installed;
}

function whichBinary(command: string): string | null {
  const locator = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(locator, [command], ensureDefaultSubprocessOptions({ encoding: 'utf-8' }));
  if (result.status === 0 && result.stdout) {
    const [firstLine] = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return firstLine ?? null;
  }
  return null;
}

function locateInKnownLocations(runtimeDir: string): string | null {
  const home = os.homedir();
  const executableName = process.platform === 'win32' ? 'lua-language-server.exe' : 'lua-language-server';
  const candidates = [
    path.join(runtimeDir, executableName),
    path.join(runtimeDir, 'bin', executableName),
    path.join(home, '.local', 'bin', executableName),
    path.join(home, '.smart-edit', 'language_servers', 'lua', 'bin', executableName),
    path.join('/usr/local/bin', executableName),
    path.join('/opt/lua-language-server', 'bin', executableName)
  ];

  if (process.platform === 'win32') {
    candidates.push(
      path.join(home, 'AppData', 'Local', 'lua-language-server', 'bin', 'lua-language-server.exe'),
      path.join(home, '.smart-edit', 'language_servers', 'lua', 'bin', 'lua-language-server.exe')
    );
  }

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function locateInstalledBinary(runtimeDir: string, dependencies: RuntimeDependencyCollection): string | null {
  const dep = dependencies.getSingleDepForCurrentPlatform();
  const executableName = process.platform === 'win32' ? 'lua-language-server.exe' : 'lua-language-server';
  const candidates = new Set<string>();

  if (dep.binaryName) {
    candidates.add(path.join(runtimeDir, dep.binaryName));
  }

  candidates.add(path.join(runtimeDir, 'lua-language-server', 'bin', executableName));
  candidates.add(path.join(runtimeDir, 'bin', executableName));
  candidates.add(path.join(runtimeDir, executableName));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
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
      definition: { dynamicRegistration: true },
      references: { dynamicRegistration: true },
      documentSymbol: {
        dynamicRegistration: true,
        hierarchicalDocumentSymbolSupport: true,
        symbolKind: { valueSet: symbolKinds }
      },
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
      }
    },
    workspace: {
      workspaceFolders: true,
      didChangeConfiguration: { dynamicRegistration: true },
      configuration: true,
      symbol: {
        dynamicRegistration: true,
        symbolKind: { valueSet: symbolKinds }
      }
    }
  } satisfies Record<string, unknown>;
}

function buildInitializationOptions(): Record<string, unknown> {
  return {
    runtime: {
      version: 'Lua 5.4',
      path: ['?.lua', '?/init.lua']
    },
    diagnostics: {
      enable: true,
      globals: ['vim', 'describe', 'it', 'before_each', 'after_each']
    },
    workspace: {
      library: [],
      checkThirdParty: false,
      userThirdParty: []
    },
    telemetry: {
      enable: false
    },
    completion: {
      enable: true,
      callSnippet: 'Both',
      keywordSnippet: 'Both'
    }
  } satisfies Record<string, unknown>;
}

registerLanguageServer(Language.LUA, LuaLanguageServer as SmartLanguageServerConstructor);
