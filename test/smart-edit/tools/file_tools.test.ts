import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CreateTextFileTool,
  DeleteLinesTool,
  FindFileTool,
  InsertAtLineTool,
  ListDirTool,
  ReadFileTool,
  ReplaceLinesTool,
  ReplaceRegexTool,
  SearchForPatternTool,
  SUCCESS_RESULT
} from '../../../src/smart-edit/tools/file_tools.js';
import {
  type AgentTaskHandle,
  type IssueTaskMetadata,
  type ProjectConfigLike,
  type ProjectLike,
  type SmartEditAgentLike,
  type Tool
} from '../../../src/smart-edit/tools/tools_base.js';
import { MatchedConsecutiveLines, TextLine, LineType } from '../../../src/smart-edit/text_utils.js';

class LinesReadTracker {
  private readonly ranges = new Map<string, [number, number][]>();

  addLinesRead(relativePath: string, range: [number, number]): void {
    const key = relativePath;
    const entries = this.ranges.get(key) ?? [];
    entries.push(range);
    this.ranges.set(key, entries);
  }

  add_lines_read(relativePath: string, range: [number, number]): void {
    this.addLinesRead(relativePath, range);
  }

  wereLinesRead(relativePath: string, range: [number, number]): boolean {
    const entries = this.ranges.get(relativePath);
    if (!entries) {
      return false;
    }
    return entries.some(([start, end]) => start === range[0] && end === range[1]);
  }

  were_lines_read(relativePath: string, range: [number, number]): boolean {
    return this.wereLinesRead(relativePath, range);
  }
}

class FakeProject implements ProjectLike {
  readonly projectRoot: string;
  readonly projectConfig: ProjectConfigLike;
  private readonly ignored: Set<string>;
  private readonly searchResponses: MatchedConsecutiveLines[];

  constructor(projectRoot: string, ignoredPaths: string[] = []) {
    this.projectRoot = projectRoot;
    this.projectConfig = { encoding: 'utf-8' };
    this.ignored = new Set(ignoredPaths.map((entry) => entry.split(path.sep).join(path.posix.sep)));
    this.searchResponses = [];
  }

  configureCodeSearchResponse(matches: MatchedConsecutiveLines[]): void {
    this.searchResponses.length = 0;
    this.searchResponses.push(...matches);
  }

  validateRelativePath(relativePath: string): void {
    const normalized = path.normalize(relativePath);
    if (normalized.startsWith('..')) {
      throw new Error(`Path escapes root: ${relativePath}`);
    }
    const absolute = path.resolve(this.projectRoot, normalized);
    if (!absolute.startsWith(this.projectRoot)) {
      throw new Error(`Path escapes root: ${relativePath}`);
    }
  }

  readFile(relativePath: string): string {
    const absolute = path.join(this.projectRoot, relativePath);
    return fs.readFileSync(absolute, 'utf-8');
  }

  relativePathExists(relativePath: string): boolean {
    const absolute = path.join(this.projectRoot, relativePath);
    return fs.existsSync(absolute);
  }

  isIgnoredPath(absolutePath: string): boolean {
    const candidate = path
      .relative(this.projectRoot, absolutePath)
      .split(path.sep)
      .join(path.posix.sep);
    return this.ignored.has(candidate);
  }

  searchSourceFilesForPattern(): MatchedConsecutiveLines[] {
    return [...this.searchResponses];
  }
}

class FakeCodeEditor {
  private readonly projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  deleteLines(relativePath: string, startLine: number, endLine: number): void {
    const absolute = path.join(this.projectRoot, relativePath);
    const { lines, hadTrailingNewline } = readLinesWithState(absolute);
    lines.splice(startLine, endLine - startLine + 1);
    writeLinesWithState(absolute, lines, hadTrailingNewline);
  }

  insertAtLine(relativePath: string, line: number, content: string): void {
    const absolute = path.join(this.projectRoot, relativePath);
    const { lines, hadTrailingNewline } = readLinesWithState(absolute);
    const insertion = splitInsertionContent(content);
    lines.splice(line, 0, ...insertion);
    writeLinesWithState(absolute, lines, hadTrailingNewline || content.endsWith('\n'));
  }
}

interface RecordedUsage {
  args: Record<string, unknown>;
  result: string;
  toolName: string;
}

class FakeAgent implements SmartEditAgentLike {
  promptFactory = {};
  memoriesManager = null;
  smartEditConfig = {
    defaultMaxToolAnswerChars: 10_000,
    toolTimeout: 5_000,
    projectNames: ['alpha']
  };
  languageServer = null;
  linesRead = new LinesReadTracker();

  readonly recorded: RecordedUsage[] = [];
  readonly activeToolNames: string[] = [
    ReadFileTool.getNameFromCls(),
    ListDirTool.getNameFromCls(),
    FindFileTool.getNameFromCls()
  ];

