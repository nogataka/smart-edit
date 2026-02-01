import { z } from 'zod';

import {
  Tool,
  ToolMarkerDoesNotRequireActiveProject,
  type AgentTaskHandle,
  type CodeEditorLike,
  type LanguageServerLike,
  type LinesReadLike,
  type MemoriesManagerLike,
  type ProjectLike,
  type SmartEditAgentLike
} from '../../../src/smart-edit/tools/tools_base.js';
import type { SmartEditConfig } from '../../../src/smart-edit/config/smart_edit_config.js';
import type { SmartEditAgentMode } from '../../../src/smart-edit/config/context_mode.js';

export class EchoTool extends Tool {
  static override readonly markers = new Set([ToolMarkerDoesNotRequireActiveProject]);
  static override readonly inputSchema = z.object({
    message: z.string().describe('Text to echo back.')
  });
  static override readonly description = 'Echoes the provided message back to the caller';

  apply(args: { message: string }): string {
    return args.message;
  }
}

export class FakeAgent implements SmartEditAgentLike {
  readonly promptFactory = {};
  readonly memoriesManager: MemoriesManagerLike | null = null;
  readonly smartEditConfig: SmartEditConfig;
  readonly languageServer: LanguageServerLike | null = null;
  readonly linesRead: LinesReadLike | null = {};
  readonly tools: Tool[];
  readonly recordedToolCalls: { args: Record<string, unknown>; result: string }[] = [];
  readonly project: ProjectLike | null = {
    projectRoot: '/tmp/project',
    projectConfig: { encoding: 'utf-8' }
  };

  createSystemPromptCalls = 0;
  lastModes: SmartEditAgentMode[] = [];

  constructor(config: SmartEditConfig) {
    this.smartEditConfig = config;
    this.tools = [new EchoTool(this)];
  }

  getExposedToolInstances(): Iterable<Tool> {
    return this.tools;
  }

  createSystemPrompt(): string {
    this.createSystemPromptCalls += 1;
    return 'SYSTEM PROMPT';
  }

  getProjectRoot(): string {
    if (!this.project) {
      throw new Error('No active project');
    }
    return this.project.projectRoot;
  }

  getActiveProject(): ProjectLike | null {
    return this.project;
  }

  getActiveProjectOrThrow(): ProjectLike {
    const project = this.getActiveProject();
    if (!project) {
      throw new Error('No active project');
    }
    return project;
  }

  getActiveToolNames(): string[] {
    return this.tools.map((tool) => tool.getName());
  }

  toolIsActive(): boolean {
    return true;
  }

  isUsingLanguageServer(): boolean {
    return false;
  }

  isLanguageServerRunning(): boolean {
    return true;
  }

  resetLanguageServer(): void {
    // no-op for tests
  }

  activateProjectFromPathOrName(): ProjectLike {
    if (!this.project) {
      throw new Error('No active project');
    }
    return this.project;
  }

  setModes(modes: SmartEditAgentMode[]): void {
    this.lastModes = modes;
  }

  getCurrentConfigOverview(): string {
    return 'overview';
  }

  createLanguageServerSymbolRetriever(): Record<string, unknown> {
    return {};
  }

  createCodeEditor(): CodeEditorLike {
    return {};
  }

  recordToolUsageIfEnabled(args: Record<string, unknown>, result: string, _tool: Tool): void {
    this.recordedToolCalls.push({ args, result });
  }

  issueTask<T>(task: () => Promise<T> | T): AgentTaskHandle<T> {
    const promise = Promise.resolve().then(task);
    return {
      async result(_options?: { timeout?: number }): Promise<T> {
        return await promise;
      }
    };
  }
}
