import fs from 'node:fs';
import path from 'node:path';

import yaml from 'yaml';

import { createSmartEditLogger } from '../smart-edit/util/logging.js';
import { JinjaTemplate, type ParameterizedTemplateInterface } from './jinja_template.js';

const { logger: log } = createSmartEditLogger({ name: 'interprompt.multilang_prompt' });

export const DEFAULT_LANG_CODE = 'default';

export enum LanguageFallbackMode {
  ANY = 'any',
  EXCEPTION = 'exception',
  USE_DEFAULT_LANG = 'use_default_lang'
}

export class PromptTemplate implements ParameterizedTemplateInterface {
  readonly name: string;
  private readonly template: JinjaTemplate;

  constructor(name: string, templateString: string) {
    this.name = name;
    this.template = new JinjaTemplate(templateString);
  }

  render(params: Record<string, unknown>): string {
    return this.template.render(params);
  }

  getParameters(): string[] {
    return this.template.getParameters();
  }
}

export class PromptList {
  readonly items: string[];

  constructor(items: string[]) {
    this.items = items.map((item) => item.trim());
  }

  toString(): string {
    const bullet = ' * ';
    const indent = ' '.repeat(bullet.length);
    return this.items
      .map((item) => item.replace(/\n/g, `\n${indent}`))
      .map((item, index) => (index === 0 ? `${bullet}${item}` : `${bullet}${item}`))
      .join('\n');
  }
}

class MultiLangContainer<T> {
  readonly name: string;
  private readonly lang2item = new Map<string, T>();

  constructor(name: string) {
    this.name = name;
  }

  get languageCodes(): string[] {
    return Array.from(this.lang2item.keys());
  }

  addItem(item: T, langCode: string, allowOverwrite: boolean): void {
    if (!allowOverwrite && this.lang2item.has(langCode)) {
      throw new Error(`Item for language '${langCode}' already registered for '${this.name}'`);
    }
    this.lang2item.set(langCode, item);
  }

  hasItem(langCode: string): boolean {
    return this.lang2item.has(langCode);
  }

  getItem(langCode: string, fallbackMode: LanguageFallbackMode): T {
    const existing = this.lang2item.get(langCode);
    if (existing) {
      return existing;
    }
    if (fallbackMode === LanguageFallbackMode.ANY) {
      const iterator = this.lang2item.values().next();
      if (iterator.done || iterator.value === undefined) {
        throw new Error(`No items registered for any language in container '${this.name}'`);
      }
      return iterator.value;
    }
    if (fallbackMode === LanguageFallbackMode.USE_DEFAULT_LANG) {
      const fallback = this.lang2item.get(DEFAULT_LANG_CODE);
      if (fallback) {
        return fallback;
      }
      throw new Error(
        `Item not found for language '${langCode}' nor for default language '${DEFAULT_LANG_CODE}' in container '${this.name}'`
      );
    }
    throw new Error(`Item for language '${langCode}' not found in container '${this.name}'`);
  }
}

export class MultiLangPromptTemplate implements ParameterizedTemplateInterface {
  private readonly container: MultiLangContainer<PromptTemplate>;

  constructor(name: string) {
    this.container = new MultiLangContainer(name);
  }

  get name(): string {
    return this.container.name;
  }

  get length(): number {
    return this.container.languageCodes.length;
  }

  addPromptTemplate(template: PromptTemplate, langCode: string, allowOverwrite: boolean): void {
    if (this.length > 0) {
      const currentParameters = this.getParameters();
      const newParameters = template.getParameters();
      if (JSON.stringify(currentParameters) !== JSON.stringify(newParameters)) {
        throw new Error(
          `Cannot add prompt template for language '${langCode}' to '${this.name}' because parameters differ`
        );
      }
    }
    this.container.addItem(template, langCode, allowOverwrite);
  }

  hasItem(langCode: string): boolean {
    return this.container.hasItem(langCode);
  }

