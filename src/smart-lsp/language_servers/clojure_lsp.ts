import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { createSmartEditLogger, type LogLevel } from '../../smart-edit/util/logging.js';
import { Language } from '../ls_config.js';
import { ensureDefaultSubprocessOptions } from '../util/subprocess_util.js';
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

const CLOJURE_LSP_RELEASES = 'https://github.com/clojure-lsp/clojure-lsp/releases/latest/download';

const CLOJURE_DEPENDENCIES: RuntimeDependency[] = [
  {
    id: 'clojure-lsp',
    url: `${CLOJURE_LSP_RELEASES}/clojure-lsp-native-macos-aarch64.zip`,
    platformId: 'osx-arm64',
    archiveType: 'zip',
    binaryName: 'clojure-lsp'
  },
  {
    id: 'clojure-lsp',
    url: `${CLOJURE_LSP_RELEASES}/clojure-lsp-native-macos-amd64.zip`,
    platformId: 'osx-x64',
    archiveType: 'zip',
    binaryName: 'clojure-lsp'
  },
  {
    id: 'clojure-lsp',
    url: `${CLOJURE_LSP_RELEASES}/clojure-lsp-native-linux-aarch64.zip`,
    platformId: 'linux-arm64',
    archiveType: 'zip',
    binaryName: 'clojure-lsp'
  },
  {
    id: 'clojure-lsp',
    url: `${CLOJURE_LSP_RELEASES}/clojure-lsp-native-linux-amd64.zip`,
    platformId: 'linux-x64',
    archiveType: 'zip',
    binaryName: 'clojure-lsp'
  },
  {
    id: 'clojure-lsp',
    url: `${CLOJURE_LSP_RELEASES}/clojure-lsp-native-windows-amd64.zip`,
    platformId: 'win-x64',
    archiveType: 'zip',
    binaryName: 'clojure-lsp.exe'
  }
];

function verifyClojureCli(): void {
  if (process.env.SMART_EDIT_ASSUME_CLOJURE === '1') {
    return;
  }

  const whichCmd = process.platform === 'win32' ? 'where' : 'which';
  const clojureExists = spawnSync(
    whichCmd,
    ['clojure'],
    ensureDefaultSubprocessOptions({ stdio: 'ignore' })
  ).status === 0;
  if (!clojureExists) {
    throw new Error(
      '`clojure` CLI was not found in PATH. Please install the official Clojure CLI from https://clojure.org/guides/getting_started'
    );
  }

  const helpResult = spawnSync('clojure', ['--help'], ensureDefaultSubprocessOptions({ encoding: 'utf-8' }));
  if (helpResult.status !== 0 || !helpResult.stdout.includes('-Aaliases')) {
    throw new Error('Detected a `clojure` executable, but it does not appear to be the official CLI (missing -Aaliases support).');
  }

  const spathResult = spawnSync('clojure', ['-Spath'], ensureDefaultSubprocessOptions({}));
  if (spathResult.status !== 0) {
    throw new Error('`clojure -Spath` failed; ensure you are using Clojure CLI 1.10 or newer.');
  }
}

function resolveRuntimeDirectory(settings: SmartLspSettings): string {
  const dir = path.join(settings.languageServersStaticDir, 'clojure-lsp');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function ensureBinary(runtimeDir: string, dependencies: RuntimeDependencyCollection, loggerLevel?: LogLevel | number): string {
  const { logger } = createSmartEditLogger({
    name: 'smart-lsp.language_servers.clojure',
    emitToConsole: false,
    level: loggerLevel === undefined ? undefined : coerceLogLevel(loggerLevel)
  });

  const binaryPath = dependencies.binaryPath(runtimeDir);
  if (!fs.existsSync(binaryPath)) {
    if (process.env.SMART_EDIT_SKIP_RUNTIME_INSTALL === '1') {
      throw new Error(`clojure-lsp binary not found at ${binaryPath}. Allow downloads or install clojure-lsp manually.`);
    }

    logger.info('Downloading clojure-lsp runtime dependency.');
    dependencies.install(logger, runtimeDir);

    if (!fs.existsSync(binaryPath)) {
      throw new Error(`Failed to install clojure-lsp runtime dependency (expected binary at ${binaryPath}).`);
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

export class ClojureLanguageServer extends SmartLanguageServer {
  protected override readonly handler: NodeLanguageServerHandler;

  constructor(
    config: LanguageServerConfigLike,
    loggerLike: { level?: number | LogLevel } | null,
    repositoryRootPath: string,
    options: { timeout?: number | null; smartLspSettings?: SmartLspSettingsInit } = {}
  ) {
    verifyClojureCli();

    const solidSettings = new SmartLspSettings(options?.smartLspSettings);
    const runtimeDir = resolveRuntimeDirectory(solidSettings);
    const dependencies = new RuntimeDependencyCollection(CLOJURE_DEPENDENCIES);
    const binaryPath = ensureBinary(runtimeDir, dependencies, loggerLike?.level);

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
    this.registerHandlers();
  }

  private registerHandlers(): void {
    const noop = () => undefined;
    this.handler.onNotification('window/logMessage', (payload) => {
      if (payload && typeof payload === 'object' && 'message' in (payload as Record<string, unknown>)) {
        this.logger.info(`clojure-lsp: ${(payload as { message?: string }).message ?? ''}`);
      }
    });
    this.handler.onNotification('$/progress', noop);
    this.handler.onNotification('textDocument/publishDiagnostics', noop);
    this.handler.onNotification('language/actionableNotification', noop);
    this.handler.onNotification('experimental/serverStatus', (payload) => {
      if (payload && typeof payload === 'object' && (payload as { quiescent?: boolean }).quiescent) {
        this.logger.debug('clojure-lsp reported quiescent=true');
      }
    });
    this.handler.onRequest('client/registerCapability', noop);
    this.handler.onRequest('workspace/executeClientCommand', () => []);
  }
}

registerLanguageServer(Language.CLOJURE, ClojureLanguageServer as SmartLanguageServerConstructor);
