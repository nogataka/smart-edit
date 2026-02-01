import path from 'node:path';

import { createSmartEditLogger } from './util/logging.js';
import type { SmartEditAgent } from './agent.js';
import type { SmartLanguageServer, ReferenceInSymbol, UnifiedSymbolInformation } from '../smart-lsp/ls.js';

const { logger } = createSmartEditLogger({ name: 'smart-edit.symbol', emitToConsole: false, level: 'info' });

export interface LspPosition {
  line: number;
  character: number;
}

export enum SymbolKind {
  File = 1,
  Module = 2,
  Namespace = 3,
  Package = 4,
  Class = 5,
  Method = 6,
  Property = 7,
  Field = 8,
  Constructor = 9,
  Enum = 10,
  Interface = 11,
  Function = 12,
  Variable = 13,
  Constant = 14,
  String = 15,
  Number = 16,
  Boolean = 17,
  Array = 18,
  Object = 19,
  Key = 20,
  Null = 21,
  EnumMember = 22,
  Struct = 23,
  Event = 24,
  Operator = 25,
  TypeParameter = 26
}

export interface LanguageServerSymbolLocationInit {
  relativePath: string | null;
  line: number | null;
  column: number | null;
}

export class LanguageServerSymbolLocation {
  readonly relativePath: string | null;
  readonly line: number | null;
  readonly column: number | null;

  constructor(init: LanguageServerSymbolLocationInit) {
    this.relativePath = init.relativePath ? init.relativePath.replace(/\//g, path.sep) : null;
    this.line = init.line ?? null;
    this.column = init.column ?? null;
  }

  toDict(options: { includeRelativePath?: boolean } = {}): Record<string, unknown> {
    const includeRelativePath = options.includeRelativePath ?? true;
    const payload: Record<string, unknown> = {
      relative_path: includeRelativePath ? this.relativePath : undefined,
      line: this.line,
      column: this.column
    };
    if (!includeRelativePath) {
      delete payload.relative_path;
    }
    return payload;
  }

  to_dict(options?: { include_relative_path?: boolean }): Record<string, unknown> {
    return this.toDict({ includeRelativePath: options?.include_relative_path });
  }

  hasPositionInFile(): boolean {
    return this.relativePath !== null && this.line !== null && this.column !== null;
  }

  has_position_in_file(): boolean {
    return this.hasPositionInFile();
  }
}

export interface PositionInFileInit {
  line: number;
  col: number;
}

export class PositionInFile {
  readonly line: number;
  readonly col: number;

  constructor(init: PositionInFileInit) {
    this.line = init.line;
    this.col = init.col;
  }

  toLspPosition(): LspPosition {
    return { line: this.line, character: this.col };
  }

  to_lsp_position(): LspPosition {
    return this.toLspPosition();
  }
}

export abstract class Symbol {
  abstract getBodyStartPosition(): PositionInFile | null;

  abstract getBodyEndPosition(): PositionInFile | null;

  abstract isNeighbouringDefinitionSeparatedByEmptyLine(): boolean;

  getBodyStartPositionOrRaise(): PositionInFile {
    const position = this.getBodyStartPosition();
    if (!position) {
      throw new Error(`Body start position is not defined for ${this.constructor.name}`);
    }
    return position;
  }

  getBodyEndPositionOrRaise(): PositionInFile {
    const position = this.getBodyEndPosition();
    if (!position) {
      throw new Error(`Body end position is not defined for ${this.constructor.name}`);
    }
    return position;
  }

  get_body_start_position(): PositionInFile | null {
    return this.getBodyStartPosition();
  }

  get_body_end_position(): PositionInFile | null {
    return this.getBodyEndPosition();
  }

  get_body_start_position_or_raise(): PositionInFile {
    return this.getBodyStartPositionOrRaise();
  }

  get_body_end_position_or_raise(): PositionInFile {
    return this.getBodyEndPositionOrRaise();
  }

