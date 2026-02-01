import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FindReferencingSymbolsTool,
  FindSymbolTool,
  GetSymbolsOverviewTool,
  InsertAfterSymbolTool,
  InsertBeforeSymbolTool,
  ReplaceSymbolBodyTool,
  RestartLanguageServerTool
} from '../../../src/smart-edit/tools/symbol_tools.js';
import { SUCCESS_RESULT, type ProjectLike, type SmartEditAgentLike, type Tool } from '../../../src/smart-edit/tools/tools_base.js';

class FakeSymbol {
  private readonly data: Record<string, unknown>;

  constructor(data: Record<string, unknown>) {
    this.data = { ...data };
  }

  to_dict(): Record<string, unknown> {
    return { ...this.data };
  }
}

class FakeContentAroundLine {
  private readonly snapshot: string;

  constructor(snapshot: string) {
    this.snapshot = snapshot;
  }

  toDisplayString(): string {
    return this.snapshot;
  }

  to_display_string(): string {
    return this.snapshot;
  }
}

class FakeProject implements ProjectLike {
  readonly projectRoot: string;
  readonly projectConfig = { encoding: 'utf-8' };
  retrieveCalls: { relativePath: string; line: number; before: number; after: number }[] = [];
  private readonly snippets = new Map<string, string>();

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  setSnippet(relativePath: string, text: string): void {
    this.snippets.set(relativePath, text);
  }

  retrieveContentAroundLine(
    relativePath: string,
    line: number,
    contextLinesBefore = 0,
    contextLinesAfter = 0
  ): FakeContentAroundLine {
    this.retrieveCalls.push({ relativePath, line, before: contextLinesBefore, after: contextLinesAfter });
    const text = this.snippets.get(relativePath) ?? '';
    return new FakeContentAroundLine(text);
  }

  retrieve_content_around_line(
    relativePath: string,
    line: number,
    contextLinesBefore = 0,
    contextLinesAfter = 0
  ): FakeContentAroundLine {
    return this.retrieveContentAroundLine(relativePath, line, contextLinesBefore, contextLinesAfter);
  }
}

class FakeCodeEditor {
  readonly replaceBodyMock = vi.fn();
  readonly insertAfterSymbolMock = vi.fn();
  readonly insertBeforeSymbolMock = vi.fn();

  replaceBody(namePath: string, relativePath: string, body: string): void {
    this.replaceBodyMock(namePath, relativePath, body);
  }

  insertAfterSymbol(namePath: string, relativePath: string, body: string): void {
    this.insertAfterSymbolMock(namePath, relativePath, body);
  }

  insertBeforeSymbol(namePath: string, relativePath: string, body: string): void {
    this.insertBeforeSymbolMock(namePath, relativePath, body);
  }
}

class FakeSymbolRetriever {
  overview: Record<string, unknown[]> = {};
  findResults: unknown[] = [];
  referenceResults: { symbol: FakeSymbol; line: number }[] = [];

  lastFindByNameArgs:
    | { namePath: string; options: Record<string, unknown> }
    | null = null;
  lastFindReferencesArgs:
    | { namePath: string; relativePath: string; options: Record<string, unknown> }
    | null = null;

  get_symbol_overview(_relativePath: string): Record<string, unknown[]> {
    return this.overview;
  }

  find_by_name(namePath: string, options: Record<string, unknown>): unknown[] {
    this.lastFindByNameArgs = { namePath, options: { ...options } };
    return [...this.findResults];
  }

  find_referencing_symbols(
    namePath: string,
    relativePath: string,
    options: Record<string, unknown>
  ): { symbol: FakeSymbol; line: number }[] {
    this.lastFindReferencesArgs = { namePath, relativePath, options: { ...options } };
    return [...this.referenceResults];
  }
}

class FakeAgent implements SmartEditAgentLike {
  readonly promptFactory = {};
  memoriesManager = null;
  readonly smartEditConfig = {
    defaultMaxToolAnswerChars: 20_000,
    toolTimeout: 5_000,
    projectNames: ['demo']
  };
  languageServer = { saveCache: vi.fn() };
  linesRead = {};

  readonly resetLanguageServerMock = vi.fn();
  readonly recordedExecutions: { args: Record<string, unknown>; result: string; toolName: string }[] = [];

  private readonly project: FakeProject;
  private readonly retriever: FakeSymbolRetriever;
  private readonly editor: FakeCodeEditor;

  constructor(project: FakeProject, retriever: FakeSymbolRetriever, editor: FakeCodeEditor) {
    this.project = project;
    this.retriever = retriever;
    this.editor = editor;
  }

  getProjectRoot(): string {
    return this.project.projectRoot;
  }

  getActiveProject(): ProjectLike | null {
    return this.project;
  }

  getActiveProjectOrThrow(): ProjectLike {
    return this.project;
  }

  getActiveToolNames(): string[] {
    return ['restart_language_server', 'get_symbols_overview'];
  }

  toolIsActive(): boolean {
    return true;
  }

  isUsingLanguageServer(): boolean {
    return true;
  }

  isLanguageServerRunning(): boolean {
    return true;
  }

  resetLanguageServer(): void {
    this.resetLanguageServerMock();
  }

  activateProjectFromPathOrName(): ProjectLike {
    return this.project;
  }

  setModes(): void {
    // not needed for tests
  }

  getCurrentConfigOverview(): string {
    return 'config';
  }

  createLanguageServerSymbolRetriever(): FakeSymbolRetriever {
    return this.retriever;
  }

  createCodeEditor(): FakeCodeEditor {
    return this.editor;
  }

