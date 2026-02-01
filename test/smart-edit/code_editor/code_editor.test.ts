import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  LanguageServerCodeEditor
} from '../../../src/smart-edit/code_editor.js';
import {
  LanguageServerSymbolRetriever,
  SymbolKind,
  PositionInFile
} from '../../../src/smart-edit/symbol.js';
import {
  SmartLanguageServer,
  type SmartLanguageServerHandler,
  type SmartLanguageServerNotifications,
  type SmartLanguageServerRequests,
  type UnifiedSymbolInformation,
  type ReferenceInSymbol
} from '../../../src/smart-lsp/ls.js';
import { Language } from '../../../src/smart-lsp/ls_config.js';

function deepClone<T>(value: T): T {
  const cloneFn = (globalThis as { structuredClone?: <U>(input: U) => U }).structuredClone;
  if (typeof cloneFn === 'function') {
    return cloneFn(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

class FakeLanguageServerHandler implements SmartLanguageServerHandler {
  private running = false;
  private timeout: number | null = null;

  constructor(
    private readonly symbolTree: UnifiedSymbolInformation[],
    private readonly references: ReferenceInSymbol[]
  ) {}

  setRequestTimeout(timeout: number | null): void {
    this.timeout = timeout ?? null;
  }

  isRunning(): boolean {
    return this.running;
  }

  start(): void {
    this.running = true;
  }

  shutdown(): void {
    this.running = false;
  }

  dispose(): void {
    this.timeout = null;
  }

  readonly notify: SmartLanguageServerNotifications = {
    didOpenTextDocument: (params) => {
      void params;
    },
    didChangeTextDocument: (params) => {
      void params;
    },
    didCloseTextDocument: (params) => {
      void params;
    }
  };

  readonly send: SmartLanguageServerRequests = {
    documentSymbol: () => {
      const flatten = (symbol: UnifiedSymbolInformation): UnifiedSymbolInformation[] => {
        const children = Array.isArray(symbol.children) ? symbol.children : [];
        return [symbol, ...children.flatMap((child) => flatten(child))];
      };
      const symbols = this.symbolTree.flatMap((root) => flatten(root));
      const withoutRoot = symbols.slice(1).map((entry) => deepClone(entry));
      return {
        documentSymbols: withoutRoot,
        outlineSymbols: this.symbolTree.map((root) => deepClone(root))
      };
    },
    fullSymbolTree: () => this.symbolTree.map((root) => deepClone(root)),
    referencingSymbols: () => this.references.map((reference) => deepClone(reference)),
    overview: (relativePath: string) => ({
      [relativePath]: this.symbolTree
        .flatMap((root) => root.children ?? [])
        .map((symbol) => deepClone(symbol))
    })
  };
}

class FakeLanguageServer extends SmartLanguageServer {
  constructor(repositoryRootPath: string, symbolTree: UnifiedSymbolInformation[], references: ReferenceInSymbol[]) {
    super(
      {
        codeLanguage: Language.TYPESCRIPT,
        ignoredPaths: []
      },
      { level: 'debug' },
      repositoryRootPath,
      {
        handler: new FakeLanguageServerHandler(symbolTree, references)
      }
    );
    this.start();
  }
}

function createSampleSymbols(relativePath: string): UnifiedSymbolInformation[] {
  const functionSymbol: UnifiedSymbolInformation = {
    name: 'demo_function',
    kind: SymbolKind.Function,
    children: [],
    location: {
      relativePath,
      range: {
        start: { line: 0, character: 0 },
        end: { line: 4, character: 0 }
      }
    },
    selectionRange: {
      start: { line: 0, character: 9 }
    },
    body: 'function demo_function() {\n  return 1;\n}'
  };

  const fileSymbol: UnifiedSymbolInformation = {
    name: relativePath,
    kind: SymbolKind.File,
    children: [functionSymbol],
    location: {
      relativePath,
      range: {
        start: { line: 0, character: 0 },
        end: { line: 4, character: 0 }
      }
    },
    selectionRange: {
      start: { line: 0, character: 0 }
    }
  };

  functionSymbol.parent = fileSymbol;
  return [fileSymbol];
}

describe('LanguageServerCodeEditor', () => {
  let tempDir: string;
  let editor: LanguageServerCodeEditor;
  let relativePath: string;
  let retriever: LanguageServerSymbolRetriever;

  const initialContent = `function demo_function() {
  const value = 1;
  return value;
}
`;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'smart-edit-code-editor-'));
    relativePath = 'demo.ts';
    const absoluteFile = path.join(tempDir, relativePath);
    await fs.mkdir(path.dirname(absoluteFile), { recursive: true });
    await fs.writeFile(absoluteFile, initialContent, 'utf-8');

    const symbolTree = createSampleSymbols(relativePath);
    const [fileSymbol] = symbolTree;
    const references: ReferenceInSymbol[] = [
      {
        symbol: deepClone(fileSymbol),
        line: 2,
        character: 5
      }
    ];
    const languageServer = new FakeLanguageServer(tempDir, symbolTree, references);
    retriever = new LanguageServerSymbolRetriever(languageServer, null);
    editor = new LanguageServerCodeEditor(retriever, null);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('replaces the symbol body without altering surrounding whitespace', async () => {
    const replacement = `
  const value = 2;
  return value * 2;
};
    `.trim();

    await editor.replaceBody('demo_function', relativePath, replacement);

    const content = await fs.readFile(path.join(tempDir, relativePath), 'utf-8');
    expect(content).toContain('const value = 2;');
    expect(content).not.toContain('const value = 1;');
  });

  it('inserts text after a symbol respecting minimum empty lines', async () => {
    await editor.insertAfterSymbol(
      'demo_function',
      relativePath,
      '\nfunction helper() {\n  return 0;\n}\n'
    );
    const content = await fs.readFile(path.join(tempDir, relativePath), 'utf-8');
    expect(content).toMatch(/return value;\n}\n\nfunction helper\(\)/);
  });

  it('inserts text before a symbol and preserves newline requirements', async () => {
    await editor.insertBeforeSymbol(
      'demo_function',
      relativePath,
      '/**\n * demo documentation\n */\n'
    );
    const content = await fs.readFile(path.join(tempDir, relativePath), 'utf-8');
    expect(content.startsWith('/**')).toBe(true);
    expect(content).toMatch(/\*\/\n\nfunction demo_function/);
  });

  it('deletes a range of lines', async () => {
    await editor.deleteLines(relativePath, 1, 2);
    const content = await fs.readFile(path.join(tempDir, relativePath), 'utf-8');
    expect(content).toBe('function demo_function() {\n}\n');
  });

  it('inserts content at a specific line', async () => {
    await editor.insertAtLine(relativePath, 1, '  const extra = 5;\n');
    const content = await fs.readFile(path.join(tempDir, relativePath), 'utf-8');
    expect(content).toMatch(/const extra = 5;/);
  });

  it('deletes a symbol by removing its body', async () => {
    await editor.deleteSymbol('demo_function', relativePath);
    const content = await fs.readFile(path.join(tempDir, relativePath), 'utf-8');
    expect(content.trim()).toBe('');
  });

  it('retrieves referencing symbols via the retriever', () => {
    const symbols = retriever.find_by_name('demo_function', false, undefined, undefined, false, relativePath);
    expect(symbols).toHaveLength(1);
    const symbol = symbols[0];
    expect(symbol).toBeDefined();
    if (!symbol) {
      throw new Error('Expected symbol to be defined');
    }
    const location = symbol.location;
    const references = retriever.find_referencing_symbols_by_location(location);
    expect(references).toHaveLength(1);
    expect(references[0]?.line).toBe(2);
  });

  it('computes offsets using PositionInFile consistently', () => {
    const position = new PositionInFile({ line: 1, col: 2 });
    expect(position.line).toBe(1);
    expect(position.col).toBe(2);
  });
});
