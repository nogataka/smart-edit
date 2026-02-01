import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NodeLanguageServerHandler } from '../../../src/smart-lsp/ls_handler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_SERVER = path.join(__dirname, '../../fixtures/smart-lsp/fake_lsp_server.js');

describe('NodeLanguageServerHandler', () => {
  let handler: NodeLanguageServerHandler;

  beforeEach(() => {
    handler = new NodeLanguageServerHandler({
      cmd: ['node', FIXTURE_SERVER],
      cwd: path.dirname(FIXTURE_SERVER)
    });
    handler.setRequestTimeout(2);
    handler.start();
  });

  afterEach(() => {
    try {
      handler.shutdown();
    } catch (error) {
      void error;
    }
    handler.dispose();
  });

  it('round-trips documentSymbol requests', () => {
    const uri = 'file:///tmp/app.py';
    const result = handler.send.documentSymbol({
      textDocument: { uri },
      options: { includeBody: false }
    }) as { documentSymbols: Record<string, unknown>[] };

    expect(Array.isArray(result.documentSymbols)).toBe(true);
    expect(result.documentSymbols[0]).toMatchObject({ name: 'main' });
  });

  it('forwards notifications without throwing', () => {
    expect(() => handler.notify.didOpenTextDocument({
      textDocument: {
        uri: 'file:///tmp/app.py',
        languageId: 'python',
        version: 1,
        text: 'print(42)\n'
      }
    })).not.toThrow();
  });

  it('raises a timeout when the server does not respond', () => {
    handler.setRequestTimeout(0.25);
    expect(() => (handler as unknown as { sendRequest(method: string, params?: unknown): unknown }).sendRequest('smart-edit/noResponse', {})).toThrowError(/timed out/i);
  });
});
