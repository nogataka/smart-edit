import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { Buffer } from 'node:buffer';
import fs from 'node:fs';

import { ensureDefaultSubprocessOptions } from './util/subprocess_util.js';
import { SmartLSPException } from './ls_exceptions.js';
import {
  LspNotification,
  LanguageServerRequest,
  type DocumentSymbolRequestParams,
  type LanguageServerRequestDelegate
} from './ls_request.js';
import { ErrorCodes } from './ls_types.js';
import {
  ENCODING,
  LSPError,
  createMessage,
  makeErrorResponse,
  makeNotification,
  makeRequest,
  makeResponse,
  type JsonRpcMessage,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type PayloadLike,
  type ProcessLaunchInfo,
  type StringDict
} from './lsp_protocol_handler/server.js';
import type {
  DocumentSymbolResult,
  FullSymbolTreeOptions,
  ReferenceInSymbol,
  ReferencingSymbolsOptions,
  SmartLanguageServerHandler,
  SmartLanguageServerNotifications,
  SmartLanguageServerRequests,
  UnifiedSymbolInformation
} from './ls.js';

type WireLogger = (source: string, destination: string, payload: unknown) => void;

const HEADER_SEPARATOR = Buffer.from('\r\n\r\n', ENCODING);

function cloneEnv(extra: Record<string, string> | undefined): NodeJS.ProcessEnv {
  return { ...process.env, ...(extra ?? {}) };
}

function normalizeCommand(cmd: string | string[]): NormalizedCommand {
  if (Array.isArray(cmd)) {
    const [first, ...rest] = cmd;
    if (!first) {
      throw new Error('Process command cannot be empty.');
    }
    return { command: first, args: rest, shell: false };
  }
  return { command: cmd, args: [], shell: true };
}

export class LanguageServerTerminatedException extends Error {
  override readonly cause?: Error;

  constructor(message: string, cause?: Error) {
    super(message);
    this.name = 'LanguageServerTerminatedException';
    this.cause = cause;
  }
}

export interface NodeLanguageServerHandlerOptions {
  logger?: WireLogger;
  startIndependentProcessGroup?: boolean;
  requestTimeoutSeconds?: number | null;
}

interface NormalizedCommand {
  command: string;
  args: string[];
  shell: boolean;
}

export class NodeLanguageServerHandler implements SmartLanguageServerHandler, LanguageServerRequestDelegate {
  readonly send: SmartLanguageServerRequests;
  readonly notify: SmartLanguageServerNotifications;

  private readonly processLaunchInfo: ProcessLaunchInfo;
  private readonly logger?: WireLogger;
  private readonly startIndependentProcessGroup: boolean;

  private child: ChildProcessWithoutNullStreams | null = null;
  private stdoutBuffer = Buffer.alloc(0);
  private stdoutFd: number | null = null;
  private requestId = 1;
  private requestTimeoutSeconds: number | null;
  private shuttingDown = false;

  private readonly requestHandlers = new Map<string, (params: unknown) => unknown>();
  private readonly notificationHandlers = new Map<string, (params: unknown) => void>();

  constructor(processLaunchInfo: ProcessLaunchInfo, options: NodeLanguageServerHandlerOptions = {}) {
    this.processLaunchInfo = processLaunchInfo;
    this.logger = options.logger;
    this.startIndependentProcessGroup = options.startIndependentProcessGroup ?? true;
    this.requestTimeoutSeconds = options.requestTimeoutSeconds ?? null;

    this.send = new LanguageServerRequest(this);
    this.notify = new LspNotification((method, params) => this.sendNotification(method, (params ?? null) as PayloadLike));
  }

  setRequestTimeout(timeout: number | null): void {
    this.requestTimeoutSeconds = timeout ?? null;
  }

  isRunning(): boolean {
    return this.child !== null && this.child.exitCode === null;
  }

