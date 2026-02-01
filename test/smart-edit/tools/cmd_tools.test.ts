import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { ExecuteShellCommandTool } from '../../../src/smart-edit/tools/cmd_tools.js';
import {
  type AgentTaskHandle,
  type IssueTaskMetadata,
  type LanguageServerLike,
  type MemoriesManagerLike,
  type ProjectLike,
  type SmartEditAgentLike,
  type Tool
} from '../../../src/smart-edit/tools/tools_base.js';
import type { SmartEditAgentMode } from '../../../src/smart-edit/config/context_mode.js';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-edit-cmd-tools-'));

async function createTempScript(dir: string, content: string): Promise<string> {
  const scriptPath = path.join(
    dir,
    `script-${Math.random().toString(16).slice(2)}.mjs`
  );
  await fs.promises.writeFile(scriptPath, `${content}\n`, 'utf-8');
  return scriptPath;
}

afterAll(async () => {
  await fs.promises.rm(tempRoot, { recursive: true, force: true });
});

class NullLanguageServer implements LanguageServerLike {
  saveCalls = 0;

  saveCache(): void {
    this.saveCalls += 1;
  }
}

interface RecordedUsage {
  args: Record<string, unknown>;
  result: string;
  toolName: string;
}

class FakeAgent implements SmartEditAgentLike {
  promptFactory = {};
  memoriesManager: MemoriesManagerLike | null = {
    listMemories: () => []
  };
  smartEditConfig = {
    defaultMaxToolAnswerChars: 1000,
    toolTimeout: 2000,
    projectNames: ['alpha', 'beta']
  };
  languageServer: NullLanguageServer | null = new NullLanguageServer();
  linesRead = {};

  private readonly projectRoot: string;
  private readonly project = {
    projectRoot: '',
    projectConfig: { encoding: 'utf-8' }
  };
  readonly recorded: RecordedUsage[] = [];

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.project.projectRoot = projectRoot;
  }

  getProjectRoot(): string {
    return this.projectRoot;
  }

  getActiveProject(): typeof this.project {
    return this.project;
  }

  getActiveProjectOrThrow(): typeof this.project {
    return this.project;
  }

  getActiveToolNames(): string[] {
    return ['execute_shell_command'];
  }

  toolIsActive(): boolean {
    return true;
  }

  activateProjectFromPathOrName(): ProjectLike {
    return this.project;
  }

  setModes(_modes: SmartEditAgentMode[]): void {
    // no-op for tests
  }

  getCurrentConfigOverview(): string {
    return 'not implemented';
  }

  isUsingLanguageServer(): boolean {
    return true;
  }

  isLanguageServerRunning(): boolean {
    return true;
  }

  resetLanguageServer(): void {
    // no-op for tests
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

describe('ExecuteShellCommandTool', () => {
  let projectRoot: string;
  let agent: FakeAgent;
  let tool: ExecuteShellCommandTool;

  beforeEach(async () => {
    projectRoot = await fs.promises.mkdtemp(
      path.join(tempRoot, 'project-root-')
    );
    agent = new FakeAgent(projectRoot);
    tool = new ExecuteShellCommandTool(agent);
  });

  it('returns command output as JSON and records usage', async () => {
    const script = await createTempScript(
      projectRoot,
      "process.stdout.write('hello'); process.stderr.write('warn');"
    );
    const command = `${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`;

    const response = await tool.applyEx({ command });
    const parsed = JSON.parse(response) as {
      stdout: string;
      stderr: string | null;
      return_code: number;
      cwd: string;
    };

    expect(parsed.stdout).toBe('hello');
    expect(parsed.stderr).toBe('warn');
    expect(parsed.return_code).toBe(0);
    expect(parsed.cwd).toBe(projectRoot);
    expect(agent.recorded).toHaveLength(1);
    expect(agent.recorded[0].args).toMatchObject({ command });
  });

  it('resolves relative working directories against the project root', async () => {
    const relativeDir = 'subdir';
    const subdirPath = path.join(projectRoot, relativeDir);
    await fs.promises.mkdir(subdirPath, { recursive: true });
    const script = await createTempScript(
      subdirPath,
      'process.stdout.write(process.cwd());'
    );
    const command = `${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`;

    const response = await tool.applyEx({ command, cwd: relativeDir });
    const parsed = JSON.parse(response) as { stdout: string };

    expect(await fs.promises.realpath(parsed.stdout)).toBe(
      await fs.promises.realpath(subdirPath)
    );
  });

  it('surfaces errors when the relative working directory is invalid', async () => {
    const response = await tool.applyEx({
      command: 'echo hello',
      cwd: 'does-not-exist'
    });

    expect(response).toContain(
      'Specified a relative working directory (does-not-exist)'
    );
  });

  it('respects capture_stderr flag', async () => {
    const script = await createTempScript(
      projectRoot,
      "process.stderr.write('failure'); process.exit(2);"
    );
    const command = `${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`;

    const response = await tool.applyEx({
      command,
      capture_stderr: false
    });
    const parsed = JSON.parse(response) as { stderr: string | null; return_code: number };

    expect(parsed.stderr).toBeNull();
    expect(parsed.return_code).toBe(2);
  });

  it('enforces max_answer_chars when provided', async () => {
    const script = await createTempScript(
      projectRoot,
      "process.stdout.write('A'.repeat(200));"
    );
    const command = `${JSON.stringify(process.execPath)} ${JSON.stringify(script)}`;

    const response = await tool.applyEx({
      command,
      max_answer_chars: 30
    });

    expect(response).toMatch(/The answer is too long/);
  });
});
