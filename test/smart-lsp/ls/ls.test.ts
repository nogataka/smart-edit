import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type DocumentSymbolResult,
  type ReferenceInSymbol,
  type SmartLanguageServerHandler,
  SmartLanguageServer,
  type UnifiedSymbolInformation
} from '../../../src/smart-lsp/ls.js';
import { Language } from '../../../src/smart-lsp/ls_config.js';

class FakeHandler implements SmartLanguageServerHandler {
  private running = false;

  readonly setRequestTimeout = vi.fn();
  readonly start = vi.fn(() => {
    this.running = true;
  });
  readonly shutdown = vi.fn(() => {
    this.running = false;
  });
  readonly dispose = vi.fn();

  readonly notify = {
    didOpenTextDocument: vi.fn(),
    didChangeTextDocument: vi.fn(),
    didCloseTextDocument: vi.fn()
  };

  readonly send = {
    documentSymbol: vi.fn<
      DocumentSymbolResult | null,
      [{ textDocument: { uri: string } }]
    >(() => ({
      documentSymbols: [],
      outlineSymbols: []
    })),
    fullSymbolTree: vi.fn<UnifiedSymbolInformation[] | null, [unknown]>(() => []),
    referencingSymbols: vi.fn<ReferenceInSymbol[] | null, [unknown]>(() => []),
    overview: vi.fn<Record<string, UnifiedSymbolInformation[]>, [string]>(() => ({}))
  };

  isRunning(): boolean {
    return this.running;
  }
}

describe('SmartLanguageServer', () => {
  let tempDir: string;
  let handler: FakeHandler;
  let server: SmartLanguageServer;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-edit-smart-lsp-'));
    handler = new FakeHandler();
    server = new SmartLanguageServer(
      {
        codeLanguage: Language.PYTHON,
        ignoredPaths: ['build/**']
      },
      { level: 'debug' },
      tempDir,
      { handler }
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('starts and stops the handler', () => {
    expect(handler.start).not.toHaveBeenCalled();
    server.start();
    expect(handler.start).toHaveBeenCalledOnce();
    expect(server.isRunning()).toBe(true);

    server.stop();
    expect(handler.shutdown).toHaveBeenCalledOnce();
    expect(handler.dispose).toHaveBeenCalledOnce();
    expect(server.isRunning()).toBe(false);
  });

  it('opens files, notifies handler, and caches document symbols', () => {
    const filePath = path.join(tempDir, 'main.py');
    fs.writeFileSync(filePath, 'def hello():\n    return 42\n', { encoding: 'utf-8' });

    const symbols: UnifiedSymbolInformation[] = [
      {
        name: 'hello',
        kind: 12,
        location: {
          relativePath: 'main.py',
          range: {
            start: { line: 0, character: 4 },
            end: { line: 0, character: 9 }
          }
        }
      }
    ];

    handler.send.documentSymbol.mockReturnValueOnce({
      documentSymbols: symbols,
      outlineSymbols: []
    });

    server.start();

    const first = server.requestDocumentSymbols('main.py');
    expect(first.documentSymbols).toHaveLength(1);
    expect(handler.send.documentSymbol).toHaveBeenCalledTimes(1);
    expect(handler.notify.didOpenTextDocument).toHaveBeenCalledOnce();
    expect(handler.notify.didCloseTextDocument).toHaveBeenCalledOnce();

    const second = server.requestDocumentSymbols('main.py');
    expect(second.documentSymbols).toHaveLength(1);
    expect(handler.send.documentSymbol).toHaveBeenCalledTimes(1); // cache hit

    server.saveCache();
    const cachePath = path.join(
      tempDir,
      '.smart-lsp',
      SmartLanguageServer.CACHE_FOLDER_NAME,
      Language.PYTHON,
      'document_symbols_cache.json'
    );
    expect(fs.existsSync(cachePath)).toBe(true);
  });

  it('honours ignored patterns when checking paths', () => {
    const ignoredFile = path.join(tempDir, 'build', 'tmp.log');
    fs.mkdirSync(path.dirname(ignoredFile), { recursive: true });
    fs.writeFileSync(ignoredFile, 'ignored', { encoding: 'utf-8' });

    server.start();

    expect(() => server.isIgnoredPath('build/tmp.log')).not.toThrow();
    expect(server.isIgnoredPath('build/tmp.log')).toBe(true);
  });
});

