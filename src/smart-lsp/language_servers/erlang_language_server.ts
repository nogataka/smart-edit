import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { Language } from '../ls_config.js';
import { ensureDefaultSubprocessOptions } from '../util/subprocess_util.js';
import {
  SmartLanguageServer,
  type LanguageServerConfigLike,
  type SmartLanguageServerConstructor,
  type SmartLanguageServerOptions,
  registerLanguageServer
} from '../ls.js';
import { NodeLanguageServerHandler } from '../ls_handler.js';

const DEFAULT_REQUEST_TIMEOUT_SECONDS = 120;

const ERLANG_IGNORED_DIRECTORIES = [
  '_build',
  'deps',
  'ebin',
  '.rebar3',
  'logs',
  'node_modules',
  '_checkouts',
  'cover'
];

const READINESS_KEYWORDS = [
  'Started Erlang LS',
  'server started',
  'initialized',
  'ready to serve requests',
  'compilation finished',
  'indexing complete'
];

interface InitializeResponseLike {
  capabilities?: Record<string, unknown> | null;
}

interface ErlangRuntimeCheckResult {
  binaryPath: string;
  hasRebar3: boolean;
  erlangVersion: string | null;
}

export class ErlangLanguageServer extends SmartLanguageServer {
  protected override readonly handler: NodeLanguageServerHandler;
  private initialized = false;
  private readyPromise: Promise<void>;
  private readyResolver: (() => void) | null = null;

  constructor(
    config: LanguageServerConfigLike,
    loggerLike: { level?: number } | null,
    repositoryRootPath: string,
    options: SmartLanguageServerOptions = {}
  ) {
    const requestTimeout = options?.timeout ?? DEFAULT_REQUEST_TIMEOUT_SECONDS;

    const runtime = ensureErlangRuntime();

    const augmentedConfig: LanguageServerConfigLike = {
      ...config,
      ignoredPaths: mergeIgnoredPaths(config.ignoredPaths, ERLANG_IGNORED_DIRECTORIES)
    };

    const providedHandler = options.handler;
    if (providedHandler && !(providedHandler instanceof NodeLanguageServerHandler)) {
      throw new TypeError('ErlangLanguageServer requires a NodeLanguageServerHandler when supplying a custom handler.');
    }
    const handlerInstance = providedHandler ?? new NodeLanguageServerHandler(
      {
        cmd: [runtime.binaryPath, '--transport', 'stdio'],
        cwd: repositoryRootPath
      },
      {
        requestTimeoutSeconds: requestTimeout
      }
    );

    super(augmentedConfig, loggerLike, repositoryRootPath, {
      timeout: requestTimeout,
      smartLspSettings: options?.smartLspSettings,
      handler: handlerInstance
    });

    if (runtime.erlangVersion) {
      this.logger.info(`Detected Erlang runtime: ${runtime.erlangVersion}`);
    }
    if (!runtime.hasRebar3) {
      this.logger.warn('rebar3 command not found. Some Erlang LS features may be degraded.');
    }

    this.handler = handlerInstance;
    this.readyPromise = this.createReadyPromise();
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
    this.readyPromise = this.createReadyPromise();
  }

  private initializeLanguageServer(): void {
    this.logger.info('Initializing Erlang LS');
    const params = this.buildInitializeParams();
    const response = this.handler.sendRequest('initialize', params) as InitializeResponseLike | null;
    this.verifyCapabilities(response?.capabilities ?? null);
    this.handler.notify.initialized({});
    this.waitForReadiness();
  }

  private buildInitializeParams(): Record<string, unknown> {
    const rootUri = pathToFileURL(this.repositoryRootPath).href;
    return {
      processId: process.pid,
      rootPath: this.repositoryRootPath,
      rootUri,
      locale: 'en',
      capabilities: buildClientCapabilities(),
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
      throw new Error('Erlang LS initialize response is missing capabilities.');
    }

    const textDocumentCaps = (capabilities as { textDocument?: Record<string, unknown> }).textDocument;
    if (!textDocumentCaps) {
      throw new Error('Erlang LS did not report textDocument capabilities.');
    }

    const requiredKeys = ['synchronization', 'completion', 'definition', 'references', 'documentSymbol', 'hover'];
    for (const key of requiredKeys) {
      if (!(key in textDocumentCaps)) {
        throw new Error(`Erlang LS capabilities missing '${key}' under textDocument.`);
      }
    }
  }

