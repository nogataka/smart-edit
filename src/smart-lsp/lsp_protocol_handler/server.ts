import { Buffer } from 'node:buffer';
import os from 'node:os';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject { [key: string]: JsonValue; }
export type JsonArray = JsonValue[];

export type StringDict = Record<string, JsonValue>;
export type PayloadLike = StringDict | JsonArray | null;

export const ENCODING = 'utf-8';

export interface ProcessLaunchInfo {
  /** Command to launch the language server process. */
  cmd: string | string[];
  /** Additional environment variables to inject when spawning the process. */
  env?: Record<string, string>;
  /** Working directory for the spawned process. Defaults to the current process CWD. */
  cwd?: string;
}

export class LSPError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = 'LSPError';
    this.code = code;
  }

  toLsp(): { code: number; message: string; data?: JsonValue } {
    return { code: this.code, message: this.message };
  }

  static fromLsp(payload: { code?: JsonValue; message?: JsonValue }): LSPError {
    const code = typeof payload.code === 'number' ? payload.code : -32603;
    const message = typeof payload.message === 'string' ? payload.message : 'Unknown LSP error';
    return new LSPError(code, message);
  }
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: JsonValue;
  error?: { code: number; message: string; data?: JsonValue };
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: PayloadLike;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse;

export function makeResponse(requestId: number | string | null, params: PayloadLike): JsonRpcResponse {
  return { jsonrpc: '2.0', id: requestId, result: params ?? null };
}

export function makeErrorResponse(requestId: number | string | null, err: LSPError): JsonRpcResponse {
  return { jsonrpc: '2.0', id: requestId, error: err.toLsp() };
}

export function makeNotification(method: string, params: PayloadLike): JsonRpcRequest {
  const payload: JsonRpcRequest = { jsonrpc: '2.0', method };
  if (params !== undefined) {
    payload.params = params;
  }
  return payload;
}

export function makeRequest(method: string, requestId: number | string, params: PayloadLike): JsonRpcRequest {
  const payload: JsonRpcRequest = { jsonrpc: '2.0', method, id: requestId };
  if (params !== undefined) {
    payload.params = params;
  }
  return payload;
}

export function createMessage(payload: JsonRpcMessage): Buffer {
  const body = Buffer.from(JSON.stringify(payload), ENCODING);
  const header = Buffer.from(
    `Content-Length: ${body.byteLength}\r\nContent-Type: application/vscode-jsonrpc; charset=${ENCODING}\r\n\r\n`,
    ENCODING
  );
  return Buffer.concat([header, body]);
}

export enum MessageType {
  error = 1,
  warning = 2,
  info = 3,
  log = 4
}

export function contentLength(line: Buffer): number | null {
  // Content-Length header is case insensitive per RFC7230.
  const normalized = line.toString(ENCODING).trim();
  const prefix = 'content-length:';
  if (!normalized.toLowerCase().startsWith(prefix)) {
    return null;
  }
  const value = normalized.slice(prefix.length).trim();
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid Content-Length header: ${value}`);
  }
  return parsed;
}

export function defaultCwd(): string {
  return process.cwd?.() ?? os.homedir();
}