  projectRoot: string;
  activeProject: FakeProject | null;

  constructor(projectRoot: string, project: FakeProject) {
    this.projectRoot = projectRoot;
    this.activeProject = project;
  }

  getProjectRoot(): string {
    return this.projectRoot;
  }

  getActiveProject(): FakeProject | null {
    return this.activeProject;
  }

  getActiveProjectOrThrow(): FakeProject {
    if (!this.activeProject) {
      throw new Error('No active project');
    }
    return this.activeProject;
  }

  getActiveToolNames(): string[] {
    return [...this.activeToolNames];
  }

  toolIsActive(): boolean {
    return true;
  }

  isUsingLanguageServer(): boolean {
    return false;
  }

  isLanguageServerRunning(): boolean {
    return false;
  }

  resetLanguageServer(): void {
    // no-op
  }

  activateProjectFromPathOrName(): FakeProject {
    if (!this.activeProject) {
      throw new Error('No project configured');
    }
    return this.activeProject;
  }

  setModes(): void {
    // no-op
  }

  getCurrentConfigOverview(): string {
    return 'Configuration overview';
  }

  createLanguageServerSymbolRetriever(): Record<string, unknown> {
    return {};
  }

  createCodeEditor(): FakeCodeEditor {
    return new FakeCodeEditor(this.projectRoot);
  }

  recordToolUsageIfEnabled(args: Record<string, unknown>, result: string, tool: Tool): void {
    this.recorded.push({ args, result, toolName: tool.getName() });
  }

  issueTask<T>(task: () => Promise<T> | T, _metadata?: IssueTaskMetadata): AgentTaskHandle<T> {
    const promise = Promise.resolve().then(task);
    return {
      async result(): Promise<T> {
        return promise;
      }
    };
  }

  getTool<T extends Tool>(toolClass: new (agent: SmartEditAgentLike) => T): T {
    return new toolClass(this);
  }
}

function readLinesWithState(absolutePath: string): { lines: string[]; hadTrailingNewline: boolean } {
  const content = fs.readFileSync(absolutePath, 'utf-8');
  const hadTrailingNewline = content.endsWith('\n');
  const trimmed = hadTrailingNewline ? content.slice(0, -1) : content;
  const lines = trimmed.length > 0 ? trimmed.split('\n') : trimmed === '' ? [] : [trimmed];
  return { lines, hadTrailingNewline };
}

function writeLinesWithState(absolutePath: string, lines: string[], ensureTrailingNewline: boolean): void {
  let serialized = lines.join('\n');
  if (ensureTrailingNewline && !serialized.endsWith('\n')) {
    serialized += '\n';
  }
  fs.writeFileSync(absolutePath, serialized, 'utf-8');
}

function splitInsertionContent(input: string): string[] {
  if (input.endsWith('\n')) {
    const without = input.slice(0, -1);
    return without.length === 0 ? [''] : without.split('\n');
  }
  return input.split('\n');
}

