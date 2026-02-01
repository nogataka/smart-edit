import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import ignore from 'ignore';
import { afterEach, describe, expect, it } from 'vitest';

import {
  findAllNonIgnoredFiles,
  GitignoreParser,
  matchPath,
  scanDirectory,
  type PathMatcher
} from '../../../src/smart-edit/util/file_system.js';

const tempRoots: string[] = [];

function createTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `smart-edit-${prefix}-`));
  tempRoots.push(dir);
  return dir;
}

function writeFileSync(filePath: string, content = ''): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const dir = tempRoots.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('scanDirectory', () => {
  it('returns directories and files with absolute paths by default', () => {
    const root = createTempDir('scan');
    const subDir = path.join(root, 'nested');
    const nestedFile = path.join(subDir, 'file.txt');
    const rootFile = path.join(root, 'root.txt');

    writeFileSync(nestedFile, 'nested');
    writeFileSync(rootFile, 'root');

    const result = scanDirectory(root, true);
    expect(result.directories.map((p) => path.normalize(p))).toContain(path.normalize(subDir));
    expect(result.files.map((p) => path.normalize(p))).toContain(path.normalize(nestedFile));
    expect(result.files.map((p) => path.normalize(p))).toContain(path.normalize(rootFile));
  });

  it('honours relativeTo and ignore callbacks', () => {
    const root = createTempDir('scan-relative');
    const includeDir = path.join(root, 'include');
    const ignoreDir = path.join(root, 'ignore-me');
    const includeFile = path.join(includeDir, 'keep.txt');
    const ignoredFile = path.join(ignoreDir, 'skip.txt');

    writeFileSync(includeFile, 'keep');
    writeFileSync(ignoredFile, 'skip');

    const result = scanDirectory(
      root,
      true,
      root,
      (absPath) => absPath === ignoreDir,
      (absPath) => absPath === ignoredFile
    );

    expect(result.directories).toContain('include');
    expect(result.directories).not.toContain('ignore-me');
    expect(result.files).toContain(path.join('include', 'keep.txt'));
    expect(result.files).not.toContain(path.join('ignore-me', 'skip.txt'));
  });
});

describe('GitignoreParser', () => {
  it('loads gitignore files and applies ignore rules across nested directories', () => {
    const root = createTempDir('gitignore');
    writeFileSync(path.join(root, '.gitignore'), '*.log\n/build/\n');

    const srcDir = path.join(root, 'src');
    const srcGitignore = path.join(srcDir, '.gitignore');
    writeFileSync(srcGitignore, 'build/\n!important.log\n');

    const libDir = path.join(srcDir, 'lib');
    writeFileSync(path.join(libDir, '.gitignore'), '*.tmp\n');
    const docsDir = path.join(root, 'docs');
    writeFileSync(path.join(docsDir, '.gitignore'), 'temp/\n');

    writeFileSync(path.join(root, 'file.txt'));
    writeFileSync(path.join(root, 'test.log'));
    writeFileSync(path.join(root, 'build', 'output.bin'));
    writeFileSync(path.join(srcDir, 'main.py'));
    writeFileSync(path.join(srcDir, 'build', 'artifact.o'));
    writeFileSync(path.join(srcDir, 'important.log'));
    writeFileSync(path.join(libDir, 'cache.tmp'));
    writeFileSync(path.join(docsDir, 'temp', 'draft.md'));

    const parser = new GitignoreParser(root);

    expect(parser.getIgnoreSpecs()).toHaveLength(4);

    expect(parser.shouldIgnore(path.join(root, 'test.log'))).toBe(true);
    expect(parser.shouldIgnore(path.join(root, 'build'))).toBe(true);
    expect(parser.shouldIgnore(path.join(srcDir, 'build'))).toBe(true);
    expect(parser.shouldIgnore(path.join(docsDir, 'temp'))).toBe(true);

    // Pathspec (and therefore the Python implementation) cannot fully honor negation patterns here.
    // To keep parity with the original behavior, important.log is still treated as ignored.
    expect(parser.shouldIgnore(path.join(srcDir, 'important.log'))).toBe(true);
    // cache.tmp is ignored via nested gitignore
    expect(parser.shouldIgnore(path.join(libDir, 'cache.tmp'))).toBe(true);
  });

  it('findAllNonIgnoredFiles excludes ignored matches', () => {
    const root = createTempDir('find');
    writeFileSync(path.join(root, '.gitignore'), '*.log\n');
    writeFileSync(path.join(root, 'keep.txt'), 'keep');
    writeFileSync(path.join(root, 'skip.log'), 'skip');

    const files = findAllNonIgnoredFiles(root);

    expect(files.some((file) => file.endsWith('keep.txt'))).toBe(true);
    expect(files.some((file) => file.endsWith('skip.log'))).toBe(false);
  });

  it('reload picks up new gitignore rules', () => {
    const root = createTempDir('reload');
    const gitignorePath = path.join(root, '.gitignore');
    writeFileSync(gitignorePath, '');
    writeFileSync(path.join(root, 'temp.log'));

    const parser = new GitignoreParser(root);
    expect(parser.shouldIgnore(path.join(root, 'temp.log'))).toBe(false);

    fs.writeFileSync(gitignorePath, '*.log\n', 'utf-8');
    parser.reload();

    expect(parser.shouldIgnore(path.join(root, 'temp.log'))).toBe(true);
  });
});

describe('matchPath', () => {
  it('uses matcher semantics and directory detection similar to Python version', () => {
    const root = createTempDir('match');
    const distDir = path.join(root, 'dist');
    fs.mkdirSync(distDir, { recursive: true });
    writeFileSync(path.join(root, 'keep.log'));
    writeFileSync(path.join(root, 'discard.log'));

    const ignoreMatcher = ignore().add(['*.log', '!keep.log', 'dist/']);
    const matcher: PathMatcher = {
      ignores: (candidate: string) => ignoreMatcher.ignores(candidate)
    };

    expect(matchPath('discard.log', matcher, root)).toBe(true);
    expect(matchPath('keep.log', matcher, root)).toBe(false);
    expect(matchPath('dist', matcher, root)).toBe(true);
  });
});
