import os from 'node:os';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CheckOnboardingPerformedTool,
  InitialInstructionsTool,
  OnboardingTool,
  PrepareForNewConversationTool,
  SummarizeChangesTool,
  ThinkAboutCollectedInformationTool,
  ThinkAboutTaskAdherenceTool,
  ThinkAboutWhetherYouAreDoneTool
} from '../../../src/smart-edit/tools/workflow_tools.js';
import {
  type AgentTaskHandle,
  type IssueTaskMetadata,
  type LanguageServerLike,
  type LinesReadLike,
  type MemoriesManagerLike,
  type ProjectLike,
  type SmartEditAgentLike,
  type Tool,
  ToolMarkerDoesNotRequireActiveProject,
  ToolMarkerOptional
} from '../../../src/smart-edit/tools/tools_base.js';

class FakeMemoriesManager implements MemoriesManagerLike {
  memories: string[] = [];

  constructor(initialMemories: string[] = []) {
    this.memories = [...initialMemories];
  }

  listMemories(): string[] {
    return [...this.memories];
  }

  set(memories: string[]): void {
    this.memories = [...memories];
  }
}

interface FakeAgentOptions {
  memories?: string[];
  createSystemPrompt?: () => string | Promise<string>;
}

class FakeAgent implements SmartEditAgentLike {
  promptFactory: Record<string, unknown> = {};
  memoriesManager: FakeMemoriesManager | null;
  smartEditConfig = {
    defaultMaxToolAnswerChars: 1000,
    toolTimeout: 5_000,
    projectNames: ['alpha']
  };
  languageServer: LanguageServerLike | null = null;
  linesRead: LinesReadLike | null = {};

  private activeProject: ProjectLike | null = {
    projectRoot: '/workspace/project',
    projectConfig: { encoding: 'utf-8' }
  };

  readonly recorded: { args: Record<string, unknown>; result: string; toolName: string }[] = [];

  getToolCalls: string[] = [];

  constructor(options: FakeAgentOptions = {}) {
    this.memoriesManager = new FakeMemoriesManager(options.memories ?? []);
    if (options.createSystemPrompt) {
      this.createSystemPrompt = options.createSystemPrompt;
    }
  }

  getProjectRoot(): string {
    return this.activeProject?.projectRoot ?? '/workspace/project';
  }

  getActiveProject(): ProjectLike | null {
    return this.activeProject;
  }

  getActiveProjectOrThrow(): ProjectLike {
    if (!this.activeProject) {
      throw new Error('No active project');
    }
    return this.activeProject;
  }

