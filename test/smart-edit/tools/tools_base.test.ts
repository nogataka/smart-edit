import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, beforeEach } from 'vitest';
import { z } from 'zod';

import {
  EditedFileContext,
  SUCCESS_RESULT,
  Tool,
  ToolMarkerCanEdit,
  ToolMarkerOptional,
  ToolRegistry,
  registerToolClass,
  type AgentTaskHandle,
  type IssueTaskMetadata,
  type LanguageServerLike,
  type LanguageServerSymbolRetrieverLike,
  type MemoriesManagerLike,
  type ProjectLike,
  type SmartEditAgentLike,
  type ToolClass
} from '../../../src/smart-edit/tools/tools_base.js';
import type { SmartEditAgentMode } from '../../../src/smart-edit/config/context_mode.js';

class FakeLanguageServer implements LanguageServerLike {
  saveCalls = 0;

  saveCache(): void {
    this.saveCalls += 1;
  }
}

interface FakeAgentOptions {
  active?: boolean;
  languageServerRunning?: boolean;
  activeProject?: { projectRoot: string; encoding?: string };
}

class FakeAgent implements SmartEditAgentLike {
  promptFactory = {};
  memoriesManager: MemoriesManagerLike | null = {
    listMemories: () => []
  };
  smartEditConfig = {
    defaultMaxToolAnswerChars: 10,
    toolTimeout: 5,
    projectNames: ['alpha', 'beta'],
    removeProject: (_projectName: string) => {
      /* no-op */
    }
  };
  languageServer: FakeLanguageServer | null = new FakeLanguageServer();
  linesRead = {};

  private readonly active: boolean;
  private languageServerRunning: boolean;
  private readonly project: (ProjectLike & { projectConfig: { encoding: string } }) | null;
  recorded: { args: Record<string, unknown>; result: string; toolName: string }[] = [];

  constructor(options: FakeAgentOptions = {}) {
    this.active = options.active ?? true;
    this.languageServerRunning = options.languageServerRunning ?? true;
    if (options.activeProject) {
      this.project = {
        projectRoot: options.activeProject.projectRoot,
        projectConfig: {
          encoding: options.activeProject.encoding ?? 'utf-8'
        }
      };
    } else {
      this.project = this.active ? { projectRoot: process.cwd(), projectConfig: { encoding: 'utf-8' } } : null;
    }
  }

  getProjectRoot(): string {
    return this.project?.projectRoot ?? process.cwd();
  }

  getActiveProject(): typeof this.project {
    return this.project;
  }

  getActiveProjectOrThrow(): NonNullable<typeof this.project> {
    if (!this.project) {
      throw new Error('No active project');
    }
    return this.project;
  }

  getActiveToolNames(): string[] {
    return this.active ? ['fake'] : [];
  }

  toolIsActive(): boolean {
    return this.active;
  }

  isUsingLanguageServer(): boolean {
    return true;
  }

  isLanguageServerRunning(): boolean {
    return this.languageServerRunning;
  }

  resetLanguageServer(): void {
    this.languageServerRunning = true;
  }

  activateProjectFromPathOrName(): ProjectLike {
    if (!this.project) {
      throw new Error('No project available');
    }
    return this.project;
  }

  setModes(_modes: SmartEditAgentMode[]): void {
    // not needed for these tests
  }

  getCurrentConfigOverview(): string {
    return 'configuration overview';
  }

  createLanguageServerSymbolRetriever(): LanguageServerSymbolRetrieverLike {
    return {};
  }

  createCodeEditor(): Record<string, unknown> {
    return {};
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
}

class EchoTool extends Tool {
  static override readonly inputSchema = z.object({
    message: z.string()
  });

  apply({ message }: { message: string }): string {
    return message;
  }
}

class OptionalTool extends Tool {
  static override readonly markers = new Set([ToolMarkerOptional]);
  static override readonly inputSchema = z.object({});

