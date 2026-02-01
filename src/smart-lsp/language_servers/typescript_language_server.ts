import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { createSmartEditLogger, type LogLevel } from '../../smart-edit/util/logging.js';
import { Language } from '../ls_config.js';
import { ensureDefaultSubprocessOptions } from '../util/subprocess_util.js';
import {
  SmartLanguageServer,
  SmartLspSettings,
  type LanguageServerConfigLike,
  type SmartLspSettingsInit,
  type SmartLanguageServerConstructor,
  registerLanguageServer
} from '../ls.js';
import { NodeLanguageServerHandler } from '../ls_handler.js';
import { Platform, RuntimeDependencyCollection, quoteWindowsPath } from './common.js';

const TYPESCRIPT_IGNORED_PATTERNS = ['**/node_modules', '**/dist', '**/build', '**/coverage'];

interface InitializeParamsLike {
  locale: string;
  capabilities: Record<string, unknown>;
  processId: number;
  rootPath: string;
  rootUri: string;
  workspaceFolders: { uri: string; name: string }[];
}

interface InitializeResponseLike {
  capabilities?: Record<string, unknown> | null;
}

export class TypeScriptLanguageServer extends SmartLanguageServer {
  private readonly nodeHandler: NodeLanguageServerHandler;
  private initialized = false;
  private serverReady = false;
  private initializeCommandRegistered = false;

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
      ignoredPaths: mergeIgnoredPaths(config.ignoredPaths, TYPESCRIPT_IGNORED_PATTERNS)
    };

    const solidSettings = new SmartLspSettings(options?.smartLspSettings);
    const launchInfo = determineLaunchInfo(solidSettings);
    const handler = new NodeLanguageServerHandler({
      ...launchInfo,
      cwd: repositoryRootPath
    });

    super(augmentedConfig, loggerLike, repositoryRootPath, {
      ...options,
      handler,
      smartLspSettings: options?.smartLspSettings
    });

    this.nodeHandler = handler;
    this.registerHandlers();
  }

  override start(): this {
    const shouldInitialize = !this.initialized;
    super.start();
    if (shouldInitialize) {
      this.serverReady = false;
      this.initializeCommandRegistered = false;
      this.initializeLanguageServer();
      this.initialized = true;
    }
    return this;
  }

  override stop(shutdownTimeout = 2.0): void {
    super.stop(shutdownTimeout);
    this.initialized = false;
    this.serverReady = false;
    this.initializeCommandRegistered = false;
  }

  private registerHandlers(): void {
    this.nodeHandler.onRequest('client/registerCapability', (params: unknown) => {
      const registrations = (params as { registrations?: Record<string, unknown>[] } | null)?.registrations;
      if (!Array.isArray(registrations)) {
        return null;
      }
      for (const registration of registrations) {
        if (registration?.method === 'workspace/executeCommand') {
          this.initializeCommandRegistered = true;
        }
      }
      return null;
    });

    this.nodeHandler.onRequest('workspace/executeClientCommand', () => []);

    const noop = () => undefined;
    this.nodeHandler.onNotification('$/progress', noop);
    this.nodeHandler.onNotification('textDocument/publishDiagnostics', noop);

    this.nodeHandler.onNotification('window/logMessage', (payload: unknown) => {
      const message = extractMessage(payload);
      if (message) {
        this.logger.info(`TypeScript LS: ${message}`);
      }
    });

    this.nodeHandler.onNotification('experimental/serverStatus', (payload: unknown) => {
      const params = payload as { quiescent?: boolean } | null;
      if (params?.quiescent) {
        this.serverReady = true;
      }
    });
  }

  private initializeLanguageServer(): void {
    const params = this.buildInitializeParams();
    const response = this.nodeHandler.sendRequest('initialize', params) as InitializeResponseLike | null;

    if (!response || typeof response !== 'object') {
      throw new Error('TypeScript language server returned an invalid initialize response.');
    }

    this.verifyCapabilities(response.capabilities ?? null);
    this.nodeHandler.notify.initialized({});

    if (!this.serverReady) {
      this.logger.debug('TypeScript language server did not report readiness before timeout; continuing.');
    }

    if (!this.initializeCommandRegistered) {
      this.logger.debug('TypeScript language server did not register workspace/executeCommand capability during initialization.');
    }
  }

  private buildInitializeParams(): InitializeParamsLike {
    const rootUri = pathToFileURL(this.repositoryRootPath).href;
    return {
      locale: 'en',
      capabilities: {
        textDocument: {
          synchronization: { didSave: true, dynamicRegistration: true },
          completion: {
            dynamicRegistration: true,
            completionItem: { snippetSupport: true }
          },
          definition: { dynamicRegistration: true },
          references: { dynamicRegistration: true },
          documentSymbol: {
            dynamicRegistration: true,
            hierarchicalDocumentSymbolSupport: true,
            symbolKind: { valueSet: rangeArray(1, 27) }
          },
          hover: {
            dynamicRegistration: true,
            contentFormat: ['markdown', 'plaintext']
          },
          signatureHelp: { dynamicRegistration: true },
          codeAction: { dynamicRegistration: true }
        },
        workspace: {
          workspaceFolders: true,
          didChangeConfiguration: { dynamicRegistration: true },
          symbol: { dynamicRegistration: true }
        }
      },
      processId: process.pid,
      rootPath: this.repositoryRootPath,
      rootUri,
      workspaceFolders: [
        {
          uri: rootUri,
          name: path.basename(this.repositoryRootPath)
        }
      ]
    };
  }

  private verifyCapabilities(capabilities: Record<string, unknown> | null): void {
    if (!capabilities) {
      throw new Error('TypeScript initialization response is missing capabilities.');
    }

    const textDocumentSync = (capabilities as { textDocumentSync?: unknown }).textDocumentSync;
    const completionProvider = (capabilities as { completionProvider?: unknown }).completionProvider;

    if (textDocumentSync !== 2) {
      throw new Error('TypeScript language server must provide incremental textDocumentSync (value 2).');
    }

    if (!completionProvider || typeof completionProvider !== 'object') {
      throw new Error('TypeScript language server does not expose completionProvider capability.');
    }
  }
}

