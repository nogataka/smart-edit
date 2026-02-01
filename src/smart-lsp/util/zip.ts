import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import AdmZip from 'adm-zip';

export interface SafeZipExtractorOptions {
  verbose?: boolean;
  includePatterns?: string[];
  excludePatterns?: string[];
  logger?: ZipLogger;
}

export interface ZipLogger {
  info(message: string): void;
  error(message: string, error?: unknown): void;
}

export class SafeZipExtractor {
  private readonly archivePath: string;
  private readonly extractDir: string;
  private readonly verbose: boolean;
  private readonly includePatterns: string[];
  private readonly excludePatterns: string[];
  private readonly logger?: ZipLogger;

  constructor(archivePath: string, extractDir: string, options: SafeZipExtractorOptions = {}) {
    this.archivePath = path.resolve(archivePath);
    this.extractDir = path.resolve(extractDir);
    this.verbose = options.verbose ?? true;
    this.includePatterns = options.includePatterns ?? [];
    this.excludePatterns = options.excludePatterns ?? [];
    this.logger = options.logger;
  }

  extractAll(): void {
    if (!fs.existsSync(this.archivePath)) {
      throw new Error(`Archive not found: ${this.archivePath}`);
    }

    if (this.verbose) {
      this.logInfo(`Extracting from: ${this.archivePath} to ${this.extractDir}`);
    }

    const zip = new AdmZip(this.archivePath);
    for (const entry of zip.getEntries()) {
      const filename = entry.entryName;
      if (!this.shouldExtract(filename)) {
        if (this.verbose) {
          this.logInfo(`Skipped: ${filename}`);
        }
        continue;
      }

      try {
        const outputPath = this.resolveTargetPath(filename);
        if (!outputPath) {
          if (this.verbose) {
            this.logInfo(`Skipping outside-path entry: ${filename}`);
          }
          continue;
        }

        if (entry.isDirectory) {
          fs.mkdirSync(outputPath, { recursive: true });
          continue;
        }

        const directory = path.dirname(outputPath);
        fs.mkdirSync(directory, { recursive: true });

        const finalPath = this.normalizePath(outputPath);
        const data = entry.getData();
        fs.writeFileSync(finalPath, data);

        if (this.verbose) {
          this.logInfo(`Extracted: ${filename}`);
        }
      } catch (error) {
        this.logError(`Failed to extract ${filename}`, error);
      }
    }
  }

  protected shouldExtract(filename: string): boolean {
    if (this.includePatterns.length > 0 && !this.includePatterns.some((pattern) => matchesGlob(filename, pattern))) {
      return false;
    }

    if (this.excludePatterns.length > 0 && this.excludePatterns.some((pattern) => matchesGlob(filename, pattern))) {
      return false;
    }

    return true;
  }

  protected resolveTargetPath(filename: string): string | null {
    const sanitized = filename.replace(/^\/+/, '');
    const target = path.resolve(this.extractDir, sanitized);
    const relative = path.relative(this.extractDir, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return null;
    }
    return target;
  }

  protected normalizePath(targetPath: string): string {
    if (process.platform === 'win32') {
      const absolute = path.resolve(targetPath);
      if (!absolute.startsWith('\\\\?\\')) {
        return `\\\\?\\${absolute}`;
      }
      return absolute;
    }
    return targetPath;
  }

  private logInfo(message: string): void {
    if (this.logger) {
      this.logger.info(message);
    } else {
      console.info(message);
    }
  }

  private logError(message: string, error: unknown): void {
    if (this.logger) {
      this.logger.error(message, error);
      return;
    }
    console.error(`${message}:`, error);
  }
}

function matchesGlob(filename: string, pattern: string): boolean {
  const regex = globToRegExp(pattern);
  return regex.test(filename);
}

function globToRegExp(pattern: string): RegExp {
  let regex = '^';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];

    if (char === '*') {
      regex += '.*';
      continue;
    }

    if (char === '?') {
      regex += '.';
      continue;
    }

    if (char === '[') {
      const { expression, length } = convertCharacterClass(pattern, i);
      regex += expression;
      i += length;
      continue;
    }

    regex += escapeRegexChar(char);
  }
  regex += '$';
  return new RegExp(regex);
}

function convertCharacterClass(pattern: string, startIndex: number): { expression: string; length: number } {
  let index = startIndex + 1;
  let negate = false;

  if (index >= pattern.length) {
    return { expression: '\\[', length: 0 };
  }

  let firstChar = pattern[index];
  if (firstChar === '!' || firstChar === '^') {
    negate = true;
    index += 1;
    firstChar = pattern[index];
  }

  if (index >= pattern.length) {
    return { expression: '\\[', length: 0 };
  }

  const classChars: string[] = [];
  let closed = false;

  if (firstChar === ']') {
    classChars.push('\\]');
    index += 1;
  }

  for (; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === ']') {
      closed = true;
      break;
    }

    if (char === '\\' && index + 1 < pattern.length) {
      index += 1;
      classChars.push(escapeClassChar(pattern[index]));
      continue;
    }

    classChars.push(escapeClassChar(char));
  }

  if (!closed) {
    return { expression: '\\[', length: 0 };
  }

  const expression = `[${negate ? '^' : ''}${classChars.join('')}]`;
  const consumedLength = index - startIndex;
  return { expression, length: consumedLength };
}

function escapeRegexChar(char: string): string {
  if (/[[\]{}()*+?.\\^$|]/.test(char)) {
    return `\\${char}`;
  }
  return char;
}

function escapeClassChar(char: string): string {
  if (char === '-') {
    return '-';
  }
  if (char === '^' || char === ']' || char === '\\') {
    return `\\${char}`;
  }
  return char;
}
