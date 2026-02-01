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
  type SmartLanguageServerConstructor,
  type SmartLspSettingsInit,
  registerLanguageServer,
  coerceLogLevel
} from '../ls.js';
import { NodeLanguageServerHandler } from '../ls_handler.js';
import { RuntimeDependencyCollection, type RuntimeDependency, quoteWindowsPath } from './common.js';

const VTS_DEPENDENCIES: RuntimeDependency[] = [
  {
    id: 'vtsls',
    command: 'npm install --prefix ./ @vtsls/language-server@0.3.0',
    platformId: 'any'
  }
];

function commandExists(command: string): boolean {
  const locator = process.platform === 'win32' ? 'where' : 'which';
  return spawnSync(locator, [command], ensureDefaultSubprocessOptions({ stdio: 'ignore' })).status === 0;
}

function ensureNodeTooling(): void {
  if (process.env.SMART_EDIT_ASSUME_VTSLS === '1') {
    return;
  }
  if (!commandExists('node')) {
    throw new Error('Node.js is not installed or not in PATH. Install it from https://nodejs.org/ and retry.');
  }
  if (!commandExists('npm')) {
    throw new Error('npm is not installed or not in PATH. Install npm (bundled with Node.js) and retry.');
  }
}

function resolveRuntimeDirectory(settings: SmartLspSettings): string {
  const dir = path.join(settings.languageServersStaticDir, 'vts-lsp');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function resolveBinaryPath(runtimeDir: string): string {
  const base = path.join(runtimeDir, 'node_modules', '.bin');
  if (process.platform === 'win32') {
    const cmdPath = path.join(base, 'vtsls.cmd');
    if (fs.existsSync(cmdPath)) {
      return cmdPath;
    }
    const ps1Path = path.join(base, 'vtsls.ps1');
    if (fs.existsSync(ps1Path)) {
      return ps1Path;
    }
  }
  return path.join(base, 'vtsls');
}

function ensureVtslsBinary(
  runtimeDir: string,
  dependencies: RuntimeDependencyCollection,
  loggerLevel?: LogLevel | number
): string {
  const { logger } = createSmartEditLogger({
    name: 'smart-lsp.language_servers.vtsls',
    emitToConsole: false,
    level: loggerLevel === undefined ? undefined : coerceLogLevel(loggerLevel)
  });

  const binaryPath = resolveBinaryPath(runtimeDir);
  if (fs.existsSync(binaryPath)) {
    return binaryPath;
  }

  if (process.env.SMART_EDIT_SKIP_RUNTIME_INSTALL === '1') {
    throw new Error(`vtsls executable not found at ${binaryPath}. Allow downloads or install @vtsls/language-server manually.`);
  }

  ensureNodeTooling();
  logger.info('Installing @vtsls/language-server via npm');
  dependencies.install(logger, runtimeDir);

  if (!fs.existsSync(binaryPath)) {
    throw new Error(
      `@vtsls/language-server installation completed but executable missing at ${binaryPath}. Verify npm installation succeeded.`
    );
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

function mergeIgnoredPaths(existing: string[] | undefined): string[] {
  const merged = new Set(existing ?? []);
  ['node_modules', 'dist', 'build', 'coverage'].forEach((entry) => merged.add(entry));
  return Array.from(merged);
}

export class VtsLanguageServer extends SmartLanguageServer {
  protected override readonly handler: NodeLanguageServerHandler;

  constructor(
    config: LanguageServerConfigLike,
    loggerLike: { level?: number | LogLevel } | null,
    repositoryRootPath: string,
    options: { timeout?: number | null; smartLspSettings?: SmartLspSettingsInit } = {}
  ) {
    const augmentedConfig: LanguageServerConfigLike = {
      ...config,
      ignoredPaths: mergeIgnoredPaths(config.ignoredPaths)
    };

    const solidSettings = new SmartLspSettings(options?.smartLspSettings);
    const runtimeDir = resolveRuntimeDirectory(solidSettings);
    const dependencies = new RuntimeDependencyCollection(VTS_DEPENDENCIES);
    const binaryPath = ensureVtslsBinary(runtimeDir, dependencies, loggerLike?.level);

    const handler = new NodeLanguageServerHandler({
      cmd: `${quoteWindowsPath(binaryPath)} --stdio`,
      cwd: repositoryRootPath
    });

    super(augmentedConfig, loggerLike, repositoryRootPath, {
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
        this.logger.info(`vtsls: ${(payload as { message?: string }).message ?? ''}`);
      }
    });
    this.handler.onNotification('$/progress', noop);
    this.handler.onNotification('textDocument/publishDiagnostics', noop);
    this.handler.onRequest('client/registerCapability', noop);
    this.handler.onRequest('workspace/executeClientCommand', () => []);
  }
}

registerLanguageServer(Language.TYPESCRIPT_VTS, VtsLanguageServer as SmartLanguageServerConstructor);
