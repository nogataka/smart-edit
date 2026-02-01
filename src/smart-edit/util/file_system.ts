import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import ignore, { type Ignore } from 'ignore';

import { createSmartEditLogger } from './logging.js';

const { logger: fileSystemLogger } = createSmartEditLogger({
  level: 'debug',
  emitToConsole: false,
  name: 'SmartEditFileSystem'
});

export interface ScanResult {
  directories: string[];
  files: string[];
}

export type IgnorePredicate = (absolutePath: string) => boolean;

export function scanDirectory(
  targetPath: string,
  recursive = false,
  relativeTo?: string,
  isIgnoredDir?: IgnorePredicate,
  isIgnoredFile?: IgnorePredicate
): ScanResult {
  const ignoreDir = isIgnoredDir ?? (() => false);
  const ignoreFile = isIgnoredFile ?? (() => false);

  const files: string[] = [];
  const directories: string[] = [];

  const absolutePath = path.resolve(targetPath);
  const relativeBase = relativeTo ? path.resolve(relativeTo) : undefined;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absolutePath, { withFileTypes: true });
  } catch (error) {
    if (isPermissionError(error)) {
      fileSystemLogger.debug('Skipping directory due to permission error', {
        path: absolutePath,
        error
      });
      return { directories: [], files: [] };
    }

    throw error;
  }

  for (const entry of entries) {
    const entryPath = path.join(absolutePath, entry.name);
    const resultPath = relativeBase ? path.relative(relativeBase, entryPath) : entryPath;

    let stats: fs.Stats | undefined;
    try {
      stats = fs.statSync(entryPath);
    } catch (error) {
      if (isPermissionError(error)) {
        fileSystemLogger.debug('Skipping entry due to permission error', {
          path: entryPath,
          error
        });
        continue;
      }

      throw error;
    }

    if (stats.isFile()) {
      if (!ignoreFile(entryPath)) {
        files.push(resultPath);
      }
      continue;
    }

    if (stats.isDirectory()) {
      if (!ignoreDir(entryPath)) {
        directories.push(resultPath);
        if (recursive) {
          const subResult = scanDirectory(entryPath, true, relativeTo, ignoreDir, ignoreFile);
          files.push(...subResult.files);
          directories.push(...subResult.directories);
        }
      }
      continue;
    }
  }

  return { directories, files };
}

export function findAllNonIgnoredFiles(repoRoot: string): string[] {
  const parser = new GitignoreParser(repoRoot);
  const { files } = scanDirectory(
    repoRoot,
    true,
    undefined,
    parser.shouldIgnore.bind(parser),
    parser.shouldIgnore.bind(parser)
  );
  return files;
}

export class GitignoreSpec {
  readonly filePath: string;
  readonly patterns: string[];

  private readonly matcher: Ignore;

  constructor(filePath: string, patterns: string[]) {
    this.filePath = filePath;
    this.patterns = patterns;
    this.matcher = ignore();

    if (patterns.length > 0) {
      this.matcher.add(patterns);
    }
  }

  matches(relativePath: string): boolean {
    if (!this.patterns.length) {
      return false;
    }

    const candidate = normalizeCandidate(relativePath);
    if (candidate === '') {
      return false;
    }

    const withoutLeadingSlash = candidate.startsWith('/') ? candidate.slice(1) : candidate;

    if (this.matcher.ignores(withoutLeadingSlash)) {
      return true;
    }

    if (withoutLeadingSlash.endsWith('/')) {
      const withoutTrailing = withoutLeadingSlash.slice(0, -1);
      if (withoutTrailing && this.matcher.ignores(withoutTrailing)) {
        return true;
      }
    } else {
      const withTrailing = `${withoutLeadingSlash}/`;
      if (this.matcher.ignores(withTrailing)) {
        return true;
      }
    }

    return false;
  }
}

export class GitignoreParser {
  readonly repoRoot: string;
  private ignoreSpecs: GitignoreSpec[] = [];

  constructor(repoRoot: string) {
    this.repoRoot = path.resolve(repoRoot);
    this.loadGitignoreFiles();
  }

  shouldIgnore(inputPath: string): boolean {
    const absolutePath = path.isAbsolute(inputPath)
      ? path.resolve(inputPath)
      : path.resolve(this.repoRoot, inputPath);

    if (!isPathInsideRoot(absolutePath, this.repoRoot)) {
      fileSystemLogger.debug('Ignoring path outside repository root', { path: absolutePath });
      return true;
    }

    let relativePath = path.relative(this.repoRoot, absolutePath);
    if (!relativePath) {
      return false;
    }

    const firstSegment = relativePath.split(path.sep)[0];
    if (firstSegment === '.git') {
      return true;
    }

    const isDirectory = isDirectorySafe(absolutePath);
    if (isDirectory && !relativePath.endsWith(path.sep)) {
      relativePath += path.sep;
    }

    const normalized = relativePath.split(path.sep).join('/');

    for (const spec of this.ignoreSpecs) {
      if (spec.matches(normalized)) {
        return true;
      }
    }

    return false;
  }

  getIgnoreSpecs(): GitignoreSpec[] {
    return [...this.ignoreSpecs];
  }

  reload(): void {
    this.ignoreSpecs = [];
    this.loadGitignoreFiles();
  }

  private loadGitignoreFiles(): void {
    const start = performance.now();
    this.ignoreSpecs = [];

    for (const gitignorePath of this.iterGitignoreFiles()) {
      fileSystemLogger.debug('Processing .gitignore file', { path: gitignorePath });
      const spec = this.createIgnoreSpec(gitignorePath);
      if (spec) {
        this.ignoreSpecs.push(spec);
      }
    }

    const duration = performance.now() - start;
    fileSystemLogger.debug('Loaded .gitignore specs', {
      count: this.ignoreSpecs.length,
      durationMs: Math.round(duration)
    });
  }

