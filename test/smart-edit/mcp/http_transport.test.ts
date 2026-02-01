import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';

import { URL as NodeURL } from 'node:url';

import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types';

import {
  createSmartEditHttpServer,
  SmartEditMCPFactorySingleProcess
} from '../../../src/smart-edit/mcp.js';
import { SmartEditConfig } from '../../../src/smart-edit/config/smart_edit_config.js';
import { SmartEditAgentMode } from '../../../src/smart-edit/config/context_mode.js';
import { FakeAgent } from './test_utils.js';

const PROTOCOL_VERSION = `${LATEST_PROTOCOL_VERSION}`;

interface JsonRpcErrorPayload {
  code: number;
  message: string;
  data?: unknown;
}

interface JsonRpcResponse<Result = unknown> {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: Result;
  error?: JsonRpcErrorPayload;
}

function isJsonRpcResponse<Result>(payload: unknown): payload is JsonRpcResponse<Result> {
  if (typeof payload !== 'object' || payload === null) {
    return false;
  }
  const record = payload as Record<string, unknown>;
  return record.jsonrpc === '2.0' && 'id' in record;
}

function expectJsonRpcResponse<Result>(payload: unknown): asserts payload is JsonRpcResponse<Result> {
  if (!isJsonRpcResponse<Result>(payload)) {
    throw new Error('Unexpected JSON-RPC response payload');
  }
}

describe('Smart-Edit MCP HTTP transport', () => {
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

  async function sendRpc(
    url: NodeURL,
    body: unknown,
    headers: Record<string, string> = {}
  ): Promise<{ status: number; payload: unknown }> {
    const response = await globalThis.fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        ...headers
      },
      body: JSON.stringify(body)
    });
    const payload: unknown = await response.json();
    return { status: response.status, payload };
  }

  it('handles tool calls over Streamable HTTP transport in JSON response mode', async () => {
    const factory = createFactory();
    const server = await createSmartEditHttpServer(factory, {
      host: '127.0.0.1',
      port: 0,
      path: '/mcp',
      sessionIdGenerator: null,
      transportOptions: {
        enableJsonResponse: true
      }
    });

    try {
      const initializeBody = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: PROTOCOL_VERSION,
          clientInfo: {
            name: 'smart-edit-http-test-client',
            version: '0.0.1'
          },
          capabilities: {}
        }
      };

      const initializeResponse = await sendRpc(server.url, initializeBody, {
        'Mcp-Protocol-Version': PROTOCOL_VERSION
      });
      expect(initializeResponse.status).toBe(200);
      const initializePayload: unknown = initializeResponse.payload;
      expectJsonRpcResponse<{ capabilities?: unknown }>(initializePayload);
      expect(initializePayload.error).toBeUndefined();
      expect(initializePayload.result?.capabilities).toBeDefined();
      expect(agentModeSpy).toHaveBeenCalled();

      const message = 'hello via http';
      const echoTool = lastAgent?.tools[0];
      if (!echoTool) {
        throw new Error('Echo tool not registered');
      }
      const directResult = await echoTool.applyEx({ message });
      expect(directResult).toBe(message);
      expect(lastAgent.recordedToolCalls.at(-1)).toMatchObject({
        args: { message },
        result: message
      });

      lastAgent.recordedToolCalls.length = 0;

      const callToolBody = {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'echo',
          arguments: {
            message
          }
        }
      };

      const callResponse = await sendRpc(server.url, callToolBody, {
        'Mcp-Protocol-Version': PROTOCOL_VERSION
      });

      expect(callResponse.status).toBe(200);
      const callPayload: unknown = callResponse.payload;
      expectJsonRpcResponse<{ content?: { type: string; text?: string }[]; isError?: boolean }>(callPayload);
      expect(callPayload.error).toBeUndefined();
      expect(callPayload.result?.content?.[0]?.text).toBe(message);
      expect(lastAgent?.recordedToolCalls.at(-1)).toMatchObject({
        args: { message },
        result: message
      });
    } finally {
      await server.close();
    }
  });

  it('responds with 404 for unmatched paths', async () => {
    const factory = createFactory();
    const server = await createSmartEditHttpServer(factory, {
      host: '127.0.0.1',
      port: 0,
      path: '/mcp',
      sessionIdGenerator: null,
      transportOptions: {
        enableJsonResponse: true
      }
    });

    try {
      const otherUrl = new NodeURL(server.url.toString());
      otherUrl.pathname = '/other';

      const response = await globalThis.fetch(otherUrl, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'ping'
        })
      });

      expect(response.status).toBe(404);
      const payload = (await response.json()) as { error?: { message?: string } };
      expect(payload.error?.message).toBe('Not Found');
    } finally {
      await server.close();
    }
  });
});
