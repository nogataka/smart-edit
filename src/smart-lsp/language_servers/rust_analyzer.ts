import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import type { LogLevel } from '../../smart-edit/util/logging.js';
import { Language } from '../ls_config.js';
import { ensureDefaultSubprocessOptions } from '../util/subprocess_util.js';
import {
  SmartLanguageServer,
  type LanguageServerConfigLike,
  type SmartLanguageServerConstructor,
  type SmartLspSettingsInit,
  registerLanguageServer
} from '../ls.js';
import { NodeLanguageServerHandler } from '../ls_handler.js';

function getRustupVersion(): string | null {
  const result = spawnSync('rustup', ['--version'], ensureDefaultSubprocessOptions({ encoding: 'utf-8' }));
  if (result.status === 0 && result.stdout) {
    return result.stdout.trim();
  }
  return null;
}

function getRustAnalyzerViaRustup(): string | null {
  const result = spawnSync('rustup', ['which', 'rust-analyzer'], ensureDefaultSubprocessOptions({ encoding: 'utf-8' }));
  if (result.status === 0 && result.stdout) {
    return result.stdout.trim();
  }
  return null;
}

function whichBinary(command: string): string | null {
  const locator = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(locator, [command], ensureDefaultSubprocessOptions({ encoding: 'utf-8' }));
  if (result.status === 0 && result.stdout) {
    const firstLine = result.stdout.split(/\r?\n/)[0]?.trim();
    return firstLine && firstLine.length > 0 ? firstLine : null;
  }
  return null;
}

function ensureRustAnalyzerBinary(): string {
  const overridePath = process.env.SMART_EDIT_RUST_ANALYZER_PATH;
  if (overridePath) {
    return overridePath;
  }

  const fromRustup = getRustAnalyzerViaRustup();
  if (fromRustup && fs.existsSync(fromRustup)) {
    return fromRustup;
  }

  const fromPath = whichBinary('rust-analyzer');
  if (fromPath) {
    return fromPath;
  }

  const rustupVersion = getRustupVersion();
  if (!rustupVersion) {
    throw new Error(
      'Neither rust-analyzer nor rustup is installed. Install Rust via https://rustup.rs/ or provide rust-analyzer in PATH.'
    );
  }

  const installResult = spawnSync(
    'rustup',
    ['component', 'add', 'rust-analyzer'],
    ensureDefaultSubprocessOptions({ encoding: 'utf-8' })
  );
  if (installResult.status !== 0) {
    throw new Error(`Failed to install rust-analyzer via rustup: ${installResult.stderr ?? installResult.stdout}`);
  }

  const installedPath = getRustAnalyzerViaRustup();
  if (installedPath && fs.existsSync(installedPath)) {
    return installedPath;
  }

  throw new Error('rust-analyzer installation succeeded but binary not found in PATH.');
}

function mergeIgnoredPaths(existing: string[] | undefined): string[] {
  const merged = new Set(existing ?? []);
  merged.add('target');
  return Array.from(merged);
}

export class RustAnalyzerLanguageServer extends SmartLanguageServer {
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

    const binaryPath = ensureRustAnalyzerBinary();
    const handler = new NodeLanguageServerHandler({
      cmd: binaryPath,
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
        this.logger.info(`rust-analyzer: ${(payload as { message?: string }).message ?? ''}`);
      }
    });
    this.handler.onNotification('$/progress', noop);
    this.handler.onNotification('textDocument/publishDiagnostics', noop);
    this.handler.onNotification('experimental/serverStatus', noop);
    this.handler.onRequest('client/registerCapability', noop);
    this.handler.onRequest('workspace/executeClientCommand', () => []);
  }
}

registerLanguageServer(Language.RUST, RustAnalyzerLanguageServer as SmartLanguageServerConstructor);
