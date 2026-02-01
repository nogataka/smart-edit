import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { parse as parseUrl } from 'node:url';
import { spawn } from 'node:child_process';

import { ensureDefaultSubprocessOptions } from '../smart-lsp/util/subprocess_util.js';
import { createSmartEditLogger, MemoryLogHandler } from './util/logging.js';

const { logger } = createSmartEditLogger({ name: 'smart-edit.gui_log_viewer', emitToConsole: false, level: 'info' });

const LOG_HISTORY_LIMIT = 500;

type GuiLogLevel = 'debug' | 'info' | 'warning' | 'error' | 'default';

interface LogEntry {
  id: number;
  message: string;
  level: GuiLogLevel;
  timestamp: number;
}

export interface GuiLogViewerOptions {
  title?: string;
  memoryLogHandler?: MemoryLogHandler;
  host?: string;
  port?: number;
  autoOpen?: boolean;
  historyLimit?: number;
}

function determineLogLevel(message: string): GuiLogLevel {
  const trimmed = message.trimStart().toUpperCase();
  if (trimmed.startsWith('DEBUG')) {
    return 'debug';
  }
  if (trimmed.startsWith('INFO')) {
    return 'info';
  }
  if (trimmed.startsWith('WARNING') || trimmed.startsWith('WARN')) {
    return 'warning';
  }
  if (trimmed.startsWith('ERROR') || trimmed.startsWith('FATAL')) {
    return 'error';
  }
  return 'default';
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function launchBrowser(url: string): void {
  try {
    if (process.platform === 'darwin') {
      const child = spawn('open', [url], ensureDefaultSubprocessOptions({ stdio: 'ignore', detached: true }));
      child.unref();
    } else if (process.platform === 'win32') {
      const child = spawn(
        'cmd',
        ['/c', 'start', '', url],
        ensureDefaultSubprocessOptions({ stdio: 'ignore', detached: true, windowsHide: true })
      );
      child.unref();
    } else {
      const child = spawn('xdg-open', [url], ensureDefaultSubprocessOptions({ stdio: 'ignore', detached: true }));
      child.unref();
    }
  } catch (error) {
    logger.warn('Failed to open browser for GUI log viewer', error instanceof Error ? error : undefined);
  }
}

export class GuiLogViewer {
  private readonly channel: string;
  private readonly title: string;
  private readonly memoryLogHandler?: MemoryLogHandler;
  private readonly host: string;
  private readonly requestedPort: number | undefined;
  private readonly autoOpen: boolean;
  private readonly historyLimit: number;

  private toolNames: string[] = [];
  private started = false;
  private server: ReturnType<typeof createServer> | null = null;
  private readonly sseClients = new Set<ServerResponse>();
  private readonly history: LogEntry[] = [];
  private memoryCallback?: (message: string) => void;
  private readyPromise: Promise<void> | null = null;
  private port: number | null = null;
  private logSequence = 0;

  constructor(channel: string, options: GuiLogViewerOptions = {}) {
    this.channel = channel;
    this.title = options.title ?? 'Smart-Edit Logs';
    this.memoryLogHandler = options.memoryLogHandler;
    this.host = options.host ?? '127.0.0.1';
    this.requestedPort = options.port;
    this.autoOpen = options.autoOpen ?? false;
    this.historyLimit = options.historyLimit ?? LOG_HISTORY_LIMIT;

    if (this.memoryLogHandler) {
      for (const message of this.memoryLogHandler.getLogMessages()) {
        this.recordLogMessage(message);
      }
    }
  }

  async start(): Promise<void> {
    if (this.started) {
      await this.readyPromise;
      return;
    }
    this.started = true;

    this.server = createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    this.readyPromise = new Promise((resolve, reject) => {
      if (!this.server) {
        reject(new Error('Server not initialised'));
        return;
      }

      this.server.once('error', (error) => {
        logger.error('GUI log viewer server encountered an error while starting', error instanceof Error ? error : undefined);
        reject(error instanceof Error ? error : new Error(String(error)));
      });

      this.server.listen(
        { host: this.host, port: this.requestedPort ?? 0, exclusive: true },
        () => {
          const address = this.server?.address();
          if (address && typeof address === 'object') {
            this.port = address.port;
            logger.info(`GUI log viewer '${this.title}' listening on http://${this.host}:${this.port}/`);
          } else {
            logger.info(`GUI log viewer '${this.title}' started.`);
          }
          resolve();
        }
      );
    });

    if (this.memoryLogHandler) {
      this.memoryCallback = (message: string) => {
        this.recordLogMessage(message);
        this.broadcastLog();
      };
      this.memoryLogHandler.addEmitCallback(this.memoryCallback);
    }

    await this.readyPromise;

    if (this.autoOpen) {
      const url = this.getBaseUrl();
      if (url) {
        launchBrowser(`${url}/`);
      }
    }
  }

  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }

    if (this.memoryLogHandler && this.memoryCallback) {
      this.memoryLogHandler.removeEmitCallback(this.memoryCallback);
    }

    for (const client of this.sseClients) {
      try {
        client.end();
      } catch {
        // ignore
      }
    }
    this.sseClients.clear();

    await new Promise<void>((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => resolve());
    });

    this.server = null;
    this.started = false;
    this.readyPromise = null;
    logger.info(`GUI log viewer '${this.title}' stopped.`);
  }

  setToolNames(toolNames: string[]): void {
    this.toolNames = [...toolNames];
    this.broadcast('toolNames', this.toolNames);
  }

  addLog(message: string): void {
    this.recordLogMessage(message);
    this.broadcastLog();
  }

  getBaseUrl(): string | null {
    if (this.port === null) {
      return null;
    }
    return `http://${this.host}:${this.port}`;
  }

  private recordLogMessage(message: string): void {
    const entry: LogEntry = {
      id: this.logSequence++,
      message,
      level: determineLogLevel(message),
      timestamp: Date.now()
    };

    this.history.push(entry);
    if (this.history.length > this.historyLimit) {
      this.history.splice(0, this.history.length - this.historyLimit);
    }
  }

  private broadcastLog(): void {
    const entry = this.history[this.history.length - 1];
    if (!entry) {
      return;
    }
    this.broadcast('log', entry);
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const parsed = parseUrl(req.url ?? '/');
    const pathname = parsed.pathname ?? '/';

    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      this.handleIndexRequest(res);
      return;
    }

    if (req.method === 'GET' && pathname === '/events') {
      this.handleEventStream(res);
      return;
    }

    if (req.method === 'GET' && pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', channel: this.channel }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  }

  private handleIndexRequest(res: ServerResponse): void {
    const html = this.renderHtmlPage();
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache'
    });
    res.end(html);
  }

  private handleEventStream(res: ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });

    res.write(`event: toolNames\ndata: ${JSON.stringify(this.toolNames)}\n\n`);
    res.write(`event: history\ndata: ${JSON.stringify(this.history)}\n\n`);

    this.sseClients.add(res);
    reqOnClose(res, () => {
      this.sseClients.delete(res);
    });
  }

  private broadcast(event: string, payload: unknown): void {
    const data = JSON.stringify(payload);
    for (const client of this.sseClients) {
      try {
        client.write(`event: ${event}\ndata: ${data}\n\n`);
      } catch (error) {
        logger.warn('Failed to deliver GUI log viewer event', error instanceof Error ? error : undefined);
      }
    }
  }

  private renderHtmlPage(): string {
    const safeTitle = escapeHtml(this.title);
    const channelLabel = escapeHtml(this.channel);
    return `<!DOCTYPE html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: "Segoe UI", system-ui, sans-serif;
        background-color: #111;
        color: #f1f1f1;
      }
      body {
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        min-height: 100vh;
      }
      header {
        padding: 16px;
        background: #1d1d1d;
        border-bottom: 1px solid #333;
      }
      h1 {
        margin: 0;
        font-size: 20px;
      }
      #channel {
        font-size: 12px;
        opacity: 0.7;
      }
      #tool-list {
        margin-top: 8px;
        font-size: 12px;
        line-height: 1.6;
        color: #bbb;
      }
      #log-container {
        flex: 1;
        overflow-y: auto;
        padding: 12px;
        font-size: 13px;
        line-height: 1.5;
        background: #0b0b0b;
      }
      .log-entry {
        padding: 4px 8px;
        border-radius: 4px;
        margin-bottom: 6px;
        white-space: pre-wrap;
        word-break: break-word;
        font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
      }
      .level-debug { color: #8ab4f8; }
      .level-info { color: #e8eaed; }
      .level-warning { color: #fbbc04; }
      .level-error { color: #f28b82; }
      .level-default { color: #e8eaed; }
      .tool-name {
        background: rgba(0, 150, 255, 0.2);
        padding: 0 2px;
        border-radius: 2px;
      }
      footer {
        padding: 8px 16px;
        font-size: 11px;
        background: #1d1d1d;
        border-top: 1px solid #333;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
    </style>
  </head>
  <body>
    <header>
      <h1>${safeTitle}</h1>
      <div id="channel">Channel: ${channelLabel}</div>
      <div id="tool-list">Tools: なし</div>
    </header>
    <main id="log-container" aria-live="polite"></main>
    <footer>
      <span>Smart-Edit GUI Log Viewer</span>
      <span id="status">接続中...</span>
    </footer>
    <script type="module">
      const logContainer = document.getElementById('log-container');
      const statusLabel = document.getElementById('status');
      const toolList = document.getElementById('tool-list');

      let toolNames = [];
      const SPECIAL_CHARS_PATTERN = '[.*+?^' + String.fromCharCode(36) + '{}()|[\\\\]\\\\\\\\]';
      const SPECIAL_CHARS_REGEX = new RegExp(SPECIAL_CHARS_PATTERN, 'g');

      function escapeHtml(str) {
        return str.replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }

      function highlightTools(text) {
        if (!toolNames.length) {
          return escapeHtml(text);
        }
        let escaped = escapeHtml(text);
        for (const tool of toolNames) {
          if (!tool) continue;
          const escapedTool = escapeHtml(tool);
          const regex = new RegExp('(\\\\b' + escapedTool.replace(SPECIAL_CHARS_REGEX, '\\\\$&') + '\\\\b)', 'g');
          escaped = escaped.replace(regex, '<span class="tool-name">$1</span>');
        }
        return escaped;
      }

      function appendLog(entry) {
        const div = document.createElement('div');
        div.className = 'log-entry level-' + (entry.level ?? 'default');
        const time = new Date(entry.timestamp ?? Date.now());
        const timeLabel = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        div.innerHTML = '<strong>[' + timeLabel + ']</strong> ' + highlightTools(entry.message ?? '');
        const shouldScroll = logContainer.scrollTop + logContainer.clientHeight >= logContainer.scrollHeight - 10;
        logContainer.appendChild(div);
        if (shouldScroll) {
          logContainer.scrollTop = logContainer.scrollHeight;
        }
      }

      function renderToolList() {
        toolList.textContent = toolNames.length ? 'Tools: ' + toolNames.join(', ') : 'Tools: なし';
      }

      function connect() {
        const eventSource = new EventSource('./events');
        eventSource.addEventListener('open', () => {
          statusLabel.textContent = '接続済み';
        });
        eventSource.addEventListener('error', () => {
          statusLabel.textContent = '切断されました。再接続しています...';
        });
        eventSource.addEventListener('toolNames', (event) => {
          try {
            toolNames = JSON.parse(event.data) ?? [];
            renderToolList();
          } catch (error) {
            console.error('Failed to parse tool names', error);
          }
        });
        eventSource.addEventListener('history', (event) => {
          try {
            const history = JSON.parse(event.data) ?? [];
            logContainer.textContent = '';
            for (const entry of history) {
              appendLog(entry);
            }
          } catch (error) {
            console.error('Failed to parse log history', error);
          }
        });
        eventSource.addEventListener('log', (event) => {
          try {
            const entry = JSON.parse(event.data);
            appendLog(entry);
          } catch (error) {
            console.error('Failed to parse log entry', error);
          }
        });
      }

      connect();
    </script>
  </body>
</html>`;
  }
}

function reqOnClose(res: ServerResponse, handler: () => void): void {
  res.on('close', handler);
  res.on('error', handler);
  res.on('finish', handler);
}

export async function showFatalException(error: unknown): Promise<void> {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  const handler = new MemoryLogHandler();
  const viewer = new GuiLogViewer('error', {
    title: 'Smart-Edit Fatal Exception',
    memoryLogHandler: handler,
    autoOpen: true
  });
  await viewer.start();
  handler.handle(`ERROR Fatal exception: ${message}`);
  logger.error('Fatal exception reported to GUI log viewer', error instanceof Error ? error : undefined);
}
