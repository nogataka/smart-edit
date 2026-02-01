import fs from 'node:fs';
import path from 'node:path';

import { createSmartEditLogger } from './util/logging.js';

const { logger: log } = createSmartEditLogger({ name: 'smart-edit.text_utils' });

export enum LineType {
  MATCH = 'match',
  BEFORE_MATCH = 'prefix',
  AFTER_MATCH = 'postfix'
}

export class TextLine {
  readonly lineNumber: number;
  readonly lineContent: string;
  readonly matchType: LineType;

  constructor(options: { lineNumber: number; lineContent: string; matchType: LineType }) {
    this.lineNumber = options.lineNumber;
    this.lineContent = options.lineContent;
    this.matchType = options.matchType;
  }

  private getDisplayPrefix(): string {
    return this.matchType === LineType.MATCH ? '  >' : '...';
  }

  formatLine(includeLineNumbers = true): string {
    let prefix = this.getDisplayPrefix();
    if (includeLineNumbers) {
      const lineNum = String(this.lineNumber).padStart(4, ' ');
      prefix = `${prefix}${lineNum}`;
    }
    return `${prefix}:${this.lineContent}`;
  }
}

export class MatchedConsecutiveLines {
  readonly lines: TextLine[];
  readonly sourceFilePath?: string;
  readonly linesBeforeMatched: TextLine[];
  readonly matchedLines: TextLine[];
  readonly linesAfterMatched: TextLine[];

  constructor(options: { lines: TextLine[]; sourceFilePath?: string }) {
    if (!options.lines.length) {
      throw new Error('At least one matched line is required.');
    }

    this.lines = options.lines;
    this.sourceFilePath = options.sourceFilePath;

    this.linesBeforeMatched = [];
    this.matchedLines = [];
    this.linesAfterMatched = [];

    for (const line of options.lines) {
      if (line.matchType === LineType.BEFORE_MATCH) {
        this.linesBeforeMatched.push(line);
      } else if (line.matchType === LineType.MATCH) {
        this.matchedLines.push(line);
      } else if (line.matchType === LineType.AFTER_MATCH) {
        this.linesAfterMatched.push(line);
      }
    }

    if (this.matchedLines.length === 0) {
      throw new Error('At least one matched line is required.');
    }
  }

  get startLine(): number {
    return this.lines[0]?.lineNumber ?? 0;
  }

  get endLine(): number {
    return this.lines[this.lines.length - 1]?.lineNumber ?? 0;
  }

  get numMatchedLines(): number {
    return this.matchedLines.length;
  }

  toDisplayString(includeLineNumbers = true): string {
    return this.lines.map((line) => line.formatLine(includeLineNumbers)).join('\n');
  }

  static fromFileContents(options: {
    fileContents: string;
    line: number;
    contextLinesBefore?: number;
    contextLinesAfter?: number;
    sourceFilePath?: string;
  }): MatchedConsecutiveLines {
    const { fileContents, line, contextLinesBefore = 0, contextLinesAfter = 0, sourceFilePath } = options;
    const lineContents = splitIntoLinesPreservingEnding(fileContents);
    const startLine = Math.max(0, line - contextLinesBefore);
    const endLine = Math.min(lineContents.length - 1, line + contextLinesAfter);

    const lines: TextLine[] = [];
    for (let index = startLine; index <= endLine; index += 1) {
      const matchType =
        index < line
          ? LineType.BEFORE_MATCH
          : index > line
            ? LineType.AFTER_MATCH
            : LineType.MATCH;
      lines.push(
        new TextLine({
          lineNumber: index,
          lineContent: lineContents[index] ?? '',
          matchType
        })
      );
    }

    return new MatchedConsecutiveLines({ lines, sourceFilePath });
  }
}

interface SearchTextOptions {
  contextLinesBefore?: number;
  contextLinesAfter?: number;
}

interface SearchFilesOptions extends SearchTextOptions {
  rootPath?: string;
  fileReader?: (absolutePath: string) => string;
  pathsIncludeGlob?: string | null;
  pathsExcludeGlob?: string | null;
}

const DEFAULT_FILE_READER = (absolutePath: string): string => {
  return fs.readFileSync(absolutePath, 'utf-8');
};

