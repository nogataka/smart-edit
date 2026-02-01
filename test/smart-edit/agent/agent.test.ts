import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { SmartEditAgent } from '../../../src/smart-edit/agent.js';
import {
  ProjectConfig,
  RegisteredProject,
  RegisteredTokenCountEstimator,
  SmartEditConfig
} from '../../../src/smart-edit/config/smart_edit_config.js';
import { SmartEditAgentContext, SmartEditAgentMode } from '../../../src/smart-edit/config/context_mode.js';
import { MemoryLogHandler } from '../../../src/smart-edit/util/logging.js';
import { Language } from '../../../src/smart-lsp/ls_config.js';
import { SmartLanguageServer } from '../../../src/smart-lsp/ls.js';

class TestProject {
  readonly projectRoot: string;
  readonly projectConfig: ProjectConfig;
  readonly projectName: string;

  constructor(projectRoot: string, projectConfig: ProjectConfig) {
    this.projectRoot = projectRoot;
    this.projectConfig = projectConfig;
    this.projectName = projectConfig.projectName;
  }

  createLanguageServer(options: {
    logLevel: number;
    lsTimeout: number | null;
    traceLspCommunication: boolean;
    lsSpecificSettings: Record<string, unknown>;
  }): SmartLanguageServer {
    return SmartLanguageServer.create(
      {
        codeLanguage: this.projectConfig.language,
        traceLspCommunication: options.traceLspCommunication,
        startIndependentLspProcess: true,
        ignoredPaths: this.projectConfig.ignoredPaths
      },
      { level: options.logLevel },
      this.projectRoot,
      {
        timeout: options.lsTimeout,
        smartLspSettings: {
          lsSpecificSettings: options.lsSpecificSettings,
          projectDataRelativePath: '.smart-lsp'
        }
      }
    );
  }
}

interface CreateAgentOptions {
  withProject?: boolean;
}

function createAgent(options: CreateAgentOptions = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-edit-agent-test-'));
  const configInit = new ProjectConfig({
    projectName: 'demo',
    language: Language.PYTHON,
    ignoredPaths: [],
    excludedTools: [],
    includedOptionalTools: [],
    readOnly: false,
    ignoreAllFilesInGitignore: true,
    initialPrompt: ''
  });
  const project = new TestProject(tmpDir, configInit);
  const registered = RegisteredProject.fromProjectInstance(project);

  const smartEditConfig = new SmartEditConfig({
    projects: options.withProject ? [registered] : [],
    guiLogWindowEnabled: false,
    webDashboard: false,
    recordToolUsageStats: true,
    tokenCountEstimator: RegisteredTokenCountEstimator.TIKTOKEN_GPT4O,
    logLevel: 20,
    traceLspCommunication: false
  });

  const context = new SmartEditAgentContext({
    name: 'test-context',
    prompt: 'You are a helpful assistant.',
    description: 'Test context',
    excludedTools: [],
    includedOptionalTools: []
  });

  const modes = [
    new SmartEditAgentMode({
      name: 'test-mode',
      prompt: 'Operate in test mode.',
      description: 'Test mode description',
      excludedTools: [],
      includedOptionalTools: []
    })
  ];

  const agent = new SmartEditAgent({
    smartEditConfig,
    context,
    modes,
    memoryLogHandler: new MemoryLogHandler(),
    project: options.withProject ? project.projectName : undefined
  });

  return { agent, project, smartEditConfig, tmpDir };
}

const resourcesToCleanup: string[] = [];

afterEach(() => {
  while (resourcesToCleanup.length > 0) {
    const dir = resourcesToCleanup.pop();
    if (!dir) {
      continue;
    }
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

describe('SmartEditAgent', () => {
  it('initializes with default tool exposure and generates system prompt', () => {
    const { agent, tmpDir } = createAgent();
    resourcesToCleanup.push(tmpDir);

    expect(agent.getExposedToolInstances().length).toBeGreaterThan(0);
    const prompt = agent.createSystemPrompt();
    expect(prompt).toContain('You are a professional coding agent concerned with one particular codebase.');
    expect(prompt).toContain('Context description:');

    agent.dispose();
  });

  it('schedules tasks sequentially', async () => {
    const { agent, tmpDir } = createAgent();
    resourcesToCleanup.push(tmpDir);

    const order: string[] = [];
    const first = agent.issueTask(() => {
      order.push('first');
      return 'first-result';
    });
    const second = agent.issueTask(() => {
      order.push('second');
      return 'second-result';
    });

    await first.result();
    await second.result();

    expect(order).toEqual(['first', 'second']);
    agent.dispose();
  });

  it('records tool usage when enabled', () => {
    const { agent, tmpDir } = createAgent();
    resourcesToCleanup.push(tmpDir);

    const statsBefore = agent.toolUsageStats?.getToolStatsDict() ?? {};
    expect(Object.keys(statsBefore).length).toBe(0);

    const arbitraryTool = agent.getExposedToolInstances()[0];
    agent.recordToolUsageIfEnabled({ foo: 'bar' }, 'result', arbitraryTool);

    const statsAfter = agent.toolUsageStats?.getToolStatsDict() ?? {};
    expect(Object.keys(statsAfter).length).toBeGreaterThanOrEqual(1);
    agent.dispose();
  });

  it('activates a project by name when provided', async () => {
    const { agent, project, tmpDir } = createAgent({ withProject: true });
    resourcesToCleanup.push(tmpDir);

    await agent.activateProjectFromPathOrName(project.projectName);
    const active = agent.getActiveProject();
    expect(active?.projectRoot).toBe(project.projectRoot);
    agent.dispose();
  });

  it('produces a human-readable configuration overview', () => {
    const { agent, tmpDir } = createAgent();
    resourcesToCleanup.push(tmpDir);

    const overview = agent.getCurrentConfigOverview();
    expect(overview).toContain('Current configuration:');
    expect(overview).toContain('Smart-Edit version:');
    agent.dispose();
  });
});
