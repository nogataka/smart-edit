import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSmartEditLogger } from '../smart-edit/util/logging.js';
import { MultiLangPromptCollection, type PromptList, DEFAULT_LANG_CODE } from './multilang_prompt.js';
import type { LanguageFallbackMode } from './multilang_prompt.js';

export interface PromptFactoryBaseOptions {
  promptsDir: string | string[];
  langCode?: string;
  fallbackMode?: LanguageFallbackMode;
}

export class PromptFactoryBase {
  protected readonly langCode: string;
  protected readonly promptCollection: MultiLangPromptCollection;

  constructor(options: PromptFactoryBaseOptions) {
    this.langCode = options.langCode ?? DEFAULT_LANG_CODE;
    this.promptCollection = new MultiLangPromptCollection(options.promptsDir, options.fallbackMode);
  }

  protected renderPromptTemplate(promptName: string, params: Record<string, unknown>): string {
    const safeParams = { ...params };
    delete (safeParams as Record<string, unknown>).self;
    return this.promptCollection.renderPromptTemplate(promptName, safeParams, this.langCode);
  }

  protected getPromptList(promptName: string): PromptList {
    return this.promptCollection.getPromptList(promptName, this.langCode);
  }
}

export { PromptList, DEFAULT_LANG_CODE, LanguageFallbackMode } from './multilang_prompt.js';

const MODULE_PATH = fileURLToPath(import.meta.url);
const MODULE_JS_PATH = MODULE_PATH.replace(/\.ts$/, '.js');
const { logger: promptFactoryLogger } = createSmartEditLogger({ name: 'interprompt.prompt_factory' });

function toPascalCase(value: string): string {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join('');
}

