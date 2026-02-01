import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { LogLevel } from '../../smart-edit/util/logging.js';
import { ensureDefaultSubprocessOptions } from '../util/subprocess_util.js';
import { Language } from '../ls_config.js';
import {
  SmartLanguageServer,
  type LanguageServerConfigLike,
  type SmartLanguageServerConstructor,
  type SmartLspSettingsInit,
  registerLanguageServer
} from '../ls.js';
import { NodeLanguageServerHandler } from '../ls_handler.js';
import { quoteWindowsPath } from './common.js';

const ZLS_ASSUME_ENV = 'SMART_EDIT_ASSUME_ZLS';
const ZLS_PATH_ENV = 'SMART_EDIT_ZLS_PATH';
const ZIG_PATH_ENV = 'SMART_EDIT_ZIG_PATH';

const WINDOWS_UNSUPPORTED_MESSAGE =
  'Windows is not supported by the Zig Language Server integration. Cross-file references are unreliable on Windows.';

const ZIG_IGNORED_DIRECTORIES = ['zig-cache', '.zig-cache', 'zig-out', 'node_modules', 'build', 'dist'];

interface InitializeResponseLike {
  capabilities?: Record<string, unknown> | null;
}

interface CapabilitySubset {
  textDocumentSync?: unknown;
  definitionProvider?: unknown;
  documentSymbolProvider?: unknown;
  referencesProvider?: unknown;
}

export class ZigLanguageServer extends SmartLanguageServer {
  protected override readonly handler: NodeLanguageServerHandler;
  private initialized = false;

