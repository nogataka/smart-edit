import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { generatePromptFactory } from '../../src/devtools/generate_prompt_factory.js';

function writePromptFile(directory: string, fileName: string, contents: string): void {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, fileName), contents, 'utf-8');
}

describe('generatePromptFactory', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-edit-gen-prompts-'));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('creates the generated prompt factory module at the specified path', () => {
    const promptsDir = path.join(tempRoot, 'prompts');
    const outputDir = path.join(tempRoot, 'output');
    const targetPath = path.join(outputDir, 'prompt_factory.ts');

    writePromptFile(promptsDir, 'default.yml', [
      'prompts:',
      '  hello_prompt: |',
      '    Hello {{ name }}!',
      '  farewell_messages:',
      '    - Good bye',
      '    - See you'
    ].join('\n'));

    const resultPath = generatePromptFactory({
      promptsDir,
      targetPath
    });

    expect(resultPath).toBe(path.resolve(targetPath));
    expect(fs.existsSync(targetPath)).toBe(true);

    const generated = fs.readFileSync(targetPath, 'utf-8');
    expect(generated).toContain('export class PromptFactory extends PromptFactoryBase');
    expect(generated).toContain('createHelloPrompt');
    expect(generated).toContain('getListFarewellMessages');
    expect(generated).toContain('Do not edit manually');
  });

  it('supports generating from multiple prompt directories', () => {
    const promptsDirA = path.join(tempRoot, 'prompts-a');
    const promptsDirB = path.join(tempRoot, 'prompts-b');
    const targetPath = path.join(tempRoot, 'factory.ts');

    writePromptFile(promptsDirA, 'default.yml', ['prompts:', '  alpha_prompt: |', '    Alpha'].join('\n'));

    writePromptFile(
      promptsDirB,
      'default.yml',
      ['prompts:', '  beta_prompt: |', '    Beta'].join('\n')
    );

    generatePromptFactory({
      promptsDir: [promptsDirA, promptsDirB],
      targetPath
    });

    const generated = fs.readFileSync(targetPath, 'utf-8');
    expect(generated).toContain('createAlphaPrompt');
    expect(generated).toContain('createBetaPrompt');
  });
});
