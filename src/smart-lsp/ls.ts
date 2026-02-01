import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import ignore from 'ignore';

import { MatchedConsecutiveLines } from '../smart-edit/text_utils.js';
import { createSmartEditLogger, type LogLevel, type SmartEditLogger } from '../smart-edit/util/logging.js';
import { matchPath, type PathMatcher } from '../smart-edit/util/file_system.js';
import type { FilenameMatcherLike, Language } from './ls_config.js';
import { getLanguageFilenameMatcher } from './ls_config.js';

export interface LanguageServerConfig {
  codeLanguage: Language;
  traceLspCommunication?: boolean;
  startIndependentLspProcess?: boolean;
  ignoredPaths?: string[];
}

export interface LanguageServerConfigLike {
  codeLanguage: Language;
  traceLspCommunication?: boolean;
  startIndependentLspProcess?: boolean;
  ignoredPaths?: string[];
}

export interface SmartLspSettingsInit {
  smartLspDir?: string;
  projectDataRelativePath?: string;
  lsSpecificSettings?: Record<string, unknown>;
}

export class SmartLspSettings {
  readonly smartLspDir: string;
  readonly projectDataRelativePath: string;
  readonly lsSpecificSettings: Record<string, unknown>;

  constructor(init: SmartLspSettingsInit = {}) {
    this.smartLspDir = init.smartLspDir ?? path.join(path.resolve(process.env.HOME ?? '.'), '.smart-lsp');
    this.projectDataRelativePath = init.projectDataRelativePath ?? '.smart-lsp';
    this.lsSpecificSettings = { ...(init.lsSpecificSettings ?? {}) };

    fs.mkdirSync(this.smartLspDir, { recursive: true });
    fs.mkdirSync(this.languageServersStaticDir, { recursive: true });
  }

  get languageServersStaticDir(): string {
    return path.join(this.smartLspDir, 'language_servers', 'static');
  }
}

type LoggerLevelName = LogLevel | 'debug';

function logWithLevel(logger: SmartEditLogger, level: LoggerLevelName, message: string, meta?: unknown): void {
  switch (level) {
    case 'trace':
      logger.trace(message, meta);
      break;
    case 'debug':
      logger.debug(message, meta);
      break;
    case 'info':
      logger.info(message, meta);
      break;
    case 'warn':
      logger.warn(message, meta);
      break;
    case 'error':
      logger.error(message, meta);
      break;
    case 'fatal':
      logger.fatal(message, meta);
      break;
    default:
      logger.info(message, meta);
  }
}

export function coerceLogLevel(value: LogLevel | number | undefined): LogLevel {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    if (value <= 10) {
      return 'trace';
    }
    if (value <= 20) {
      return 'debug';
    }
    if (value <= 30) {
      return 'info';
    }
    if (value <= 40) {
      return 'warn';
    }
    if (value <= 50) {
      return 'error';
    }
    return 'fatal';
  }
  return 'info';
}

export interface LspRange {
  start?: { line?: number; character?: number | null } | null;
  end?: { line?: number; character?: number | null } | null;
}

export interface UnifiedSymbolInformation {
  name: string;
  kind: number;
  children?: UnifiedSymbolInformation[];
  location?: {
    relativePath?: string | null;
    range?: LspRange | null;
  } | null;
  parent?: UnifiedSymbolInformation | null;
  range?: LspRange | null;
  selectionRange?: LspRange | null;
  body?: string;
}

export interface ReferenceInSymbol {
  symbol: UnifiedSymbolInformation;
  line: number;
  character: number;
}

export interface DocumentSymbolsOptions {
  includeBody?: boolean;
}

export interface FullSymbolTreeOptions {
  withinRelativePath?: string;
  includeBody?: boolean;
}

export interface ReferencingSymbolsOptions {
  relativeFilePath: string;
  line: number;
  column: number;
  includeImports?: boolean;
  includeSelf?: boolean;
  includeBody?: boolean;
  includeFileSymbols?: boolean;
}

export interface DidOpenTextDocumentParams {
  textDocument: {
    uri: string;
    languageId: string;
    version: number;
    text: string;
  };
}

export interface DidChangeTextDocumentParams {
  textDocument: {
    uri: string;
    version: number;
  };
  contentChanges: {
    range: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
    text: string;
  }[];
}

export interface DidCloseTextDocumentParams {
  textDocument: {
    uri: string;
  };
}

export interface DocumentSymbolResult {
  documentSymbols: UnifiedSymbolInformation[];
  outlineSymbols: UnifiedSymbolInformation[];
}

