import { Buffer } from 'node:buffer';
import { clearInterval, setInterval } from 'node:timers';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { parse as parseUrl } from 'node:url';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { createSmartEditLogger } from './util/logging.js';
import type { MemoryLogHandler } from './util/logging.js';
import { SMART_EDIT_DASHBOARD_DIR } from './constants.js';
import type { ToolUsageStats } from './analytics.js';
import { getInstances } from './instance-registry.js';

const { logger } = createSmartEditLogger({ name: 'smart-edit.dashboard', emitToConsole: false, level: 'info' });

const DEFAULT_DASHBOARD_PORT = 0x5eda;
const DASHBOARD_HOST = '127.0.0.1';
const SSE_HEARTBEAT_INTERVAL_MS = 15_000;

const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon'
};

interface DashboardAgentLike {
  getActiveProject(): { projectName?: string | null } | null;
}

export interface DashboardThread {
  stop(): void;
}

class DashboardHttpThread implements DashboardThread {
  private stopped = false;

  constructor(private readonly server: Server, private readonly onStop?: () => void) {}

  stop(): void {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    this.server.close((error) => {
      if (error) {
        logger.warn('Failed to stop Smart-Edit dashboard server cleanly.', error);
      }
      this.onStop?.();
    });
  }
}

export interface SmartEditDashboardApiOptions {
  shutdownCallback?: () => void;
  toolUsageStats?: ToolUsageStats | null;
}

interface LogMessagesResponse {
  messages: string[];
  maxIdx: number;
  activeProject: string | null;
}

type ToolStatsResponse = Record<string, { num_times_called: number; input_tokens: number; output_tokens: number }>;

const SSE_HEADERS: Record<string, string> = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive'
};

export class SmartEditDashboardAPI {
  private readonly memoryLogHandler: MemoryLogHandler;
  private toolNames: string[];
  private readonly agent: DashboardAgentLike;
  private readonly shutdownCallback?: () => void;
  private readonly toolUsageStats?: ToolUsageStats | null;

  private server: Server | null = null;
  private listeningPort: number | null = null;
  private readonly sseClients = new Set<ServerResponse>();
  private logSequence = 0;
  private logListener?: (message: string) => void;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private streamingAttached = false;

  constructor(
    memoryLogHandler: MemoryLogHandler,
    toolNames: string[],
    agent: DashboardAgentLike,
    options: SmartEditDashboardApiOptions = {}
  ) {
    this.memoryLogHandler = memoryLogHandler;
    this.toolNames = [...toolNames];
    this.agent = agent;
    this.shutdownCallback = options.shutdownCallback;
    this.toolUsageStats = options.toolUsageStats;
    this.logSequence = this.memoryLogHandler.getLogMessages().length;
  }

  async runInThread(): Promise<[DashboardThread, number]> {
    if (this.server && this.listeningPort !== null) {
      this.ensureLogStreamingAttached();
      return [new DashboardHttpThread(this.server), this.listeningPort];
    }

    const { server, port } = await this.startServer();
    this.server = server;
    this.listeningPort = port;
    this.ensureLogStreamingAttached();
    const thread = new DashboardHttpThread(server, () => {
      this.server = null;
      this.listeningPort = null;
      this.detachLogStreaming();
    });
    logger.info(`Smart-Edit dashboard listening on http://${DASHBOARD_HOST}:${port}/dashboard/index.html`);
    return [thread, port];
  }

  getToolNames(): string[] {
    return [...this.toolNames];
  }

  setToolNames(toolNames: string[]): void {
    this.toolNames = [...toolNames];
    this.broadcastToolNames();
  }

  private broadcastToolNames(): void {
    this.broadcastSseEvent('toolNames', { toolNames: this.getToolNames() });
  }

  clearToolStats(): void {
    this.toolUsageStats?.clear();
  }

  shutdown(): void {
    logger.info('Dashboard shutdown triggered.');
    this.detachLogStreaming();
    if (this.shutdownCallback) {
      this.shutdownCallback();
      return;
    }
    process.exit(0);
  }

  private async startServer(): Promise<{ server: Server; port: number }> {
    let candidatePort = DEFAULT_DASHBOARD_PORT;
    let lastError: NodeJS.ErrnoException | null = null;
    while (candidatePort <= 65535) {
      const server = createServer((req, res) => {
        void this.handleRequest(req, res);
      });

      try {
        const port = await this.listenOnPort(server, candidatePort);
        server.on('close', () => {
          this.server = null;
          this.listeningPort = null;
          this.detachLogStreaming();
        });
        return { server, port };
      } catch (error) {
        lastError = error as NodeJS.ErrnoException;
        try {
          server.close();
        } catch {
          // ignore close errors
        }

        if (lastError && (lastError.code === 'EADDRINUSE' || lastError.code === 'EACCES')) {
          candidatePort += 1;
          continue;
        }

        logger.error('Failed to start Smart-Edit dashboard server.', lastError ?? undefined);
        break;
      }
    }

    throw new Error(
      lastError?.message ?? 'Unable to start Smart-Edit dashboard server; no available ports in the configured range.'
    );
  }

