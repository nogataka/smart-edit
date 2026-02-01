import fs from 'node:fs';

import {
  PROMPT_TEMPLATES_DIR_IN_USER_HOME,
  PROMPT_TEMPLATES_DIR_INTERNAL
} from './constants.js';
import {
  PromptFactory,
  type CreateOnboardingPromptParams,
  type CreateSystemPromptParams
} from './generated/generated_prompt_factory.js';
import type { PromptFactoryBaseOptions } from '../interprompt/prompt_factory.js';

export interface SmartEditPromptFactoryOptions extends Partial<PromptFactoryBaseOptions> {
  userPromptDir?: string;
  internalPromptDir?: string;
}

export type CreateSystemPromptOptions = CreateSystemPromptParams;
export type CreateOnboardingPromptOptions = CreateOnboardingPromptParams;

export class SmartEditPromptFactory extends PromptFactory {
  private readonly searchDirectories: string[];

  constructor(options: SmartEditPromptFactoryOptions = {}) {
    const userPromptDir = options.userPromptDir ?? PROMPT_TEMPLATES_DIR_IN_USER_HOME;
    const internalPromptDir = options.internalPromptDir ?? PROMPT_TEMPLATES_DIR_INTERNAL;
    fs.mkdirSync(userPromptDir, { recursive: true });
    const promptsDir = [userPromptDir, internalPromptDir];
    super({
      promptsDir,
      langCode: options.langCode,
      fallbackMode: options.fallbackMode
    });
    this.searchDirectories = [...promptsDir];
  }

  getPromptDirectories(): string[] {
    return [...this.searchDirectories];
  }

  override createSystemPrompt(options: CreateSystemPromptOptions): string {
    return super.createSystemPrompt(options);
  }

  listPromptTemplateNames(): string[] {
    return this.promptCollection.getPromptTemplateNames();
  }

  getPromptTemplateParameters(name: string): string[] {
    return this.promptCollection.getPromptTemplateParameters(name);
  }

  renderPrompt(name: string, params: Record<string, unknown>): string {
    return this.renderPromptTemplate(name, params);
  }

  hasPromptTemplate(name: string, langCode = this.langCode): boolean {
    return this.promptCollection.hasPromptTemplate(name, langCode);
  }

  listPromptListNames(): string[] {
    return this.promptCollection.getPromptListNames();
  }

  getPromptListByName(name: string): string[] {
    return this.getPromptList(name).items;
  }
}