  private *iterGitignoreFiles(): Iterable<string> {
    const queue: string[] = [this.repoRoot];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        continue;
      }

      if (current !== this.repoRoot) {
        const relative = path.relative(this.repoRoot, current);
        if (this.shouldIgnore(relative)) {
          continue;
        }
      }

      let dirEntries: fs.Dirent[];
      try {
        dirEntries = fs.readdirSync(current, { withFileTypes: true });
      } catch (error) {
        if (isPermissionError(error)) {
          fileSystemLogger.debug('Skipping directory during gitignore discovery due to permission error', {
            path: current,
            error
          });
          continue;
        }

        throw error;
      }

      for (const entry of dirEntries) {
        const entryPath = path.join(current, entry.name);

        if (entry.isDirectory() || (entry.isSymbolicLink() && isDirectorySafe(entryPath))) {
          queue.push(entryPath);
          continue;
        }

        if (entry.isFile() && entry.name === '.gitignore') {
          yield entryPath;
        }
      }
    }
  }

  private createIgnoreSpec(gitignoreFilePath: string): GitignoreSpec | null {
    let content: string;
    try {
      content = fs.readFileSync(gitignoreFilePath, 'utf-8');
    } catch (error) {
      fileSystemLogger.debug('Failed to read .gitignore file', {
        path: gitignoreFilePath,
        error
      });
      return null;
    }

    const patterns = this.parseGitignoreContent(content, path.dirname(gitignoreFilePath));
    if (patterns.length === 0) {
      return null;
    }

    return new GitignoreSpec(gitignoreFilePath, patterns);
  }

  private parseGitignoreContent(content: string, gitignoreDir: string): string[] {
    const patterns: string[] = [];

    let relativeDir = path.relative(this.repoRoot, gitignoreDir);
    if (relativeDir === '.') {
      relativeDir = '';
    }

    for (const rawLine of content.split(/\r?\n/)) {
      let line = stripTrailingWhitespace(rawLine);

      if (!line || line.trimStart().startsWith('#')) {
        continue;
      }

      let isNegation = false;
      if (line.startsWith('!')) {
        isNegation = true;
        line = line.slice(1);
      }

      line = line.trim();
      if (!line) {
        continue;
      }

      if (line.startsWith('\\#') || line.startsWith('\\!')) {
        line = line.slice(1);
      }

      const anchored = line.startsWith('/');
      if (anchored) {
        line = line.slice(1);
      }

      let adjustedPattern: string;
      if (relativeDir) {
        if (anchored) {
          adjustedPattern = path.join(relativeDir, line);
        } else if (line.startsWith('**/')) {
          adjustedPattern = path.join(relativeDir, line);
        } else {
          adjustedPattern = path.join(relativeDir, '**', line);
        }
      } else if (anchored) {
        adjustedPattern = `/${line}`;
      } else {
        adjustedPattern = line;
      }

      if (isNegation) {
        adjustedPattern = `!${adjustedPattern}`;
      }

      patterns.push(adjustedPattern.replace(/\\/g, '/'));
    }

    return patterns;
  }
}

function normalizeCandidate(relativePath: string): string {
  let normalized = relativePath.replace(/\\/g, '/');
  normalized = normalized.replace(/^\.\//, '');

  if (normalized.startsWith('//')) {
    normalized = normalized.slice(1);
  }

  return normalized;
}

function stripTrailingWhitespace(value: string): string {
  return value.replace(/[ \t]+$/, '');
}

function isDirectorySafe(candidatePath: string): boolean {
  try {
    return fs.statSync(candidatePath).isDirectory();
  } catch (error) {
    if (isPermissionError(error)) {
      return false;
    }

    if (isErrno(error, 'ENOENT') || isErrno(error, 'ENOTDIR')) {
      return false;
    }

    throw error;
  }
}

function isPermissionError(error: unknown): error is NodeJS.ErrnoException {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const code = (error as NodeJS.ErrnoException).code;
  return code === 'EACCES' || code === 'EPERM';
}

function isErrno(error: unknown, errno: string): boolean {
  return Boolean(error && typeof error === 'object' && (error as NodeJS.ErrnoException).code === errno);
}

function isPathInsideRoot(absolutePath: string, root: string): boolean {
  const normalizedRoot = path.resolve(root);
  const normalizedPath = path.resolve(absolutePath);
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}${path.sep}`);
}

export interface PathMatcher {
  ignores(path: string): boolean;
}

export function matchPath(relativePath: string, matcher: PathMatcher, rootPath = ''): boolean {
  let normalized = String(relativePath).replace(/\\/g, '/');
  if (!normalized.startsWith('/')) {
    normalized = `/${normalized}`;
  }

  const absolutePath = rootPath
    ? path.resolve(rootPath, relativePath)
    : path.resolve(relativePath);

  if (isDirectorySafe(absolutePath) && !normalized.endsWith('/')) {
    normalized = `${normalized}/`;
  }

  const withoutLeadingSlash = normalized.slice(1);
  const candidates = new Set<string>();
  if (withoutLeadingSlash) {
    candidates.add(withoutLeadingSlash);
  }

  if (withoutLeadingSlash.endsWith('/')) {
    const withoutTrailing = withoutLeadingSlash.slice(0, -1);
    if (withoutTrailing) {
      candidates.add(withoutTrailing);
    }
  } else if (withoutLeadingSlash) {
    candidates.add(`${withoutLeadingSlash}/`);
  }

  for (const candidate of candidates) {
    if (matcher.ignores(candidate)) {
      return true;
    }
  }

  return false;
}
