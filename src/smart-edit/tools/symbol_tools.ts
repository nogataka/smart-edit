/* eslint-disable @typescript-eslint/unbound-method */
import fs from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import {
  SUCCESS_RESULT,
  Tool,
  ToolMarkerOptional,
  ToolMarkerSymbolicEdit,
  ToolMarkerSymbolicRead,
  type CodeEditorLike,
  type LanguageServerSymbolRetrieverLike,
  type ProjectLike
} from './tools_base.js';

interface GetSymbolsOverviewInput {
  relative_path: string;
  max_answer_chars?: number;
}

interface FindSymbolInput {
  name_path: string;
  depth?: number;
  relative_path?: string;
  include_body?: boolean;
  include_kinds?: number[];
  exclude_kinds?: number[];
  substring_matching?: boolean;
  max_answer_chars?: number;
}

interface FindReferencingSymbolsInput {
  name_path: string;
  relative_path: string;
  include_kinds?: number[];
  exclude_kinds?: number[];
  max_answer_chars?: number;
}

interface ReplaceSymbolBodyInput {
  name_path: string;
  relative_path: string;
  body: string;
}

interface InsertSymbolInput {
  name_path: string;
  relative_path: string;
  body: string;
}

type SymbolRetrieverMethodName =
  | 'getSymbolOverview'
  | 'get_symbol_overview'
  | 'findByName'
  | 'find_by_name'
  | 'findReferencingSymbols'
  | 'find_referencing_symbols';

type LanguageServerSymbolRetriever = LanguageServerSymbolRetrieverLike &
  Partial<Record<SymbolRetrieverMethodName, (...args: unknown[]) => unknown>>;

interface ProjectWithContentAroundLine extends ProjectLike {
  retrieveContentAroundLine?(
    relativePath: string,
    line: number,
    contextLinesBefore?: number,
    contextLinesAfter?: number
  ): unknown;
  retrieve_content_around_line?(
    relativePath: string,
    line: number,
    contextLinesBefore?: number,
    contextLinesAfter?: number
  ): unknown;
}

type SymbolEditorMethodName =
  | 'replaceBody'
  | 'replace_body'
  | 'insertAfterSymbol'
  | 'insert_after_symbol'
  | 'insertBeforeSymbol'
  | 'insert_before_symbol';

type CodeEditorWithSymbolOps = CodeEditorLike &
  Partial<Record<SymbolEditorMethodName, (namePath: string, relativePath: string, body: string) => void | Promise<void>>>;

type EditorSymbolMethod = (namePath: string, relativePath: string, body: string) => unknown;

function isEditorSymbolMethod(value: unknown): value is EditorSymbolMethod {
  return typeof value === 'function';
}

interface SymbolToDictOptions {
  depth?: number;
  include_body?: boolean;
  includeBody?: boolean;
  kind?: boolean;
  location?: boolean;
}

