import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

import { loadYaml, saveYaml } from '../../../src/smart-edit/util/general.js';

const require = createRequire(import.meta.url);
let yamlAvailable = true;

try {
  require.resolve('yaml');
} catch {
  yamlAvailable = false;
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-edit-general-test-'));

const describeIfYaml = yamlAvailable ? describe : describe.skip;

interface YamlDocumentLike {
  toString(): string;
  set?: (key: string, value: unknown) => unknown;
}

function assertYamlDocument(value: unknown): asserts value is YamlDocumentLike {
  if (typeof value !== 'object' || value === null) {
    throw new Error('YAML ドキュメントの読み込みに失敗しました');
  }

  if (typeof (value as YamlDocumentLike).toString !== 'function') {
    throw new Error('YAML ドキュメントの読み込みに失敗しました');
  }
}

describeIfYaml('loadYaml/saveYaml', () => {
  it('loads YAML data without comments', () => {
    const filePath = path.join(tmpRoot, 'simple.yml');
    fs.writeFileSync(filePath, 'foo: bar\nbaz: 1\n', 'utf-8');

    const result = loadYaml(filePath);
    expect(result).toEqual({ foo: 'bar', baz: 1 });
  });

  it('preserves comments when requested', () => {
    const filePath = path.join(tmpRoot, 'with-comments.yml');
    fs.writeFileSync(filePath, '# heading\nvalue: 1\n', 'utf-8');

    const doc = loadYaml(filePath, true);
    assertYamlDocument(doc);
    doc.set?.('next', 2);

    const outputPath = path.join(tmpRoot, 'with-comments-out.yml');
    saveYaml(outputPath, doc, true);

    const output = fs.readFileSync(outputPath, 'utf-8');
    expect(output).toContain('# heading');
    expect(output).toContain('next: 2');
  });
});
