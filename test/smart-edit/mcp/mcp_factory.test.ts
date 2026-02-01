import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types';

import { SmartEditMCPFactorySingleProcess } from '../../../src/smart-edit/mcp.js';
import { SmartEditConfig } from '../../../src/smart-edit/config/smart_edit_config.js';
import { SmartEditAgentMode } from '../../../src/smart-edit/config/context_mode.js';
import { FakeAgent } from './test_utils.js';

function getRegisteredTool(server: McpServer, name: string): TestRegisteredTool {
  const tracked = Reflect.get(server, '__smartEditRegisteredTools') as Map<string, unknown> | undefined;
  if (tracked?.has(name)) {
    const entry = tracked.get(name);
    if (!isTestRegisteredTool(entry)) {
      throw new Error(`Registered tool ${name} missing callback`);
    }
    return entry;
  }

  const storage = Reflect.get(server, '_registeredTools') as unknown;
  if (!storage || typeof storage !== 'object') {
    throw new Error('Unable to access registered tools for test verification.');
  }

  let entry: unknown;
  if (storage instanceof Map) {
    entry = storage.get(name);
  } else {
    entry = (storage as Record<string, unknown>)[name];
  }

  if (!isTestRegisteredTool(entry)) {
    throw new Error(`Registered tool ${name} missing callback`);
  }
  return entry;
}

function listRegisteredToolNames(server: McpServer): string[] {
  const tracked = Reflect.get(server, '__smartEditRegisteredTools') as Map<string, unknown> | undefined;
  if (tracked) {
    return Array.from(tracked.keys());
  }

  const storage = Reflect.get(server, '_registeredTools') as unknown;
  if (!storage || typeof storage !== 'object') {
    return [];
  }

  if (storage instanceof Map) {
    return Array.from(storage.keys(), (value) => String(value));
  }

  return Object.keys(storage as Record<string, unknown>);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface TestRegisteredTool {
  description?: string;
  annotations?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
  callback: (args: Record<string, unknown>, extra?: Record<string, unknown>) => Promise<CallToolResult>;
}

function isTestRegisteredTool(value: unknown): value is TestRegisteredTool {
  if (!isRecord(value)) {
    return false;
  }
  if ('description' in value && value.description !== undefined && typeof value.description !== 'string') {
    return false;
  }
  if ('annotations' in value && value.annotations !== undefined && !isRecord(value.annotations)) {
    return false;
  }
  if ('_meta' in value && value._meta !== undefined && !isRecord(value._meta)) {
    return false;
  }
  if (typeof value.callback !== 'function') {
    return false;
  }
  return true;
}

function instantiateServer(factory: SmartEditMCPFactorySingleProcess): McpServer {
  const instance = factory.createMcpServer();
  if (!(instance instanceof McpServer)) {
    throw new Error('Expected factory to return an MCP server instance.');
  }
  return instance;
}

describe('SmartEditMCPFactorySingleProcess', () => {
  let config: SmartEditConfig;
  let agentModeSpy: ReturnType<typeof vi.spyOn>;
  let lastAgent: FakeAgent | null = null;

  beforeEach(() => {
    config = new SmartEditConfig({
      projects: [],
      defaultMaxToolAnswerChars: 1_000,
      toolTimeout: 5
    });

    vi.spyOn(SmartEditConfig, 'fromConfigFile').mockImplementation(() => config);
    agentModeSpy = vi.spyOn(SmartEditAgentMode, 'load').mockImplementation(
      (name: string) =>
        new SmartEditAgentMode({
          name,
          prompt: '',
          description: '',
          excludedTools: [],
          includedOptionalTools: []
        })
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    lastAgent = null;
  });

  function createFactory(context = 'desktop-app'): SmartEditMCPFactorySingleProcess {
    return new SmartEditMCPFactorySingleProcess({
      context,
      agentFactory: ({ smartEditConfig }) => {
        const agent = new FakeAgent(smartEditConfig);
        lastAgent = agent;
        return agent;
      }
    });
  }

  it('registers Smart-Edit tools as MCP tools and invokes agent system prompt', async () => {
    const factory = createFactory();
    const server = instantiateServer(factory);
    expect(server).toBeInstanceOf(McpServer);
    expect(agentModeSpy).toHaveBeenCalled();
    expect(lastAgent?.createSystemPromptCalls).toBe(1);

    expect(listRegisteredToolNames(server)).toContain('echo');

    const echo = getRegisteredTool(server, 'echo');
    expect(echo.description).toContain('Echoes the provided message back to the caller');
    expect(echo.annotations ?? {}).toEqual({});
    expect(echo._meta).toBeUndefined();

    const result = await echo.callback({ message: 'hello' }, {});
    expect(result.content?.[0]?.text).toBe('hello');
    expect(lastAgent?.recordedToolCalls).toHaveLength(1);
  });

  it('marks tools as OpenAI compatible when context supports it', () => {
    const factory = createFactory('chatgpt');
    const server = instantiateServer(factory);

    const echo = getRegisteredTool(server, 'echo');

    expect(echo.annotations).toMatchObject({ 'smart-edit/openaiToolCompatible': true });
    expect(echo.annotations?.['smart-edit/openaiToolInputSchema']).toBeDefined();
    expect(echo._meta).toBeUndefined();
  });

  it('applies runtime configuration overrides before instantiating the agent', () => {
    const factory = createFactory();
    factory.createMcpServer({
      enableWebDashboard: false,
      enableGuiLogWindow: true,
      logLevel: 'DEBUG',
      toolTimeout: 42
    });

    expect(config.webDashboard).toBe(false);
    expect(config.guiLogWindowEnabled).toBe(true);
    expect(config.logLevel).toBe(10);
    expect(config.toolTimeout).toBe(42);
  });
});

/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
