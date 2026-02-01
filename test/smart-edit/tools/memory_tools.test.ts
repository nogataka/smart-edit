import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DeleteMemoryTool,
  ListMemoriesTool,
  ReadMemoryTool,
  WriteMemoryTool
} from '../../../src/smart-edit/tools/memory_tools.js';
import {
  type AgentTaskHandle,
  type IssueTaskMetadata,
  type LanguageServerLike,
  type LinesReadLike,
  type MemoriesManagerLike,
  type ProjectLike,
  type SmartEditAgentLike,
  type Tool
} from '../../../src/smart-edit/tools/tools_base.js';

class CamelCaseMemoriesManager implements MemoriesManagerLike {
  readonly saved = new Map<string, string>();

  listMemories(): string[] {
    return Array.from(this.saved.keys());
  }

  saveMemory(name: string, content: string): string {
    this.saved.set(name, content);
    return `Memory ${name} written.`;
  }

  loadMemory(name: string): string {
    if (!this.saved.has(name)) {
      return `Memory file ${name} not found, consider creating it with the \`write_memory\` tool if you need it.`;
    }
    return this.saved.get(name) ?? '';
  }

  deleteMemory(name: string): string {
    this.saved.delete(name);
    return `Memory ${name} deleted.`;
  }
}

class SnakeCaseMemoriesManager implements MemoriesManagerLike {
  readonly saved = new Map<string, string>();

  list_memories(): string[] {
    return Array.from(this.saved.keys());
  }

  save_memory(name: string, content: string): string {
    this.saved.set(name, content);
    return `Memory ${name} written.`;
  }

  load_memory(name: string): string {
    return this.saved.get(name) ?? '';
  }

  delete_memory(name: string): string {
    this.saved.delete(name);
    return `Memory ${name} deleted.`;
  }

  listMemories(): string[] {
    return this.list_memories();
  }
}

interface FakeAgentOptions {
  manager: MemoriesManagerLike;
  project?: ProjectLike;
}

class FakeAgent implements SmartEditAgentLike {
  promptFactory = {};
  memoriesManager: MemoriesManagerLike | null;
  smartEditConfig = {
    defaultMaxToolAnswerChars: 100,
    toolTimeout: 5_000,
    projectNames: [] as string[]
  };
  languageServer: LanguageServerLike | null = null;
  linesRead: LinesReadLike | null = {};

  private readonly activeProject: ProjectLike;

  constructor(options: FakeAgentOptions) {
    this.memoriesManager = options.manager;
    this.activeProject =
      options.project ?? ({ projectRoot: '/workspace/project', projectConfig: { encoding: 'utf-8' } } as ProjectLike);
  }

  getProjectRoot(): string {
    return this.activeProject.projectRoot;
  }

  getActiveProject(): ProjectLike | null {
    return this.activeProject;
  }

  getActiveProjectOrThrow(): ProjectLike {
    return this.activeProject;
  }

  getActiveToolNames(): string[] {
    return ['write_memory', 'read_memory', 'list_memories'];
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

  activateProjectFromPathOrName(): ProjectLike {
    return this.activeProject;
  }

  setModes(): void {
    // no-op
  }

  getCurrentConfigOverview(): string {
    return 'overview';
  }

  createLanguageServerSymbolRetriever(): Record<string, unknown> {
    return {};
  }

  createCodeEditor(): Record<string, unknown> {
    return {};
  }

  recordToolUsageIfEnabled = vi.fn<(args: Record<string, unknown>, result: string, tool: Tool) => void>();

  issueTask<T>(task: () => Promise<T> | T, _metadata?: IssueTaskMetadata): AgentTaskHandle<T> {
    const promise = Promise.resolve().then(task);
    return {
      result: ({ timeout }: { timeout?: number } = {}): Promise<T> => {
        if (timeout && timeout < 0) {
          return Promise.reject(new Error('Timeout must be positive.'));
        }
        return promise;
      }
    };
  }
}

describe('memory tools', () => {
  let manager: CamelCaseMemoriesManager;
  let agent: FakeAgent;

  beforeEach(() => {
    manager = new CamelCaseMemoriesManager();
    agent = new FakeAgent({ manager });
  });

  it('writes a memory entry enforcing maximum length', async () => {
    const tool = new WriteMemoryTool(agent);

    const response = await tool.applyEx({ memory_name: 'daily', content: 'Remember to update docs.' });

    expect(manager.saved.get('daily')).toBe('Remember to update docs.');
    expect(response).toBe('Memory daily written.');
  });

  it('rejects content longer than the configured limit', async () => {
    agent.smartEditConfig.defaultMaxToolAnswerChars = 5;
    const tool = new WriteMemoryTool(agent);

    await expect(
      tool.applyEx(
        { memory_name: 'long', content: 'This content is beyond limit.' },
        { catchExceptions: false }
      )
    ).rejects.toThrow(/too long/);
  });

  it('respects caller-provided max_answer_chars when writing', async () => {
    const tool = new WriteMemoryTool(agent);

    await expect(
      tool.applyEx(
        { memory_name: 'trim', content: '123456', max_answer_chars: 5 },
        { catchExceptions: false }
      )
    ).rejects.toThrow(/too long/);
  });

  it('reads an existing memory entry', async () => {
    manager.saveMemory('summary', 'Completed tasks list.');
    const tool = new ReadMemoryTool(agent);

    const content = await tool.applyEx({ memory_file_name: 'summary' });

    expect(content).toBe('Completed tasks list.');
  });

  it('lists memories as a JSON payload', async () => {
    manager.saveMemory('kickoff', 'Kickoff notes');
    manager.saveMemory('retro', 'Retro notes');
    const tool = new ListMemoriesTool(agent);

    const payload = await tool.applyEx();
    const parsed = JSON.parse(payload) as string[];

    expect(parsed).toEqual(expect.arrayContaining(['kickoff', 'retro']));
  });

  it('deletes a memory entry', async () => {
    manager.saveMemory('obsolete', 'Old info');
    const tool = new DeleteMemoryTool(agent);

    const response = await tool.applyEx({ memory_file_name: 'obsolete' });

    expect(response).toBe('Memory obsolete deleted.');
    expect(manager.saved.has('obsolete')).toBe(false);
  });

  it('supports snake_case memory manager methods', async () => {
    const snakeManager = new SnakeCaseMemoriesManager();
    const snakeAgent = new FakeAgent({ manager: snakeManager });
    const writeTool = new WriteMemoryTool(snakeAgent);
    const readTool = new ReadMemoryTool(snakeAgent);
    const listTool = new ListMemoriesTool(snakeAgent);
    const deleteTool = new DeleteMemoryTool(snakeAgent);

    await writeTool.applyEx({ memory_name: 'note', content: 'Snake case support.' });
    await writeTool.applyEx({ memory_name: 'reminder', content: 'Use snake_case manager.' });

    const content = await readTool.applyEx({ memory_file_name: 'note' });
    expect(content).toBe('Snake case support.');

    const listedRaw = JSON.parse(await listTool.applyEx()) as unknown;
    expect(Array.isArray(listedRaw)).toBe(true);
    const listed = listedRaw as string[];
    expect(listed).toEqual(expect.arrayContaining(['note', 'reminder']));

    await deleteTool.applyEx({ memory_file_name: 'note' });
    expect(snakeManager.saved.has('note')).toBe(false);
  });
});
