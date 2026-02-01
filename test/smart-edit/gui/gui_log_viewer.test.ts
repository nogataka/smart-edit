import { setTimeout } from 'node:timers';
import { TextDecoder } from 'node:util';
import type { ReadableStreamDefaultReader } from 'node:stream/web';

import { afterEach, describe, expect, it } from 'vitest';

import { GuiLogViewer } from '../../../src/smart-edit/gui_log_viewer.js';
import { MemoryLogHandler } from '../../../src/smart-edit/util/logging.js';

interface TestContext {
  viewer?: GuiLogViewer;
}

interface SseStreamState {
  decoder: TextDecoder;
  buffer: string;
}

function createSseStreamState(): SseStreamState {
  return { decoder: new TextDecoder(), buffer: '' };
}

async function waitForSseEvent(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  state: SseStreamState,
  eventName: string,
  timeoutMs = 2000
): Promise<string> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Timed out waiting for event '${eventName}'`)), timeoutMs);
  });

  const readPromise = (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        throw new Error(`Stream ended before event '${eventName}' was received`);
      }
      state.buffer += state.decoder.decode(value, { stream: true });
      const segments = state.buffer.split('\n\n');
      const hasTrailingSeparator = state.buffer.endsWith('\n\n');
      if (!hasTrailingSeparator) {
        state.buffer = segments.pop() ?? '';
      } else {
        state.buffer = '';
      }

      for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index];
        const lines = segment.split('\n');
        let currentEvent = 'message';
        const dataLines: string[] = [];
        for (const line of lines) {
          if (line.startsWith('event:')) {
            currentEvent = line.slice('event:'.length).trim();
          } else if (line.startsWith('data:')) {
            dataLines.push(line.slice('data:'.length).trim());
          }
        }
        if (currentEvent === eventName) {
          const remainingSegments = segments.slice(index + 1);
          if (!hasTrailingSeparator && state.buffer) {
            remainingSegments.push(state.buffer);
            state.buffer = '';
          }
          state.buffer = remainingSegments.join('\n\n');
          return dataLines.join('\n');
        }
      }
    }
  })();

  return Promise.race([readPromise, timeoutPromise]);
}

describe('GuiLogViewer', () => {
  const ctx: TestContext = {};

  afterEach(async () => {
    if (ctx.viewer) {
      await ctx.viewer.stop();
      ctx.viewer = undefined;
    }
  });

  it('streams log messages via SSE connection', async () => {
    const handler = new MemoryLogHandler();
    const viewer = new GuiLogViewer('test', {
      title: 'Test Viewer',
      memoryLogHandler: handler,
      host: '127.0.0.1',
      autoOpen: false
    });
    ctx.viewer = viewer;

    await viewer.start();
    const baseUrl = viewer.getBaseUrl();
    expect(baseUrl).toBeTruthy();

    const controller = new globalThis.AbortController();
    const response = await globalThis.fetch(`${baseUrl}/events`, { signal: controller.signal });
    expect(response.status).toBe(200);

    const reader = response.body?.getReader() as ReadableStreamDefaultReader<Uint8Array> | undefined;
    expect(reader).toBeDefined();
    if (!reader) {
      controller.abort();
      return;
    }

    const state = createSseStreamState();

    // consume initial bootstrap events
    await waitForSseEvent(reader, state, 'toolNames');

    handler.handle('INFO Example log message');
    const payload = await waitForSseEvent(reader, state, 'log');
    const event = JSON.parse(payload) as { message: string; level: string };
    expect(event.message).toContain('INFO Example log message');
    expect(event.level).toBe('info');

    controller.abort();
    reader.releaseLock();
  });

  it('pushes tool name updates to connected clients', async () => {
    const viewer = new GuiLogViewer('test', {
      title: 'Tool Viewer',
      host: '127.0.0.1',
      autoOpen: false
    });
    ctx.viewer = viewer;

    await viewer.start();
    const baseUrl = viewer.getBaseUrl();
    expect(baseUrl).toBeTruthy();

    const controller = new globalThis.AbortController();
    const response = await globalThis.fetch(`${baseUrl}/events`, { signal: controller.signal });
    expect(response.status).toBe(200);

    const reader = response.body?.getReader() as ReadableStreamDefaultReader<Uint8Array> | undefined;
    expect(reader).toBeDefined();
    if (!reader) {
      controller.abort();
      return;
    }

    const state = createSseStreamState();

    // initial empty tool list followed by history
    const initialToolPayload = await waitForSseEvent(reader, state, 'toolNames');
    expect(JSON.parse(initialToolPayload)).toEqual([]);

    viewer.setToolNames(['ToolA', 'ToolB']);
    const updatePayload = await waitForSseEvent(reader, state, 'toolNames');
    expect(JSON.parse(updatePayload)).toEqual(['ToolA', 'ToolB']);

    controller.abort();
    reader.releaseLock();
  });
});
