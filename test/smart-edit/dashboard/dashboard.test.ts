import { setTimeout as delay } from 'node:timers/promises';
import { TextDecoder } from 'node:util';
import type { ReadableStreamDefaultReader } from 'node:stream/web';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SmartEditDashboardAPI } from '../../../src/smart-edit/dashboard.js';
import { MemoryLogHandler } from '../../../src/smart-edit/util/logging.js';
import { ToolUsageStats } from '../../../src/smart-edit/analytics.js';

interface TestContext {
  stopServer?: () => void;
}

interface FakeProject {
  projectName?: string;
}

class FakeAgent {
  private project: FakeProject | null = null;

  setActiveProject(name: string | null): void {
    this.project = name ? { projectName: name } : null;
  }

  getActiveProject(): FakeProject | null {
    return this.project;
  }
}

async function fetchJson<T>(
  url: string,
  init?: Parameters<typeof globalThis.fetch>[1]
): Promise<T> {
  const response = await globalThis.fetch(url, init);
  const json = (await response.json()) as T;
  return json;
}

describe('SmartEditDashboardAPI', () => {
  const ctx: TestContext = {};

  beforeEach(() => {
    ctx.stopServer = undefined;
  });

  afterEach(async () => {
    if (ctx.stopServer) {
      ctx.stopServer();
      ctx.stopServer = undefined;
      await delay(10);
    }
  });

  it('serves log messages, tool metadata, and handles shutdown', async () => {
    const memoryHandler = new MemoryLogHandler();
    const agent = new FakeAgent();
    agent.setActiveProject('demo-project');

    const toolUsageStats = new ToolUsageStats();
    toolUsageStats.recordToolUsage('echo', 'hello', 'world');

    memoryHandler.handle('INFO Starting Smart-Edit');
    memoryHandler.handle('WARNING Potential issue detected');
    await delay(10);

    const shutdownSpy = vi.fn();
    const api = new SmartEditDashboardAPI(memoryHandler, ['echo', 'plan'], agent, {
      shutdownCallback: shutdownSpy,
      toolUsageStats
    });

    const [thread, port] = await api.runInThread();
    ctx.stopServer = () => thread.stop();

    await delay(50);
    const baseUrl = `http://127.0.0.1:${port}`;

    const names = await fetchJson<{ tool_names: string[] }>(`${baseUrl}/get_tool_names`);
    expect(names.tool_names).toEqual(['echo', 'plan']);

    const logs = await fetchJson<{ messages: string[]; max_idx: number; active_project: string | null }>(
      `${baseUrl}/get_log_messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start_idx: 0 })
      }
    );
    expect(logs.messages).toHaveLength(2);
    expect(logs.active_project).toBe('demo-project');
    expect(logs.max_idx).toBe(1);

    const stats = await fetchJson<{ stats: Record<string, { num_times_called: number; input_tokens: number }> }>(
      `${baseUrl}/get_tool_stats`
    );
    expect(stats.stats.echo?.num_times_called).toBe(1);

    await fetchJson(`${baseUrl}/clear_tool_stats`, { method: 'POST' });
    const clearedStats = await fetchJson<{ stats: Record<string, unknown> }>(`${baseUrl}/get_tool_stats`);
    expect(clearedStats.stats).toEqual({});

    const estimator = await fetchJson<{ token_count_estimator_name: string }>(
      `${baseUrl}/get_token_count_estimator_name`
    );
    expect(estimator.token_count_estimator_name.length).toBeGreaterThan(0);

    const shutdownResponse = await fetchJson<{ status: string }>(`${baseUrl}/shutdown`, { method: 'PUT' });
    expect(shutdownResponse.status).toBe('shutting down');
    expect(shutdownSpy).toHaveBeenCalledTimes(1);
  });

  it('serves dashboard assets from the bundled directory', async () => {
    const memoryHandler = new MemoryLogHandler();
    const agent = new FakeAgent();

    const api = new SmartEditDashboardAPI(memoryHandler, [], agent);
    const [thread, port] = await api.runInThread();
    ctx.stopServer = () => thread.stop();
    await delay(50);

    const response = await globalThis.fetch(`http://127.0.0.1:${port}/dashboard/index.html`);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('<title>Smart Edit Dashboard</title>');
  });

  it('streams log updates over SSE', async () => {
    const memoryHandler = new MemoryLogHandler();
    const agent = new FakeAgent();
    agent.setActiveProject('stream-project');

    memoryHandler.handle('INFO Initial log entry');
    await delay(20);

    const api = new SmartEditDashboardAPI(memoryHandler, ['echo'], agent);
    const [thread, port] = await api.runInThread();
    ctx.stopServer = () => thread.stop();
    await delay(50);

    const response = await globalThis.fetch(`http://127.0.0.1:${port}/log_stream`);
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    if (!reader) {
      return;
    }

    const streamReader = reader as ReadableStreamDefaultReader<Uint8Array>;

    const decoder = new TextDecoder();
    let buffer = '';

    const extractEvent = (): { name: string; data: unknown } | null => {
      while (true) {
        const separatorIndex = buffer.indexOf('\n\n');
        if (separatorIndex === -1) {
          return null;
        }
        const rawEvent = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        if (!rawEvent || rawEvent.startsWith(':')) {
          continue;
        }
        const event = parseSse(rawEvent);
        if (event) {
          return event;
        }
      }
    };

    const nextEvent = async (): Promise<{ name: string; data: unknown }> => {
      while (true) {
        const bufferedEvent = extractEvent();
        if (bufferedEvent) {
          return bufferedEvent;
        }
        const chunk = await streamReader.read();
        expect(chunk.done).toBe(false);
        const value = chunk.value ?? new Uint8Array();
        buffer += decoder.decode(value, { stream: true });
      }
    };

    const parseSse = (raw: string): { name: string; data: unknown } | null => {
      const lines = raw.split('\n');
      let name = 'message';
      const dataLines: string[] = [];
      for (const line of lines) {
        if (line.startsWith('event:')) {
          name = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trim());
        }
      }
      if (dataLines.length === 0) {
        return null;
      }
      const payloadText = dataLines.join('\n');
      const data = JSON.parse(payloadText) as unknown;
      return { name, data };
    };

    const waitForEvent = async (label: string) => {
      return Promise.race([
        nextEvent(),
        delay(2000).then(() => {
          throw new Error(`${label} event timed out`);
        })
      ]);
    };

    const toolNamesEvent = await waitForEvent('toolNames');
    expect(toolNamesEvent.name).toBe('toolNames');
    expect(toolNamesEvent.data).toMatchObject({ toolNames: ['echo'] });

    const historyEvent = await waitForEvent('history');
    expect(historyEvent.name).toBe('history');
    const historyPayload = historyEvent.data as { messages?: string[]; maxIdx?: number; activeProject?: string | null };
    expect(historyPayload.messages).toContainEqual(expect.stringContaining('Initial log entry'));
    expect(historyPayload.activeProject).toBe('stream-project');

    memoryHandler.handle('WARNING New issue detected');
    await delay(30);

    const logEvent = await waitForEvent('log');
    expect(logEvent.name).toBe('log');
    const logPayload = logEvent.data as { message?: string; idx?: number; activeProject?: string | null };
    expect(logPayload.message).toContain('WARNING');
    expect(logPayload.idx).toBeGreaterThanOrEqual(1);
    expect(logPayload.activeProject).toBe('stream-project');

    await reader.cancel();
  });
});