  start(): void {
    if (this.child) {
      throw new Error('Language server already started');
    }

    const { command, args, shell } = normalizeCommand(this.processLaunchInfo.cmd);
    const env = cloneEnv(this.processLaunchInfo.env);
    const cwd = this.processLaunchInfo.cwd ?? process.cwd();

    const spawnOptions = ensureDefaultSubprocessOptions({
      cwd,
      env,
      shell,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: this.startIndependentProcessGroup
    });

    const child = spawn(command, args, spawnOptions);

    if (!child.stdin || !child.stdout || !child.stderr) {
      child.kill();
      throw new Error('Failed to spawn language server process with stdio pipes.');
    }

    this.child = child;
    this.stdoutBuffer = Buffer.alloc(0);
    this.stdoutFd = getStreamFd(child.stdout);
    child.stdout.pause();

    child.stdin.on('error', (error: Error & { code?: string }) => {
      const code = error.code ?? 'UNKNOWN';
      if (code === 'EPIPE' || code === 'ERR_STREAM_DESTROYED') {
        if (!this.shuttingDown) {
          this.logWire('client', 'server', { type: 'stdin-error', code, message: error.message });
        }
        return;
      }
      this.logWire('client', 'server', { type: 'stdin-error', code, message: error.message });
    });

    child.stderr.setEncoding(ENCODING);
    child.stderr.on('data', (chunk: string) => {
      const message = chunk.trimEnd();
      if (!message) {
        return;
      }
      if (message.toLowerCase().includes('error') || message.startsWith('E[')) {
        if (this.logger) {
          this.logger('server', 'stderr', message);
        }
      }
    });

    child.on('exit', (code, signal) => {
      this.child = null;
      this.stdoutFd = null;
      if (this.shuttingDown) {
        return;
      }
      const reason = `Language server exited with code ${code} signal ${signal ?? 'none'}`;
      this.stdoutBuffer = Buffer.alloc(0);
      this.shuttingDown = false;
      this.logWire('server', 'client', reason);
    });

    const immediateExit = child.exitCode !== null;
    if (immediateExit) {
      const rawStderr = child.stderr.read() as string | Buffer | null;
      const stderr = normalizeStreamOutput(rawStderr);
      throw new Error(
        `Language server process terminated immediately with code ${child.exitCode}. ${stderr}`
      );
    }
  }

  shutdown(): void {
    if (!this.child) {
      return;
    }
    this.shuttingDown = true;
    try {
      this.send.shutdown();
    } catch (error) {
      // Ignore errors on shutdown path.
      void error;
    }
    this.notify.exit();
  }

  dispose(): void {
    const child = this.child;
    this.child = null;
    if (!child) {
      return;
    }

    try {
      child.stdin?.end();
    } catch (error) {
      void error;
    }

    if (child.exitCode === null) {
      child.kill('SIGTERM');
      const timeout = globalThis.setTimeout(() => {
        if (child.exitCode === null) {
          child.kill('SIGKILL');
        }
      }, 5_000);
      child.once('exit', () => globalThis.clearTimeout(timeout));
    }

    child.stdout?.destroy();
    child.stderr?.destroy();
  }

  sendRequest(method: 'textDocument/documentSymbol', params: DocumentSymbolRequestParams): DocumentSymbolResult | null;
  sendRequest(method: 'smart-edit/fullSymbolTree', params: FullSymbolTreeOptions): UnifiedSymbolInformation[] | null;
  sendRequest(method: 'smart-edit/referencingSymbols', params: ReferencingSymbolsOptions): ReferenceInSymbol[] | null;
  sendRequest(method: 'smart-edit/overview', params: string): Record<string, UnifiedSymbolInformation[]> | null;
  sendRequest(method: 'shutdown'): void;
  sendRequest(method: string, params?: unknown): unknown;
  sendRequest(method: string, params?: unknown): unknown {
    const child = this.child;
    if (!child?.stdin || this.stdoutFd === null) {
      throw new SmartLSPException('Language server is not running.');
    }

    const id = this.requestId;
    this.requestId += 1;

    const payload = makeRequest(method, id, (params ?? null) as PayloadLike);
    this.logWire('client', 'server', payload);
    child.stdin.write(createMessage(payload));

    const response = this.waitForResponse(id, method);

    switch (method) {
      case 'textDocument/documentSymbol':
        return (response ?? null) as DocumentSymbolResult | null;
      case 'smart-edit/fullSymbolTree':
        return (response ?? null) as UnifiedSymbolInformation[] | null;
      case 'smart-edit/referencingSymbols':
        return (response ?? null) as ReferenceInSymbol[] | null;
      case 'smart-edit/overview':
        return (response ?? null) as Record<string, UnifiedSymbolInformation[]> | null;
      case 'shutdown':
        return undefined;
      default:
        return response;
    }
  }

