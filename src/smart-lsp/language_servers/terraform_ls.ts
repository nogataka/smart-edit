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

const TERRAFORM_DEPENDENCIES: RuntimeDependency[] = [
  {
    id: 'terraform-ls',
    description: 'terraform-ls for macOS (ARM64)',
    url: 'https://releases.hashicorp.com/terraform-ls/0.38.3/terraform-ls_0.38.3_darwin_arm64.zip',
    platformId: 'osx-arm64',
    archiveType: 'zip',
    binaryName: 'terraform-ls'
  },
  {
    id: 'terraform-ls',
    description: 'terraform-ls for macOS (x64)',
    url: 'https://releases.hashicorp.com/terraform-ls/0.38.3/terraform-ls_0.38.3_darwin_amd64.zip',
    platformId: 'osx-x64',
    archiveType: 'zip',
    binaryName: 'terraform-ls'
  },
  {
    id: 'terraform-ls',
    description: 'terraform-ls for Linux (ARM64)',
    url: 'https://releases.hashicorp.com/terraform-ls/0.38.3/terraform-ls_0.38.3_linux_arm64.zip',
    platformId: 'linux-arm64',
    archiveType: 'zip',
    binaryName: 'terraform-ls'
  },
  {
    id: 'terraform-ls',
    description: 'terraform-ls for Linux (x64)',
    url: 'https://releases.hashicorp.com/terraform-ls/0.38.3/terraform-ls_0.38.3_linux_amd64.zip',
    platformId: 'linux-x64',
    archiveType: 'zip',
    binaryName: 'terraform-ls'
  },
  {
    id: 'terraform-ls',
    description: 'terraform-ls for Windows (x64)',
    url: 'https://releases.hashicorp.com/terraform-ls/0.38.3/terraform-ls_0.38.3_windows_amd64.zip',
    platformId: 'win-x64',
    archiveType: 'zip',
    binaryName: 'terraform-ls.exe'
  }
];

function mergeIgnoredPaths(existing: string[] | undefined): string[] {
  const merged = new Set(existing ?? []);
  ['.terraform', 'terraform.tfstate.d'].forEach((entry) => merged.add(entry));
  return Array.from(merged);
}

function commandExists(command: string): boolean {
  const locator = process.platform === 'win32' ? 'where' : 'which';
  return spawnSync(locator, [command], ensureDefaultSubprocessOptions({ stdio: 'ignore' })).status === 0;
}

function ensureTerraformCli(): void {
  if (process.env.SMART_EDIT_ASSUME_TERRAFORM === '1') {
    return;
  }
  if (!commandExists('terraform')) {
    throw new Error(
      'Terraform CLI not found. Install it from https://developer.hashicorp.com/terraform/install and ensure it is available in PATH.'
    );
  }
}

function resolveRuntimeDirectory(settings: SmartLspSettings): string {
  const dir = path.join(settings.languageServersStaticDir, 'terraform-ls');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function ensureTerraformLanguageServer(
  runtimeDir: string,
  dependencies: RuntimeDependencyCollection,
  loggerLevel?: LogLevel | number
): string {
  const { logger } = createSmartEditLogger({
    name: 'smart-lsp.language_servers.terraform',
    emitToConsole: false,
    level: loggerLevel === undefined ? undefined : coerceLogLevel(loggerLevel)
  });

  const binaryPath = dependencies.binaryPath(runtimeDir);
  if (fs.existsSync(binaryPath)) {
    return binaryPath;
  }

  if (process.env.SMART_EDIT_SKIP_RUNTIME_INSTALL === '1') {
    throw new Error(
      `terraform-ls executable not found at ${binaryPath}. Allow downloads or install terraform-ls manually.`
    );
  }

  logger.info('Downloading terraform-ls runtime dependency.');
  dependencies.install(logger, runtimeDir);

  if (!fs.existsSync(binaryPath)) {
    throw new Error(`Failed to install terraform-ls (expected binary at ${binaryPath}).`);
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

export class TerraformLanguageServer extends SmartLanguageServer {
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

    ensureTerraformCli();

    const solidSettings = new SmartLspSettings(options?.smartLspSettings);
    const runtimeDir = resolveRuntimeDirectory(solidSettings);
    const dependencies = new RuntimeDependencyCollection(TERRAFORM_DEPENDENCIES);
    const binaryPath = ensureTerraformLanguageServer(runtimeDir, dependencies, loggerLike?.level);

    const handler = new NodeLanguageServerHandler({
      cmd: `${quoteWindowsPath(binaryPath)} serve`,
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
        this.logger.info(`terraform-ls: ${(payload as { message?: string }).message ?? ''}`);
      }
    });
    this.handler.onNotification('$/progress', noop);
    this.handler.onNotification('textDocument/publishDiagnostics', noop);
    this.handler.onRequest('client/registerCapability', noop);
    this.handler.onRequest('workspace/executeClientCommand', () => []);
  }
}

registerLanguageServer(Language.TERRAFORM, TerraformLanguageServer as SmartLanguageServerConstructor);
