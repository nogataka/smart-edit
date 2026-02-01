import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import AdmZip from 'adm-zip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SafeZipExtractor } from '../../../src/smart-lsp/util/zip.js';

describe('SafeZipExtractor', () => {
  let tempDir: string;
  let zipPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-edit-zip-test-'));
    zipPath = path.join(tempDir, 'test.zip');
    const zip = new AdmZip();
    zip.addFile('file1.txt', Buffer.from('Hello World 1', 'utf-8'));
    zip.addFile('file2.txt', Buffer.from('Hello World 2', 'utf-8'));
    zip.addFile('folder/file3.txt', Buffer.from('Hello World 3', 'utf-8'));
    zip.writeZip(zipPath);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function extractTo(subdir: string, options: { include?: string[]; exclude?: string[] } = {}): string {
    const destination = path.join(tempDir, subdir);
    const extractor = new SafeZipExtractor(zipPath, destination, {
      verbose: false,
      includePatterns: options.include,
      excludePatterns: options.exclude
    });
    extractor.extractAll();
    return destination;
  }

  it('extracts all files successfully', () => {
    const destination = extractTo('extracted');
    expect(readText(destination, 'file1.txt')).toBe('Hello World 1');
    expect(readText(destination, 'file2.txt')).toBe('Hello World 2');
    expect(readText(destination, 'folder/file3.txt')).toBe('Hello World 3');
  });

  it('respects include patterns', () => {
    const destination = extractTo('include', { include: ['*.txt'] });
    expect(fs.existsSync(path.join(destination, 'file1.txt'))).toBe(true);
    expect(fs.existsSync(path.join(destination, 'file2.txt'))).toBe(true);
    expect(fs.existsSync(path.join(destination, 'folder', 'file3.txt'))).toBe(true);
  });

  it('respects exclude patterns', () => {
    const destination = extractTo('exclude', { exclude: ['file2.txt'] });
    expect(fs.existsSync(path.join(destination, 'file1.txt'))).toBe(true);
    expect(fs.existsSync(path.join(destination, 'file2.txt'))).toBe(false);
    expect(fs.existsSync(path.join(destination, 'folder', 'file3.txt'))).toBe(true);
  });

  it('gives priority to exclude patterns when both match', () => {
    const destination = extractTo('include-exclude', { include: ['*.txt'], exclude: ['file1.txt'] });
    expect(fs.existsSync(path.join(destination, 'file1.txt'))).toBe(false);
    expect(fs.existsSync(path.join(destination, 'file2.txt'))).toBe(true);
    expect(fs.existsSync(path.join(destination, 'folder', 'file3.txt'))).toBe(true);
  });

  it('supports character class patterns in includes', () => {
    const destination = extractTo('char-class', { include: ['file[12].txt'] });
    expect(fs.existsSync(path.join(destination, 'file1.txt'))).toBe(true);
    expect(fs.existsSync(path.join(destination, 'file2.txt'))).toBe(true);
    expect(fs.existsSync(path.join(destination, 'folder', 'file3.txt'))).toBe(false);
  });

  it('supports negated character class patterns', () => {
    const destination = extractTo('negated-class', { include: ['file[!2].txt'] });
    expect(fs.existsSync(path.join(destination, 'file1.txt'))).toBe(true);
    expect(fs.existsSync(path.join(destination, 'file2.txt'))).toBe(false);
  });

  it('skips files that throw during extraction but continues with others', () => {
    const originalWriteFileSync = fs.writeFileSync.bind(fs);
    vi.spyOn(fs, 'writeFileSync').mockImplementation((
      file: fs.PathOrFileDescriptor,
      data: string | NodeJS.ArrayBufferView,
      options?: fs.ObjectEncodingOptions | fs.WriteFileOptions
    ) => {
      if (typeof file === 'string' && file.includes('file2.txt')) {
        throw new Error('Simulated failure');
      }
      return originalWriteFileSync(file, data as never, options as never);
    });

    const destination = extractTo('skip-on-error');
    expect(fs.existsSync(path.join(destination, 'file1.txt'))).toBe(true);
    expect(fs.existsSync(path.join(destination, 'file2.txt'))).toBe(false);
    expect(fs.existsSync(path.join(destination, 'folder', 'file3.txt'))).toBe(true);
  });

  it('normalizes long paths on Windows', () => {
    class TestExtractor extends SafeZipExtractor {
      exposeNormalize(target: string): string {
        return this.normalizePath(target);
      }
    }

    const extractor = new TestExtractor(zipPath, path.join(tempDir, 'long'), { verbose: false });
    const longTarget = path.join(tempDir, 'a'.repeat(250), 'file.txt');
    const normalized = extractor.exposeNormalize(longTarget);

    if (process.platform === 'win32') {
      expect(normalized.startsWith('\\\\?\\')).toBe(true);
    } else {
      expect(normalized).toBe(path.resolve(longTarget));
    }
  });
});

function readText(destination: string, relativePath: string): string {
  return fs.readFileSync(path.join(destination, relativePath), 'utf-8');
}