  private waitForResponse(requestId: number, method: string): unknown {
    const timeoutMillis = this.requestTimeoutSeconds != null ? this.requestTimeoutSeconds * 1000 : null;
    const deadline = timeoutMillis != null ? Date.now() + timeoutMillis : null;

    while (true) {
      const message = this.readNextMessage(deadline);
      if (!message) {
        continue;
      }

      if ('id' in message && Object.prototype.hasOwnProperty.call(message, 'result')) {
        const response = message as JsonRpcResponse;
        if (response.id === requestId) {
          return response.result;
        }
      }

      if ('id' in message && Object.prototype.hasOwnProperty.call(message, 'error')) {
        const response = message as JsonRpcResponse;
        if (response.id === requestId) {
          const errorPayload = (response.error ?? {}) as StringDict;
          const lspError = LSPError.fromLsp(errorPayload);
          throw new SmartLSPException(
            `Error processing request ${method}`,
            lspError
          );
        }
      }

      if (isJsonRpcRequest(message)) {
        if (Object.prototype.hasOwnProperty.call(message, 'id')) {
          this.handleServerRequest(message);
        } else {
          this.handleNotification(message);
        }
      }
    }
  }

  private readNextMessage(deadline: number | null): JsonRpcMessage | null {
    const fd = this.stdoutFd;
    if (fd === null) {
      throw new SmartLSPException('Language server stdout is not available.');
    }

    while (true) {
      const message = this.extractMessageFromBuffer();
      if (message) {
        this.logWire('server', 'client', message);
        return message;
      }

      if (deadline !== null && Date.now() > deadline) {
        throw new SmartLSPException(`Request timed out after ${this.requestTimeoutSeconds} seconds.`);
      }

      const chunk = Buffer.allocUnsafe(4096);
      let bytesRead: number;
      try {
        bytesRead = fs.readSync(fd, chunk, 0, chunk.length, null);
      } catch (error) {
        const err = error as NodeJS.ErrnoException;
        if (err.code === 'EAGAIN') {
          continue;
        }
        throw new SmartLSPException('Failed to read from language server stdout.', err);
      }

      if (bytesRead === 0) {
        if (!this.isRunning()) {
          throw new LanguageServerTerminatedException('Language server terminated while waiting for response.');
        }
        continue;
      }

      this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk.subarray(0, bytesRead)]);
    }
  }

  private extractMessageFromBuffer(): JsonRpcMessage | null {
    if (this.stdoutBuffer.length === 0) {
      return null;
    }

    const headerEnd = this.stdoutBuffer.indexOf(HEADER_SEPARATOR);
    if (headerEnd === -1) {
      return null;
    }

    const header = this.stdoutBuffer.subarray(0, headerEnd).toString(ENCODING);
    const headers = header.split('\r\n');
    let contentLengthValue: number | null = null;
    for (const line of headers) {
      try {
        const length = getContentLengthFromHeader(line);
        if (length !== null) {
          contentLengthValue = length;
          break;
        }
      } catch (error) {
        throw new SmartLSPException('Invalid Content-Length header.', error);
      }
    }

    if (contentLengthValue === null) {
      // Drop malformed header and continue.
      this.stdoutBuffer = this.stdoutBuffer.subarray(headerEnd + HEADER_SEPARATOR.length);
      return null;
    }

    const totalLength = headerEnd + HEADER_SEPARATOR.length + contentLengthValue;
    if (this.stdoutBuffer.length < totalLength) {
      return null;
    }

    const body = this.stdoutBuffer.subarray(headerEnd + HEADER_SEPARATOR.length, totalLength).toString(ENCODING);
    this.stdoutBuffer = this.stdoutBuffer.subarray(totalLength);

    try {
      return JSON.parse(body) as JsonRpcMessage;
    } catch (error) {
      throw new SmartLSPException('Malformed JSON payload received from language server.', error);
    }
  }

  private handleServerRequest(request: JsonRpcRequest): void {
    const handler = this.requestHandlers.get(request.method);
    if (!handler) {
      const err = new LSPError(ErrorCodes.MethodNotFound, `Unhandled method '${request.method}'.`);
      this.sendPayload(makeErrorResponse(request.id ?? null, err));
      return;
    }
    try {
      const result = handler(request.params);
      this.sendPayload(makeResponse(request.id ?? null, result as PayloadLike));
    } catch (error) {
      const err = error instanceof LSPError ? error : new LSPError(ErrorCodes.InternalError, String(error));
      this.sendPayload(makeErrorResponse(request.id ?? null, err));
    }
  }

  private handleNotification(request: JsonRpcRequest): void {
    const handler = this.notificationHandlers.get(request.method);
    if (!handler) {
      return;
    }
    try {
      handler(request.params);
    } catch (error) {
      void error;
    }
  }

  sendNotification(method: string, params: PayloadLike = null): void {
    this.sendPayload(makeNotification(method, params));
  }

  sendResponse(requestId: number | string | null, params: PayloadLike): void {
    this.sendPayload(makeResponse(requestId, params));
  }

  sendErrorResponse(requestId: number | string | null, err: LSPError): void {
    this.sendPayload(makeErrorResponse(requestId, err));
  }

  on_request(method: string, handler: (params: unknown) => unknown): void {
    this.onRequest(method, handler);
  }

  onRequest(method: string, handler: (params: unknown) => unknown): void {
    this.requestHandlers.set(method, handler);
  }

  onNotification(method: string, handler: (params: unknown) => void): void {
    this.notificationHandlers.set(method, handler);
  }

  private sendPayload(payload: JsonRpcMessage): void {
    const child = this.child;
    if (!child?.stdin || child.stdin.destroyed) {
      return;
    }

    this.logWire('client', 'server', payload);
    try {
      child.stdin.write(createMessage(payload));
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED') {
        if (!this.shuttingDown) {
          throw new LanguageServerTerminatedException('Language server stdin is no longer available.', err);
        }
        return;
      }
      throw new SmartLSPException('Failed to write to language server stdin.', err);
    }
  }

  private logWire(source: string, destination: string, payload: unknown): void {
    if (!this.logger) {
      return;
    }
    try {
      this.logger(source, destination, payload);
    } catch (error) {
      void error;
    }
  }

}

function isJsonRpcRequest(message: JsonRpcMessage): message is JsonRpcRequest {
  return typeof (message as JsonRpcRequest).method === 'string';
}

function getStreamFd(stream: NodeJS.ReadableStream | null | undefined): number | null {
  if (!stream) {
    return null;
  }
  const direct = (stream as { fd?: unknown }).fd;
  if (typeof direct === 'number') {
    return direct;
  }
  const handleFd = (stream as { _handle?: { fd?: unknown } })._handle?.fd;
  return typeof handleFd === 'number' ? handleFd : null;
}

function normalizeStreamOutput(value: Buffer | string | null | undefined): string {
  if (typeof value === 'string') {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return value.toString(ENCODING);
  }
  return '';
}

function getContentLengthFromHeader(line: string): number | null {
  const normalized = line.trim().toLowerCase();
  if (!normalized.startsWith('content-length:')) {
    return null;
  }
  const value = normalized.slice('content-length:'.length).trim();
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid Content-Length header value: ${value}`);
  }
  return parsed;
}
