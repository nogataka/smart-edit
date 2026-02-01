import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

interface MinimalYamlDocument {
  toString(): string;
  set?(key: string, value: unknown): void;
  toJSON?(): unknown;
  [key: string]: unknown;
}

interface MinimalYamlModule {
  parse(source: string): unknown;
  parseDocument(source: string): MinimalYamlDocument;
  stringify(data: unknown): string;
}

let cachedYamlModule: MinimalYamlModule | undefined;

function loadYamlModule(): MinimalYamlModule {
  if (cachedYamlModule) {
    return cachedYamlModule;
  }

  try {
    const module = require('yaml') as MinimalYamlModule;
    cachedYamlModule = module;
    return module;
  } catch {
    throw new Error(
      'YAML サポートが利用できません。依存パッケージ "yaml" をインストールしてください。'
    );
  }
}

export type YamlObject = Record<string, unknown>;
export type YamlDocument = MinimalYamlDocument;

export function loadYaml(pathname: string, preserveComments = false): YamlObject | YamlDocument {
  const yaml = loadYamlModule();
  const source = fs.readFileSync(pathname, 'utf-8');

  if (preserveComments) {
    return yaml.parseDocument(source);
  }

  const parsed = yaml.parse(source);
  if (parsed && typeof parsed === 'object') {
    return parsed as YamlObject;
  }

  return {} as YamlObject;
}

export function saveYaml(
  pathname: string,
  data: YamlObject | YamlDocument,
  preserveComments = false
): void {
  const yaml = loadYamlModule();
  const directory = path.dirname(pathname);
  fs.mkdirSync(directory, { recursive: true });

  const serialized = preserveComments && isYamlDocument(data)
    ? data.toString()
    : yaml.stringify(data);

  fs.writeFileSync(pathname, serialized, 'utf-8');
}

function isYamlDocument(data: YamlObject | YamlDocument): data is YamlDocument {
  return typeof data === 'object' && data !== null && typeof (data as YamlDocument).toString === 'function';
}
