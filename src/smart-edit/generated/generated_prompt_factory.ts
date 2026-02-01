// NOTE: This module is auto-generated via interprompt.autogeneratePromptFactoryModule. Do not edit manually.

import {
  PromptFactoryBase,
  type PromptFactoryBaseOptions,
} from '../../interprompt/prompt_factory.js';

export interface CreateOnboardingPromptParams {
  system: string;
}

export interface CreateSystemPromptParams {
  availableMarkers: Iterable<string>;
  availableTools: Iterable<string>;
  contextSystemPrompt: string;
  modeSystemPrompts: Iterable<string>;
}

export class PromptFactory extends PromptFactoryBase {
  declare create_onboarding_prompt: (params: CreateOnboardingPromptParams) => string;
  declare create_prepare_for_new_conversation: () => string;
  declare create_summarize_changes: () => string;
  declare create_system_prompt: (params: CreateSystemPromptParams) => string;
  declare create_think_about_collected_information: () => string;
  declare create_think_about_task_adherence: () => string;
  declare create_think_about_whether_you_are_done: () => string;

  constructor(options: PromptFactoryBaseOptions) {
    super(options);
    this.create_onboarding_prompt = (params) => this.createOnboardingPrompt(params);
    this.create_prepare_for_new_conversation = () => this.createPrepareForNewConversation();
    this.create_summarize_changes = () => this.createSummarizeChanges();
    this.create_system_prompt = (params) => this.createSystemPrompt(params);
    this.create_think_about_collected_information = () => this.createThinkAboutCollectedInformation();
    this.create_think_about_task_adherence = () => this.createThinkAboutTaskAdherence();
    this.create_think_about_whether_you_are_done = () => this.createThinkAboutWhetherYouAreDone();
  }

  createOnboardingPrompt(params: CreateOnboardingPromptParams): string {
    return this.renderPromptTemplate(
      'onboarding_prompt',
      {
        system: params.system
      }
    );
  }

  createPrepareForNewConversation(): string {
    return this.renderPromptTemplate('prepare_for_new_conversation', {});
  }

  createSummarizeChanges(): string {
    return this.renderPromptTemplate('summarize_changes', {});
  }

  createSystemPrompt(params: CreateSystemPromptParams): string {
    return this.renderPromptTemplate(
      'system_prompt',
      {
        available_markers: Array.from(params.availableMarkers ?? []),
        available_tools: Array.from(params.availableTools ?? []),
        context_system_prompt: params.contextSystemPrompt,
        mode_system_prompts: Array.from(params.modeSystemPrompts ?? [])
      }
    );
  }

  createThinkAboutCollectedInformation(): string {
    return this.renderPromptTemplate('think_about_collected_information', {});
  }

  createThinkAboutTaskAdherence(): string {
    return this.renderPromptTemplate('think_about_task_adherence', {});
  }

  createThinkAboutWhetherYouAreDone(): string {
    return this.renderPromptTemplate('think_about_whether_you_are_done', {});
  }

}