  private listenOnPort(server: Server, port: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException) => {
        cleanup();
        reject(error);
      };

      const onListening = () => {
        const address = server.address();
        cleanup();
        if (address && typeof address === 'object') {
          resolve(address.port);
        } else {
          resolve(port);
        }
      };

      const cleanup = () => {
        server.off('error', onError);
        server.off('listening', onListening);
      };

      server.once('error', onError);
      server.once('listening', onListening);
      server.listen({ port, host: DASHBOARD_HOST, exclusive: true });
    });
  }

  private ensureLogStreamingAttached(): void {
    if (this.streamingAttached) {
      return;
    }
    this.streamingAttached = true;
    this.logSequence = this.memoryLogHandler.getLogMessages().length;
    this.logListener = (message: string) => {
      this.onLogMessage(message);
    };
    this.memoryLogHandler.addEmitCallback(this.logListener);
    const timer = setInterval(() => {
      this.sendHeartbeat();
    }, SSE_HEARTBEAT_INTERVAL_MS);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
    this.heartbeatTimer = timer;
  }

  private detachLogStreaming(): void {
    if (!this.streamingAttached) {
      return;
    }
    this.streamingAttached = false;
    if (this.logListener) {
      this.memoryLogHandler.removeEmitCallback(this.logListener);
      this.logListener = undefined;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.sseClients.size > 0) {
      const shutdownFrame = this.formatSseEvent('shutdown', { reason: 'server_stop' });
      for (const client of this.sseClients) {
        try {
          client.write(shutdownFrame);
          if (!client.writableEnded) {
            client.end();
          }
        } catch {
          // ignore errors when closing clients
        }
      }
      this.sseClients.clear();
    }
  }

  private onLogMessage(message: string): void {
    const payload = {
      message,
      idx: this.logSequence,
      activeProject: this.agent.getActiveProject()?.projectName ?? null
    } satisfies { message: string; idx: number; activeProject: string | null };
    this.logSequence += 1;
    this.broadcastSseEvent('log', payload);
  }

  private broadcastSseEvent(event: string, payload: unknown): void {
    if (this.sseClients.size === 0) {
      return;
    }
    const frame = this.formatSseEvent(event, payload);
    for (const client of [...this.sseClients]) {
      try {
        client.write(frame);
      } catch {
        this.removeSseClient(client);
      }
    }
  }

  private sendHeartbeat(): void {
    if (this.sseClients.size === 0) {
      return;
    }
    const heartbeat = `: heartbeat ${Date.now()}\n\n`;
    for (const client of [...this.sseClients]) {
      try {
        client.write(heartbeat);
      } catch {
        this.removeSseClient(client);
      }
    }
  }

  private removeSseClient(res: ServerResponse): void {
    if (!this.sseClients.has(res)) {
      return;
    }
    this.sseClients.delete(res);
    try {
      if (!res.writableEnded) {
        res.end();
      }
    } catch {
      // ignore errors during cleanup
    }
  }

  private formatSseEvent(event: string, payload: unknown): string {
    return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  }

  private handleLogStream(req: IncomingMessage, res: ServerResponse): void {
    this.ensureLogStreamingAttached();
    this.sseClients.add(res);

    const teardown = () => {
      this.removeSseClient(res);
    };

    res.on('close', teardown);
    res.on('error', teardown);
    req.on('close', teardown);
    req.on('error', teardown);

    res.writeHead(200, SSE_HEADERS);
    res.write(': connected\n\n');

    // Send current tool names and log history so the client can hydrate immediately.
    const toolNamesPayload = { toolNames: this.getToolNames() };
    res.write(this.formatSseEvent('toolNames', toolNamesPayload));
    const logMessages = this.memoryLogHandler.getLogMessages();
    const historyPayload: LogMessagesResponse = {
      messages: logMessages,
      maxIdx: logMessages.length > 0 ? logMessages.length - 1 : -1,
      activeProject: this.agent.getActiveProject()?.projectName ?? null
    };
    res.write(this.formatSseEvent('history', historyPayload));
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method?.toUpperCase() ?? 'GET';
    const url = parseUrl(req.url ?? '/', true);
    const pathname = url.pathname ?? '/';

    // Add CORS headers for cross-origin requests from multi-instance dashboard
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    try {
      if (pathname.startsWith('/dashboard')) {
        if (method !== 'GET') {
          this.respondMethodNotAllowed(res);
          return;
        }
        await this.serveDashboardAsset(pathname, res);
        return;
      }

      if (pathname === '/log_stream') {
        if (method !== 'GET') {
          this.respondMethodNotAllowed(res);
          return;
        }
        this.handleLogStream(req, res);
        return;
      }

      switch (pathname) {
        case '/get_log_messages':
          if (method !== 'POST') {
            this.respondMethodNotAllowed(res);
            return;
          }
          await this.handleGetLogMessages(req, res);
          return;
        case '/get_tool_names':
          if (method !== 'GET') {
            this.respondMethodNotAllowed(res);
            return;
          }
          this.sendJson(res, 200, { tool_names: this.getToolNames() });
          return;
        case '/get_tool_stats':
          if (method !== 'GET') {
            this.respondMethodNotAllowed(res);
            return;
          }
          this.sendJson(res, 200, { stats: this.getToolStats() });
          return;
        case '/clear_tool_stats':
          if (method !== 'POST') {
            this.respondMethodNotAllowed(res);
            return;
          }
          this.clearToolStats();
          this.sendJson(res, 200, { status: 'cleared' });
          return;
        case '/get_token_count_estimator_name':
          if (method !== 'GET') {
            this.respondMethodNotAllowed(res);
            return;
          }
          this.sendJson(res, 200, {
            token_count_estimator_name: this.toolUsageStats?.tokenEstimatorName ?? 'unknown'
          });
          return;
        case '/shutdown':
          if (method !== 'PUT') {
            this.respondMethodNotAllowed(res);
            return;
          }
          this.shutdown();
          this.sendJson(res, 200, { status: 'shutting down' });
          return;
        // Multi-instance dashboard APIs
        case '/api/instances':
          if (method !== 'GET') {
            this.respondMethodNotAllowed(res);
            return;
          }
          this.sendJson(res, 200, { instances: getInstances() });
          return;
        case '/api/instance-info':
          if (method !== 'GET') {
            this.respondMethodNotAllowed(res);
            return;
          }
          this.sendJson(res, 200, {
            port: this.listeningPort,
            project: this.agent.getActiveProject()?.projectName ?? null
          });
          return;
        default:
          this.respondNotFound(res);
      }
    } catch (error) {
      logger.error('Dashboard request failed.', error instanceof Error ? error : undefined);
      this.sendJson(res, 500, { error: 'Internal server error' });
    }
  }

  private async serveDashboardAsset(pathname: string, res: ServerResponse): Promise<void> {
    const relativePath = pathname.replace(/^\/dashboard\/?/, '');
    const safeRelativePath = relativePath.length === 0 ? 'index.html' : relativePath;
    const resolvedPath = path.resolve(SMART_EDIT_DASHBOARD_DIR, decodeURIComponent(safeRelativePath));

    if (!resolvedPath.startsWith(path.resolve(SMART_EDIT_DASHBOARD_DIR))) {
      this.respondNotFound(res);
      return;
    }

    try {
      const file = await fs.readFile(resolvedPath);
      const ext = path.extname(resolvedPath).toLowerCase();
      const contentType = CONTENT_TYPE_BY_EXTENSION[ext] ?? 'application/octet-stream';
      res.statusCode = 200;
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', file.length);
      res.end(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.respondNotFound(res);
        return;
      }
      throw error;
    }
  }

  private async handleGetLogMessages(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const requestBody = await this.parseRequestBody(req);
    const startIdxCandidate = requestBody ? this.getNumberFromRecord(requestBody, 'start_idx') : undefined;
    const startIdxRaw = startIdxCandidate ?? 0;
    const startIdx = Number.isFinite(startIdxRaw) && startIdxRaw >= 0 ? Math.floor(startIdxRaw) : 0;

    const logMessages = this.memoryLogHandler.getLogMessages();
    const messages = startIdx <= logMessages.length ? logMessages.slice(startIdx) : [];
    const maxIdx = logMessages.length > 0 ? logMessages.length - 1 : -1;
    const activeProject = this.agent.getActiveProject()?.projectName ?? null;

    const response: LogMessagesResponse = {
      messages,
      maxIdx,
      activeProject
    };

    this.sendJson(res, 200, {
      messages: response.messages,
      max_idx: response.maxIdx,
      active_project: response.activeProject
    });
  }

  private getToolStats(): ToolStatsResponse {
    if (!this.toolUsageStats) {
      return {};
    }
    const stats = this.toolUsageStats.getToolStatsDict();
    const result: ToolStatsResponse = {};
    for (const [toolName, entry] of Object.entries(stats)) {
      const numTimesCalled = typeof entry.numTimesCalled === 'number' ? entry.numTimesCalled : 0;
      const inputTokens = typeof entry.inputTokens === 'number' ? entry.inputTokens : 0;
      const outputTokens = typeof entry.outputTokens === 'number' ? entry.outputTokens : 0;
      result[toolName] = {
        num_times_called: numTimesCalled,
        input_tokens: inputTokens,
        output_tokens: outputTokens
      };
    }
    return result;
  }

  private getNumberFromRecord(record: Record<string, unknown>, key: string): number | undefined {
    const value = record[key];
    return typeof value === 'number' ? value : undefined;
  }

  private async parseRequestBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
    req.setEncoding('utf8');
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch (error) {
      logger.warn('Failed to parse dashboard request payload as JSON.', error instanceof Error ? error : undefined);
      return null;
    }
  }

  private respondNotFound(res: ServerResponse): void {
    res.statusCode = 404;
    res.end('Not found');
  }

  private respondMethodNotAllowed(res: ServerResponse): void {
    res.statusCode = 405;
    res.end('Method not allowed');
  }

  private sendJson(res: ServerResponse, statusCode: number, payload: Record<string, unknown>): void {
    const body = JSON.stringify(payload);
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Length', Buffer.byteLength(body, 'utf-8'));
    res.end(body);
  }
}