  apply(): string {
    return SUCCESS_RESULT;
  }
}

class EditingTool extends Tool {
  static override readonly markers = new Set([ToolMarkerCanEdit]);
  static override readonly inputSchema = z.object({});

  apply(): string {
    return SUCCESS_RESULT;
  }
}

function resetRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  (registry as unknown as { resetForTesting(): void }).resetForTesting();
  return registry;
}

describe('Tool base class', () => {
  beforeEach(() => {
    resetRegistry();
  });

  it('derives snake_case tool name', () => {
    expect(EchoTool.getNameFromCls()).toBe('echo');
  });

  it('validates input arguments with zod', async () => {
    const agent = new FakeAgent();
    const tool = new EchoTool(agent);
    await expect(tool.applyEx({ message: 'hello' })).resolves.toBe('hello');
    await expect(tool.applyEx({ message: 5 as unknown as string })).rejects.toThrowError();
  });

  it('limits overly long tool responses', async () => {
    const agent = new FakeAgent();
    const tool = new EchoTool(agent);
    const response = await tool.applyEx({ message: '0123456789ABCDEF' }, { maxAnswerChars: 5 });
    expect(response).toMatch(/The answer is too long/);
  });

  it('returns error when tool inactive', async () => {
    const agent = new FakeAgent({ active: false });
    const tool = new EchoTool(agent);
    const response = await tool.applyEx({ message: 'hi' });
    expect(response).toContain("Tool 'echo' is not active");
  });

  it('records tool usage and saves language server cache', async () => {
    const agent = new FakeAgent();
    const tool = new EchoTool(agent);
    const result = await tool.applyEx({ message: 'works' });
    expect(result).toBe('works');
    expect(agent.recorded).toHaveLength(1);
    expect(agent.recorded[0]).toMatchObject({ args: { message: 'works' }, result: 'works', toolName: 'echo' });
    expect(agent.languageServer?.saveCalls ?? 0).toBe(1);
  });

  it('detects editing capability via markers', () => {
    expect(EditingTool.canEdit()).toBe(true);
  });
});

describe('ToolRegistry', () => {
  beforeEach(() => {
    resetRegistry();
  });

  it('registers and retrieves tool classes', () => {
    const registry = resetRegistry();
    registry.registerToolClass(EchoTool as ToolClass);

    expect(registry.getToolClassByName('echo')).toBe(EchoTool);
    expect(registry.getToolNamesDefaultEnabled()).toEqual(['echo']);
    expect(registry.getToolNames()).toEqual(['echo']);
  });

  it('tracks optional tools separately', () => {
    const registry = resetRegistry();
    registry.registerToolClass(OptionalTool as ToolClass);

    expect(registry.getToolNamesOptional()).toEqual(['optional']);
    expect(registry.getToolNamesDefaultEnabled()).toEqual([]);
  });

  it('prevents duplicate registrations', () => {
    const registry = resetRegistry();
    registry.registerToolClass(EchoTool as ToolClass);
    expect(() => registry.registerToolClass(EchoTool as ToolClass)).toThrow(/Duplicate tool name/);
  });

  it('registers tools via helper', () => {
    resetRegistry();
    registerToolClass(EchoTool as ToolClass);
    const registry = new ToolRegistry();
    expect(registry.isValidToolName('echo')).toBe(true);
  });
});

describe('EditedFileContext', () => {
  it('writes updated file content back to disk', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-edit-tools-'));
    const filePath = path.join(tmpDir, 'sample.txt');
    fs.writeFileSync(filePath, 'original', 'utf-8');

    const agent = new FakeAgent({
      activeProject: { projectRoot: tmpDir, encoding: 'utf-8' }
    });

    await EditedFileContext.use('sample.txt', agent, (context) => {
      expect(context.getOriginalContent()).toBe('original');
      context.setUpdatedContent('updated');
    });

    expect(fs.readFileSync(filePath, 'utf-8')).toBe('updated');
  });
});
