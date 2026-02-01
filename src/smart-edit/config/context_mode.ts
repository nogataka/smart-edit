import fs from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import {
  DEFAULT_CONTEXT,
  DEFAULT_MODES,
  INTERNAL_MODE_YAMLS_DIR,
  SMART_EDITS_OWN_CONTEXT_YAMLS_DIR,
  SMART_EDITS_OWN_MODE_YAMLS_DIR,
  USER_CONTEXT_YAMLS_DIR,
  USER_MODE_YAMLS_DIR
} from '../constants.js';
import { loadYaml } from '../util/general.js';
import type { ToolInclusionDefinitionInit } from './smart_edit_config.js';
import { ToolInclusionDefinition } from './smart_edit_config.js';

const STRING_ARRAY_SCHEMA = z
  .union([z.array(z.union([z.string(), z.number(), z.boolean()])), z.string(), z.number(), z.boolean(), z.null()])
  .optional()
  .transform((value): string[] => {
    if (value === undefined || value === null) {
      return [];
    }
    if (Array.isArray(value)) {
      return value
        .map((item) => {
          if (typeof item === 'string') {
            return item;
          }
          if (typeof item === 'number' || typeof item === 'boolean') {
            return String(item);
          }
          return null;
        })
        .filter((item): item is string => item !== null);
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return [String(value)];
    }
    return [];
  });

const OPTIONAL_NAME_SCHEMA = z
  .union([z.string(), z.number()])
  .optional()
  .transform((value) => {
    if (value === undefined) {
      return undefined;
    }
    const normalized = String(value).trim();
    return normalized.length > 0 ? normalized : undefined;
  });

const OPTIONAL_TEXT_SCHEMA = z
  .union([z.string(), z.number()])
  .optional()
  .transform((value) => {
    if (value === undefined) {
      return '';
    }
    return String(value);
  });

const TOOL_DESCRIPTION_OVERRIDES_SCHEMA = z
  .record(z.union([z.string(), z.number()]))
  .optional()
  .transform((value): Record<string, string> => {
    if (!value) {
      return {};
    }
    return Object.fromEntries(Object.entries(value).map(([key, raw]) => [key, String(raw)]));
  });

const MODE_YAML_SCHEMA = z
  .object({
    name: OPTIONAL_NAME_SCHEMA,
    prompt: OPTIONAL_TEXT_SCHEMA,
    description: OPTIONAL_TEXT_SCHEMA,
    excluded_tools: STRING_ARRAY_SCHEMA,
    included_optional_tools: STRING_ARRAY_SCHEMA
  })
  .passthrough();

const CONTEXT_YAML_SCHEMA = MODE_YAML_SCHEMA.extend({
  tool_description_overrides: TOOL_DESCRIPTION_OVERRIDES_SCHEMA
});

export class SmartEditAgentMode extends ToolInclusionDefinition {
  readonly name: string;
  readonly prompt: string;
  readonly description: string;

  constructor(init: ToolInclusionDefinitionInit & { name: string; prompt: string; description?: string }) {
    super(init);
    this.name = init.name;
    this.prompt = init.prompt;
    this.description = init.description ?? '';
  }

  static fromYaml(yamlPath: string): SmartEditAgentMode {
    const data = loadYaml(yamlPath);
    if (!data || typeof data !== 'object') {
      throw new Error(`Invalid mode YAML: ${yamlPath}`);
    }

    const plain = data as Record<string, unknown>;
    const parsedResult = MODE_YAML_SCHEMA.safeParse(plain);
    if (!parsedResult.success) {
      throw new Error(formatYamlZodIssues(yamlPath, parsedResult.error));
    }
    const parsed = parsedResult.data;
    const name = parsed.name ?? path.parse(yamlPath).name;

    return new SmartEditAgentMode({
      name,
      prompt: parsed.prompt,
      description: parsed.description,
      excludedTools: parsed.excluded_tools,
      includedOptionalTools: parsed.included_optional_tools
    });
  }

  static getPath(name: string): string {
    const filename = `${name}.yml`;
    const custom = path.join(USER_MODE_YAMLS_DIR, filename);
    if (fs.existsSync(custom)) {
      return custom;
    }

    const own = path.join(SMART_EDITS_OWN_MODE_YAMLS_DIR, filename);
    if (!fs.existsSync(own)) {
      throw new Error(
        `Mode ${name} not found in ${USER_MODE_YAMLS_DIR} or in ${SMART_EDITS_OWN_MODE_YAMLS_DIR}. Available modes:\n${this.listRegisteredModeNames().join(', ')}`
      );
    }
    return own;
  }

  static fromName(name: string): SmartEditAgentMode {
    const modePath = this.getPath(name);
    return this.fromYaml(modePath);
  }

  static fromNameInternal(name: string): SmartEditAgentMode {
    const internalPath = path.join(INTERNAL_MODE_YAMLS_DIR, `${name}.yml`);
    if (!fs.existsSync(internalPath)) {
      throw new Error(`Internal mode '${name}' not found in ${INTERNAL_MODE_YAMLS_DIR}`);
    }
    return this.fromYaml(internalPath);
  }

