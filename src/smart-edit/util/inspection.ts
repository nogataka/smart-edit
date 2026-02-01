import path from 'node:path';

import { findAllNonIgnoredFiles } from './file_system.js';

export type Constructor<T = unknown> = abstract new (...args: unknown[]) => T;

export interface RegisterSubclassOptions {
  /**
   * 任意で明示的な基底クラスを指定できます。指定しない場合は prototype 連鎖から推測します。
   */
  base?: Constructor<unknown>;
}

const subclassRegistry = new Map<Constructor<unknown>, Set<Constructor<unknown>>>();

/**
 * サブクラスをレジストリに登録します。
 * 各クラス定義側からこの関数を呼び出して静的メタデータを構築します。
 */
export function registerSubclass<T>(
  derived: Constructor<T>,
  options?: RegisterSubclassOptions
): void {
  const base = options?.base ?? getDirectBaseConstructor(derived);

  if (!base || base === derived) {
    return;
  }

  let entries = subclassRegistry.get(base);
  if (!entries) {
    entries = new Set();
    subclassRegistry.set(base, entries);
  }

  entries.add(derived);
}

/**
 * 指定した基底クラスのサブクラスを列挙します。recursive = true の場合は再帰的に辿ります。
 */
export function* iterSubclasses<T>(
  base: Constructor<T>,
  recursive = true
): Generator<Constructor<T>, void, unknown> {
  yield* iterateSubclassesInternal(base, recursive, new Set());
}

function* iterateSubclassesInternal<T>(
  base: Constructor<T>,
  recursive: boolean,
  seen: Set<Constructor<unknown>>
): Generator<Constructor<T>, void, unknown> {
  const direct = subclassRegistry.get(base as Constructor<unknown>);
  if (!direct) {
    return;
  }

  for (const subclass of direct) {
    if (seen.has(subclass)) {
      continue;
    }

    seen.add(subclass);
    yield subclass as Constructor<T>;

    if (recursive) {
      yield* iterateSubclassesInternal(subclass as Constructor<T>, true, seen);
    }
  }
}

interface PrototypeRecord {
  constructor?: unknown;
}

function getDirectBaseConstructor(ctor: Constructor<unknown>): Constructor<unknown> | undefined {
  const prototype = Object.getPrototypeOf(ctor.prototype) as (PrototypeRecord & object) | null;
  if (!prototype) {
    return undefined;
  }

  const parentCtor = prototype.constructor;
  if (typeof parentCtor !== 'function') {
    return undefined;
  }

  if (parentCtor === Object || parentCtor === Function) {
    return undefined;
  }

  return parentCtor as Constructor<unknown>;
}

/**
 * テスト用途などでレジストリを初期化したい場合に使用します。
 */
export function clearSubclassRegistry(): void {
  subclassRegistry.clear();
}

export interface FilenameMatcher {
  isRelevantFilename(filename: string): boolean;
}

export interface ProgrammingLanguageDefinition {
  name: string;
  matcher: FilenameMatcher;
  experimental?: boolean;
}

export interface DetermineLanguageOptions {
  languages?: Iterable<LanguageInput>;
  includeExperimental?: boolean;
}

type LanguageInput = ProgrammingLanguageDefinition | SmartLanguageLike;

interface SmartLanguageLike {
  toString(): string;
  getSourceFnMatcher?: () => unknown;
  getSourceFilenameMatcher?: () => unknown;
  isExperimental?: () => boolean;
}

const languageRegistry = new Map<string, ProgrammingLanguageDefinition>();

export function registerLanguageDefinition(language: ProgrammingLanguageDefinition): void {
  const matcherFn = bindMatcher(language.matcher);
  languageRegistry.set(language.name, {
    name: language.name,
    matcher: {
      isRelevantFilename: matcherFn
    },
    experimental: language.experimental ?? false
  });
}

export function registerLanguageDefinitions(languages: Iterable<ProgrammingLanguageDefinition>): void {
  for (const language of languages) {
    registerLanguageDefinition(language);
  }
}

export function clearLanguageRegistry(): void {
  languageRegistry.clear();
}

export function getRegisteredLanguages(): ProgrammingLanguageDefinition[] {
  return Array.from(languageRegistry.values()).map((language) => ({
    name: language.name,
    matcher: bindMatcherObject(language.matcher),
    experimental: language.experimental ?? false
  }));
}