function determineLaunchInfo(settings: SmartLspSettings): { cmd: string } {
  const { logger } = createSmartEditLogger({
    name: 'smart-lsp.language_servers.typescript',
    emitToConsole: false
  });

  const runtimeDir = resolveRuntimeDirectory(settings);
  let localBinary: string | null = null;

  if (process.env.SMART_EDIT_SKIP_RUNTIME_INSTALL !== '1') {
    assertBinaryAvailable('node');
    assertBinaryAvailable('npm');

    const dependencies = new RuntimeDependencyCollection([
      {
        id: 'typescript',
        description: 'typescript npm package',
        command: ['npm', 'install', '--prefix', './', 'typescript@5.9.3'],
        platformId: 'any'
      },
      {
        id: 'typescript-language-server',
        description: 'typescript-language-server npm package',
        command: ['npm', 'install', '--prefix', './', 'typescript-language-server@5.1.3'],
        platformId: 'any'
      }
    ]);

    try {
      dependencies.install(logger, runtimeDir);
    } catch (error) {
      logger.warn(`Failed to install TypeScript language server dependencies: ${String(error)}`);
    }
  }

  const binName = Platform.isWindows() ? 'typescript-language-server.cmd' : 'typescript-language-server';
  localBinary = locateLocalBinary(runtimeDir, binName);

  if (localBinary) {
    return { cmd: `${quoteWindowsPath(localBinary)} --stdio` };
  }

  if (process.env.SMART_EDIT_SKIP_RUNTIME_INSTALL === '1') {
    return { cmd: 'typescript-language-server --stdio' };
  }

  throw new Error(`typescript-language-server executable not found in ${runtimeDir}.`);
}

function locateLocalBinary(runtimeDir: string, binaryName: string): string | null {
  const candidate = path.join(runtimeDir, 'node_modules', '.bin', binaryName);
  if (fs.existsSync(candidate)) {
    return candidate;
  }
  return null;
}

function resolveRuntimeDirectory(settings: SmartLspSettings): string {
  const dir = path.join(settings.languageServersStaticDir, 'TypeScriptLanguageServer');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function assertBinaryAvailable(command: string): void {
  const locator = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(
    locator,
    [command],
    ensureDefaultSubprocessOptions({
      stdio: 'ignore'
    })
  );
  if (result.status !== 0) {
    throw new Error(`${command} is not installed or not available in PATH.`);
  }
}

function mergeIgnoredPaths(existing: string[] | undefined, additions: string[]): string[] {
  const merged = new Set(existing ?? []);
  for (const entry of additions) {
    merged.add(entry);
  }
  return Array.from(merged);
}

function extractMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const message = (payload as { message?: unknown }).message;
  return typeof message === 'string' ? message : null;
}

function rangeArray(start: number, endExclusive: number): number[] {
  const values: number[] = [];
  for (let value = start; value < endExclusive; value += 1) {
    values.push(value);
  }
  return values;
}

registerLanguageServer(Language.TYPESCRIPT, TypeScriptLanguageServer as SmartLanguageServerConstructor);
