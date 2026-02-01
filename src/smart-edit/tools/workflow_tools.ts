import os from 'node:os';

import {
  Tool,
  ToolMarkerDoesNotRequireActiveProject,
  ToolMarkerOptional,
  type PromptFactoryLike,
  type SmartEditAgentLike,
  type ToolClass
} from './tools_base.js';
import { ListMemoriesTool } from './memory_tools.js';

function ensureString(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'symbol') {
    return value.toString();
  }
  if (typeof value === 'function') {
    return '[function]';
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return Object.prototype.toString.call(value);
    }
  }
  return '';
}

async function callPromptFactoryMethod(
  promptFactory: PromptFactoryLike,
  methodCandidates: string[],
  ...args: unknown[]
): Promise<string> {
  for (const name of methodCandidates) {
    const candidate = Reflect.get(promptFactory as object, name) as unknown;
    if (typeof candidate === 'function') {
      const result = await Promise.resolve((candidate as (...fnArgs: unknown[]) => unknown).apply(promptFactory, args));
      return ensureString(result);
    }
  }
  throw new Error(`Prompt factory does not implement expected method: ${methodCandidates.join(' or ')}`);
}

function normalizeSystemName(platformName: string): string {
  switch (platformName) {
    case 'win32':
      return 'Windows';
    case 'darwin':
      return 'Darwin';
    case 'linux':
      return 'Linux';
    default:
      if (platformName.length === 0) {
        return 'Unknown';
      }
      return platformName.charAt(0).toUpperCase() + platformName.slice(1);
  }
}

function getToolInstance<T extends Tool>(agent: SmartEditAgentLike, toolClass: ToolClass<T>): T {
  const lookupAgent = agent as SmartEditAgentLike & {
    getTool?: (tool: ToolClass<T>) => T;
    get_tool?: (tool: ToolClass<T>) => T;
  };
  if (typeof lookupAgent.getTool === 'function') {
    return lookupAgent.getTool(toolClass);
  }
  if (typeof lookupAgent.get_tool === 'function') {
    return lookupAgent.get_tool(toolClass);
  }
  const FallbackCtor: new (agent: SmartEditAgentLike) => T = toolClass;
  return new FallbackCtor(agent);
}

async function callAgentSystemPrompt(agent: SmartEditAgentLike): Promise<string> {
  const candidate = agent as SmartEditAgentLike & {
    createSystemPrompt?: () => unknown;
    create_system_prompt?: () => unknown;
  };
  if (typeof candidate.createSystemPrompt === 'function') {
    const result = await Promise.resolve(candidate.createSystemPrompt());
    return ensureString(result);
  }
  if (typeof candidate.create_system_prompt === 'function') {
    const result = await Promise.resolve(candidate.create_system_prompt());
    return ensureString(result);
  }
  throw new Error('Agent does not implement a system prompt creation method.');
}

export class CheckOnboardingPerformedTool extends Tool {
  static override readonly description = 'Checks whether project onboarding was already performed.';

  override async apply(_args: Record<string, unknown> = {}): Promise<string> {
    const listTool = getToolInstance(this.agent, ListMemoriesTool);
    const raw = await Promise.resolve(listTool.apply());

    let parsed: unknown;
    try {
      parsed = JSON.parse(ensureString(raw));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Unable to parse ListMemoriesTool output as JSON: ${message}`);
    }

    if (!Array.isArray(parsed)) {
      throw new Error('ListMemoriesTool returned non-array JSON output.');
    }

    if (parsed.length === 0) {
      return (
        'Onboarding not performed yet (no memories available). ' +
        'You should perform onboarding by calling the `onboarding` tool before proceeding with the task.'
      );
    }

    const lines = [
      'The onboarding was already performed, below is the list of available memories.',
      'Do not read them immediately, just remember that they exist and that you can read them later, if it is necessary',
      'for the current task.',
      'Some memories may be based on previous conversations, others may be general for the current project.',
      'You should be able to tell which one you need based on the name of the memory.',
      '',
      JSON.stringify(parsed)
    ];
    return lines.join('\n');
  }
}

export class OnboardingTool extends Tool {
  static override readonly description =
    'Provides onboarding instructions (project structure, essential tasks, etc.) when onboarding has not been performed.';

  override async apply(_args: Record<string, unknown> = {}): Promise<string> {
    const system = normalizeSystemName(os.platform());
    const result = await callPromptFactoryMethod(
      this.promptFactory,
      ['create_onboarding_prompt', 'createOnboardingPrompt'],
      { system }
    );
    return result;
  }
}

export class ThinkAboutCollectedInformationTool extends Tool {
  static override readonly description =
    'Encourages the agent to reflect on whether the gathered information is sufficient and relevant.';

  override async apply(_args: Record<string, unknown> = {}): Promise<string> {
    const result = await callPromptFactoryMethod(
      this.promptFactory,
      ['create_think_about_collected_information', 'createThinkAboutCollectedInformation']
    );
    return result;
  }
}

export class ThinkAboutTaskAdherenceTool extends Tool {
  static override readonly description =
    'Guides the agent to confirm alignment with the current task before making code changes.';

  override async apply(_args: Record<string, unknown> = {}): Promise<string> {
    const result = await callPromptFactoryMethod(
      this.promptFactory,
      ['create_think_about_task_adherence', 'createThinkAboutTaskAdherence']
    );
    return result;
  }
}

export class ThinkAboutWhetherYouAreDoneTool extends Tool {
  static override readonly description = 'Helps determine whether the requested task is fully completed.';

  override async apply(_args: Record<string, unknown> = {}): Promise<string> {
    const result = await callPromptFactoryMethod(
      this.promptFactory,
      ['create_think_about_whether_you_are_done', 'createThinkAboutWhetherYouAreDone']
    );
    return result;
  }
}

export class SummarizeChangesTool extends Tool {
  static override readonly markers = new Set([ToolMarkerOptional]);
  static override readonly description = 'Provides guidelines for summarizing codebase changes after completing a task.';

  override async apply(_args: Record<string, unknown> = {}): Promise<string> {
    const result = await callPromptFactoryMethod(
      this.promptFactory,
      ['create_summarize_changes', 'createSummarizeChanges']
    );
    return result;
  }
}

export class PrepareForNewConversationTool extends Tool {
  static override readonly description =
    'Provides instructions to prepare for continuing work in a new conversation context.';

  override async apply(_args: Record<string, unknown> = {}): Promise<string> {
    const result = await callPromptFactoryMethod(
      this.promptFactory,
      ['create_prepare_for_new_conversation', 'createPrepareForNewConversation']
    );
    return result;
  }
}

export class InitialInstructionsTool extends Tool {
  static override readonly markers = new Set([ToolMarkerDoesNotRequireActiveProject, ToolMarkerOptional]);
  static override readonly description =
    'Returns the initial system instructions for the current project when they cannot be provided via the system prompt.';

  override async apply(_args: Record<string, unknown> = {}): Promise<string> {
    const result = await callAgentSystemPrompt(this.agent);
    return result;
  }
}
