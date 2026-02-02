import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  Tool,
  ToolMarkerDoesNotRequireActiveProject,
  ToolMarkerOptional,
  type PromptFactoryLike,
  type SmartEditAgentLike,
  type ToolClass
} from './tools_base.js';
import { ListMemoriesTool, ReadMemoryTool, WriteMemoryTool } from './memory_tools.js';
import { getCurrentCommit, hasSignificantChanges } from '../util/git.js';

const PROJECT_SYMBOLS_MEMORY = 'project-symbols';

interface ProjectSymbolsMemory {
  lastCommit: string;
  lastUpdated: string;
  dependencies?: Record<string, string>;
  utilityDirs?: string[];
  commonComponents?: string[];
}

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

/**
 * Auto-collects project symbols from the codebase.
 * This provides fallback data when the AI doesn't pass arguments.
 */
function autoCollectProjectSymbols(projectRoot: string): Partial<ProjectSymbolsMemory> {
  const result: Partial<ProjectSymbolsMemory> = {};

  // 1. Collect dependencies from package.json
  const pkgPath = path.join(projectRoot, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkgContent = fs.readFileSync(pkgPath, 'utf-8');
      const pkg = JSON.parse(pkgContent) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      result.dependencies = {
        ...(pkg.dependencies ?? {}),
        ...(pkg.devDependencies ?? {})
      };
    } catch {
      // Ignore parse errors
    }
  }

  // 2. Detect common utility directories
  const utilityPatterns = ['src/lib', 'src/utils', 'src/helpers', 'lib', 'utils', 'src/util'];
  result.utilityDirs = utilityPatterns.filter((dir) => {
    const fullPath = path.join(projectRoot, dir);
    try {
      return fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory();
    } catch {
      return false;
    }
  });

  // 3. Detect common component directories and list components
  const componentPatterns = ['src/components/common', 'src/components/ui', 'src/components/shared'];
  const foundComponentDirs = componentPatterns.filter((dir) => {
    const fullPath = path.join(projectRoot, dir);
    try {
      return fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory();
    } catch {
      return false;
    }
  });

  if (foundComponentDirs.length > 0) {
    const components: string[] = [];
    for (const dir of foundComponentDirs) {
      try {
        const fullPath = path.join(projectRoot, dir);
        const entries = fs.readdirSync(fullPath);
        for (const entry of entries) {
          if (entry.endsWith('.tsx') || entry.endsWith('.ts') || entry.endsWith('.jsx') || entry.endsWith('.js')) {
            const name = entry.replace(/\.(tsx?|jsx?)$/, '');
            if (!components.includes(name)) {
              components.push(name);
            }
          }
        }
      } catch {
        // Ignore read errors
      }
    }
    result.commonComponents = components;
  }

  return result;
}

export class CheckOnboardingPerformedTool extends Tool {
  static override readonly description =
    'Checks whether project onboarding was already performed and if there are significant changes since last onboarding.';

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

    // Check for significant changes since last onboarding
    let significantChangesInfo = '';

    if (parsed.includes(PROJECT_SYMBOLS_MEMORY)) {
      try {
        const readTool = getToolInstance(this.agent, ReadMemoryTool);
        const memoryContent = await Promise.resolve(
          readTool.apply({ memory_file_name: PROJECT_SYMBOLS_MEMORY })
        );

        const projectSymbols = JSON.parse(ensureString(memoryContent)) as ProjectSymbolsMemory;
        const lastCommit = projectSymbols.lastCommit;

        if (lastCommit) {
          const projectRoot = this.agent.getActiveProject()?.projectRoot;
          const currentCommit = await getCurrentCommit({ cwd: projectRoot });

          if (currentCommit && currentCommit !== lastCommit) {
            const changeInfo = await hasSignificantChanges(lastCommit);

            if (changeInfo.significant) {
              significantChangesInfo = [
                '',
                '## IMPORTANT: Significant Changes Detected',
                '',
                `Since your last onboarding (commit: ${lastCommit.substring(0, 7)}), there have been significant changes:`,
                changeInfo.summary,
                '',
                'Consider re-running onboarding to refresh the project-symbols memory.',
                'Use the `onboarding` tool to update your knowledge of the codebase.',
                ''
              ].join('\n');
            }
          }
        }
      } catch (error) {
        // If we can't read the memory or parse it, just continue without the check
        const message = error instanceof Error ? error.message : String(error);
        significantChangesInfo = `\n(Note: Could not check for changes: ${message})\n`;
      }
    }