  getPromptTemplate(langCode: string, fallbackMode: LanguageFallbackMode): PromptTemplate {
    return this.container.getItem(langCode, fallbackMode);
  }

  getParameters(): string[] {
    if (this.length === 0) {
      throw new Error(`No prompt templates registered for '${this.name}'`);
    }
    const [firstLanguage] = this.container.languageCodes;
    if (!firstLanguage) {
      throw new Error(`No languages registered for '${this.name}'`);
    }
    return this.container.getItem(firstLanguage, LanguageFallbackMode.EXCEPTION).getParameters();
  }
}

export class MultiLangPromptList {
  private readonly container: MultiLangContainer<PromptList>;

  constructor(name: string) {
    this.container = new MultiLangContainer(name);
  }

  addPromptList(list: PromptList, langCode: string, allowOverwrite: boolean): void {
    this.container.addItem(list, langCode, allowOverwrite);
  }

  hasItem(langCode: string): boolean {
    return this.container.hasItem(langCode);
  }

  getPromptList(langCode: string, fallbackMode: LanguageFallbackMode): PromptList {
    return this.container.getItem(langCode, fallbackMode);
  }
}

interface LoadOptions {
  onNameCollision: 'skip' | 'overwrite' | 'raise';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveLangCode(...candidates: unknown[]): string {
  for (const candidate of candidates) {
    if (isPlainObject(candidate)) {
      const lang = candidate.lang;
      if (typeof lang === 'string' && lang.length > 0) {
        return lang;
      }
    }
  }
  return DEFAULT_LANG_CODE;
}

function preparePromptEntries(data: unknown): [string, unknown][] {
  if (!isPlainObject(data)) {
    return [];
  }
  const record: Record<string, unknown> = data;
  const result: [string, unknown][] = [];
  for (const key of Object.keys(record)) {
    if (key === 'lang') {
      continue;
    }
    result.push([key, record[key]]);
  }
  return result;
}

function isStringArray(values: unknown[]): values is string[] {
  return values.every((value) => typeof value === 'string');
}

export class MultiLangPromptCollection {
  private readonly promptTemplates = new Map<string, MultiLangPromptTemplate>();
  private readonly promptLists = new Map<string, MultiLangPromptList>();
  private _fallbackMode: LanguageFallbackMode;

  constructor(promptsDir: string | string[], fallbackMode: LanguageFallbackMode = LanguageFallbackMode.EXCEPTION) {
    const directories = Array.isArray(promptsDir) ? promptsDir : [promptsDir];
    if (directories.length === 0) {
      throw new Error('At least one prompts directory must be provided');
    }
    const [primary, ...fallbacks] = directories;
    this.loadFromDisk(primary, { onNameCollision: 'raise' });
    for (const fallback of fallbacks) {
      this.loadFromDisk(fallback, { onNameCollision: 'skip' });
    }
    this._fallbackMode = fallbackMode;
  }

  get fallbackMode(): LanguageFallbackMode {
    return this._fallbackMode;
  }

  set fallbackMode(mode: LanguageFallbackMode) {
    this._fallbackMode = mode;
  }