  recordToolUsageIfEnabled(args: Record<string, unknown>, result: string, tool: Tool): void {
    this.recordedExecutions.push({ args, result, toolName: tool.getName() });
  }

  issueTask<T>(task: () => Promise<T> | T): { result: () => Promise<T> } {
    const promise = Promise.resolve().then(task);
    return {
      result: () => promise
    };
  }
}

describe('symbol tools', () => {
  let projectRoot: string;
  let project: FakeProject;
  let retriever: FakeSymbolRetriever;
  let editor: FakeCodeEditor;
  let agent: FakeAgent;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-edit-symbol-tools-'));
    const filePath = path.join(projectRoot, 'src', 'demo.ts');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, 'export function demo() {}\n', 'utf-8');

    project = new FakeProject(projectRoot);
    project.setSnippet('src/demo.ts', 'line1\nline2\nline3');

    retriever = new FakeSymbolRetriever();
    retriever.overview = {
      'src/demo.ts': [
        {
          name: 'demo',
          location: { relative_path: 'src/demo.ts', line: 1 },
          kind: 12
        }
      ]
    };
    retriever.findResults = [
      new FakeSymbol({ name: 'demo', location: { relative_path: 'src/demo.ts' }, kind: 12, depth: 0 })
    ];
    retriever.referenceResults = [
      { symbol: new FakeSymbol({ name: 'caller', location: { relative_path: 'src/demo.ts' }, kind: 6 }), line: 1 }
    ];

    editor = new FakeCodeEditor();
    agent = new FakeAgent(project, retriever, editor);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('restarts the language server', async () => {
    const tool = new RestartLanguageServerTool(agent);

    const result = await tool.applyEx();

    expect(result).toBe(SUCCESS_RESULT);
    expect(agent.resetLanguageServerMock).toHaveBeenCalledTimes(1);
  });

  it('returns sanitized symbol overview for a file', async () => {
    const tool = new GetSymbolsOverviewTool(agent);

    const response = await tool.applyEx({ relative_path: 'src/demo.ts' });
    const parsed = JSON.parse(response) as Record<string, unknown>[];

    expect(parsed).toHaveLength(1);
    expect(parsed[0].relative_path).toBe('src/demo.ts');
    expect(parsed[0].name).toBeUndefined();
    expect(parsed[0].location).toBeUndefined();
  });

  it('throws when provided path is a directory', async () => {
    const tool = new GetSymbolsOverviewTool(agent);

    const response = await tool.applyEx({ relative_path: 'src' });
    expect(response).toContain('Error executing tool');
    expect(response).toContain('Expected a file path, but got a directory path: src.');
  });

  it('finds symbols and normalizes include/exclude kinds', async () => {
    const tool = new FindSymbolTool(agent);

    const response = await tool.applyEx({
      name_path: 'demo',
      include_body: true,
      include_kinds: [12],
      exclude_kinds: [1],
      substring_matching: true
    });
    const parsed = JSON.parse(response) as Record<string, unknown>[];

    expect(parsed).toHaveLength(1);
    expect(parsed[0].relative_path).toBe('src/demo.ts');
    expect(parsed[0].name).toBeUndefined();
    expect(retriever.lastFindByNameArgs).not.toBeNull();
    expect(retriever.lastFindByNameArgs?.options.includeKinds).toEqual([12]);
    expect(retriever.lastFindByNameArgs?.options.excludeKinds).toEqual([1]);
    expect(retriever.lastFindByNameArgs?.options.substringMatching).toBe(true);
  });

  it('returns referencing symbols with surrounding content', async () => {
    const tool = new FindReferencingSymbolsTool(agent);

    const response = await tool.applyEx({ name_path: 'demo', relative_path: 'src/demo.ts' });
    const parsed = JSON.parse(response) as Record<string, unknown>[];

    expect(parsed).toHaveLength(1);
    const entry = parsed[0];
    expect(entry.relative_path).toBe('src/demo.ts');
    expect(entry.content_around_reference).toBe('line1\nline2\nline3');
    expect(project.retrieveCalls).toEqual([
      { relativePath: 'src/demo.ts', line: 1, before: 1, after: 1 }
    ]);
  });

  it('replaces symbol body through the code editor', async () => {
    const tool = new ReplaceSymbolBodyTool(agent);

    const result = await tool.applyEx({
      name_path: 'demo',
      relative_path: 'src/demo.ts',
      body: 'export function demo() { return 1; }'
    });

    expect(result).toBe(SUCCESS_RESULT);
    expect(editor.replaceBodyMock).toHaveBeenCalledWith('demo', 'src/demo.ts', 'export function demo() { return 1; }');
  });

  it('inserts after the specified symbol', async () => {
    const tool = new InsertAfterSymbolTool(agent);

    const result = await tool.applyEx({
      name_path: 'demo',
      relative_path: 'src/demo.ts',
      body: 'console.log("after");'
    });

    expect(result).toBe(SUCCESS_RESULT);
    expect(editor.insertAfterSymbolMock).toHaveBeenCalledWith('demo', 'src/demo.ts', 'console.log("after");');
  });

  it('inserts before the specified symbol', async () => {
    const tool = new InsertBeforeSymbolTool(agent);

    const result = await tool.applyEx({
      name_path: 'demo',
      relative_path: 'src/demo.ts',
      body: 'console.log("before");'
    });

    expect(result).toBe(SUCCESS_RESULT);
    expect(editor.insertBeforeSymbolMock).toHaveBeenCalledWith('demo', 'src/demo.ts', 'console.log("before");');
  });
});