    const lines = [
      'The onboarding was already performed, below is the list of available memories.',
      'Do not read them immediately, just remember that they exist and that you can read them later, if it is necessary',
      'for the current task.',
      'Some memories may be based on previous conversations, others may be general for the current project.',
      'You should be able to tell which one you need based on the name of the memory.',
      significantChangesInfo,
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

export class CollectProjectSymbolsTool extends Tool {
  static override readonly description =
    'Collects and saves project symbols (utilities, components, dependencies) to the project-symbols memory. ' +
    'Call this after onboarding to enable duplicate detection features. ' +
    'Basic information is auto-collected; your input is merged to add project-specific patterns.';

  override async apply(args: Record<string, unknown> = {}): Promise<string> {
    // Get project root from the active project
    const activeProject = this.agent.getActiveProject();
    const projectRoot = activeProject?.projectRoot;

    if (!projectRoot) {
      throw new Error('No active project. Please activate a project first.');
    }

    // AI-provided arguments
    const {
      utility_dirs = [],
      common_components = [],
      dependencies = {}
    } = args as {
      utility_dirs?: string[];
      common_components?: string[];
      dependencies?: Record<string, string>;
    };

    // Auto-collect from the project
    const autoCollected = autoCollectProjectSymbols(projectRoot);

    // Merge: auto-collected as base, AI input added on top
    const mergedDependencies: Record<string, string> = {
      ...(autoCollected.dependencies ?? {}),
      ...dependencies
    };

    const mergedUtilityDirs = [
      ...new Set([...(autoCollected.utilityDirs ?? []), ...utility_dirs])
    ];

    const mergedComponents = [
      ...new Set([...(autoCollected.commonComponents ?? []), ...common_components])
    ];

    // Get current git commit from project directory
    const currentCommit = await getCurrentCommit({ cwd: projectRoot });

    // Build the project symbols memory content
    const projectSymbols: ProjectSymbolsMemory = {
      lastCommit: currentCommit ?? 'unknown',
      lastUpdated: new Date().toISOString(),
      dependencies: mergedDependencies,
      utilityDirs: mergedUtilityDirs,
      commonComponents: mergedComponents
    };

    // Save to memory
    const writeTool = getToolInstance(this.agent, WriteMemoryTool);
    const memoryContent = JSON.stringify(projectSymbols, null, 2);

    await Promise.resolve(
      writeTool.apply({
        memory_name: PROJECT_SYMBOLS_MEMORY,
        content: memoryContent
      })
    );

    // Build summary showing what was auto-collected vs AI-provided
    const autoDepCount = Object.keys(autoCollected.dependencies ?? {}).length;
    const aiDepCount = Object.keys(dependencies).length;
    const autoUtilCount = (autoCollected.utilityDirs ?? []).length;
    const aiUtilCount = utility_dirs.length;
    const autoCompCount = (autoCollected.commonComponents ?? []).length;
    const aiCompCount = common_components.length;

    const lines = [
      `Project symbols saved to memory: ${PROJECT_SYMBOLS_MEMORY}`,
      '',
      `- Commit: ${projectSymbols.lastCommit}`,
      `- Updated: ${projectSymbols.lastUpdated}`,
      '',
      '## Collected Data',
      '',
      `- Dependencies: ${Object.keys(mergedDependencies).length} total (${autoDepCount} auto-collected, ${aiDepCount} AI-provided)`,
      `- Utility directories: ${mergedUtilityDirs.length > 0 ? mergedUtilityDirs.join(', ') : 'none found'} (${autoUtilCount} auto, ${aiUtilCount} AI)`,
      `- Common components: ${mergedComponents.length > 0 ? mergedComponents.join(', ') : 'none found'} (${autoCompCount} auto, ${aiCompCount} AI)`,
      '',
      'This information will be used for duplicate detection in careful-editor mode.',
      'The system will alert you when significant changes occur since this onboarding.'
    ];

    return lines.join('\n');
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
