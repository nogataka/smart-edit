/**
 * Standalone Dashboard Server for Multi-Instance Mode
 *
 * This server runs independently from MCP servers and provides:
 * - Static file serving for the dashboard UI
 * - API endpoints to list registered instances
 * - Proxy capabilities to forward requests to individual MCP instances
 */

import { Buffer } from 'node:buffer';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { parse as parseUrl } from 'node:url';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { createSmartEditLogger } from './util/logging.js';
import { SMART_EDIT_DASHBOARD_DIR } from './constants.js';
import { getInstances, DEFAULT_DASHBOARD_PORT } from './instance-registry.js';

const { logger } = createSmartEditLogger({ name: 'smart-edit.standalone-dashboard', emitToConsole: true, level: 'info' });

const DASHBOARD_HOST = '127.0.0.1';

const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon'
};

export interface StandaloneDashboardOptions {
  port?: number;
}

export class StandaloneDashboardServer {
  private server: Server | null = null;
  private listeningPort: number | null = null;
  private readonly requestedPort: number;

  constructor(options: StandaloneDashboardOptions = {}) {
    this.requestedPort = options.port ?? DEFAULT_DASHBOARD_PORT;
  }

  async start(): Promise<number> {
    if (this.server && this.listeningPort !== null) {
      return this.listeningPort;
    }

    const { server, port } = await this.startServer();
    this.server = server;
    this.listeningPort = port;

    logger.info(`Smart-Edit standalone dashboard listening on http://${DASHBOARD_HOST}:${port}/dashboard/`);
    return port;
  }

  stop(): void {
    if (this.server) {
      this.server.close((error) => {
        if (error) {
          logger.warn('Failed to stop standalone dashboard server cleanly.', error);
        }
      });
      this.server = null;
      this.listeningPort = null;
    }
  }

  getPort(): number | null {
    return this.listeningPort;
  }

  private async startServer(): Promise<{ server: Server; port: number }> {
    let candidatePort = this.requestedPort;
    let lastError: NodeJS.ErrnoException | null = null;

    while (candidatePort <= 65535) {
      const server = createServer((req, res) => {
        void this.handleRequest(req, res);
      });

      try {
        const port = await this.listenOnPort(server, candidatePort);
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

        logger.error('Failed to start standalone dashboard server.', lastError ?? undefined);
        break;
      }
    }

    throw new Error(
      lastError?.message ?? 'Unable to start standalone dashboard server; no available ports.'
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

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method?.toUpperCase() ?? 'GET';
    const url = parseUrl(req.url ?? '/', true);
    const pathname = url.pathname ?? '/';

    // Add CORS headers for cross-origin requests from dashboard UI to MCP instances
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    try {
      // Redirect root to dashboard
      if (pathname === '/' || pathname === '') {
        res.statusCode = 302;
        res.setHeader('Location', '/dashboard/');
        res.end();
        return;
      }

      if (pathname.startsWith('/dashboard')) {
        if (method !== 'GET') {
          this.respondMethodNotAllowed(res);
          return;
        }
        await this.serveDashboardAsset(pathname, res);
        return;
      }

      // API endpoints for multi-instance mode
      if (pathname === '/api/instances') {
        if (method !== 'GET') {
          this.respondMethodNotAllowed(res);
          return;
        }
        this.handleGetInstances(res);
        return;
      }

      this.respondNotFound(res);
    } catch (error) {
      logger.error('Standalone dashboard request failed.', error instanceof Error ? error : undefined);
      this.sendJson(res, 500, { error: 'Internal server error' });
    }
  }

  private handleGetInstances(res: ServerResponse): void {
    const instances = getInstances();
    this.sendJson(res, 200, { instances });
  }

  private async serveDashboardAsset(pathname: string, res: ServerResponse): Promise<void> {
    let relativePath = pathname.replace(/^\/dashboard\/?/, '');

    // Handle directory requests
    if (relativePath === '' || relativePath.endsWith('/')) {
      relativePath = relativePath + 'index.html';
    }

    const resolvedPath = path.resolve(SMART_EDIT_DASHBOARD_DIR, decodeURIComponent(relativePath));

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

/**
 * Start a standalone dashboard server and wait for shutdown signal.
 */
export async function runStandaloneDashboard(options: StandaloneDashboardOptions = {}): Promise<void> {
  const server = new StandaloneDashboardServer(options);
  const port = await server.start();

  console.log(`Smart-Edit Dashboard is running at: http://127.0.0.1:${port}/dashboard/`);
  console.log('Press Ctrl+C to stop.');

  await new Promise<void>((resolve) => {
    const shutdown = () => {
      console.log('\nShutting down dashboard...');
      server.stop();
      resolve();
    };

    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
}