  constructor(
    config: LanguageServerConfigLike,
    loggerLike: { level?: number | LogLevel } | null,
    repositoryRootPath: string,
    options: { timeout?: number | null; smartLspSettings?: SmartLspSettingsInit } = {}
  ) {
    const augmentedConfig: LanguageServerConfigLike = {
      ...config,
      ignoredPaths: mergeIgnoredPaths(config.ignoredPaths, ZIG_IGNORED_DIRECTORIES)
    };

    const binaryPath = ensureZlsRuntime();
    const handler = new NodeLanguageServerHandler({
      cmd: [quoteWindowsPath(binaryPath)],
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
    this.handler.onRequest('client/registerCapability', noop);
    this.handler.onNotification('window/logMessage', (payload: unknown) => {
      const message = extractWindowMessage(payload);
      if (message) {
        this.logger.info(`zls: ${message}`);
      }
    });
    this.handler.onNotification('$/progress', noop);
    this.handler.onNotification('textDocument/publishDiagnostics', noop);
  }

  private initializeLanguageServer(): void {
    const params = this.buildInitializeParams();
    const response = this.handler.sendRequest('initialize', params) as InitializeResponseLike | null;
    this.verifyCapabilities(response?.capabilities ?? null);
    this.handler.notify.initialized({});
    this.openBuildFileIfPresent();
  }

  private buildInitializeParams(): Record<string, unknown> {
    const rootUri = pathToFileURL(this.repositoryRootPath).href;
    return {
      processId: process.pid,
      locale: 'en',
      rootPath: this.repositoryRootPath,
      rootUri,
      capabilities: buildClientCapabilities(),
      workspaceFolders: [
        {
          uri: rootUri,
          name: path.basename(this.repositoryRootPath)
        }
      ],
      initializationOptions: buildInitializationOptions()
    } satisfies Record<string, unknown>;
  }

  private verifyCapabilities(capabilities: Record<string, unknown> | null): void {
    if (!capabilities) {
      throw new Error('Zig language server initialize response is missing capabilities.');
    }

    const subset = capabilities as CapabilitySubset;
    for (const key of ['textDocumentSync', 'definitionProvider', 'documentSymbolProvider', 'referencesProvider']) {
      if (!(key in subset)) {
        throw new Error(`Zig language server did not advertise required capability '${key}'.`);
      }
    }
  }

  private openBuildFileIfPresent(): void {
    const buildFilePath = path.join(this.repositoryRootPath, 'build.zig');
    if (!fs.existsSync(buildFilePath)) {
      return;
    }

    try {
      const contents = fs.readFileSync(buildFilePath, { encoding: 'utf-8' });
      const uri = pathToFileURL(buildFilePath).href;
      this.handler.notify.didOpenTextDocument({
        textDocument: {
          uri,
          languageId: 'zig',
          version: 1,
          text: contents
        }
      });
      this.logger.info('Opened build.zig to seed Zig language server project context.');
    } catch (error) {
      this.logger.warn(`Failed to open build.zig: ${(error as Error).message}`);
    }
  }
}

registerLanguageServer(Language.ZIG, ZigLanguageServer as SmartLanguageServerConstructor);

function mergeIgnoredPaths(existing: string[] | undefined, additions: string[]): string[] {
  const merged = new Set(existing ?? []);
  for (const entry of additions) {
    merged.add(entry);
  }
  return Array.from(merged);
}

function ensureZlsRuntime(): string {
  if (process.env[ZLS_ASSUME_ENV] === '1') {
    const override = process.env[ZLS_PATH_ENV];
    if (override && override.length > 0) {
      return override;
    }
    return process.platform === 'win32' ? 'zls.exe' : 'zls';
  }

  if (process.platform === 'win32') {
    throw new Error(WINDOWS_UNSUPPORTED_MESSAGE);
  }

  const zigPath = resolveZigExecutable();
  if (!zigPath || !detectZigVersion(zigPath)) {
    throw new Error(
      'Zig is not installed. Install Zig from https://ziglang.org/download/ and ensure it is available in PATH.'
    );
  }

  const zlsExecutable = resolveZlsExecutable();
  if (!zlsExecutable) {
    throw new Error(
      'Found Zig but ZLS (Zig Language Server) is not installed. Install it via package managers or from https://github.com/zigtools/zls and ensure `zls` is on PATH.'
    );
  }

  return zlsExecutable;
}

function resolveZigExecutable(): string | null {
  const override = process.env[ZIG_PATH_ENV];
  if (override && fs.existsSync(override)) {
    return override;
  }

  const binaryName = process.platform === 'win32' ? 'zig.exe' : 'zig';
  const located = which(binaryName);
  if (located && fs.existsSync(located)) {
    return located;
  }
  return null;
}

function detectZigVersion(executable: string): string | null {
  const result = spawnSync(executable, ['version'], ensureDefaultSubprocessOptions({ encoding: 'utf-8' }));
  if (result.status === 0 && typeof result.stdout === 'string') {
    const trimmed = result.stdout.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

function resolveZlsExecutable(): string | null {
  const override = process.env[ZLS_PATH_ENV];
  if (override && fs.existsSync(override)) {
    return override;
  }

  const binaryName = process.platform === 'win32' ? 'zls.exe' : 'zls';
  const located = which(binaryName);
  if (located && fs.existsSync(located)) {
    return located;
  }
  return null;
}

function which(command: string): string | null {
  const locator = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(locator, [command], ensureDefaultSubprocessOptions({ encoding: 'utf-8' }));
  if (result.status !== 0 || typeof result.stdout !== 'string') {
    return null;
  }

  const lines = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  return lines[0] ?? null;
}

function extractWindowMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const message = (payload as { message?: unknown }).message;
  return typeof message === 'string' ? message : null;
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
      }
    },
    workspace: {
      workspaceFolders: true,
      didChangeConfiguration: { dynamicRegistration: true },
      configuration: true
    }
  } satisfies Record<string, unknown>;
}

function buildInitializationOptions(): Record<string, unknown> {
  return {
    zig_exe_path: resolveZigExecutable(),
    zig_lib_path: null,
    build_runner_path: null,
    global_cache_path: null,
    enable_build_on_save: true,
    build_on_save_args: ['build'],
    enable_snippets: true,
    enable_argument_placeholders: true,
    semantic_tokens: 'full',
    warn_style: false,
    highlight_global_var_declarations: false,
    skip_std_references: false,
    prefer_ast_check_as_child_process: true,
    completion_label_details: true,
    inlay_hints_show_variable_type_hints: true,
    inlay_hints_show_struct_literal_field_type: true,
    inlay_hints_show_parameter_name: true,
    inlay_hints_show_builtin: true,
    inlay_hints_exclude_single_argument: true,
    inlay_hints_hide_redundant_param_names: false,
    inlay_hints_hide_redundant_param_names_last_token: false
  } satisfies Record<string, unknown>;
}
