import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MemoryLogHandler,
  createSmartEditLogger,
  formatLogMessage,
  type SmartEditLogMessage
} from '../../../src/smart-edit/util/logging.js';

describe('MemoryLogHandler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stores emitted log messages', async () => {
    vi.useFakeTimers();
    const handler = new MemoryLogHandler();
    handler.handle('test message');
    await vi.runOnlyPendingTimersAsync();
    expect(handler.getLogMessages()).toEqual(['test message']);
  });

  it('invokes registered callbacks', async () => {
    vi.useFakeTimers();
    const handler = new MemoryLogHandler();
    const callback = vi.fn();
    handler.addEmitCallback(callback);
    handler.handle('hello');
    await vi.runOnlyPendingTimersAsync();
    expect(callback).toHaveBeenCalledWith('hello');
  });
});

describe('createSmartEditLogger', () => {
  it('writes messages above log level to memory handler', async () => {
    vi.useFakeTimers();
    const memoryHandler = new MemoryLogHandler();
    const { logger } = createSmartEditLogger({
      level: 'debug',
      emitToConsole: false,
      memoryHandler
    });

    logger.debug('debug message');
    logger.trace('trace message');

    await vi.runOnlyPendingTimersAsync();

    expect(memoryHandler.getLogMessages()).toHaveLength(1);
    expect(memoryHandler.getLogMessages()[0]).toContain('debug message');
  });

  it('appends error metadata to formatted messages', async () => {
    vi.useFakeTimers();
    const memoryHandler = new MemoryLogHandler();
    const { logger } = createSmartEditLogger({ emitToConsole: false, memoryHandler });
    const error = new Error('boom');

    logger.error('fatal issue', error);
    await vi.runOnlyPendingTimersAsync();

    const message = memoryHandler.getLogMessages()[0];
    expect(message).toContain('fatal issue');
    expect(message).toContain('error=boom');
  });
});

describe('formatLogMessage', () => {
  it('formats message using SMART_EDIT_LOG_FORMAT fallback', () => {
    const base: SmartEditLogMessage = {
      timestamp: new Date('2024-01-02T03:04:05Z'),
      level: 'info',
      message: 'hello world',
      loggerName: 'TestLogger'
    };

    const result = formatLogMessage(base);
    expect(result).toContain('INFO');
    expect(result).toContain('hello world');
    expect(result).toContain('TestLogger');
  });
});
