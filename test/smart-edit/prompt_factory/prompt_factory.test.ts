import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SmartEditPromptFactory } from '../../../src/smart-edit/prompt_factory.js';

describe('SmartEditPromptFactory', () => {
  let originalHome: string | undefined;
  let tempHome: string;

  async function importFactory() {
    return import('../../../src/smart-edit/prompt_factory.js');
  }

  async function createFactory(): Promise<SmartEditPromptFactory> {
    const module = await importFactory();
    return new module.SmartEditPromptFactory();
  }

  beforeEach(() => {
    originalHome = process.env.HOME;
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-edit-home-'));
    process.env.HOME = tempHome;
    vi.resetModules();
  });

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    vi.resetModules();
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('renders system prompt using template files', async () => {
    const factory = await createFactory();
    const prompt = factory.createSystemPrompt({
      contextSystemPrompt: 'Smart-Edit is helping with a repository',
      modeSystemPrompts: ['Mode Alpha', 'Mode Beta'],
      availableTools: ['find_symbol', 'search_for_pattern'],
      availableMarkers: new Set(['ToolMarkerSymbolicRead'])
    });

    expect(prompt).toContain('You are a professional coding agent concerned with one particular codebase.');
    expect(prompt).toContain('Context description:');
    expect(prompt).toContain('Smart-Edit is helping with a repository');
    expect(prompt).toContain('I WILL BE SERIOUSLY UPSET IF YOU READ ENTIRE FILES WITHOUT NEED!');
    expect(prompt).toContain('search_for_pattern');
  });

  it('exposes snake_case aliases for compatibility with Python tooling', async () => {
    const factory = await createFactory();
    const result = factory.create_onboarding_prompt({ system: 'Darwin' });
    expect(String(result)).toContain('The project is being developed on the system: Darwin');
  });

  it('ensures user prompt directory is created automatically', async () => {
    const factory = await createFactory();
    const directories = factory.getPromptDirectories();
    expect(directories.length).toBeGreaterThanOrEqual(2);
    const [userDirectory] = directories;
    expect(typeof userDirectory).toBe('string');
    if (userDirectory) {
      expect(fs.existsSync(userDirectory)).toBe(true);
      expect(path.isAbsolute(userDirectory)).toBe(true);
    }
  });
});
