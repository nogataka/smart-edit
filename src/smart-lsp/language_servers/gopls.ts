import { spawnSync } from 'node:child_process';

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

function commandExists(command: string): boolean {
  if (process.env.SMART_EDIT_ASSUME_GOPLS === '1') {
    return true;
  }
  const locator = process.platform === 'win32' ? 'where' : 'which';
  return spawnSync(locator, [command], ensureDefaultSubprocessOptions({ stdio: 'ignore' })).status === 0;
}

function ensureGoRuntime(): void {
  if (!commandExists('go')) {
    throw new Error('Go is not installed. Install Go from https://golang.org/doc/install and ensure it is in PATH.');
  }
  if (!commandExists('gopls')) {
    throw new Error(
      'gopls is not installed. Install it via `go install golang.org/x/tools/gopls@latest` and ensure it is available in PATH.'
    );
  }
}

function mergeIgnored(existing: string[] | undefined): string[] {
  const merged = new Set(existing ?? []);
  ['vendor', 'node_modules', 'dist', 'build'].forEach((entry) => merged.add(entry));
  return Array.from(merged);
}

export class GoplsLanguageServer extends SmartLanguageServer {
  protected override readonly handler: NodeLanguageServerHandler;

  constructor(
    config: LanguageServerConfigLike,
    loggerLike: { level?: number } | null,
    repositoryRootPath: string,
    options: { timeout?: number | null; smartLspSettings?: SmartLspSettingsInit } = {}
  ) {
    ensureGoRuntime();

    const augmentedConfig: LanguageServerConfigLike = {
      ...config,
      ignoredPaths: mergeIgnored(config.ignoredPaths)
    };

    const handler = new NodeLanguageServerHandler({
      cmd: 'gopls',
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
        this.logger.info(`gopls: ${(payload as { message?: string }).message ?? ''}`);
      }
    });
    this.handler.onNotification('$/progress', noop);
    this.handler.onNotification('textDocument/publishDiagnostics', noop);
    this.handler.onRequest('client/registerCapability', noop);
    this.handler.onRequest('workspace/executeClientCommand', () => []);
  }
}

registerLanguageServer(Language.GO, GoplsLanguageServer as SmartLanguageServerConstructor);
