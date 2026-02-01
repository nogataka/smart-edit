import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Project, type ProjectSearchOptions } from '../../../src/smart-edit/project.js';
import { ProjectConfig } from '../../../src/smart-edit/config/smart_edit_config.js';
import { Language } from '../../../src/smart-lsp/ls_config.js';
import { SmartLanguageServer } from '../../../src/smart-lsp/ls.js';

interface TempProjectHandle {
  root: string;
  project: Project;
}

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(target: string, content: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, { encoding: 'utf-8' });
}

function createTempProject(): TempProjectHandle {
  const root = makeTempDir('smart-edit-project-');
  const config = new ProjectConfig({
    projectName: 'demo',
    language: Language.TYPESCRIPT,
    ignoredPaths: ['dist/', 'coverage/**'],
    readOnly: false,
    ignoreAllFilesInGitignore: true
  });

  writeFile(path.join(root, 'src', 'index.ts'), "console.log('hello world');\n");
  writeFile(path.join(root, 'src', 'app.tsx'), 'export const App = () => null;\n');
  writeFile(path.join(root, 'README.md'), '# Demo\n');
  writeFile(path.join(root, 'dist', 'bundle.js'), 'console.log("built");');
  writeFile(path.join(root, '.gitignore'), 'node_modules\n*.log\n');

  const project = new Project({ projectRoot: root, projectConfig: config });
  return { root, project };
}

function removeDir(target: string): void {
  fs.rmSync(target, { recursive: true, force: true });
}

describe('Project', () => {
  let handle: TempProjectHandle;

  beforeEach(() => {
    handle = createTempProject();
  });

  afterEach(() => {
    removeDir(handle.root);
  });

  it('creates .smart-edit/.gitignore with cache entry', () => {
    const gitignorePath = path.join(handle.project.pathToSmartEditDataFolder(), '.gitignore');
    expect(fs.existsSync(gitignorePath)).toBe(true);
    const content = fs.readFileSync(gitignorePath, 'utf-8');
    expect(content).toBe(`/${SmartLanguageServer.CACHE_FOLDER_NAME}\n`);
  });

  it('filters ignored and non-source files when gathering source files', () => {
    const files = handle.project.gatherSourceFiles();
    expect(files.sort()).toEqual(['src/app.tsx', 'src/index.ts']);
  });

  it('detects ignored paths from configuration and gitignore', () => {
    expect(handle.project.isIgnoredPath('dist/bundle.js')).toBe(true);
    expect(handle.project.isIgnoredPath('node_modules/example.js')).toBe(true);
    expect(handle.project.isIgnoredPath('src/index.ts')).toBe(false);
  });

  it('validates relative paths and rejects ignored files', () => {
    expect(() => handle.project.validateRelativePath('src/index.ts')).not.toThrow();
    expect(() => handle.project.validateRelativePath('dist/bundle.js')).toThrowError(/ignored/iu);
    expect(() => handle.project.validateRelativePath('../outside.ts')).toThrowError(/outside/iu);
  });

  it('searches source files for a pattern', () => {
    const options: ProjectSearchOptions = {
      pattern: 'console\\.log',
      context_lines_before: 0,
      context_lines_after: 0
    };
    const matches = handle.project.searchSourceFilesForPattern(options);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.sourceFilePath).toBe('src/index.ts');
  });

  it('retrieves content around a line', () => {
    const snippet = handle.project.retrieveContentAroundLine('src/index.ts', 0, 0, 0);
    expect(snippet.lines[0]?.lineContent.trim()).toBe("console.log('hello world');");
  });

  it('creates a language server instance with project root', () => {
    const ls = handle.project.createLanguageServer({
      logLevel: 20,
      lsTimeout: null,
      traceLspCommunication: false,
      lsSpecificSettings: {}
    });
    expect(ls).toBeInstanceOf(SmartLanguageServer);
    expect(ls.repositoryRootPath).toBe(handle.root);
  });
});
