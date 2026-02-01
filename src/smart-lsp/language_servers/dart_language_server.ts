import fs from 'node:fs';
import path from 'node:path';

import { createSmartEditLogger, type LogLevel } from '../../smart-edit/util/logging.js';
import { Language } from '../ls_config.js';
import {
  SmartLanguageServer,
  SmartLspSettings,
  type LanguageServerConfigLike,
  type SmartLanguageServerOptions,
  coerceLogLevel,
  type SmartLanguageServerConstructor,
  registerLanguageServer
} from '../ls.js';
import { NodeLanguageServerHandler } from '../ls_handler.js';
import { RuntimeDependencyCollection, type RuntimeDependency, quoteWindowsPath } from './common.js';

const DART_DEPENDENCIES: RuntimeDependency[] = [
  {
    id: 'dart-sdk',
    description: 'Dart SDK for Linux (x64)',
    url: 'https://storage.googleapis.com/dart-archive/channels/stable/release/3.10.4/sdk/dartsdk-linux-x64-release.zip',
    platformId: 'linux-x64',
    archiveType: 'zip',
    binaryName: 'dart-sdk/bin/dart'
  },
  {
    id: 'dart-sdk',
    description: 'Dart SDK for Windows (x64)',
    url: 'https://storage.googleapis.com/dart-archive/channels/stable/release/3.10.4/sdk/dartsdk-windows-x64-release.zip',
    platformId: 'win-x64',
    archiveType: 'zip',
    binaryName: 'dart-sdk/bin/dart.exe'
  },
  {
    id: 'dart-sdk',
    description: 'Dart SDK for Windows (arm64)',
    url: 'https://storage.googleapis.com/dart-archive/channels/stable/release/3.10.4/sdk/dartsdk-windows-arm64-release.zip',
    platformId: 'win-arm64',
    archiveType: 'zip',
    binaryName: 'dart-sdk/bin/dart.exe'
  },
  {
    id: 'dart-sdk',
    description: 'Dart SDK for macOS (x64)',
    url: 'https://storage.googleapis.com/dart-archive/channels/stable/release/3.10.4/sdk/dartsdk-macos-x64-release.zip',
    platformId: 'osx-x64',
    archiveType: 'zip',
    binaryName: 'dart-sdk/bin/dart'
  },
  {
    id: 'dart-sdk',
    description: 'Dart SDK for macOS (arm64)',
    url: 'https://storage.googleapis.com/dart-archive/channels/stable/release/3.10.4/sdk/dartsdk-macos-arm64-release.zip',
    platformId: 'osx-arm64',
    archiveType: 'zip',
    binaryName: 'dart-sdk/bin/dart'
  }
];

function resolveRuntimeDirectory(settings: SmartLspSettings): string {
  const dir = path.join(settings.languageServersStaticDir, 'dart-sdk');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function ensureDartBinary(runtimeDir: string, dependencies: RuntimeDependencyCollection, loggerLevel?: LogLevel | number): string {
  const { logger } = createSmartEditLogger({
    name: 'smart-lsp.language_servers.dart',
    emitToConsole: false,
    level: loggerLevel === undefined ? undefined : coerceLogLevel(loggerLevel)
  });

  const binaryPath = dependencies.binaryPath(runtimeDir);
  if (!fs.existsSync(binaryPath)) {
    if (process.env.SMART_EDIT_SKIP_RUNTIME_INSTALL === '1') {
      throw new Error(`Dart SDK binary not found at ${binaryPath}. Allow runtime downloads or install Dart manually.`);
    }

    logger.info('Downloading Dart SDK runtime dependency.');
    dependencies.install(logger, runtimeDir);

    if (!fs.existsSync(binaryPath)) {
      throw new Error(`Failed to install Dart SDK runtime dependency (expected binary at ${binaryPath}).`);
    }
  }

  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(binaryPath, 0o755);
    } catch {
      // ignore
    }
  }

  return binaryPath;
}

export class DartLanguageServer extends SmartLanguageServer {
  protected override readonly handler: NodeLanguageServerHandler;

  constructor(
    config: LanguageServerConfigLike,
    loggerLike: { level?: number | LogLevel } | null,
    repositoryRootPath: string,
    options: SmartLanguageServerOptions = {}
  ) {
    const solidSettings = new SmartLspSettings(options?.smartLspSettings);
    const runtimeDir = resolveRuntimeDirectory(solidSettings);
    const dependencies = new RuntimeDependencyCollection(DART_DEPENDENCIES);
    const binaryPath = ensureDartBinary(runtimeDir, dependencies, loggerLike?.level);

    const command = `${quoteWindowsPath(binaryPath)} language-server --client-id multilspy.dart --client-version 1.2`;
    const providedHandler = options.handler;
    if (providedHandler && !(providedHandler instanceof NodeLanguageServerHandler)) {
      throw new TypeError('DartLanguageServer requires a NodeLanguageServerHandler when supplying a custom handler.');
    }
    const handler = providedHandler ?? new NodeLanguageServerHandler({
      cmd: command,
      cwd: repositoryRootPath
    });

    super(config, loggerLike, repositoryRootPath, {
      ...options,
      handler,
      smartLspSettings: options?.smartLspSettings
    });

    this.handler = handler;
    this.registerHandlers();
  }

  private registerHandlers(): void {
    const noop = () => undefined;
    this.handler.onNotification('window/logMessage', (payload) => {
      if (payload && typeof payload === 'object' && 'message' in (payload as Record<string, unknown>)) {
        this.logger.info(`dart-language-server: ${(payload as { message?: string }).message ?? ''}`);
      }
    });
    this.handler.onNotification('$/progress', noop);
    this.handler.onNotification('textDocument/publishDiagnostics', noop);
    this.handler.onNotification('language/status', noop);
    this.handler.onNotification('language/actionableNotification', noop);
    this.handler.onNotification('experimental/serverStatus', noop);
    this.handler.onRequest('client/registerCapability', noop);
    this.handler.onRequest('workspace/executeClientCommand', () => []);
  }
}

registerLanguageServer(Language.DART, DartLanguageServer as SmartLanguageServerConstructor);