  private loadFromDisk(directory: string, options: LoadOptions): void {
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      if (!entry.name.endsWith('.yml') && !entry.name.endsWith('.yaml')) {
        log.debug(`Skipping non-YAML file: ${entry.name}`);
        continue;
      }
      const absolutePath = path.join(directory, entry.name);
      const fileContents = fs.readFileSync(absolutePath, 'utf-8');
      let parsed: unknown;
      try {
        parsed = yaml.parse(fileContents);
      } catch (error) {
        throw new Error(`Failed to parse prompt yaml file ${absolutePath}: ${(error as Error).message}`);
      }
      if (typeof parsed !== 'object' || parsed === null || !('prompts' in parsed)) {
        throw new Error(`Invalid YAML structure in ${absolutePath}; missing 'prompts' key`);
      }
      const promptsSection = (parsed as Record<string, unknown>).prompts;
      const langCode = resolveLangCode(parsed, promptsSection);
      const promptEntries = preparePromptEntries(promptsSection);
      for (const [promptName, promptValue] of promptEntries) {
        if (Array.isArray(promptValue)) {
          if (isStringArray(promptValue)) {
            this.addPromptList(promptName, [...promptValue], langCode, options.onNameCollision);
            continue;
          }
          throw new Error(`Prompt list '${promptName}' in ${absolutePath} must contain only strings`);
        } else if (typeof promptValue === 'string') {
          this.addPromptTemplate(promptName, promptValue, langCode, options.onNameCollision);
        } else {
          throw new Error(
            `Invalid prompt entry '${promptName}' in ${absolutePath}; expected string or list, received ${typeof promptValue}`
          );
        }
      }
    }
  }

  private addPromptTemplate(
    name: string,
    templateString: string,
    langCode: string,
    onNameCollision: LoadOptions['onNameCollision']
  ): void {
    const promptTemplate = new PromptTemplate(name, templateString);
    let container = this.promptTemplates.get(name);
    if (!container) {
      container = new MultiLangPromptTemplate(name);
      this.promptTemplates.set(name, container);
    }
    const allowOverwrite = onNameCollision === 'overwrite';
    if (container.hasItem(langCode)) {
      if (onNameCollision === 'skip') {
        log.debug(`Skipping prompt '${name}' for language '${langCode}' because it already exists`);
        return;
      }
      if (onNameCollision === 'raise') {
        throw new Error(`Prompt '${name}' for language '${langCode}' already exists`);
      }
    }
    container.addPromptTemplate(promptTemplate, langCode, allowOverwrite);
  }

  private addPromptList(
    name: string,
    promptValues: string[],
    langCode: string,
    onNameCollision: LoadOptions['onNameCollision']
  ): void {
    const promptList = new PromptList(promptValues);
    let container = this.promptLists.get(name);
    if (!container) {
      container = new MultiLangPromptList(name);
      this.promptLists.set(name, container);
    }
    const allowOverwrite = onNameCollision === 'overwrite';
    if (container.hasItem(langCode)) {
      if (onNameCollision === 'skip') {
        log.debug(`Skipping prompt list '${name}' for language '${langCode}' because it already exists`);
        return;
      }
      if (onNameCollision === 'raise') {
        throw new Error(`Prompt list '${name}' for language '${langCode}' already exists`);
      }
    }
    container.addPromptList(promptList, langCode, allowOverwrite);
  }

  getPromptTemplateNames(): string[] {
    return Array.from(this.promptTemplates.keys());
  }

  getPromptListNames(): string[] {
    return Array.from(this.promptLists.keys());
  }

  getPromptTemplate(name: string, langCode: string): PromptTemplate {
    const container = this.promptTemplates.get(name);
    if (!container) {
      throw new Error(`Prompt template '${name}' not found`);
    }
    return container.getPromptTemplate(langCode, this._fallbackMode);
  }

  getPromptTemplateParameters(name: string): string[] {
    const container = this.promptTemplates.get(name);
    if (!container) {
      throw new Error(`Prompt template '${name}' not found`);
    }
    return container.getParameters();
  }

  getPromptList(name: string, langCode: string): PromptList {
    const container = this.promptLists.get(name);
    if (!container) {
      throw new Error(`Prompt list '${name}' not found`);
    }
    return container.getPromptList(langCode, this._fallbackMode);
  }

  hasPromptTemplate(name: string, langCode: string): boolean {
    return this.promptTemplates.get(name)?.hasItem(langCode) ?? false;
  }

  renderPromptTemplate(name: string, params: Record<string, unknown>, langCode: string): string {
    const template = this.getPromptTemplate(name, langCode);
    return template.render(params);
  }
}
