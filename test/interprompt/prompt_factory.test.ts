import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { autogeneratePromptFactoryModule } from '../../src/interprompt/prompt_factory.js';

describe('autogeneratePromptFactoryModule', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-edit-interprompt-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('generates a prompt factory module with camelCase methods and snake_case aliases', () => {
    const promptsDir = path.join(tempDir, 'prompts');
    fs.mkdirSync(promptsDir, { recursive: true });

    const promptYaml = `prompts:\n  hello_prompt: |\n    Hello {{ name }}!\n  salutations: \n    - Hi there\n    - Welcome\n`;
    fs.writeFileSync(path.join(promptsDir, 'default.yml'), promptYaml, 'utf-8');

    const generatedPath = path.join(tempDir, 'generated', 'prompt_factory.ts');
    autogeneratePromptFactoryModule(promptsDir, generatedPath);

    const generated = fs.readFileSync(generatedPath, 'utf-8');

    expect(generated).toContain('export class PromptFactory extends PromptFactoryBase');
    expect(generated).toContain('createHelloPrompt');
    expect(generated).toContain('create_hello_prompt');
    expect(generated).toContain('getListSalutations');
    expect(generated).toContain('get_list_salutations');
    expect(generated).toContain('return this.renderPromptTemplate');
  });

  it('creates the target directory if it does not exist', () => {
    const promptsDir = path.join(tempDir, 'templates');
    fs.mkdirSync(promptsDir, { recursive: true });
    const promptYaml = 'prompts:\n  simple_prompt: |\n    Hi';
    fs.writeFileSync(path.join(promptsDir, 'default.yml'), promptYaml, 'utf-8');

    const generatedDir = path.join(tempDir, 'output', 'nested');
    const generatedPath = path.join(generatedDir, 'factory.ts');

    autogeneratePromptFactoryModule(promptsDir, generatedPath);

    expect(fs.existsSync(generatedDir)).toBe(true);
    expect(fs.existsSync(generatedPath)).toBe(true);
  });
});