  static listRegisteredModeNames(includeUserModes = true): string[] {
    const own = listYamlFiles(SMART_EDITS_OWN_MODE_YAMLS_DIR).filter((file) => file !== 'mode.template');
    const user = includeUserModes ? listYamlFiles(USER_MODE_YAMLS_DIR) : [];
    return Array.from(new Set([...own, ...user])).sort();
  }

  static listCustomModeNames(): string[] {
    return listYamlFiles(USER_MODE_YAMLS_DIR);
  }

  static loadDefaultModes(): SmartEditAgentMode[] {
    return DEFAULT_MODES.map((mode) => this.fromName(mode));
  }

  static load(nameOrPath: string): SmartEditAgentMode {
    if (nameOrPath.endsWith('.yml')) {
      return this.fromYaml(nameOrPath);
    }
    return this.fromName(nameOrPath);
  }

  printOverview(): void {
    console.log(`${this.name}:\n ${this.description}`);
    if (this.excludedTools.length > 0) {
      console.log(` excluded tools:\n  ${this.excludedTools.sort().join(', ')}`);
    }
  }
}

export class SmartEditAgentContext extends ToolInclusionDefinition {
  readonly name: string;
  readonly prompt: string;
  readonly description: string;
  readonly toolDescriptionOverrides: Record<string, string>;

  constructor(init: ToolInclusionDefinitionInit & {
    name: string;
    prompt: string;
    description?: string;
    toolDescriptionOverrides?: Record<string, string>;
  }) {
    super(init);
    this.name = init.name;
    this.prompt = init.prompt;
    this.description = init.description ?? '';
    this.toolDescriptionOverrides = { ...(init.toolDescriptionOverrides ?? {}) };
  }

  static fromYaml(yamlPath: string): SmartEditAgentContext {
    const data = loadYaml(yamlPath);
    if (!data || typeof data !== 'object') {
      throw new Error(`Invalid context YAML: ${yamlPath}`);
    }

    const plain = data as Record<string, unknown>;
    const parsedResult = CONTEXT_YAML_SCHEMA.safeParse(plain);
    if (!parsedResult.success) {
      throw new Error(formatYamlZodIssues(yamlPath, parsedResult.error));
    }
    const parsed = parsedResult.data;
    const name = parsed.name ?? path.parse(yamlPath).name;

    return new SmartEditAgentContext({
      name,
      prompt: parsed.prompt,
      description: parsed.description,
      toolDescriptionOverrides: parsed.tool_description_overrides,
      excludedTools: parsed.excluded_tools,
      includedOptionalTools: parsed.included_optional_tools
    });
  }

  static getPath(name: string): string {
    const filename = `${name}.yml`;
    const custom = path.join(USER_CONTEXT_YAMLS_DIR, filename);
    if (fs.existsSync(custom)) {
      return custom;
    }

    const own = path.join(SMART_EDITS_OWN_CONTEXT_YAMLS_DIR, filename);
    if (!fs.existsSync(own)) {
      throw new Error(
        `Context ${name} not found in ${USER_CONTEXT_YAMLS_DIR} or in ${SMART_EDITS_OWN_CONTEXT_YAMLS_DIR}. Available contexts:\n${this.listRegisteredContextNames().join(', ')}`
      );
    }
    return own;
  }

  static fromName(name: string): SmartEditAgentContext {
    const contextPath = this.getPath(name);
    return this.fromYaml(contextPath);
  }

  static load(nameOrPath: string): SmartEditAgentContext {
    if (nameOrPath.endsWith('.yml')) {
      return this.fromYaml(nameOrPath);
    }
    return this.fromName(nameOrPath);
  }

  static listRegisteredContextNames(includeUserContexts = true): string[] {
    const own = listYamlFiles(SMART_EDITS_OWN_CONTEXT_YAMLS_DIR);
    const user = includeUserContexts ? listYamlFiles(USER_CONTEXT_YAMLS_DIR) : [];
    return Array.from(new Set([...own, ...user])).sort();
  }

  static listCustomContextNames(): string[] {
    return listYamlFiles(USER_CONTEXT_YAMLS_DIR);
  }

  static loadDefault(): SmartEditAgentContext {
    return this.fromName(DEFAULT_CONTEXT);
  }

  printOverview(): void {
    console.log(`${this.name}:\n ${this.description}`);
    if (this.excludedTools.length > 0) {
      console.log(` excluded tools:\n  ${this.excludedTools.sort().join(', ')}`);
    }
  }
}

function formatYamlZodIssues(filePath: string, error: z.ZodError): string {
  const details = error.issues
    .map((issue) => {
      const pathSegment = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `${pathSegment}: ${issue.message}`;
    })
    .join('; ');
  return `Invalid YAML structure detected in ${filePath}: ${details}`;
}

function listYamlFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs
    .readdirSync(directory)
    .filter((file) => file.endsWith('.yml'))
    .map((file) => path.parse(file).name);
}
