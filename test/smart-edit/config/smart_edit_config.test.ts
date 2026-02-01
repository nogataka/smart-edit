import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';

import {
  ProjectConfig,
  RegisteredProject,
  RegisteredTokenCountEstimator,
  SmartEditConfig,
  SmartEditConfigError
} from '../../../src/smart-edit/config/smart_edit_config.js';
import type { SmartEditConfigInit } from '../../../src/smart-edit/config/smart_edit_config.js';
import { Language } from '../../../src/smart-lsp/ls_config.js';
import {
  clearLanguageRegistry,
  registerLanguageDefinition
} from '../../../src/smart-edit/util/inspection.js';
import { loadYaml } from '../../../src/smart-edit/util/general.js';

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('ProjectConfig', () => {
  let tempDir: string;

  beforeAll(() => {
    registerLanguageDefinition({
      name: Language.PYTHON,
      matcher: {
        isRelevantFilename(filename: string): boolean {
          return filename.endsWith('.py');
        }
      }
    });
  });

  afterAll(() => {
    clearLanguageRegistry();
  });

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('autogenerate は優勢な言語を推定し設定を返す', () => {
    tempDir = createTempDir('smart-edit-project-');
    const sourcePath = path.join(tempDir, 'src');
    fs.mkdirSync(sourcePath, { recursive: true });
    fs.writeFileSync(path.join(sourcePath, 'main.py'), 'print("hello")', 'utf-8');

    const config = ProjectConfig.autogenerate(tempDir, { saveToDisk: false });
    expect(config.projectName).toBe(path.basename(tempDir));
    expect(config.language).toBe(Language.PYTHON);
    expect(config.encoding).toBe('utf-8');
  });

  test('load は autogenerate が生成したファイルを読み取る', () => {
    tempDir = createTempDir('smart-edit-project-');
    const sourcePath = path.join(tempDir, 'src');
    fs.mkdirSync(sourcePath, { recursive: true });
    fs.writeFileSync(path.join(sourcePath, 'main.py'), 'print("hello")', 'utf-8');

    const generated = ProjectConfig.autogenerate(tempDir, { saveToDisk: true });
    const loaded = ProjectConfig.load(tempDir);

    expect(loaded.projectName).toBe(generated.projectName);
    expect(loaded.language).toBe(generated.language);
  });

  test('load は無効な project.yml を検出して例外を投げる', () => {
    tempDir = createTempDir('smart-edit-project-invalid-');
    const managedDir = path.join(tempDir, '.smart-edit');
    fs.mkdirSync(managedDir, { recursive: true });
    const projectYamlPath = path.join(managedDir, 'project.yml');
    fs.writeFileSync(
      projectYamlPath,
      `
project_name: demo
language: python
ignored_paths:
  foo: bar
`.trim(),
      'utf-8'
    );

    expect(() => ProjectConfig.load(tempDir)).toThrow(SmartEditConfigError);
  });
});

describe('SmartEditConfig', () => {
  let tempDir: string;
  let configFilePath: string;
  let projectRoot: string;

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('save はプロジェクト一覧と設定を YAML に反映する', () => {
    tempDir = createTempDir('smart-edit-config-');
    configFilePath = path.join(tempDir, 'smart_edit_config.yml');
    SmartEditConfig.generateConfigFile(configFilePath);
    const template = loadYaml(configFilePath, true);

    projectRoot = path.join(tempDir, 'workspace');
    const managedDir = path.join(projectRoot, '.smart-edit');
    fs.mkdirSync(managedDir, { recursive: true });
    const projectConfig = new ProjectConfig({
      projectName: 'demo',
      language: Language.PYTHON
    });
    const registered = new RegisteredProject({
      projectRoot,
      projectConfig
    });

    const init: SmartEditConfigInit = {
      projects: [registered],
      guiLogWindowEnabled: true,
      webDashboard: false,
      recordToolUsageStats: true,
      tokenCountEstimator: RegisteredTokenCountEstimator.ANTHROPIC_CLAUDE_SONNET_4,
      loadedCommentedYaml: template,
      configFilePath
    };

    const config = new SmartEditConfig(init);
    config.save();

    const saved = loadYaml(configFilePath);
    expect(saved).toBeDefined();
    const plain = saved as Record<string, unknown>;
    expect(plain.projects).toEqual([projectRoot]);
    expect(plain.gui_log_window).toBe(true);
    expect(plain.web_dashboard).toBe(false);
    expect(plain.record_tool_usage_stats).toBe(true);
    expect(plain.token_count_estimator).toBe('ANTHROPIC_CLAUDE_SONNET_4');
  });

  test('fromConfigFile は projects キー欠如を検出する', () => {
    tempDir = createTempDir('smart-edit-config-missing-projects-');
    configFilePath = path.join(tempDir, 'smart_edit_config.yml');
    fs.writeFileSync(
      configFilePath,
      `
web_dashboard: true
default_max_tool_answer_chars: 12345
`.trim(),
      'utf-8'
    );

    const spy = vi
      .spyOn(SmartEditConfig as unknown as { determineConfigFilePath: () => string }, 'determineConfigFilePath')
      .mockReturnValue(configFilePath);

    try {
      expect(() => SmartEditConfig.fromConfigFile({ generateIfMissing: false })).toThrow(SmartEditConfigError);
    } finally {
      spy.mockRestore();
    }
  });
});
