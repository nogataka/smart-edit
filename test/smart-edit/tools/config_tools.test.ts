import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import {
  ActivateProjectTool,
  GetCurrentConfigTool,
  RemoveProjectTool,
  SwitchModesTool
} from '../../../src/smart-edit/tools/config_tools.js';
import {
  type AgentTaskHandle,
  type IssueTaskMetadata,
  type MemoriesManagerLike,
  type ProjectLike,
  type SmartEditAgentLike,
  type Tool
} from '../../../src/smart-edit/tools/tools_base.js';
import { SmartEditAgentMode } from '../../../src/smart-edit/config/context_mode.js';

interface RecordedUsage {
  args: Record<string, unknown>;
  result: string;
  toolName: string;
}

class FakeMemoriesManager implements MemoriesManagerLike {
  calls = 0;
  memories: string[] = ['kickoff', 'retro'];

  listMemories(): string[] {
    this.calls += 1;
    return [...this.memories];
  }
}

class FakeAgent implements SmartEditAgentLike {
  promptFactory = {};
  memoriesManager: FakeMemoriesManager | null = new FakeMemoriesManager();
  smartEditConfig = {
    defaultMaxToolAnswerChars: 100_000,
    toolTimeout: 5_000,
    projectNames: ['alpha', 'beta'],
    removeProject: vi.fn<(name: string) => void>(),
    save: vi.fn()
  };
  languageServer = null;
  linesRead = {};

  readonly activationCalls: string[] = [];
  readonly setModesCalls: SmartEditAgentMode[][] = [];
  readonly recorded: RecordedUsage[] = [];

  projectRoot: string;
  activeProject: (ProjectLike & { pathToProjectYml?: () => string; isNewlyCreated?: boolean }) | null = null;
  nextActivationResult: ProjectLike & { pathToProjectYml?: () => string; isNewlyCreated?: boolean };
  activeToolNames: string[] = ['execute_shell_command', 'get_current_config'];
  configOverview = 'Current configuration:\n- demo';

  constructor(projectRoot: string, nextActivationResult: ProjectLike & { pathToProjectYml?: () => string; isNewlyCreated?: boolean }) {
    this.projectRoot = projectRoot;
    this.nextActivationResult = nextActivationResult;
  }

  getProjectRoot(): string {
    return this.projectRoot;
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
    // no-op for tests
  }

  activateProjectFromPathOrName(project: string): ProjectLike {
    this.activationCalls.push(project);
    const result = this.nextActivationResult;
    this.activeProject = result;
    return result;
  }

  setModes(modes: SmartEditAgentMode[]): void {
    this.setModesCalls.push([...modes]);
  }

  getCurrentConfigOverview(): string {
    return this.configOverview;
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
      async result(): Promise<T> {
        return promise;
      }
    };
  }
}

describe('config tools', () => {
  let agent: FakeAgent;
  const projectRoot = '/workspace/demo';
  const baseProject: ProjectLike & { pathToProjectYml: () => string; isNewlyCreated?: boolean } = {
    projectRoot,
    projectConfig: {
      encoding: 'utf-8',
      language: 'typescript',
      initialPrompt: 'Kick off the project with TypeScript best practices.',
      projectName: 'alpha'
    },
    pathToProjectYml: () => `${projectRoot}/.smart-edit/project.yml`,
    isNewlyCreated: true
  };

  beforeEach(() => {
    agent = new FakeAgent(projectRoot, { ...baseProject });
    agent.activeProject = agent.nextActivationResult;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('activates a project and reports project details and memories', async () => {
    const tool = new ActivateProjectTool(agent);

    const response = await tool.applyEx({ project: 'alpha' });

    expect(agent.activationCalls).toEqual(['alpha']);
    expect(agent.memoriesManager?.calls).toBe(1);
    expect(response).toContain("Created and activated a new project with name 'alpha'");
    expect(response).toContain('language: typescript');
    expect(response).toContain(agent.nextActivationResult.pathToProjectYml?.() ?? '');
    expect(response).toContain('Additional project information');
    expect(response).toContain('Available memories');
    expect(response).toContain('"kickoff"');
    expect(response).toContain('Available tools');
    expect(response).toContain('"execute_shell_command"');
  });

  it('reports existing project activation when project already registered', async () => {
    agent.nextActivationResult = {
      ...baseProject,
      isNewlyCreated: false
    };

    const tool = new ActivateProjectTool(agent);
    const response = await tool.applyEx({ project: 'alpha' });

    expect(response).toContain("Activated existing project with name 'alpha'");
  });

  it('removes a project through the configuration API', async () => {
    const tool = new RemoveProjectTool(agent);

    const output = await tool.applyEx({ project_name: 'beta' });

    expect(agent.smartEditConfig.removeProject).toHaveBeenCalledWith('beta');
    expect(output).toBe("Successfully removed project 'beta' from configuration.");
  });

  it('switches modes and returns prompts and active tool list', async () => {
    const modeFactory = (name: string, prompt: string): SmartEditAgentMode =>
      new SmartEditAgentMode({
        name,
        prompt,
        description: `${name} mode`,
        excludedTools: [],
        includedOptionalTools: []
      });

    const loadSpy = vi
      .spyOn(SmartEditAgentMode, 'load')
      .mockImplementation((name: string) => modeFactory(name, `${name} prompt`));

    const tool = new SwitchModesTool(agent);
    const response = await tool.applyEx({ modes: ['editing', 'planning'] });

    expect(loadSpy).toHaveBeenCalledTimes(2);
    expect(agent.setModesCalls).toHaveLength(1);
    expect(agent.setModesCalls[0].map((mode) => mode.name)).toEqual(['editing', 'planning']);
    expect(response).toContain('Successfully activated modes: editing, planning');
    expect(response).toContain('editing prompt');
    expect(response).toContain('Currently active tools: execute_shell_command, get_current_config');
  });

  it('retrieves the current configuration overview', async () => {
    const tool = new GetCurrentConfigTool(agent);
    agent.configOverview = 'Current configuration:\n- alpha project';

    const result = await tool.applyEx();

    expect(result).toBe('Current configuration:\n- alpha project');
  });
});