export function determineProgrammingLanguageComposition(
  repoPath: string,
  options?: DetermineLanguageOptions
): Record<string, number> {
  const files = findAllNonIgnoredFiles(repoPath);
  if (files.length === 0) {
    return {};
  }

  const includeExperimental = options?.includeExperimental ?? false;
  const languages = resolveLanguages(options?.languages, includeExperimental);

  if (!languages.length) {
    return {};
  }

  const totalFiles = files.length;
  const counts = new Map<string, number>();

  for (const language of languages) {
    let count = 0;
    for (const filePath of files) {
      const filename = path.basename(filePath);
      if (language.matcher.isRelevantFilename(filename)) {
        count += 1;
      }
    }

    if (count > 0) {
      counts.set(language.name, count);
    }
  }

  const result: Record<string, number> = {};
  for (const [name, count] of counts) {
    const percentage = (count / totalFiles) * 100;
    result[name] = Math.round(percentage * 100) / 100;
  }

  return result;
}

function resolveLanguages(
  explicit: Iterable<LanguageInput> | undefined,
  includeExperimental: boolean
): ProgrammingLanguageDefinition[] {
  const source = explicit ?? languageRegistry.values();
  const normalized = new Map<string, ProgrammingLanguageDefinition>();

  for (const item of source) {
    const definition = normalizeLanguageInput(item, includeExperimental);
    if (definition) {
      normalized.set(definition.name, definition);
    }
  }

  return Array.from(normalized.values());
}

function normalizeLanguageInput(
  input: LanguageInput,
  includeExperimental: boolean
): ProgrammingLanguageDefinition | undefined {
  if (isProgrammingLanguageDefinition(input)) {
    if (!includeExperimental && input.experimental) {
      return undefined;
    }

    const matcher = bindMatcher(input.matcher);
    return {
      name: input.name,
      matcher: {
        isRelevantFilename: matcher
      },
      experimental: input.experimental ?? false
    };
  }

  if (isSmartLanguageLike(input)) {
    const experimental = typeof input.isExperimental === 'function' ? input.isExperimental() : false;
    if (!includeExperimental && experimental) {
      return undefined;
    }

    const matcherCandidate =
      typeof input.getSourceFnMatcher === 'function'
        ? input.getSourceFnMatcher()
        : typeof input.getSourceFilenameMatcher === 'function'
          ? input.getSourceFilenameMatcher()
          : undefined;

    if (!matcherCandidate) {
      throw new TypeError('Language object does not expose a source filename matcher');
    }

    const matcher = bindMatcher(normalizeMatcher(matcherCandidate));

    return {
      name: String(input),
      matcher: {
        isRelevantFilename: matcher
      },
      experimental
    };
  }

  throw new TypeError('Unsupported language definition encountered');
}

function bindMatcherObject(matcher: FilenameMatcher): FilenameMatcher {
  const bound = bindMatcher(matcher);
  return {
    isRelevantFilename: bound
  };
}

function bindMatcher(matcher: FilenameMatcher): (filename: string) => boolean {
  if (typeof matcher.isRelevantFilename !== 'function') {
    return () => false;
  }

  return matcher.isRelevantFilename.bind(matcher);
}

function normalizeMatcher(candidate: unknown): FilenameMatcher {
  if (isFilenameMatcher(candidate)) {
    return candidate;
  }

  if (candidate && typeof candidate === 'object') {
    interface MatcherRecord {
      isRelevantFilename?: (filename: string) => boolean;
      is_relevant_filename?: (filename: string) => boolean;
    }

    const recordCandidate = candidate as MatcherRecord;

    const maybeCamel = recordCandidate.isRelevantFilename;
    if (typeof maybeCamel === 'function') {
      return {
        isRelevantFilename: maybeCamel.bind(candidate)
      };
    }

    const maybeSnake = recordCandidate.is_relevant_filename;
    if (typeof maybeSnake === 'function') {
      return {
        isRelevantFilename: maybeSnake.bind(candidate)
      };
    }
  }

  throw new TypeError('Unsupported filename matcher');
}

function isProgrammingLanguageDefinition(value: unknown): value is ProgrammingLanguageDefinition {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as ProgrammingLanguageDefinition;
  return (
    typeof candidate.name === 'string' &&
    typeof candidate.matcher === 'object' &&
    candidate.matcher !== null &&
    typeof candidate.matcher.isRelevantFilename === 'function'
  );
}

function isSmartLanguageLike(value: unknown): value is SmartLanguageLike {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as SmartLanguageLike;
  return (
    typeof candidate.toString === 'function' &&
    (typeof candidate.getSourceFnMatcher === 'function' || typeof candidate.getSourceFilenameMatcher === 'function')
  );
}

function isFilenameMatcher(value: unknown): value is FilenameMatcher {
  return !!value && typeof value === 'object' && typeof (value as FilenameMatcher).isRelevantFilename === 'function';
}