  private registerHandlers(): void {
    const noop = () => undefined;
    this.handler.onRequest('client/registerCapability', noop);
    this.handler.onNotification('window/logMessage', (payload: unknown) => {
      this.handleWindowLogMessage(payload);
    });
    this.handler.onNotification('$/progress', (payload: unknown) => {
      this.handleProgressNotification(payload);
    });
    this.handler.onNotification('window/workDoneProgress/create', noop);
    this.handler.onNotification('$/workDoneProgress', noop);
    this.handler.onNotification('textDocument/publishDiagnostics', noop);
  }

  private handleWindowLogMessage(payload: unknown): void {
    const message = extractMessage(payload);
    if (!message) {
      return;
    }
    this.logger.info(`Erlang LS: ${message}`);

    const normalized = message.toLowerCase();
    if (READINESS_KEYWORDS.some((keyword) => normalized.includes(keyword.toLowerCase()))) {
      this.logger.info(`Erlang LS readiness signal detected: ${message}`);
      this.markServerReady();
    }
  }

  private handleProgressNotification(payload: unknown): void {
    if (!payload || typeof payload !== 'object') {
      return;
    }

    const params = payload as { value?: { kind?: string | null; message?: string | null } | null };
    const progress = params.value;
    if (progress?.kind?.toLowerCase() === 'end') {
      const message = progress.message ?? '';
      if (containsReadinessKeyword(message)) {
        this.logger.info('Erlang LS initialization progress reported completion.');
        this.markServerReady();
      }
    }
  }