export interface SmartLanguageServerNotifications {
  initialized(params: unknown): void;
  exit(): void;
  didOpenTextDocument(params: DidOpenTextDocumentParams): void;
  didChangeTextDocument(params: DidChangeTextDocumentParams): void;
  didCloseTextDocument(params: DidCloseTextDocumentParams): void;
}

export interface SmartLanguageServerRequests {
  documentSymbol(params: { textDocument: { uri: string }; options?: DocumentSymbolsOptions }): DocumentSymbolResult | null;
  fullSymbolTree(params: FullSymbolTreeOptions): UnifiedSymbolInformation[] | null;
  referencingSymbols(options: ReferencingSymbolsOptions): ReferenceInSymbol[] | null;
  overview(relativeFilePath: string): Record<string, UnifiedSymbolInformation[]> | null;
  shutdown(): void;
}

export interface SmartLanguageServerHandler {
  setRequestTimeout(timeout: number | null): void;
  isRunning(): boolean;
  start(): void;
  shutdown(): void;
  dispose(): void;
  readonly notify: SmartLanguageServerNotifications;
  readonly send: SmartLanguageServerRequests;
}

export interface SmartLanguageServerOptions {
  timeout?: number | null;
  smartLspSettings?: SmartLspSettingsInit;
  handler?: SmartLanguageServerHandler;
}

class NullLanguageServerHandler implements SmartLanguageServerHandler {
  private running = false;
  private timeout: number | null = null;

  setRequestTimeout(timeout: number | null): void {
    this.timeout = timeout ?? null;
  }

  isRunning(): boolean {
    return this.running;
  }

  start(): void {
    this.running = true;
  }

  shutdown(): void {
    this.running = false;
  }

  dispose(): void {
    this.timeout = null;
  }

  readonly notify: SmartLanguageServerNotifications = {
    initialized: (params: unknown) => {
      void params;
    },
    exit: () => {
      // no-op
    },
    didOpenTextDocument: (params: DidOpenTextDocumentParams) => {
      void params;
    },
    didChangeTextDocument: (params: DidChangeTextDocumentParams) => {
      void params;
    },
    didCloseTextDocument: (params: DidCloseTextDocumentParams) => {
      void params;
    }
  };

  readonly send: SmartLanguageServerRequests = {
    documentSymbol: () => null,
    fullSymbolTree: () => null,
    referencingSymbols: () => null,
    overview: () => ({}),
    shutdown: () => undefined
  };
}

interface DocumentSymbolCacheEntry {
  hash: string;
  data: DocumentSymbolResult;
}

class LspFileBuffer {
  readonly uri: string;
  contents: string;
  version: number;
  readonly languageId: string;
  refCount: number;
  contentHash: string;

  constructor(init: { uri: string; contents: string; version: number; languageId: string; refCount: number }) {
    this.uri = init.uri;
    this.contents = init.contents;
    this.version = init.version;
    this.languageId = init.languageId;
    this.refCount = init.refCount;
    this.contentHash = computeContentHash(this.contents);
  }

  updateContents(contents: string): void {
    this.contents = contents;
    this.contentHash = computeContentHash(contents);
  }
}

function computeContentHash(contents: string): string {
  return createHash('md5').update(contents, 'utf8').digest('hex');
}

function normalizeRelativePath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/');
  if (normalized.startsWith('./')) {
    return normalized.slice(2);
  }
  if (normalized.startsWith('../')) {
    return normalized.replace(/^\\.\\./u, '..');
  }
  return normalized;
}

function getIndexFromLineCol(text: string, line: number, col: number): number {
  let currentLine = 0;
  let currentCol = 0;

  for (let index = 0; index < text.length; index += 1) {
    if (currentLine === line && currentCol === col) {
      return index;
    }

    const char = text[index];
    if (char === '\n') {
      currentLine += 1;
      currentCol = 0;
    } else if (char === '\r') {
      continue;
    } else {
      currentCol += 1;
    }
  }

  if (currentLine === line && currentCol === col) {
    return text.length;
  }

  throw new RangeError(`Position (${line}, ${col}) is out of bounds.`);
}

function insertTextAtPosition(text: string, line: number, col: number, snippet: string): {
  contents: string;
  line: number;
  column: number;
} {
  const index = getIndexFromLineCol(text, line, col);
  const updated = `${text.slice(0, index)}${snippet}${text.slice(index)}`;

  const lines = snippet.split('\n');
  if (lines.length === 1) {
    return { contents: updated, line, column: col + snippet.length };
  }

  const newLine = line + lines.length - 1;
  const newColumn = lines[lines.length - 1].length;
  return { contents: updated, line: newLine, column: newColumn };
}

