import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  SMART_EDITS_OWN_CONTEXT_YAMLS_DIR,
  SMART_EDITS_OWN_MODE_YAMLS_DIR
} from '../../../src/smart-edit/constants.js';
import { SmartEditAgentContext, SmartEditAgentMode } from '../../../src/smart-edit/config/context_mode.js';

function createTempYaml(prefix: string, content: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const filePath = path.join(directory, 'fixture.yml');
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

describe('SmartEditAgentMode', () => {
  let cleanupPaths: string[] = [];

  beforeEach(() => {
    cleanupPaths = [];
  });

  afterEach(() => {
    for (const item of cleanupPaths) {
      fs.rmSync(item, { recursive: true, force: true });
    }
    cleanupPaths = [];
  });

  test('fromYaml 読み込みでモード情報を取り込む', () => {
    const yamlPath = createTempYaml('smart-edit-mode-', `
name: review
prompt: "Please review the code"
description: "コードレビュー専用モード"
excluded_tools:
  - apply_patch
    `.trim());
    cleanupPaths.push(path.dirname(yamlPath));

    const mode = SmartEditAgentMode.fromYaml(yamlPath);
    expect(mode.name).toBe('review');
    expect(mode.prompt).toBe('Please review the code');
    expect(mode.description).toBe('コードレビュー専用モード');
    expect(mode.excludedTools).toEqual(['apply_patch']);
  });

  test('listRegisteredModeNames で公式モードを列挙する', () => {
    fs.mkdirSync(SMART_EDITS_OWN_MODE_YAMLS_DIR, { recursive: true });
    const samplePath = path.join(SMART_EDITS_OWN_MODE_YAMLS_DIR, 'sample-mode.yml');
    fs.writeFileSync(samplePath, 'prompt: ""', 'utf-8');
    cleanupPaths.push(samplePath);

    const modes = SmartEditAgentMode.listRegisteredModeNames(false);
    expect(modes).toContain('sample-mode');
  });
});

describe('SmartEditAgentContext', () => {
  let cleanupPaths: string[] = [];

  beforeEach(() => {
    cleanupPaths = [];
  });

  afterEach(() => {
    for (const item of cleanupPaths) {
      fs.rmSync(item, { recursive: true, force: true });
    }
    cleanupPaths = [];
  });

  test('fromYaml 読み込みでコンテキスト情報を取り込む', () => {
    const yamlPath = createTempYaml('smart-edit-context-', `
name: desktop-app
prompt: "You are working inside an IDE."
description: "IDE コンタクト"
tool_description_overrides:
  tool_a: "override"
  tool_b: 123
    `.trim());
    cleanupPaths.push(path.dirname(yamlPath));

    const context = SmartEditAgentContext.fromYaml(yamlPath);
    expect(context.name).toBe('desktop-app');
    expect(context.prompt).toBe('You are working inside an IDE.');
    expect(context.description).toBe('IDE コンタクト');
    expect(context.toolDescriptionOverrides).toEqual({ tool_a: 'override', tool_b: '123' });
  });

  test('listRegisteredContextNames で公式コンテキストを列挙する', () => {
    fs.mkdirSync(SMART_EDITS_OWN_CONTEXT_YAMLS_DIR, { recursive: true });
    const samplePath = path.join(SMART_EDITS_OWN_CONTEXT_YAMLS_DIR, 'sample-context.yml');
    fs.writeFileSync(samplePath, 'prompt: ""', 'utf-8');
    cleanupPaths.push(samplePath);

    const contexts = SmartEditAgentContext.listRegisteredContextNames(false);
    expect(contexts).toContain('sample-context');
  });

  test('fromYaml は不正な excluded_tools に対してエラーを投げる', () => {
    const yamlPath = createTempYaml('smart-edit-mode-invalid-', `
name: faulty
prompt: "invalid"
excluded_tools:
  key: value
    `.trim());
    cleanupPaths.push(path.dirname(yamlPath));

    expect(() => SmartEditAgentMode.fromYaml(yamlPath)).toThrow(/Invalid YAML structure detected/);
  });
});