  private waitForReadiness(): void {
    const isCi = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
    const isMacOs = process.platform === 'darwin';

    const readyTimeoutSeconds = isCi ? (isMacOs ? 240 : 180) : 60;
    const settlingSeconds = isCi ? 15 : 5;
    const fallbackSettlingSeconds = isCi ? 20 : 10;

    this.logger.info(
      `Waiting up to ${readyTimeoutSeconds} seconds for Erlang LS readiness (${isCi ? (isMacOs ? 'macOS CI' : 'CI') : 'local'} environment).`
    );

    void (async () => {
      const readinessOutcome = await Promise.race([
        this.readyPromise.then(() => 'ready' as const),
        delay(readyTimeoutSeconds * 1000).then(() => 'timeout' as const)
      ]);

      if (readinessOutcome === 'ready') {
        this.logger.info('Erlang LS reported readiness. Allowing additional settling time.');
        await delay(settlingSeconds * 1000);
        this.logger.info('Erlang LS settling period complete.');
      } else {
        this.logger.warn(
          `Erlang LS readiness timeout reached after ${readyTimeoutSeconds}s, proceeding anyway (common in CI environments).`
        );
        this.markServerReady();
        await delay(fallbackSettlingSeconds * 1000);
        this.logger.info('Basic Erlang LS initialization period complete.');
      }
    })().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Erlang LS readiness watcher encountered an error: ${message}`);
    });
  }

  private markServerReady(): void {
    const resolver = this.readyResolver;
    if (!resolver) {
      return;
    }
    this.readyResolver = null;
    resolver();
  }

  private createReadyPromise(): Promise<void> {
    return new Promise((resolve) => {
      this.readyResolver = () => {
        this.readyResolver = null;
        resolve();
      };
    });
  }
}

function ensureErlangRuntime(): ErlangRuntimeCheckResult {
  if (shouldAssumeInstalled()) {
    return {
      binaryPath: getAssumedBinaryPath(),
      hasRebar3: true,
      erlangVersion: null
    };
  }

  const binaryPath = findExecutable(['erlang_ls', process.platform === 'win32' ? 'erlang_ls.cmd' : null]);
  if (!binaryPath) {
    throw new Error('Erlang LS not found. Install from https://github.com/erlang-ls/erlang_ls and ensure it is on PATH.');
  }

  if (!commandSucceeds('erl', ['-version'])) {
    throw new Error('Erlang/OTP not found. Install from https://www.erlang.org/downloads and ensure it is on PATH.');
  }

  const erlangVersion = captureCommandOutput('erl', ['-version']);
  const hasRebar3 = commandSucceeds('rebar3', ['version']);

  return {
    binaryPath,
    hasRebar3,
    erlangVersion: erlangVersion ?? null
  };
}

function shouldAssumeInstalled(): boolean {
  return process.env.SMART_EDIT_ASSUME_ERLANG === '1' || process.env.SMART_EDIT_ASSUME_ERLANG_LS === '1';
}

function getAssumedBinaryPath(): string {
  const override = process.env.SMART_EDIT_ERLANG_LS_PATH;
  if (override) {
    return override;
  }
  if (process.platform === 'win32') {
    return 'erlang_ls.cmd';
  }
  return 'erlang_ls';
}

function commandSucceeds(command: string, args: string[]): boolean {
  const result = spawnSync(command, args, ensureDefaultSubprocessOptions({ stdio: 'ignore' }));
  return result.status === 0;
}

function captureCommandOutput(command: string, args: string[]): string | null {
  const result = spawnSync(command, args, ensureDefaultSubprocessOptions({ encoding: 'utf-8' }));
  if (result.status !== 0) {
    return null;
  }

  const stdout = typeof result.stdout === 'string' ? result.stdout.trim() : '';
  const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : '';
  return stdout || stderr || null;
}

function findExecutable(candidates: (string | null)[]): string | null {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const overridePath = process.env.SMART_EDIT_ERLANG_LS_PATH;
    if (overridePath && fs.existsSync(overridePath)) {
      return overridePath;
    }
    const resolved = whichBinary(candidate);
    if (resolved) {
      return resolved;
    }
  }
  return null;
}

function whichBinary(command: string): string | null {
  const locator = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(locator, [command], ensureDefaultSubprocessOptions({ encoding: 'utf-8' }));
  if (result.status === 0 && typeof result.stdout === 'string') {
    const [first] = result.stdout.split(/\r?\n/u);
    if (first && first.trim().length > 0) {
      return first.trim();
    }
  }
  return null;
}

function mergeIgnoredPaths(existing: string[] | undefined, additions: string[]): string[] {
  const merged = new Set(existing ?? []);
  for (const entry of additions) {
    merged.add(entry);
    merged.add(`**/${entry}/**`);
  }
  return Array.from(merged);
}

function buildClientCapabilities(): Record<string, unknown> {
  return {
    textDocument: {
      synchronization: { didSave: true, dynamicRegistration: true },
      completion: { dynamicRegistration: true },
      definition: { dynamicRegistration: true },
      references: { dynamicRegistration: true },
      documentSymbol: { dynamicRegistration: true },
      hover: { dynamicRegistration: true }
    },
    workspace: {
      workspaceFolders: true,
      configuration: true
    }
  } satisfies Record<string, unknown>;
}

function extractMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const raw = (payload as { message?: unknown }).message;
  return typeof raw === 'string' ? raw : null;
}

function containsReadinessKeyword(message: string): boolean {
  const normalized = message.toLowerCase();
  return READINESS_KEYWORDS.some((keyword) => normalized.includes(keyword.toLowerCase()));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = globalThis.setTimeout(resolve, ms);
    if (isUnrefableTimeout(timer)) {
      timer.unref();
    }
  });
}

function isUnrefableTimeout(value: unknown): value is { unref: () => void } {
  if (!value || typeof value !== 'object') {
    return false;
  }
  return 'unref' in value && typeof (value as { unref?: unknown }).unref === 'function';
}

registerLanguageServer(Language.ERLANG, ErlangLanguageServer as SmartLanguageServerConstructor);