function deleteTextBetweenPositions(
  text: string,
  start: { line: number; character: number },
  end: { line: number; character: number }
): { contents: string; deleted: string } {
  const startIndex = getIndexFromLineCol(text, start.line, start.character);
  const endIndex = getIndexFromLineCol(text, end.line, end.character);
  if (endIndex < startIndex) {
    throw new RangeError('End position must not precede start position.');
  }

  const deleted = text.slice(startIndex, endIndex);
  const updated = `${text.slice(0, startIndex)}${text.slice(endIndex)}`;
  return { contents: updated, deleted };
}

export type SmartLanguageServerConstructor = new (
  config: LanguageServerConfigLike,
  loggerLike: { level?: LogLevel | number } | null,
  repositoryRootPath: string,
  options?: SmartLanguageServerOptions
) => SmartLanguageServer;

export class SmartLanguageServer {
  static readonly CACHE_FOLDER_NAME = 'cache';

  protected readonly repositoryRootPath: string;
  protected readonly logger: SmartEditLogger;
  protected readonly language: Language;
  private readonly languageMatcher: FilenameMatcherLike;
  private readonly ignoreMatcher: PathMatcher;
  protected readonly handler: SmartLanguageServerHandler;
  protected readonly smartLspSettings: SmartLspSettings;
  private readonly documentSymbolsCache = new Map<string, DocumentSymbolCacheEntry>();

  private serverStarted = false;
  private cacheHasChanged = false;
  private readonly openFileBuffers = new Map<string, LspFileBuffer>();

  constructor(
    config: LanguageServerConfigLike,
    loggerLike: { level?: LogLevel | number } | null,
    repositoryRootPath: string,
    options: SmartLanguageServerOptions = {}
  ) {
    this.repositoryRootPath = path.resolve(repositoryRootPath);
    this.language = config.codeLanguage;
    this.languageMatcher = getLanguageFilenameMatcher(this.language);

    const ignoredPatterns = Array.from(new Set(config.ignoredPaths ?? [])).map((pattern) => pattern.replace(/\\/g, '/'));
    const ignoreInstance = ignore();
    if (ignoredPatterns.length > 0) {
      ignoreInstance.add(ignoredPatterns);
    }
    this.ignoreMatcher = {
      ignores(candidate: string): boolean {
        const normalizedCandidate = candidate.replace(/^\/+/, '');
        return ignoreInstance.ignores(normalizedCandidate);
      }
    };

    const { logger } = createSmartEditLogger({
      level: coerceLogLevel(loggerLike?.level),
      emitToConsole: false,
      name: 'smart-lsp.language_server'
    });
    this.logger = logger;

    this.handler = options.handler ?? new NullLanguageServerHandler();
    if (options.timeout !== undefined) {
      this.handler.setRequestTimeout(options.timeout ?? null);
    }

    this.smartLspSettings = new SmartLspSettings(options.smartLspSettings);

    this.loadCache();
  }

  static create(
    config: LanguageServerConfigLike,
    loggerLike: { level?: LogLevel | number } | null,
    repositoryRootPath: string,
    options: SmartLanguageServerOptions = {}
  ): SmartLanguageServer {
    const Ctor = getLanguageServerConstructor(config.codeLanguage);
    return new Ctor(config, loggerLike, repositoryRootPath, options);
  }

  start(): this {
    if (this.serverStarted) {
      return this;
    }
    logWithLevel(this.logger, 'info', `Starting SmartLanguageServer for ${this.repositoryRootPath}`);
    this.handler.start();
    this.serverStarted = true;
    return this;
  }

  stop(shutdownTimeout = 2.0): void {
    if (!this.serverStarted) {
      return;
    }

    logWithLevel(this.logger, 'debug', `Stopping SmartLanguageServer (timeout=${shutdownTimeout}s)`);

    for (const buffer of this.openFileBuffers.values()) {
      this.handler.notify.didCloseTextDocument({
        textDocument: { uri: buffer.uri }
      });
    }
    this.openFileBuffers.clear();

    this.handler.shutdown();
    this.handler.dispose();
    this.serverStarted = false;
  }

  isRunning(): boolean {
    return this.handler.isRunning();
  }

  setRequestTimeout(timeout: number | null): void {
    this.handler.setRequestTimeout(timeout);
  }

  getRepositoryRootPath(): string {
    return this.repositoryRootPath;
  }

  get ignoreSpec(): PathMatcher {
    return this.ignoreMatcher;
  }

