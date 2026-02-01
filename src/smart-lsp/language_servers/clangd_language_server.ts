import fs from 'node:fs';
import path from 'node:path';

import { createSmartEditLogger, type LogLevel } from '../../smart-edit/util/logging.js';
import { Language } from '../ls_config.js';
import {
  SmartLanguageServer,
  SmartLspSettings,
  type LanguageServerConfigLike,
  type SmartLspSettingsInit,
  type SmartLanguageServerConstructor,
  registerLanguageServer,
  coerceLogLevel
} from '../ls.js';
import { NodeLanguageServerHandler } from '../ls_handler.js';
import { RuntimeDependencyCollection, type RuntimeDependency, quoteWindowsPath } from './common.js';

const CLANGD_DEPENDENCIES: RuntimeDependency[] = [
  {
    id: 'clangd',
    description: 'Clangd for Linux (x64)',
    url: 'https://github.com/clangd/clangd/releases/download/19.1.2/clangd-linux-19.1.2.zip',
    platformId: 'linux-x64',
    archiveType: 'zip',
    binaryName: 'clangd_19.1.2/bin/clangd'
  },
  {
    id: 'clangd',
    description: 'Clangd for Windows (x64)',
    url: 'https://github.com/clangd/clangd/releases/download/19.1.2/clangd-windows-19.1.2.zip',
    platformId: 'win-x64',
    archiveType: 'zip',
    binaryName: 'clangd_19.1.2/bin/clangd.exe'
  },
  {
    id: 'clangd',
    description: 'Clangd for macOS (x64)',
    url: 'https://github.com/clangd/clangd/releases/download/19.1.2/clangd-mac-19.1.2.zip',
    platformId: 'osx-x64',
    archiveType: 'zip',
    binaryName: 'clangd_19.1.2/bin/clangd'
  },
  {
    id: 'clangd',
    description: 'Clangd for macOS (arm64)',
    url: 'https://github.com/clangd/clangd/releases/download/19.1.2/clangd-mac-19.1.2.zip',
    platformId: 'osx-arm64',
    archiveType: 'zip',
    binaryName: 'clangd_19.1.2/bin/clangd'
  }
];

function resolveRuntimeDirectory(settings: SmartLspSettings): string {
  const dir = path.join(settings.languageServersStaticDir, 'clangd');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function ensureClangdBinary(runtimeDir: string, dependencies: RuntimeDependencyCollection, loggerLevel?: LogLevel | number): string {
  const { logger } = createSmartEditLogger({
    name: 'smart-lsp.language_servers.clangd',
    emitToConsole: false,
    level: loggerLevel === undefined ? undefined : coerceLogLevel(loggerLevel)
  });

  const binaryPath = dependencies.binaryPath(runtimeDir);
  if (!fs.existsSync(binaryPath)) {
    if (process.env.SMART_EDIT_SKIP_RUNTIME_INSTALL === '1') {
      throw new Error(`clangd executable not found at ${binaryPath}. Set SMART_EDIT_SKIP_RUNTIME_INSTALL=0 to allow downloads.`);
    }

    const dep = dependencies.getSingleDepForCurrentPlatform();
    logger.info(`Downloading clangd runtime dependency from ${dep.url}`);
    dependencies.install(logger, runtimeDir);

    if (!fs.existsSync(binaryPath)) {
      throw new Error(
        `clangd executable not found after installation (expected at ${binaryPath}). Please install clangd manually from https://clangd.llvm.org/installation.`
      );
    }
  }

  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(binaryPath, 0o755);
    } catch {
      // ignore chmod failures
    }
  }

  return binaryPath;
}

export class ClangdLanguageServer extends SmartLanguageServer {
  protected override readonly handler: NodeLanguageServerHandler;

  constructor(
    config: LanguageServerConfigLike,
    loggerLike: { level?: number | LogLevel } | null,
    repositoryRootPath: string,
    options: {
      timeout?: number | null;
      smartLspSettings?: SmartLspSettingsInit;
    } = {}
  ) {
    const solidSettings = new SmartLspSettings(options?.smartLspSettings);
    const runtimeDir = resolveRuntimeDirectory(solidSettings);
    const dependencies = new RuntimeDependencyCollection(CLANGD_DEPENDENCIES);
    const binaryPath = ensureClangdBinary(runtimeDir, dependencies, loggerLike?.level);

    const handler = new NodeLanguageServerHandler({
      cmd: quoteWindowsPath(binaryPath),
      cwd: repositoryRootPath
    });

    super(config, loggerLike, repositoryRootPath, {
      ...options,
      handler,
      smartLspSettings: options?.smartLspSettings
    });

    this.handler = handler;
    this.registerDefaultHandlers();
  }

  private registerDefaultHandlers(): void {
    const noop = () => undefined;
    this.handler.onNotification('$/progress', noop);
    this.handler.onNotification('textDocument/publishDiagnostics', noop);
    this.handler.onNotification('language/actionableNotification', noop);
    this.handler.onNotification('experimental/serverStatus', noop);
    this.handler.onNotification('window/logMessage', (payload) => {
      const message = typeof payload === 'object' && payload !== null ? (payload as { message?: unknown }).message : null;
      if (typeof message === 'string' && message.trim().length > 0) {
        this.logger.info(`clangd: ${message}`);
      }
    });
    this.handler.onRequest('client/registerCapability', noop);
    this.handler.onRequest('workspace/executeClientCommand', () => []);
  }
}

registerLanguageServer(Language.CPP, ClangdLanguageServer as SmartLanguageServerConstructor);
