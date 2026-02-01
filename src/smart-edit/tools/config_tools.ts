import { z } from 'zod';

import { SmartEditAgentMode } from '../config/context_mode.js';
import type { MemoriesManagerLike, ProjectConfigLike, ProjectLike } from './tools_base.js';
import {
  Tool,
  ToolMarkerDoesNotRequireActiveProject,
  ToolMarkerOptional
} from './tools_base.js';

interface ActivateProjectInput {
  project: string;
}

interface RemoveProjectInput {
  project_name: string;
}

interface SwitchModesInput {
  modes: string[];
}

function stringifyUnknown(value: unknown, fallback = 'unknown'): string {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint' || typeof value === 'symbol') {
    return String(value);
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
  return fallback;
}

function isIterable(value: unknown): value is Iterable<unknown> {
  return typeof value === 'object' && value !== null && Symbol.iterator in value;
}

function resolveLanguageName(language: ProjectConfigLike['language']): string {
  if (typeof language === 'string') {
    return language;
  }
  if (language && typeof language === 'object' && 'value' in language) {
    const value = (language as { value: unknown }).value;
    if (typeof value === 'string') {
      return value;
    }
    if (value !== undefined && value !== null) {
      return stringifyUnknown(value);
    }
  }
  return stringifyUnknown(language);
}

function resolveProjectName(project: ProjectLike): string {
  const fromConfig = project.projectConfig.projectName ?? (project.projectConfig as { project_name?: unknown }).project_name;
  if (fromConfig && typeof fromConfig === 'string') {
    return fromConfig;
  }
  const directName = (project as { projectName?: unknown }).projectName;
  if (typeof directName === 'string' && directName.length > 0) {
    return directName;
  }
  const snakeCaseName = (project as { project_name?: unknown }).project_name;
  if (typeof snakeCaseName === 'string' && snakeCaseName.length > 0) {
    return snakeCaseName;
  }
  return 'unknown';
}

function resolveInitialPrompt(projectConfig: ProjectConfigLike): string {
  const prompt = projectConfig.initialPrompt ?? (projectConfig as { initial_prompt?: unknown }).initial_prompt;
  if (typeof prompt === 'string' && prompt.trim().length > 0) {
    return prompt;
  }
  return '';
}

function resolveProjectYamlPath(project: ProjectLike): string | undefined {
  const camelCase = project.pathToProjectYml;
  if (typeof camelCase === 'function') {
    return camelCase.call(project);
  }
  const snakeCase = (project as { path_to_project_yml?: () => string }).path_to_project_yml;
  if (typeof snakeCase === 'function') {
    return snakeCase.call(project);
  }
  return undefined;
}

async function listAvailableMemories(manager: MemoriesManagerLike): Promise<string[]> {
  const raw = await Promise.resolve(manager.listMemories());
  if (!raw) {
    return [];
  }
  if (Array.isArray(raw)) {
    return raw.map((entry) => stringifyUnknown(entry));
  }
  if (isIterable(raw)) {
    const result: string[] = [];
    for (const item of raw) {
      result.push(stringifyUnknown(item));
    }
    return result;
  }
  return [stringifyUnknown(raw)];
}

export class ActivateProjectTool extends Tool {
  static override readonly markers = new Set([ToolMarkerDoesNotRequireActiveProject]);
  static override readonly description = 'Activates a project by name or path.';
  static override readonly inputSchema = z.object({
    project: z.string().min(1, 'project must not be empty')
  });

  override async apply(args: ActivateProjectInput): Promise<string> {
    const activeProject = await Promise.resolve(this.agent.activateProjectFromPathOrName(args.project));

    const isNewlyCreated = Boolean(
      (activeProject as { isNewlyCreated?: unknown }).isNewlyCreated ??
        (activeProject as { is_newly_created?: unknown }).is_newly_created ??
        false
    );
    const projectName = resolveProjectName(activeProject);
    const language = resolveLanguageName(activeProject.projectConfig.language);
    const projectYamlPath = resolveProjectYamlPath(activeProject);

    let result = '';
    if (isNewlyCreated) {
      result =
        `Created and activated a new project with name '${projectName}' at ${activeProject.projectRoot}, language: ${language}. ` +
        "You can activate this project later by name.\n";
      if (projectYamlPath) {
        result += `The project's Smart-Edit configuration is in ${projectYamlPath}. In particular, you may want to edit the project name and the initial prompt.`;
      }
    } else {
      result = `Activated existing project with name '${projectName}' at ${activeProject.projectRoot}, language: ${language}`;
    }

    const initialPrompt = resolveInitialPrompt(activeProject.projectConfig);
    if (initialPrompt.length > 0) {
      result += `\nAdditional project information:\n ${initialPrompt}`;
    }

    const memoriesManager = this.memoriesManager;
    const memories = await listAvailableMemories(memoriesManager);
    result +=
      `\nAvailable memories:\n ${JSON.stringify(memories)}` +
      'You should not read these memories directly, but rather use the `read_memory` tool to read them later if needed for the task.';

    const activeTools = this.agent.getActiveToolNames();
    result += `\nAvailable tools:\n ${JSON.stringify(activeTools)}`;

    return result;
  }
}

export class RemoveProjectTool extends Tool {
  static override readonly markers = new Set([ToolMarkerDoesNotRequireActiveProject, ToolMarkerOptional]);
  static override readonly description = 'Removes a project from the Smart-Edit configuration.';
  static override readonly inputSchema = z.object({
    project_name: z.string().min(1, 'project_name must not be empty')
  });

  override async apply(args: RemoveProjectInput): Promise<string> {
    const config = this.agent.smartEditConfig;
    if (typeof config.removeProject !== 'function') {
      throw new Error('Removing projects is not supported by the active Smart-Edit configuration.');
    }
    await Promise.resolve(config.removeProject.call(config, args.project_name));
    return `Successfully removed project '${args.project_name}' from configuration.`;
  }
}

export class SwitchModesTool extends Tool {
  static override readonly markers = new Set([ToolMarkerOptional]);
  static override readonly description = 'Activates the desired agent modes by name.';
  static override readonly inputSchema = z.object({
    modes: z.array(z.string().min(1, 'mode name must not be empty')).min(1, 'at least one mode must be provided')
  });

  override async apply(args: SwitchModesInput): Promise<string> {
    const modeInstances = args.modes.map((modeName) => SmartEditAgentMode.load(modeName));
    await Promise.resolve(this.agent.setModes(modeInstances));

    let result = `Successfully activated modes: ${modeInstances.map((mode) => mode.name).join(', ')}` + '\n';
    result += modeInstances.map((mode) => mode.prompt).join('\n') + '\n';
    result += `Currently active tools: ${this.agent.getActiveToolNames().join(', ')}`;
    return result;
  }
}

export class GetCurrentConfigTool extends Tool {
  static override readonly description =
    'Displays the current configuration of the agent, including projects, tools, contexts, and modes.';

  override async apply(_args: Record<string, unknown> = {}): Promise<string> {
    return Promise.resolve(this.agent.getCurrentConfigOverview());
  }
}

export const CONFIG_TOOL_CLASSES = [
  ActivateProjectTool,
  RemoveProjectTool,
  SwitchModesTool,
  GetCurrentConfigTool
];