  getActiveToolNames(): string[] {
    return ['check_onboarding_performed', 'onboarding'];
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
    this.activeProject ??= {
      projectRoot: '/workspace/project',
      projectConfig: { encoding: 'utf-8' }
    } as ProjectLike;
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

  recordToolUsageIfEnabled(args: Record<string, unknown>, result: string, tool: Tool): void {
    this.recorded.push({ args, result, toolName: tool.getName() });
  }

  issueTask<T>(task: () => Promise<T> | T, _metadata?: IssueTaskMetadata): AgentTaskHandle<T> {
    const promise = Promise.resolve().then(task);
    return {
      result: ({ timeout }: { timeout?: number } = {}): Promise<T> => {
        if (timeout !== undefined && timeout < 0) {
          return Promise.reject(new Error('Timeout must be positive.'));
        }
        return promise;
      }
    };
  }

  // Optional interfaces probed by workflow tools
  getTool<T extends Tool>(_toolClass: new (agent: SmartEditAgentLike) => T): T {
    this.getToolCalls.push((_toolClass as { name: string }).name ?? 'unknown');
    const FallbackCtor: new (agent: SmartEditAgentLike) => T = _toolClass;
    return new FallbackCtor(this);
  }

  createSystemPrompt?(): string | Promise<string>;
  create_system_prompt?(): string | Promise<string>;

  clearActiveProject(): void {
    this.activeProject = null;
  }
}

describe('workflow tools', () => {
  let agent: FakeAgent;

  beforeEach(() => {
    agent = new FakeAgent({ memories: [] });
  });

  it('reports onboarding missing when no memories exist', async () => {
    const tool = new CheckOnboardingPerformedTool(agent);

    const response = await tool.applyEx();

    expect(response).toContain('Onboarding not performed yet');
    expect(agent.recorded).toHaveLength(1);
  });

  it('lists memories when onboarding was already performed', async () => {
    agent.memoriesManager?.set(['kickoff', 'retro']);
    const tool = new CheckOnboardingPerformedTool(agent);

    const response = await tool.applyEx();

    expect(response).toContain('The onboarding was already performed');
    expect(response).toContain('["kickoff","retro"]');
    expect(agent.getToolCalls).toContain('ListMemoriesTool');
  });

  it('delegates onboarding prompt generation to the prompt factory with normalized system name', async () => {
    const promptSpy = vi.fn().mockResolvedValue('onboarding instructions');
    agent.promptFactory = {
      create_onboarding_prompt: promptSpy
    };
    const platformSpy = vi.spyOn(os, 'platform').mockReturnValue('win32');
    const tool = new OnboardingTool(agent);

    const response = await tool.applyEx();

    expect(platformSpy).toHaveBeenCalled();
    expect(promptSpy).toHaveBeenCalledWith({ system: 'Windows' });
    expect(response).toBe('onboarding instructions');
    platformSpy.mockRestore();
  });

  it('invokes camelCase prompt factory methods for thinking tools', async () => {
    const collectedSpy = vi.fn().mockReturnValue('reflect collected');
    const adherenceSpy = vi.fn().mockReturnValue('stay on task');
    const doneSpy = vi.fn().mockReturnValue('confirm completion');
    agent.promptFactory = {
      createThinkAboutCollectedInformation: collectedSpy,
      createThinkAboutTaskAdherence: adherenceSpy,
      createThinkAboutWhetherYouAreDone: doneSpy
    };

    const collectTool = new ThinkAboutCollectedInformationTool(agent);
    const adherenceTool = new ThinkAboutTaskAdherenceTool(agent);
    const doneTool = new ThinkAboutWhetherYouAreDoneTool(agent);

    await expect(collectTool.applyEx()).resolves.toBe('reflect collected');
    await expect(adherenceTool.applyEx()).resolves.toBe('stay on task');
    await expect(doneTool.applyEx()).resolves.toBe('confirm completion');
  });

  it('marks summarize changes tool as optional and calls prompt factory', async () => {
    const summarizeSpy = vi.fn().mockResolvedValue('summary template');
    agent.promptFactory = {
      create_summarize_changes: summarizeSpy
    };
    const tool = new SummarizeChangesTool(agent);

    const response = await tool.applyEx();

    expect(SummarizeChangesTool.hasMarker(ToolMarkerOptional)).toBe(true);
    expect(response).toBe('summary template');
  });

  it('provides preparation instructions for a new conversation', async () => {
    const prepSpy = vi.fn().mockReturnValue('prep instructions');
    agent.promptFactory = {
      createPrepareForNewConversation: prepSpy
    };
    const tool = new PrepareForNewConversationTool(agent);

    const response = await tool.applyEx();

    expect(prepSpy).toHaveBeenCalledTimes(1);
    expect(response).toBe('prep instructions');
  });

  it('fetches initial instructions without requiring an active project', async () => {
    agent.clearActiveProject();
    agent.createSystemPrompt = vi.fn().mockResolvedValue('system prompt');
    const tool = new InitialInstructionsTool(agent);

    const response = await tool.applyEx({}, { catchExceptions: false });

    expect(response).toBe('system prompt');
    expect(InitialInstructionsTool.hasMarker(ToolMarkerDoesNotRequireActiveProject)).toBe(true);
    expect(InitialInstructionsTool.hasMarker(ToolMarkerOptional)).toBe(true);
  });
});