export function searchFiles(
  relativeFilePaths: string[],
  pattern: string,
  options: SearchFilesOptions = {}
): MatchedConsecutiveLines[] {
  const {
    rootPath = '',
    fileReader = DEFAULT_FILE_READER,
    contextLinesBefore = 0,
    contextLinesAfter = 0,
    pathsIncludeGlob,
    pathsExcludeGlob
  } = options;

  const filteredPaths = relativeFilePaths.filter((candidate) => {
    if (pathsIncludeGlob && !globMatch(pathsIncludeGlob, candidate)) {
      log.debug(`Skipping ${candidate}: does not match include pattern ${pathsIncludeGlob}`);
      return false;
    }
    if (pathsExcludeGlob && globMatch(pathsExcludeGlob, candidate)) {
      log.debug(`Skipping ${candidate}: matches exclude pattern ${pathsExcludeGlob}`);
      return false;
    }
    return true;
  });

  log.info(`Processing ${filteredPaths.length} files.`);

  const matches: MatchedConsecutiveLines[] = [];
  const skipped: { path: string; error: unknown }[] = [];

  for (const relativePath of filteredPaths) {
    try {
      const absolutePath = rootPath ? path.join(rootPath, relativePath) : relativePath;
      const fileContents = fileReader(absolutePath);
      const results = searchText(fileContents, pattern, {
        contextLinesBefore,
        contextLinesAfter
      }).map(
        (item) =>
          new MatchedConsecutiveLines({
            lines: item.lines,
            sourceFilePath: relativePath
          })
      );
      if (results.length > 0) {
        log.debug(`Found ${results.length} matches in ${relativePath}`);
      }
      matches.push(...results);
    } catch (error) {
      skipped.push({ path: relativePath, error });
    }
  }

  if (skipped.length > 0) {
    log.debug(`Failed to read ${skipped.length} files`, skipped);
  }
  log.info(`Found ${matches.length} total matches across ${filteredPaths.length} files`);

  return matches;
}

function searchText(content: string, pattern: string, options: SearchTextOptions = {}): MatchedConsecutiveLines[] {
  const { contextLinesBefore = 0, contextLinesAfter = 0 } = options;

  let regex: RegExp;
  try {
    regex = new RegExp(pattern, 'gms');
  } catch (error) {
    throw new Error(`Invalid regular expression pattern: ${(error as Error).message}`);
  }

  const matches: MatchedConsecutiveLines[] = [];
  const lines = splitIntoLinesPreservingEnding(content);
  const lineOffsets = computeLineOffsets(content);

  for (const match of content.matchAll(regex)) {
    if (match.index === undefined) {
      continue;
    }
    const startIndex = match.index;
    const endIndex = startIndex + match[0].length;

    const startLine = findLineNumberForOffset(lineOffsets, startIndex);
    const endLine = findLineNumberForOffset(lineOffsets, Math.max(startIndex, endIndex - 1));

    const beforeStart = Math.max(0, startLine - contextLinesBefore);
    const afterEnd = Math.min(lines.length - 1, endLine + contextLinesAfter);

    const consecutiveLines: TextLine[] = [];
    for (let lineNumber = beforeStart; lineNumber <= afterEnd; lineNumber += 1) {
      const matchType =
        lineNumber < startLine
          ? LineType.BEFORE_MATCH
          : lineNumber > endLine
            ? LineType.AFTER_MATCH
            : LineType.MATCH;
      consecutiveLines.push(
        new TextLine({
          lineNumber,
          lineContent: lines[lineNumber] ?? '',
          matchType
        })
      );
    }

    matches.push(new MatchedConsecutiveLines({ lines: consecutiveLines }));
  }

  return matches;
}

function splitIntoLinesPreservingEnding(input: string): string[] {
  if (input.length === 0) {
    return [''];
  }
  const parts = input.split('\n');
  for (let index = 0; index < parts.length - 1; index += 1) {
    const current = parts[index];
    if (current?.endsWith('\r')) {
      parts[index] = current.slice(0, -1);
    }
  }
  return parts;
}

function computeLineOffsets(content: string): number[] {
  const offsets: number[] = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === '\n') {
      offsets.push(index + 1);
    }
  }
  return offsets;
}

function findLineNumberForOffset(lineOffsets: number[], offset: number): number {
  let low = 0;
  let high = lineOffsets.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const start = lineOffsets[mid];
    if (start === undefined) {
      break;
    }
    const nextStart = lineOffsets[mid + 1];

    if (offset < start) {
      high = mid - 1;
    } else if (nextStart !== undefined && offset >= nextStart) {
      low = mid + 1;
    } else {
      return mid;
    }
  }

  return Math.max(0, lineOffsets.length - 1);
}

function globMatch(pattern: string, candidate: string): boolean {
  if (!pattern) {
    return true;
  }
  const normalizedCandidate = candidate.split(path.sep).join('/');
  const regex = globToRegExp(pattern);
  return regex.test(normalizedCandidate);
}

function globToRegExp(pattern: string): RegExp {
  let escaped = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (!char) {
      continue;
    }
    if (char === '*') {
      escaped += '.*';
    } else if (char === '?') {
      escaped += '.';
    } else if (char === '\\') {
      index += 1;
      if (index < pattern.length) {
        const nextChar = pattern[index];
        if (nextChar) {
          escaped += escapeRegExpChar(nextChar);
        } else {
          escaped += '\\\\';
        }
      } else {
        escaped += '\\\\';
      }
    } else {
      escaped += escapeRegExpChar(char);
    }
  }
  return new RegExp(`^${escaped}$`);
}

function escapeRegExpChar(char: string): string {
  return char.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}