interface ReferenceEntry {
  symbol: unknown;
  line: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function maybeCall<T>(target: object, names: string[], ...args: unknown[]): T {
  for (const name of names) {
    const candidate = Reflect.get(target, name) as unknown;
    if (typeof candidate === 'function') {
      return (candidate as (...fnArgs: unknown[]) => T).apply(target, args);
    }
  }
  throw new Error(`Required method not implemented. Tried: ${names.join(', ')}`);
}

function sanitizeSymbolDict(source: Record<string, unknown>): Record<string, unknown> {
  const symbolDict: Record<string, unknown> = { ...source };
  const location = symbolDict.location;
  if (isRecord(location)) {
    const relativePath =
      typeof location.relative_path === 'string'
        ? location.relative_path
        : typeof location.relativePath === 'string'
          ? location.relativePath
          : undefined;
    if (relativePath !== undefined) {
      symbolDict.relative_path = relativePath;
    }
  }
  delete symbolDict.location;
  delete symbolDict.name;
  return symbolDict;
}

function normalizeSymbolKinds(values: number[] | undefined): number[] | undefined {
  if (!values || values.length === 0) {
    return undefined;
  }
  return values.map((value) => {
    if (!Number.isInteger(value)) {
      throw new Error(`Symbol kind must be an integer, got ${value}`);
    }
    if (value < 1 || value > 26) {
      throw new RangeError(`Unsupported symbol kind value: ${value}`);
    }
    return value;
  });
}

function symbolRepresentationToDict(symbol: unknown, options: SymbolToDictOptions = {}): Record<string, unknown> {
  if (!isRecord(symbol)) {
    throw new Error('Symbol retriever returned a non-object value.');
  }
  const camelCase = symbol.toDict;
  const snakeCase = symbol.to_dict;
  if (typeof camelCase === 'function' || typeof snakeCase === 'function') {
    const callable = (camelCase ?? snakeCase) as (opts?: Record<string, unknown>) => unknown;
    const payload: Record<string, unknown> = { ...options };
    if (payload.include_body !== undefined && payload.includeBody === undefined) {
      payload.includeBody = payload.include_body;
    }
    if (payload.includeBody !== undefined && payload.include_body === undefined) {
      payload.include_body = payload.includeBody;
    }
    const result = callable.call(symbol, payload);
    if (!isRecord(result)) {
      throw new Error('Symbol to_dict returned a non-object value.');
    }
    return { ...result };
  }
  return { ...symbol };
}

async function getSymbolOverview(
  retriever: LanguageServerSymbolRetriever,
  relativePath: string
): Promise<Record<string, unknown>[]> {
  const raw = await Promise.resolve(maybeCall<unknown>(retriever, ['getSymbolOverview', 'get_symbol_overview'], relativePath));
  if (Array.isArray(raw)) {
    return raw.map((entry) => {
      if (!isRecord(entry)) {
        throw new Error('Symbol overview entry must be an object.');
      }
      return { ...entry };
    });
  }
  if (isRecord(raw)) {
    const entries = raw[relativePath];
    if (!entries) {
      return [];
    }
    if (!Array.isArray(entries)) {
      throw new Error('Symbol overview response must contain a list of entries.');
    }
    return entries.map((entry) => {
      if (!isRecord(entry)) {
        throw new Error('Symbol overview entry must be an object.');
      }
      return { ...entry };
    });
  }
  throw new Error('Symbol overview response has an unexpected format.');
}

async function findSymbols(
  retriever: LanguageServerSymbolRetriever,
  namePath: string,
  options: {
    includeBody: boolean;
    includeKinds?: number[];
    excludeKinds?: number[];
    substringMatching: boolean;
    withinRelativePath?: string;
  }
): Promise<unknown[]> {
  const payload: Record<string, unknown> = {
    includeBody: options.includeBody,
    include_body: options.includeBody,
    includeKinds: options.includeKinds,
    include_kinds: options.includeKinds,
    excludeKinds: options.excludeKinds,
    exclude_kinds: options.excludeKinds,
    substringMatching: options.substringMatching,
    substring_matching: options.substringMatching
  };
  if (options.withinRelativePath && options.withinRelativePath.length > 0) {
    payload.withinRelativePath = options.withinRelativePath;
    payload.within_relative_path = options.withinRelativePath;
  }
  const raw = await Promise.resolve(maybeCall<unknown>(retriever, ['findByName', 'find_by_name'], namePath, payload));
  if (!Array.isArray(raw)) {
    throw new Error('find_by_name returned a non-array value.');
  }
  const result: unknown[] = [];
  for (const entry of raw) {
    result.push(entry);
  }
  return result;
}

async function findReferencingSymbols(
  retriever: LanguageServerSymbolRetriever,
  namePath: string,
  relativePath: string,
  options: { includeKinds?: number[]; excludeKinds?: number[] }
): Promise<ReferenceEntry[]> {
  const payload: Record<string, unknown> = {
    includeKinds: options.includeKinds,
    include_kinds: options.includeKinds,
    excludeKinds: options.excludeKinds,
    exclude_kinds: options.excludeKinds,
    includeBody: false,
    include_body: false
  };
  const raw = await Promise.resolve(
    maybeCall<unknown>(retriever, ['findReferencingSymbols', 'find_referencing_symbols'], namePath, relativePath, payload)
  );
  if (!Array.isArray(raw)) {
    throw new Error('find_referencing_symbols returned a non-array value.');
  }
  return raw.map((entry) => {
    if (!isRecord(entry) || typeof entry.line !== 'number' || !('symbol' in entry)) {
      throw new Error('Reference entry must include a symbol and numeric line.');
    }
    return {
      symbol: entry.symbol,
      line: entry.line
    } satisfies ReferenceEntry;
  });
}

async function resolveContentAroundLine(
  project: ProjectWithContentAroundLine,
  relativePath: string,
  line: number
): Promise<string> {
  const method = project.retrieveContentAroundLine ?? project.retrieve_content_around_line;
  if (typeof method !== 'function') {
    throw new Error('Project does not support retrieving content around a line.');
  }
  const result = await Promise.resolve(
    Reflect.apply(method as (this: ProjectWithContentAroundLine, ...args: unknown[]) => unknown, project, [
      relativePath,
      line,
      1,
      1
    ])
  );
  if (typeof result === 'string') {
    return result;
  }
  if (isRecord(result)) {
    const formatter = result.toDisplayString ?? result.to_display_string;
    if (typeof formatter === 'function') {
      const formattedResult = await Promise.resolve(
        Reflect.apply(formatter as (...args: unknown[]) => unknown, result, [])
      );
      if (typeof formattedResult === 'string') {
        return formattedResult;
      }
    }
  }
  throw new Error('Content around line must provide a string or toDisplayString() result.');
}

async function callEditor(
  editor: CodeEditorWithSymbolOps,
  names: [SymbolEditorMethodName, SymbolEditorMethodName],
  namePath: string,
  relativePath: string,
  body: string
): Promise<void> {
  const firstCandidate = Reflect.get(editor, names[0]);
  if (isEditorSymbolMethod(firstCandidate)) {
    await Promise.resolve(Reflect.apply(firstCandidate, editor, [namePath, relativePath, body]));
    return;
  }
  const secondCandidate = Reflect.get(editor, names[1]);
  if (isEditorSymbolMethod(secondCandidate)) {
    await Promise.resolve(Reflect.apply(secondCandidate, editor, [namePath, relativePath, body]));
    return;
  }
  throw new Error(`Code editor does not implement ${names.join(' / ')}.`);
}

function getSymbolRetriever(raw: LanguageServerSymbolRetrieverLike): LanguageServerSymbolRetriever {
  if (!isRecord(raw)) {
    throw new Error('Language server symbol retriever must be an object.');
  }
  return raw as LanguageServerSymbolRetriever;
}

export class RestartLanguageServerTool extends Tool {
  static override readonly markers = new Set([ToolMarkerOptional]);
  static override readonly description =
    'Restarts the language server. Use only on explicit user request or if the server hangs.';