describe('file tools', () => {
  let workspace: string;
  let agent: FakeAgent;
  let project: FakeProject;

  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-edit-file-tools-'));
    fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
    fs.writeFileSync(path.join(workspace, 'README.md'), '# Demo\n');
    fs.writeFileSync(path.join(workspace, 'src', 'index.ts'), "console.log('hello');\n");
    fs.writeFileSync(path.join(workspace, 'src', 'ignore-me.ts'), '// ignore me\n');

    project = new FakeProject(workspace, ['src/ignore-me.ts']);
    agent = new FakeAgent(workspace, project);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('reads a file subsection and records lines', async () => {
    fs.writeFileSync(path.join(workspace, 'notes.txt'), 'line1\nline2\nline3\n');
    const tool = new ReadFileTool(agent);

    const result = await tool.applyEx({
      relative_path: 'notes.txt',
      start_line: 1,
      end_line: 2
    });

    expect(result).toBe('line2\nline3');
    expect(agent.linesRead.wereLinesRead('notes.txt', [1, 2])).toBe(true);
  });

  it('creates a new file and overwrites existing ones', async () => {
    const tool = new CreateTextFileTool(agent);

    const created = await tool.applyEx({
      relative_path: 'docs/guide.txt',
      content: 'Hello!'
    });
    expect(JSON.parse(created)).toContain('File created: docs/guide.txt');
    expect(fs.readFileSync(path.join(workspace, 'docs', 'guide.txt'), 'utf-8')).toBe('Hello!');

    const overwritten = await tool.applyEx({
      relative_path: 'docs/guide.txt',
      content: 'Updated'
    });
    expect(JSON.parse(overwritten)).toContain('Overwrote existing file');
    expect(fs.readFileSync(path.join(workspace, 'docs', 'guide.txt'), 'utf-8')).toBe('Updated');
  });

  it('lists directories and respects ignored files when requested', async () => {
    const tool = new ListDirTool(agent);

    const response = await tool.applyEx({
      relative_path: 'src',
      recursive: true,
      skip_ignored_files: true
    });
    const parsed = JSON.parse(response) as { dirs: string[]; files: string[] };
    expect(parsed.files).toContain('src/index.ts');
    expect(parsed.files).not.toContain('src/ignore-me.ts');
  });

  it('finds files using a filename mask while ignoring blocked paths', async () => {
    const tool = new FindFileTool(agent);
    const result = await tool.applyEx({
      file_mask: '*.ts',
      relative_path: 'src'
    });
    const parsed = JSON.parse(result) as { files: string[] };
    expect(parsed.files).toEqual(['src/index.ts']);
  });

  it('replaces content via regex and prevents accidental multi-match replacements', async () => {
    const filePath = path.join(workspace, 'data.txt');
    fs.writeFileSync(filePath, 'alpha beta gamma\nalpha beta gamma\n');
    const tool = new ReplaceRegexTool(agent);

    const success = await tool.applyEx({
      relative_path: 'data.txt',
      regex: 'alpha beta',
      repl: 'ALPHA BETA',
      allow_multiple_occurrences: true
    });
    expect(success).toBe(SUCCESS_RESULT);
    expect(fs.readFileSync(filePath, 'utf-8')).toContain('ALPHA BETA');

    fs.writeFileSync(filePath, 'cat cat cat\n');
    const failure = await tool.applyEx({
      relative_path: 'data.txt',
      regex: 'cat',
      repl: 'dog',
      allow_multiple_occurrences: false
    });
    expect(failure).toContain('matches 3 occurrences');
  });

  it('requires lines to be read before deletion', async () => {
    const filePath = path.join(workspace, 'delete.txt');
    fs.writeFileSync(filePath, 'a\nb\nc\n');
    const tool = new DeleteLinesTool(agent);

    const failure = await tool.applyEx({
      relative_path: 'delete.txt',
      start_line: 0,
      end_line: 1
    });
    expect(failure).toContain('Must call `read_file` first');

    agent.linesRead.addLinesRead('delete.txt', [0, 1]);
    const success = await tool.applyEx({
      relative_path: 'delete.txt',
      start_line: 0,
      end_line: 1
    });
    expect(success).toBe(SUCCESS_RESULT);
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('c\n');
  });

  it('replaces and inserts lines through helper tools', async () => {
    const filePath = path.join(workspace, 'replace.txt');
    fs.writeFileSync(filePath, 'line1\nline2\nline3\n');
    agent.linesRead.addLinesRead('replace.txt', [1, 1]);

    const tool = new ReplaceLinesTool(agent);
    const outcome = await tool.applyEx({
      relative_path: 'replace.txt',
      start_line: 1,
      end_line: 1,
      content: 'updated'
    });

    expect(outcome).toBe(SUCCESS_RESULT);
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('line1\nupdated\nline3\n');
  });

  it('inserts content at a target line', async () => {
    const filePath = path.join(workspace, 'insert.txt');
    fs.writeFileSync(filePath, 'top\nbottom\n');
    const tool = new InsertAtLineTool(agent);

    const result = await tool.applyEx({
      relative_path: 'insert.txt',
      line: 1,
      content: 'middle'
    });

    expect(result).toBe(SUCCESS_RESULT);
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('top\nmiddle\nbottom\n');
  });

  it('searches for patterns and groups matches by file', async () => {
    fs.writeFileSync(path.join(workspace, 'src', 'module.ts'), 'function demo() {\n  return 42;\n}\n');
    const tool = new SearchForPatternTool(agent);

    const raw = await tool.applyEx({
      substring_pattern: 'return 42',
      relative_path: 'src',
      context_lines_before: 1,
      context_lines_after: 0
    });
    const parsed = JSON.parse(raw) as Record<string, string[]>;
    expect(Object.keys(parsed)).toContain('src/module.ts');
    expect(parsed['src/module.ts'][0]).toContain('return 42');
  });

  it('delegates to project search when restricting to code files', async () => {
    const match = new MatchedConsecutiveLines({
      lines: [
        new TextLine({ lineNumber: 10, lineContent: 'const value = 99;', matchType: LineType.MATCH })
      ],
      sourceFilePath: 'src/value.ts'
    });
    project.configureCodeSearchResponse([match]);

    const tool = new SearchForPatternTool(agent);
    const raw = await tool.applyEx({
      substring_pattern: 'value',
      restrict_search_to_code_files: true,
      relative_path: ''
    });

    const parsed = JSON.parse(raw) as Record<string, string[]>;
    expect(parsed['src/value.ts'][0]).toContain('const value = 99;');
  });
});
