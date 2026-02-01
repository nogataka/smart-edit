import { setImmediate } from 'node:timers';

import { SMART_EDIT_LOG_FORMAT } from '../constants.js';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60
};

export interface SmartEditLogger {
  trace(message: string, meta?: unknown): void;
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
  fatal(message: string, meta?: unknown): void;
}

export interface SmartEditLoggerOptions {
  level?: LogLevel;
  memoryHandler?: MemoryLogHandler;
  emitToConsole?: boolean;
  name?: string;
}

let consoleLoggingEnabled = true;

export function setConsoleLoggingEnabled(enabled: boolean): void {
  consoleLoggingEnabled = enabled;
}

export function isConsoleLoggingEnabled(): boolean {
  return consoleLoggingEnabled;
}

export interface SmartEditLogMessage {
  timestamp: Date;
  level: LogLevel;
  message: string;
  meta?: unknown;
  loggerName: string;
}

export class LogBuffer {
  private readonly logMessages: string[] = [];

  append(message: string): void {
    this.logMessages.push(message);
  }

  getLogMessages(): string[] {
    return [...this.logMessages];
  }
}

export type EmitCallback = (message: string) => void;

export class MemoryLogHandler {
  private readonly buffer = new LogBuffer();
  private readonly callbacks = new Set<EmitCallback>();
  private queue: string[] = [];
  private draining = false;

  addEmitCallback(callback: EmitCallback): void {
    this.callbacks.add(callback);
  }

  removeEmitCallback(callback: EmitCallback): void {
    this.callbacks.delete(callback);
  }

  handle(message: string): void {
    this.queue.push(message);
    if (!this.draining) {
      this.draining = true;
      setImmediate(() => this.flush());
    }
  }

  getLogMessages(): string[] {
    return this.buffer.getLogMessages();
  }

  private flush(): void {
    while (this.queue.length > 0) {
      const message = this.queue.shift();
      if (message === undefined) {
        continue;
      }
      this.buffer.append(message);
      for (const callback of this.callbacks) {
        try {
          callback(message);
        } catch {
          // ignore listener errors to avoid breaking logging pipeline
        }
      }
    }
    this.draining = false;
  }
}

class SmartEditConsoleLogger implements SmartEditLogger {
  private readonly level: LogLevel;
  private readonly emitToConsole: boolean;
  private memoryHandler?: MemoryLogHandler;
  private readonly loggerName: string;

  constructor(options: Required<Pick<SmartEditLoggerOptions, 'level' | 'emitToConsole'>> & {
    memoryHandler?: MemoryLogHandler;
    name?: string;
  }) {
    this.level = options.level;
    this.emitToConsole = options.emitToConsole;
    this.memoryHandler = options.memoryHandler;
    this.loggerName = options.name ?? 'SmartEditLogger';
  }

  trace(message: string, meta?: unknown): void {
    this.log('trace', message, meta);
  }

  debug(message: string, meta?: unknown): void {
    this.log('debug', message, meta);
  }

  info(message: string, meta?: unknown): void {
    this.log('info', message, meta);
  }

  warn(message: string, meta?: unknown): void {
    this.log('warn', message, meta);
  }

  error(message: string, meta?: unknown): void {
    this.log('error', message, meta);
  }

  fatal(message: string, meta?: unknown): void {
    this.log('fatal', message, meta);
  }

  setMemoryHandler(memoryHandler?: MemoryLogHandler): void {
    this.memoryHandler = memoryHandler;
  }

  private log(level: LogLevel, message: string, meta?: unknown): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) {
      return;
    }

    const formatted = formatLogMessage({
      timestamp: new Date(),
      level,
      message,
      meta,
      loggerName: this.loggerName
    });

    this.memoryHandler?.handle(formatted);

    if (!this.emitToConsole || !consoleLoggingEnabled) {
      return;
    }

    const consoleMessage = meta instanceof Error && meta.stack
      ? `${formatted}\n${meta.stack}`
      : formatted;

    switch (level) {
      case 'trace':
        console.trace(consoleMessage);
        break;
      case 'debug':
        console.debug(consoleMessage);
        break;
      case 'info':
        console.info(consoleMessage);
        break;
      case 'warn':
        console.warn(consoleMessage);
        break;
      case 'error':
      case 'fatal':
        console.error(consoleMessage);
        break;
      default:
        console.log(consoleMessage);
    }
  }
}

const sharedLoggers = new Set<SmartEditConsoleLogger>();
let sharedMemoryHandler: MemoryLogHandler | null = null;

function getOrCreateSharedMemoryHandler(): MemoryLogHandler {
  sharedMemoryHandler ??= new MemoryLogHandler();
  return sharedMemoryHandler;
}

export function createSmartEditLogger(options: SmartEditLoggerOptions = {}): {
  logger: SmartEditLogger;
  memoryHandler: MemoryLogHandler;
} {
  const useSharedHandler = options.memoryHandler === undefined;
  const memoryHandler = useSharedHandler ? getOrCreateSharedMemoryHandler() : options.memoryHandler!;
  const emitToConsole = (options.emitToConsole ?? true) && consoleLoggingEnabled;
  const loggerInstance = new SmartEditConsoleLogger({
    level: options.level ?? 'info',
    emitToConsole,
    memoryHandler,
    name: options.name
  });

  if (useSharedHandler) {
    sharedLoggers.add(loggerInstance);
  }

  return { logger: loggerInstance, memoryHandler };
}

export function formatLogMessage(message: SmartEditLogMessage): string {
  const level = message.level.toUpperCase().padEnd(5).slice(0, 5);
  const timestamp = message.timestamp.toISOString().replace('T', ' ').replace('Z', '');
  const threadName = 'main';
  const location = `${message.loggerName}:log`;

  let formatted = SMART_EDIT_LOG_FORMAT.replace('%(levelname)-5s', level)
    .replace('%(asctime)-15s', timestamp.padEnd(15).slice(0, 15))
    .replace('%(threadName)s', threadName)
    .replace('%(name)s', message.loggerName)
    .replace('%(funcName)s', 'log')
    .replace('%(lineno)d', '0')
    .replace('%(message)s', enrichMessage(message.message, message.meta));

  if (!SMART_EDIT_LOG_FORMAT.includes('%(name)s:%(funcName)s:%(lineno)d')) {
    formatted = `${level} ${timestamp} [${threadName}] ${location} - ${enrichMessage(
      message.message,
      message.meta
    )}`;
  }

  return formatted;
}

function enrichMessage(message: string, meta?: unknown): string {
  if (meta === undefined || meta === null) {
    return message;
  }

  if (meta instanceof Error) {
    return `${message} | error=${meta.message}`;
  }

  if (typeof meta === 'object') {
    try {
      return `${message} | ${JSON.stringify(meta)}`;
    } catch {
      return `${message} | [unserializable meta]`;
    }
  }

  if (typeof meta === 'string') {
    return `${message} | ${meta}`;
  }

  if (typeof meta === 'number' || typeof meta === 'boolean' || typeof meta === 'bigint') {
    return `${message} | ${meta.toString()}`;
  }

  if (typeof meta === 'symbol') {
    return `${message} | ${meta.toString()}`;
  }

  if (typeof meta === 'function') {
    return `${message} | [function]`;
  }

  return message;
}