function toCamelCase(value: string): string {
  const pascal = toPascalCase(value);
  if (pascal.length === 0) {
    return pascal;
  }
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

function toPosixPath(value: string): string {
  return value.replace(/\\/g, '/');
}

interface TemplateParamSpec {
  snake: string;
  camel: string;
  type: string;
  optional: boolean;
  needsArrayConversion: boolean;
}

function inferParamSpec(templateName: string, paramName: string): TemplateParamSpec {
  const snake = paramName;
  const camel = toCamelCase(paramName);
  const lower = paramName.toLowerCase();

  let type = 'unknown';
  let optional = false;
  let needsArrayConversion = false;

  if (lower === 'system') {
    type = 'string';
  } else if (lower.endsWith('_prompt')) {
    type = 'string';
  } else if (lower.endsWith('_prompts') || lower.endsWith('_tools') || lower.endsWith('_markers')) {
    type = 'Iterable<string>';
    needsArrayConversion = true;
  } else if (lower.endsWith('_dir') || lower.endsWith('_path')) {
    type = 'string';
  }

  if (templateName === 'prepare_for_new_conversation' && lower === 'mode_prepare_for_new_conversation') {
    type = 'string | undefined';
    optional = true;
  }

  return { snake, camel, type, optional, needsArrayConversion };
}

function normalizeImportPath(from: string, to: string): string {
  const relative = path.relative(from, to);
  const normalized = toPosixPath(relative.startsWith('.') ? relative : `./${relative}`);
  return normalized.endsWith('.js') ? normalized : `${normalized}.js`;
}

export function autogeneratePromptFactoryModule(promptsDir: string | string[], targetModulePath: string): void {
  const collection = new MultiLangPromptCollection(promptsDir);
  const dir = path.dirname(targetModulePath);
  fs.mkdirSync(dir, { recursive: true });

  const templateNames = [...collection.getPromptTemplateNames()].sort();
  const promptListNames = [...collection.getPromptListNames()].sort();

  const templateSpecs = templateNames.map((name) => ({
    name,
    pascal: toPascalCase(name),
    camel: `create${toPascalCase(name)}`,
    snake: `create_${name}`,
    params: collection.getPromptTemplateParameters(name).map((param) => inferParamSpec(name, param))
  }));

  const promptListSpecs = promptListNames.map((name) => ({
    name,
    pascal: toPascalCase(name),
    camel: `getList${toPascalCase(name)}`,
    snake: `get_list_${name}`
  }));

  const importPath = normalizeImportPath(dir, MODULE_JS_PATH);

  const lines: string[] = [];
  lines.push('// NOTE: This module is auto-generated via interprompt.autogeneratePromptFactoryModule. Do not edit manually.');
  lines.push('');
  lines.push('import {');
  lines.push('  PromptFactoryBase,');
  lines.push('  type PromptFactoryBaseOptions,');
  if (promptListSpecs.length > 0) {
    lines.push('  type PromptList');
  }
  lines.push(`} from '${importPath}';`);
  lines.push('');

  for (const spec of templateSpecs) {
    if (spec.params.length === 0) {
      continue;
    }
    const interfaceName = `Create${spec.pascal}Params`;
    lines.push(`export interface ${interfaceName} {`);
    for (const param of spec.params) {
      const optionalMark = param.optional ? '?' : '';
      lines.push(`  ${param.camel}${optionalMark}: ${param.type};`);
    }
    lines.push('}');
    lines.push('');
  }

  lines.push('export class PromptFactory extends PromptFactoryBase {');

  for (const spec of templateSpecs) {
    const typeAnnotation = spec.params.length === 0 ? '() => string' : `(params: Create${spec.pascal}Params) => string`;
    lines.push(`  declare ${spec.snake}: ${typeAnnotation};`);
  }
  if (promptListSpecs.length > 0) {
    for (const spec of promptListSpecs) {
      lines.push(`  declare ${spec.snake}: () => PromptList;`);
    }
  }
  if (templateSpecs.length > 0 || promptListSpecs.length > 0) {
    lines.push('');
  }

  lines.push('  constructor(options: PromptFactoryBaseOptions) {');
  lines.push('    super(options);');
  for (const spec of templateSpecs) {
    const callArgs = spec.params.length === 0 ? '' : 'params';
    const arrowParams = spec.params.length === 0 ? '' : 'params';
    const assignment = spec.params.length === 0
      ? `    this.${spec.snake} = () => this.${spec.camel}();`
      : `    this.${spec.snake} = (${arrowParams}) => this.${spec.camel}(${callArgs});`;
    lines.push(assignment);
  }
  if (promptListSpecs.length > 0) {
    for (const spec of promptListSpecs) {
      lines.push(`    this.${spec.snake} = () => this.${spec.camel}();`);
    }
  }
  lines.push('  }');
  lines.push('');

  for (const spec of templateSpecs) {
    const methodSignature = spec.params.length === 0
      ? `${spec.camel}(): string`
      : `${spec.camel}(params: Create${spec.pascal}Params): string`;
    lines.push(`  ${methodSignature} {`);
    if (spec.params.length === 0) {
      lines.push(`    return this.renderPromptTemplate('${spec.name}', {});`);
    } else {
      lines.push('    return this.renderPromptTemplate(');
      lines.push(`      '${spec.name}',`);
      lines.push('      {');
      for (let index = 0; index < spec.params.length; index += 1) {
        const param = spec.params[index];
        const suffix = index === spec.params.length - 1 ? '' : ',';
        if (param.needsArrayConversion) {
          lines.push(`        ${param.snake}: Array.from(params.${param.camel} ?? [])${suffix}`);
        } else {
          lines.push(`        ${param.snake}: params.${param.camel}${suffix}`);
        }
      }
      lines.push('      }');
      lines.push('    );');
    }
    lines.push('  }');
    lines.push('');
  }

  if (promptListSpecs.length > 0) {
    for (const spec of promptListSpecs) {
      lines.push(`  ${spec.camel}(): PromptList {`);
      lines.push(`    return this.getPromptList('${spec.name}');`);
      lines.push('  }');
      lines.push('');
    }
  }

  lines.push('}');
  lines.push('');

  const fileContents = `${lines.join('\n').trimEnd()}\n`;
  fs.writeFileSync(targetModulePath, fileContents, 'utf-8');
  promptFactoryLogger.info(`Prompt factory generated successfully at ${targetModulePath}`);
}