  async apply(): Promise<string> {
    await Promise.resolve(this.agent.resetLanguageServer());
    return SUCCESS_RESULT;
  }
}

export class GetSymbolsOverviewTool extends Tool {
  static override readonly markers = new Set([ToolMarkerSymbolicRead]);
  static override readonly description = 'Returns a JSON array describing the top-level symbols in a file.';
  static override readonly inputSchema = z.object({
    relative_path: z.string().min(1, 'relative_path must not be empty'),
    max_answer_chars: z
      .number()
      .int()
      .gte(-1, 'max_answer_chars must be -1 or a positive integer')
      .optional()
  });

  override async apply(args: GetSymbolsOverviewInput): Promise<string> {
    const { relative_path, max_answer_chars = -1 } = args;
    const projectRoot = this.getProjectRoot();
    const filePath = path.join(projectRoot, relative_path);
    if (!fs.existsSync(filePath)) {
      throw new Error(`File or directory ${relative_path} does not exist in the project.`);
    }
    const stats = fs.statSync(filePath);
    if (stats.isDirectory()) {
      throw new Error(`Expected a file path, but got a directory path: ${relative_path}.`);
    }

    const retriever = getSymbolRetriever(this.createLanguageServerSymbolRetriever());
    const entries = await getSymbolOverview(retriever, relative_path);
    const serialized = entries.map((entry) => sanitizeSymbolDict(symbolRepresentationToDict(entry)));
    return this._limitLength(JSON.stringify(serialized), max_answer_chars);
  }
}

export class FindSymbolTool extends Tool {
  static override readonly markers = new Set([ToolMarkerSymbolicRead]);
  static override readonly description =
    'Finds symbols that match the given name path, optionally restricting by location or symbol kind.';
  static override readonly inputSchema = z.object({
    name_path: z.string().min(1, 'name_path must not be empty'),
    depth: z
      .number()
      .int()
      .min(0, 'depth must be non-negative')
      .optional()
      .default(0),
    relative_path: z.string().optional().default(''),
    include_body: z.boolean().optional().default(false),
    include_kinds: z.array(z.number().int()).optional().default([]),
    exclude_kinds: z.array(z.number().int()).optional().default([]),
    substring_matching: z.boolean().optional().default(false),
    max_answer_chars: z
      .number()
      .int()
      .gte(-1, 'max_answer_chars must be -1 or a positive integer')
      .optional()
  });