  saveCache(): void {
    if (!this.cacheHasChanged) {
      return;
    }

    const cachePath = this.cachePath;
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });

    const payload: Record<string, DocumentSymbolCacheEntry> = {};
    for (const [relativePath, entry] of this.documentSymbolsCache.entries()) {
      payload[relativePath] = {
        hash: entry.hash,
        data: {
          documentSymbols: entry.data.documentSymbols,
          outlineSymbols: entry.data.outlineSymbols
        }
      };
    }

    fs.writeFileSync(cachePath, JSON.stringify(payload, null, 2), { encoding: 'utf-8' });
    this.cacheHasChanged = false;
  }

  requestDocumentSymbols(relativePath: string, options: DocumentSymbolsOptions = {}): DocumentSymbolResult {
    this.ensureServerRunning('requestDocumentSymbols');

    return this.withOpenFile(relativePath, (buffer) => {
      const cached = this.documentSymbolsCache.get(relativePath);
      if (cached && cached.hash === buffer.contentHash) {
        return {
          documentSymbols: cloneSymbols(cached.data.documentSymbols),
          outlineSymbols: cloneSymbols(cached.data.outlineSymbols)
        };
      }

      const response = this.handler.send.documentSymbol({
        textDocument: { uri: buffer.uri },
        options
      });

      const result: DocumentSymbolResult = response ?? {
        documentSymbols: [],
        outlineSymbols: []
      };

      this.documentSymbolsCache.set(relativePath, {
        hash: buffer.contentHash,
        data: {
          documentSymbols: cloneSymbols(result.documentSymbols),
          outlineSymbols: cloneSymbols(result.outlineSymbols)
        }
      });
      this.cacheHasChanged = true;

      return result;
    });
  }

  requestFullSymbolTree(options: FullSymbolTreeOptions = {}): UnifiedSymbolInformation[] {
    this.ensureServerRunning('requestFullSymbolTree');
    const response = this.handler.send.fullSymbolTree(options);
    return response ? cloneSymbols(response) : [];
  }

  requestReferencingSymbols(options: ReferencingSymbolsOptions): ReferenceInSymbol[] {
    this.ensureServerRunning('requestReferencingSymbols');
    const response = this.handler.send.referencingSymbols(options);
    return response ? response.map((entry) => ({ ...entry, symbol: cloneSymbol(entry.symbol) })) : [];
  }

  requestOverview(relativePath: string): Record<string, UnifiedSymbolInformation[]> {
    this.ensureServerRunning('requestOverview');
    const response = this.handler.send.overview(relativePath) ?? {};
    const clone: Record<string, UnifiedSymbolInformation[]> = {};
    for (const [key, symbols] of Object.entries(response)) {
      clone[key] = cloneSymbols(symbols);
    }
    return clone;
  }

  retrieveFullFileContent(relativePath: string): string {
    return this.withOpenFile(relativePath, (buffer) => buffer.contents);
  }

  retrieveContentAroundLine(
    relativePath: string,
    line: number,
    contextLinesBefore = 0,
    contextLinesAfter = 0
  ): MatchedConsecutiveLines {
    const contents = this.retrieveFullFileContent(relativePath);
    return MatchedConsecutiveLines.fromFileContents({
      fileContents: contents,
      line,
      contextLinesBefore,
      contextLinesAfter,
      sourceFilePath: relativePath
    });
  }

  insertTextAtPosition(relativePath: string, line: number, column: number, text: string): {
    line: number;
    column: number;
  } {
    this.ensureServerRunning('insertTextAtPosition');

    return this.withOpenFile(relativePath, (buffer) => {
      const result = insertTextAtPosition(buffer.contents, line, column, text);
      buffer.updateContents(result.contents);
      buffer.version += 1;

      this.handler.notify.didChangeTextDocument({
        textDocument: { uri: buffer.uri, version: buffer.version },
        contentChanges: [
          {
            range: {
              start: { line, character: column },
              end: { line, character: column }
            },
            text
          }
        ]
      });

      return { line: result.line, column: result.column };
    });
  }

  deleteTextBetweenPositions(
    relativePath: string,
    start: { line: number; character: number },
    end: { line: number; character: number }
  ): string {
    this.ensureServerRunning('deleteTextBetweenPositions');

    return this.withOpenFile(relativePath, (buffer) => {
      const { contents, deleted } = deleteTextBetweenPositions(buffer.contents, start, end);
      buffer.updateContents(contents);
      buffer.version += 1;

      this.handler.notify.didChangeTextDocument({
        textDocument: { uri: buffer.uri, version: buffer.version },
        contentChanges: [
          {
            range: {
              start,
              end
            },
            text: ''
          }
        ]
      });

      return deleted;
    });
  }

  isIgnoredPath(relativePath: string, ignoreUnsupportedFiles = true): boolean {
    const normalized = normalizeRelativePath(relativePath);
    const absolutePath = path.resolve(this.repositoryRootPath, normalized);

    if (!fs.existsSync(absolutePath)) {
      throw new Error(`File ${absolutePath} not found, the ignore check cannot be performed`);
    }

    const stats = fs.statSync(absolutePath);
    if (stats.isFile() && ignoreUnsupportedFiles) {
      if (!this.languageMatcher.isRelevantFilename(path.basename(absolutePath))) {
        return true;
      }
    }

    return matchPath(normalized, this.ignoreMatcher, this.repositoryRootPath);
  }

  private ensureServerRunning(operation: string): void {
    if (!this.serverStarted) {
      throw new Error(`Language server is not started; cannot call ${operation}`);
    }
  }

  private withOpenFile<T>(relativePath: string, handler: (buffer: LspFileBuffer) => T): T {
    const buffer = this.acquireFileBuffer(relativePath);
    try {
      return handler(buffer);
    } finally {
      this.releaseFileBuffer(buffer.uri);
    }
  }

  private acquireFileBuffer(relativePath: string): LspFileBuffer {
    const normalized = normalizeRelativePath(relativePath);
    const absolutePath = path.resolve(this.repositoryRootPath, normalized);
    const uri = pathToFileURL(absolutePath).href;

    const existing = this.openFileBuffers.get(uri);
    if (existing) {
      existing.refCount += 1;
      return existing;
    }

    const contents = fs.readFileSync(absolutePath, { encoding: 'utf-8' });
    const buffer = new LspFileBuffer({ uri, contents, version: 0, languageId: this.language, refCount: 1 });
    this.openFileBuffers.set(uri, buffer);

    this.handler.notify.didOpenTextDocument({
      textDocument: {
        uri,
        languageId: this.language,
        version: buffer.version,
        text: contents
      }
    });

    return buffer;
  }

  private releaseFileBuffer(uri: string): void {
    const buffer = this.openFileBuffers.get(uri);
    if (!buffer) {
      return;
    }

    buffer.refCount -= 1;
    if (buffer.refCount <= 0) {
      this.handler.notify.didCloseTextDocument({
        textDocument: { uri }
      });
      this.openFileBuffers.delete(uri);
    }
  }

  private loadCache(): void {
    const cachePath = this.cachePath;
    if (!fs.existsSync(cachePath)) {
      return;
    }

    try {
      const contents = fs.readFileSync(cachePath, 'utf-8');
      const parsed = JSON.parse(contents) as Record<string, DocumentSymbolCacheEntry>;
      for (const [relativePath, entry] of Object.entries(parsed)) {
        this.documentSymbolsCache.set(relativePath, {
          hash: entry.hash,
          data: {
            documentSymbols: cloneSymbols(entry.data.documentSymbols),
            outlineSymbols: cloneSymbols(entry.data.outlineSymbols)
          }
        });
      }
    } catch (error) {
      logWithLevel(this.logger, 'warn', `Failed to load SmartLSP cache from ${cachePath}`, error);
    }
  }

  private get cachePath(): string {
    return path.join(
      this.repositoryRootPath,
      this.smartLspSettings.projectDataRelativePath,
      SmartLanguageServer.CACHE_FOLDER_NAME,
      this.language,
      'document_symbols_cache.json'
    );
  }
}

const LANGUAGE_SERVER_REGISTRY = new Map<Language, SmartLanguageServerConstructor>();

export function registerLanguageServer(language: Language, ctor: SmartLanguageServerConstructor): void {
  LANGUAGE_SERVER_REGISTRY.set(language, ctor);
}

function getLanguageServerConstructor(language: Language): SmartLanguageServerConstructor {
  return LANGUAGE_SERVER_REGISTRY.get(language) ?? SmartLanguageServer;
}

function deepClone<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;
}

function cloneSymbol(symbol: UnifiedSymbolInformation): UnifiedSymbolInformation {
  return {
    ...symbol,
    children: symbol.children ? cloneSymbols(symbol.children) : undefined,
    parent: symbol.parent ?? undefined,
    location: symbol.location ? deepClone(symbol.location) : undefined,
    selectionRange: symbol.selectionRange ? deepClone(symbol.selectionRange) : undefined
  };
}

function cloneSymbols(symbols: UnifiedSymbolInformation[]): UnifiedSymbolInformation[] {
  return symbols.map((symbol) => cloneSymbol(symbol));
}