  is_neighbouring_definition_separated_by_empty_line(): boolean {
    return this.isNeighbouringDefinitionSeparatedByEmptyLine();
  }
}

function normalizeRelativePath(candidate: string | null | undefined): string | null {
  if (candidate === null || candidate === undefined) {
    return null;
  }
  return candidate.replace(/\//g, path.sep);
}

export interface SymbolRangeLike {
  start?: { line: number; character: number };
  end?: { line: number; character: number };
}

export interface SymbolLocationLike {
  relativePath?: string | null;
  range?: SymbolRangeLike;
}

function resolveSymbolLocation(raw: UnifiedSymbolInformation): SymbolLocationLike | null {
  if (raw.location && typeof raw.location === 'object') {
    return raw.location as SymbolLocationLike;
  }
  return null;
}

function resolveSelectionRange(raw: UnifiedSymbolInformation): SymbolRangeLike | null {
  if (raw.selectionRange && typeof raw.selectionRange === 'object') {
    return raw.selectionRange as SymbolRangeLike;
  }
  return null;
}

export class LanguageServerSymbol extends Symbol {
  private static readonly NAME_PATH_SEPARATOR = '/';

  private readonly symbolRoot: UnifiedSymbolInformation;

  constructor(symbolRoot: UnifiedSymbolInformation) {
    super();
    this.symbolRoot = symbolRoot;
  }

  static matchNamePath(namePath: string, symbolNamePathParts: string[], substringMatching: boolean): boolean {
    if (!namePath) {
      throw new Error('name_path must not be empty');
    }
    if (!symbolNamePathParts || symbolNamePathParts.length === 0) {
      throw new Error('symbol_name_path_parts must not be empty');
    }

    const sep = LanguageServerSymbol.NAME_PATH_SEPARATOR;
    const isAbsolutePattern = namePath.startsWith(sep);
    const patternParts = namePath
      .replace(/^\/*/u, '')
      .replace(/\/*$/u, '')
      .split(sep)
      .filter((part) => part.length > 0);

    if (patternParts.length === 0) {
      return true;
    }

    if (patternParts.length > symbolNamePathParts.length) {
      return false;
    }

    if (isAbsolutePattern && patternParts.length !== symbolNamePathParts.length) {
      return false;
    }

    const expectedAncestors = patternParts.slice(0, -1);
    const candidateAncestors = symbolNamePathParts.slice(-patternParts.length, -1);
    if (expectedAncestors.length > 0 && expectedAncestors.join('\u0000') !== candidateAncestors.join('\u0000')) {
      return false;
    }

    const needle = patternParts[patternParts.length - 1] ?? '';
    const haystack = symbolNamePathParts[symbolNamePathParts.length - 1] ?? '';
    return substringMatching ? haystack.includes(needle) : haystack === needle;
  }

  get name(): string {
    return this.symbolRoot.name ?? '';
  }

  get kind(): string {
    return SymbolKind[this.symbolKind] ?? 'Unknown';
  }

  get symbolKind(): SymbolKind {
    const rawKind = this.symbolRoot.kind;
    if (typeof rawKind === 'number' && rawKind in SymbolKind) {
      return rawKind as SymbolKind;
    }
    return SymbolKind.Object;
  }

  get relativePath(): string | null {
    const location = resolveSymbolLocation(this.symbolRoot);
    if (!location) {
      return null;
    }
    return normalizeRelativePath(location.relativePath ?? null);
  }

  get location(): LanguageServerSymbolLocation {
    return new LanguageServerSymbolLocation({
      relativePath: this.relativePath,
      line: this.line,
      column: this.column
    });
  }

  get body(): string | undefined {
    const body = this.symbolRoot.body;
    return typeof body === 'string' ? body : undefined;
  }

  get line(): number | null {
    const selection = resolveSelectionRange(this.symbolRoot);
    if (selection?.start?.line !== undefined) {
      return selection.start.line;
    }
    return null;
  }

  get column(): number | null {
    const selection = resolveSelectionRange(this.symbolRoot);
    if (selection?.start?.character !== undefined) {
      return selection.start.character;
    }
    return null;
  }

  override isNeighbouringDefinitionSeparatedByEmptyLine(): boolean {
    return (
      this.symbolKind === SymbolKind.Function ||
      this.symbolKind === SymbolKind.Method ||
      this.symbolKind === SymbolKind.Class ||
      this.symbolKind === SymbolKind.Interface ||
      this.symbolKind === SymbolKind.Struct
    );
  }

  override getBodyStartPosition(): PositionInFile | null {
    const location = resolveSymbolLocation(this.symbolRoot);
    const start = location?.range?.start;
    if (!start) {
      return null;
    }
    return new PositionInFile({ line: start.line ?? 0, col: start.character ?? 0 });
  }

  override getBodyEndPosition(): PositionInFile | null {
    const location = resolveSymbolLocation(this.symbolRoot);
    const end = location?.range?.end;
    if (!end) {
      return null;
    }
    return new PositionInFile({ line: end.line ?? 0, col: end.character ?? 0 });
  }

  getBodyLineNumbers(): [number | null, number | null] {
    const range = resolveSymbolLocation(this.symbolRoot)?.range;
    const startLine = range?.start?.line ?? null;
    const endLine = range?.end?.line ?? null;
    return [startLine, endLine];
  }

  override getBodyStartPositionOrRaise(): PositionInFile {
    return super.getBodyStartPositionOrRaise();
  }

  override getBodyEndPositionOrRaise(): PositionInFile {
    return super.getBodyEndPositionOrRaise();
  }

  get_name_path(): string {
    return this.getNamePath();
  }

  getNamePath(): string {
    return this.getNamePathParts().join(LanguageServerSymbol.NAME_PATH_SEPARATOR);
  }

  getNamePathParts(): string[] {
    const ancestors = Array.from(this.iterAncestors(SymbolKind.File)).reverse();
    const ancestorNames = ancestors.map((ancestor) => ancestor.name);
    return [...ancestorNames, this.name];
  }

  get_name_path_parts(): string[] {
    return this.getNamePathParts();
  }

  *iterChildren(): IterableIterator<LanguageServerSymbol> {
    const children = Array.isArray(this.symbolRoot.children) ? this.symbolRoot.children : [];
    for (const child of children) {
      if (child) {
        yield new LanguageServerSymbol(child);
      }
    }
  }

  iter_children(): IterableIterator<LanguageServerSymbol> {
    return this.iterChildren();
  }

  *iterAncestors(upToSymbolKind?: SymbolKind): IterableIterator<LanguageServerSymbol> {
    const parent = this.getParent();
    if (!parent) {
      return;
    }
    if (upToSymbolKind === undefined || parent.symbolKind !== upToSymbolKind) {
      yield parent;
      yield* parent.iterAncestors(upToSymbolKind);
    }
  }

  iter_ancestors(upToSymbolKind?: SymbolKind): IterableIterator<LanguageServerSymbol> {
    return this.iterAncestors(upToSymbolKind);
  }

  getParent(): LanguageServerSymbol | null {
    const parent = this.symbolRoot.parent;
    if (!parent) {
      return null;
    }
    return new LanguageServerSymbol(parent);
  }

  get_parent(): LanguageServerSymbol | null {
    return this.getParent();
  }

  find(
    namePath: string,
    options: {
      substringMatching?: boolean;
      includeKinds?: SymbolKind[] | number[];
      excludeKinds?: SymbolKind[] | number[];
    } = {}
  ): LanguageServerSymbol[] {
    const {
      substringMatching = false,
      includeKinds,
      excludeKinds
    } = options;

    const include = includeKinds ? new Set(includeKinds.map((kind) => Number(kind))) : null;
    const exclude = excludeKinds ? new Set(excludeKinds.map((kind) => Number(kind))) : null;

    const result: LanguageServerSymbol[] = [];

    const shouldInclude = (symbol: LanguageServerSymbol): boolean => {
      if (include?.has(symbol.symbolKind) === false) {
        return false;
      }
      if (exclude?.has(symbol.symbolKind)) {
        return false;
      }
      return LanguageServerSymbol.matchNamePath(namePath, symbol.getNamePathParts(), substringMatching);
    };

    const traverse = (symbol: LanguageServerSymbol): void => {
      if (shouldInclude(symbol)) {
        result.push(symbol);
      }
      for (const child of symbol.iterChildren()) {
        traverse(child);
      }
    };

    traverse(this);
    return result;
  }

  find_symbols(
    namePath: string,
    substringMatching = false,
    includeKinds?: SymbolKind[] | number[],
    excludeKinds?: SymbolKind[] | number[]
  ): LanguageServerSymbol[] {
    return this.find(namePath, { substringMatching, includeKinds, excludeKinds });
  }

  toDict(options: {
    kind?: boolean;
    location?: boolean;
    depth?: number;
    includeBody?: boolean;
    includeChildrenBody?: boolean;
    includeRelativePath?: boolean;
  } = {}): Record<string, unknown> {
    const {
      kind = false,
      location = false,
      depth = 0,
      includeBody = false,
      includeChildrenBody = false,
      includeRelativePath = true
    } = options;

    const result: Record<string, unknown> = {
      name: this.name,
      name_path: this.getNamePath()
    };

    if (kind) {
      result.kind = this.kind;
    }

    if (location) {
      result.location = this.location.toDict({ includeRelativePath });
      const [startLine, endLine] = this.getBodyLineNumbers();
      result.body_location = { start_line: startLine, end_line: endLine };
    }

    if (includeBody) {
      if (this.body === undefined) {
        logger.warn(
          `Requested body for symbol ${this.name}, but it is not present. The symbol might have been loaded without include_body.`
        );
      }
      result.body = this.body ?? null;
    }

    if (depth > 0) {
      result.children = this.collectChildren({
        depth,
        includeBody: includeChildrenBody,
        includeLocation: location,
        includeKind: kind
      });
    }

    return result;
  }

  to_dict(options?: {
    kind?: boolean;
    location?: boolean;
    depth?: number;
    include_body?: boolean;
    include_children_body?: boolean;
    include_relative_path?: boolean;
  }): Record<string, unknown> {
    return this.toDict({
      kind: options?.kind,
      location: options?.location,
      depth: options?.depth,
      includeBody: options?.include_body,
      includeChildrenBody: options?.include_children_body,
      includeRelativePath: options?.include_relative_path
    });
  }

  private collectChildren(options: {
    depth: number;
    includeBody: boolean;
    includeLocation: boolean;
    includeKind: boolean;
  }): Record<string, unknown>[] {
    const { depth, includeBody, includeLocation, includeKind } = options;

    const result: Record<string, unknown>[] = [];
    if (depth <= 0) {
      return result;
    }

    for (const child of this.iterChildren()) {
      result.push(
        child.toDict({
          kind: includeKind,
          location: includeLocation,
          depth: depth - 1,
          includeBody,
          includeChildrenBody: includeBody,
          includeRelativePath: false
        })
      );
    }

    return result;
  }
}

export class ReferenceInLanguageServerSymbol {
  readonly symbol: LanguageServerSymbol;
  readonly line: number;
  readonly character: number;

  constructor(init: { symbol: LanguageServerSymbol; line: number; character: number }) {
    this.symbol = init.symbol;
    this.line = init.line;
    this.character = init.character;
  }

  static fromLspReference(reference: ReferenceInSymbol): ReferenceInLanguageServerSymbol {
    return new ReferenceInLanguageServerSymbol({
      symbol: new LanguageServerSymbol(reference.symbol),
      line: reference.line,
      character: reference.character
    });
  }

  get_relative_path(): string | null {
    return this.symbol.location.relativePath;
  }
}

export interface SymbolOverviewEntry {
  name_path: string;
  kind: number;
}

export interface FindSymbolOptions {
  includeBody?: boolean;
  includeKinds?: number[] | SymbolKind[];
  excludeKinds?: number[] | SymbolKind[];
  substringMatching?: boolean;
  withinRelativePath?: string | null;
}

function toNumberKindSet(values?: number[] | SymbolKind[]): Set<number> | null {
  if (!values || values.length === 0) {
    return null;
  }
  return new Set(values.map((value) => Number(value)));
}

export class LanguageServerSymbolRetriever {
  private _langServer: SmartLanguageServer;
  private readonly agent: SmartEditAgent | null;

  constructor(langServer: SmartLanguageServer, agent: SmartEditAgent | null = null) {
    this._langServer = langServer;
    this.agent = agent;
  }

  setLanguageServer(langServer: SmartLanguageServer): void {
    this._langServer = langServer;
  }

  set_language_server(langServer: SmartLanguageServer): void {
    this.setLanguageServer(langServer);
  }

  getLanguageServer(): SmartLanguageServer {
    return this._langServer;
  }

  get_language_server(): SmartLanguageServer {
    return this.getLanguageServer();
  }

  findByName(namePath: string, options: FindSymbolOptions = {}): LanguageServerSymbol[] {
    const {
      includeBody = false,
      includeKinds,
      excludeKinds,
      substringMatching = false,
      withinRelativePath
    } = options;

    const symbolRoots = this._langServer.requestFullSymbolTree({
      withinRelativePath: withinRelativePath ?? undefined,
      includeBody
    });

    const includeSet = toNumberKindSet(includeKinds);
    const excludeSet = toNumberKindSet(excludeKinds);

    const matches: LanguageServerSymbol[] = [];
    for (const root of symbolRoots) {
      const symbol = new LanguageServerSymbol(root);
      const found = symbol.find(namePath, {
        includeKinds: includeSet ? Array.from(includeSet) : undefined,
        excludeKinds: excludeSet ? Array.from(excludeSet) : undefined,
        substringMatching
      });
      matches.push(...found);
    }
    return matches;
  }

  find_by_name(
    namePath: string,
    includeBody = false,
    includeKinds?: number[] | SymbolKind[],
    excludeKinds?: number[] | SymbolKind[],
    substringMatching = false,
    withinRelativePath?: string | null
  ): LanguageServerSymbol[] {
    return this.findByName(namePath, {
      includeBody,
      includeKinds,
      excludeKinds,
      substringMatching,
      withinRelativePath
    });
  }

  getDocumentSymbols(relativePath: string): LanguageServerSymbol[] {
    const result = this._langServer.requestDocumentSymbols(relativePath, { includeBody: false });
    return result.documentSymbols.map((entry) => new LanguageServerSymbol(entry));
  }

  get_document_symbols(relativePath: string): LanguageServerSymbol[] {
    return this.getDocumentSymbols(relativePath);
  }

  findByLocation(location: LanguageServerSymbolLocation): LanguageServerSymbol | null {
    if (!location.relativePath) {
      return null;
    }
    const result = this._langServer.requestDocumentSymbols(location.relativePath, { includeBody: false });
    for (const symbolDict of result.documentSymbols) {
      const symbol = new LanguageServerSymbol(symbolDict);
      if (symbol.location.relativePath === location.relativePath && symbol.line === location.line) {
        return symbol;
      }
    }
    return null;
  }

  find_by_location(location: LanguageServerSymbolLocation): LanguageServerSymbol | null {
    return this.findByLocation(location);
  }

  findReferencingSymbols(
    namePath: string,
    relativeFilePath: string,
    options: FindSymbolOptions = {}
  ): ReferenceInLanguageServerSymbol[] {
    const {
      includeBody = false,
      includeKinds,
      excludeKinds
    } = options;

    const matches = this.findByName(namePath, {
      includeBody,
      includeKinds,
      excludeKinds,
      withinRelativePath: relativeFilePath
    });

    if (matches.length === 0) {
      return [];
    }

    const target = matches[0];
    const references = this._langServer.requestReferencingSymbols({
      relativeFilePath,
      line: target.line ?? 0,
      column: target.column ?? 0,
      includeBody,
      includeImports: false,
      includeSelf: false,
      includeFileSymbols: true
    });

    const includeSet = toNumberKindSet(includeKinds);
    const excludeSet = toNumberKindSet(excludeKinds);

    return references
      .filter((reference) => {
        const symbol = new LanguageServerSymbol(reference.symbol);
        if (includeSet?.has(symbol.symbolKind) === false) {
          return false;
        }
        if (excludeSet?.has(symbol.symbolKind)) {
          return false;
        }
        return true;
      })
      .map((reference) => ReferenceInLanguageServerSymbol.fromLspReference(reference));
  }

  find_referencing_symbols(
    namePath: string,
    relativeFilePath: string,
    includeBody = false,
    includeKinds?: number[] | SymbolKind[],
    excludeKinds?: number[] | SymbolKind[]
  ): ReferenceInLanguageServerSymbol[] {
    return this.findReferencingSymbols(namePath, relativeFilePath, {
      includeBody,
      includeKinds,
      excludeKinds
    });
  }

  findReferencingSymbolsByLocation(
    location: LanguageServerSymbolLocation,
    options: FindSymbolOptions = {}
  ): ReferenceInLanguageServerSymbol[] {
    if (!location.hasPositionInFile()) {
      throw new Error('Symbol location does not contain a valid position in a file.');
    }
    const references = this._langServer.requestReferencingSymbols({
      relativeFilePath: location.relativePath ?? '',
      line: location.line ?? 0,
      column: location.column ?? 0,
      includeBody: options.includeBody ?? false,
      includeImports: false,
      includeSelf: false,
      includeFileSymbols: true
    });

    const includeSet = toNumberKindSet(options.includeKinds);
    const excludeSet = toNumberKindSet(options.excludeKinds);

    return references
      .filter((reference) => {
        const symbol = new LanguageServerSymbol(reference.symbol);
        if (includeSet?.has(symbol.symbolKind) === false) {
          return false;
        }
        if (excludeSet?.has(symbol.symbolKind)) {
          return false;
        }
        return true;
      })
      .map((reference) => ReferenceInLanguageServerSymbol.fromLspReference(reference));
  }

  find_referencing_symbols_by_location(
    location: LanguageServerSymbolLocation,
    includeBody = false,
    includeKinds?: number[] | SymbolKind[],
    excludeKinds?: number[] | SymbolKind[]
  ): ReferenceInLanguageServerSymbol[] {
    return this.findReferencingSymbolsByLocation(location, {
      includeBody,
      includeKinds,
      excludeKinds
    });
  }

  private static symbolOverviewFromSymbol(symbol: LanguageServerSymbol): SymbolOverviewEntry {
    return {
      name_path: symbol.getNamePath(),
      kind: Number(symbol.symbolKind)
    };
  }

  getSymbolOverview(relativePath: string): Record<string, SymbolOverviewEntry[]> {
    const overview = this._langServer.requestOverview(relativePath);
    const result: Record<string, SymbolOverviewEntry[]> = {};
    for (const filePath of Object.keys(overview)) {
      const symbols = overview[filePath] ?? [];
      const mappedSymbols = symbols.map((symbol) =>
        LanguageServerSymbolRetriever.symbolOverviewFromSymbol(new LanguageServerSymbol(symbol))
      );
      result[filePath] = mappedSymbols;
    }
    return result;
  }

  get_symbol_overview(relativePath: string): Record<string, SymbolOverviewEntry[]> {
    return this.getSymbolOverview(relativePath);
  }
}

export class JetBrainsSymbol extends Symbol {
  private readonly data: Record<string, unknown>;

  constructor(symbolDict: Record<string, unknown>) {
    super();
    this.data = { ...symbolDict };
  }

  private ensureTextRange(): { start_pos: { line: number; col: number }; end_pos: { line: number; col: number } } | null {
    const textRange = this.data.text_range;
    if (!textRange || typeof textRange !== 'object') {
      return null;
    }
    const startPos = (textRange as { start_pos?: { line: number; col: number } }).start_pos;
    const endPos = (textRange as { end_pos?: { line: number; col: number } }).end_pos;
    if (!startPos || !endPos) {
      return null;
    }
    return { start_pos: startPos, end_pos: endPos };
  }

  override getBodyStartPosition(): PositionInFile | null {
    const range = this.ensureTextRange();
    if (!range) {
      return null;
    }
    return new PositionInFile({ line: Number(range.start_pos.line ?? 0), col: Number(range.start_pos.col ?? 0) });
  }

  override getBodyEndPosition(): PositionInFile | null {
    const range = this.ensureTextRange();
    if (!range) {
      return null;
    }
    return new PositionInFile({ line: Number(range.end_pos.line ?? 0), col: Number(range.end_pos.col ?? 0) });
  }

  override isNeighbouringDefinitionSeparatedByEmptyLine(): boolean {
    return true;
  }
}

export class JetBrainsCodeEditorNotAvailableError extends Error {
  constructor() {
    super('JetBrains IDE integration is not available in the current TypeScript port.');
  }
}