  override async apply(args: FindSymbolInput): Promise<string> {
    const {
      name_path,
      depth = 0,
      relative_path = '',
      include_body = false,
      include_kinds = [],
      exclude_kinds = [],
      substring_matching = false,
      max_answer_chars = -1
    } = args;

    const retriever = getSymbolRetriever(this.createLanguageServerSymbolRetriever());
    const symbols = await findSymbols(retriever, name_path, {
      includeBody: include_body,
      includeKinds: normalizeSymbolKinds(include_kinds),
      excludeKinds: normalizeSymbolKinds(exclude_kinds),
      substringMatching: substring_matching,
      withinRelativePath: relative_path
    });

    const serialized = symbols.map((symbol) =>
      sanitizeSymbolDict(
        symbolRepresentationToDict(symbol, {
          depth,
          kind: true,
          location: true,
          include_body: include_body,
          includeBody: include_body
        })
      )
    );

    return this._limitLength(JSON.stringify(serialized), max_answer_chars);
  }
}

export class FindReferencingSymbolsTool extends Tool {
  static override readonly markers = new Set([ToolMarkerSymbolicRead]);
  static override readonly description =
    'Finds symbols referencing the specified target and returns metadata including snippets.';
  static override readonly inputSchema = z.object({
    name_path: z.string().min(1, 'name_path must not be empty'),
    relative_path: z.string().min(1, 'relative_path must not be empty'),
    include_kinds: z.array(z.number().int()).optional().default([]),
    exclude_kinds: z.array(z.number().int()).optional().default([]),
    max_answer_chars: z
      .number()
      .int()
      .gte(-1, 'max_answer_chars must be -1 or a positive integer')
      .optional()
  });

  override async apply(args: FindReferencingSymbolsInput): Promise<string> {
    const {
      name_path,
      relative_path,
      include_kinds = [],
      exclude_kinds = [],
      max_answer_chars = -1
    } = args;

    const retriever = getSymbolRetriever(this.createLanguageServerSymbolRetriever());
    const references = await findReferencingSymbols(retriever, name_path, relative_path, {
      includeKinds: normalizeSymbolKinds(include_kinds),
      excludeKinds: normalizeSymbolKinds(exclude_kinds)
    });

    const project = this.project as ProjectWithContentAroundLine;
    const serialized = [];
    for (const reference of references) {
      const dict = sanitizeSymbolDict(
        symbolRepresentationToDict(reference.symbol, {
          depth: 0,
          include_body: false,
          includeBody: false,
          kind: true,
          location: true
        })
      );
      const relativePath =
        typeof dict.relative_path === 'string'
          ? dict.relative_path
          : typeof dict.relativePath === 'string'
            ? dict.relativePath
            : null;
      if (!relativePath) {
        throw new Error('Referencing symbol is missing a relative path.');
      }
      const content = await resolveContentAroundLine(project, relativePath, reference.line);
      dict.content_around_reference = content;
      serialized.push(dict);
    }

    return this._limitLength(JSON.stringify(serialized), max_answer_chars);
  }
}

export class ReplaceSymbolBodyTool extends Tool {
  static override readonly markers = new Set([ToolMarkerSymbolicEdit]);
  static override readonly description = 'Replaces the body of the specified symbol.';
  static override readonly inputSchema = z.object({
    name_path: z.string().min(1, 'name_path must not be empty'),
    relative_path: z.string().min(1, 'relative_path must not be empty'),
    body: z.string()
  });

  override async apply(args: ReplaceSymbolBodyInput): Promise<string> {
    const { name_path, relative_path, body } = args;
    const editor = this.createCodeEditor() as CodeEditorWithSymbolOps;
    await callEditor(editor, ['replaceBody', 'replace_body'], name_path, relative_path, body);
    return SUCCESS_RESULT;
  }
}

export class InsertAfterSymbolTool extends Tool {
  static override readonly markers = new Set([ToolMarkerSymbolicEdit]);
  static override readonly description = 'Inserts content immediately after the specified symbol.';
  static override readonly inputSchema = z.object({
    name_path: z.string().min(1, 'name_path must not be empty'),
    relative_path: z.string().min(1, 'relative_path must not be empty'),
    body: z.string()
  });

  override async apply(args: InsertSymbolInput): Promise<string> {
    const { name_path, relative_path, body } = args;
    const editor = this.createCodeEditor() as CodeEditorWithSymbolOps;
    await callEditor(editor, ['insertAfterSymbol', 'insert_after_symbol'], name_path, relative_path, body);
    return SUCCESS_RESULT;
  }
}

export class InsertBeforeSymbolTool extends Tool {
  static override readonly markers = new Set([ToolMarkerSymbolicEdit]);
  static override readonly description = 'Inserts content immediately before the specified symbol.';
  static override readonly inputSchema = z.object({
    name_path: z.string().min(1, 'name_path must not be empty'),
    relative_path: z.string().min(1, 'relative_path must not be empty'),
    body: z.string()
  });

  override async apply(args: InsertSymbolInput): Promise<string> {
    const { name_path, relative_path, body } = args;
    const editor = this.createCodeEditor() as CodeEditorWithSymbolOps;
    await callEditor(editor, ['insertBeforeSymbol', 'insert_before_symbol'], name_path, relative_path, body);
    return SUCCESS_RESULT;
  }
}
