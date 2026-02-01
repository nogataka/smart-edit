import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';

import ignore, { type Ignore } from 'ignore';

import { createSmartEditLogger } from './util/logging.js';
import { GitignoreParser, matchPath, type PathMatcher } from './util/file_system.js';
import { MatchedConsecutiveLines, searchFiles } from './text_utils.js';
import {
  DEFAULT_TOOL_TIMEOUT,
  ProjectConfig,
  type ProjectLike
} from './config/smart_edit_config.js';
import { SMART_EDIT_MANAGED_DIR_IN_HOME, SMART_EDIT_MANAGED_DIR_NAME } from './constants.js';
import { SmartLanguageServer } from '../smart-lsp/ls.js';
import { getLanguageFilenameMatcher } from '../smart-lsp/ls_config.js';
import type { FilenameMatcherLike, Language } from '../smart-lsp/ls_config.js';

const { logger: log } = createSmartEditLogger({ name: 'smart-edit.project', emitToConsole: true, level: 'info' });

class IgnoreMatcher implements PathMatcher {
  private readonly engine: Ignore;

  constructor(patterns: string[]) {
    this.engine = ignore();
    if (patterns.length > 0) {
      this.engine.add(patterns);
    }
  }

  ignores(candidate: string): boolean {
    if (!candidate) {
      return false;
    }
    return this.engine.ignores(candidate);
  }
}

export interface ProjectSearchOptions {
  pattern: string;
  relative_path?: string;
  context_lines_before?: number;
  context_lines_after?: number;
  paths_include_glob?: string;
  paths_exclude_glob?: string;
}

export interface CreateLanguageServerOptions {
  logLevel: number;
  lsTimeout: number | null;
  traceLspCommunication: boolean;
  lsSpecificSettings: Record<string, unknown>;
}

function normalizePattern(pattern: string): string {
  return pattern.replace(/\\/g, '/');
}

function toPosixRelative(relativePath: string): string {
  const replaced = relativePath.split(path.sep).join('/');
  if (replaced === '.' || replaced === './') {
    return '';
  }
  return replaced.replace(/^\.\//u, '');
}

function ensureDirectoryExists(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function safeStat(candidate: string): fs.Stats | null {
  try {
    return fs.statSync(candidate);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export class Project implements ProjectLike {
  readonly projectRoot: string;
  readonly projectConfig: ProjectConfig;
  readonly isNewlyCreated: boolean;

  private readonly ignoredPatterns: string[];
  private readonly ignoreMatcher: PathMatcher;
  private readonly languageMatcher: FilenameMatcherLike | null;

  constructor(init: { projectRoot: string; projectConfig: ProjectConfig; isNewlyCreated?: boolean }) {
    this.projectRoot = path.resolve(init.projectRoot);
    this.projectConfig = init.projectConfig;
    this.isNewlyCreated = init.isNewlyCreated ?? false;

    this.ensureSmartEditDataGitignore();

    const patterns = new Set<string>();
    for (const pattern of this.projectConfig.ignoredPaths) {
      if (pattern) {
        patterns.add(normalizePattern(pattern));
      }
    }

    if (this.projectConfig.ignoreAllFilesInGitignore) {
      const parser = new GitignoreParser(this.projectRoot);
      for (const spec of parser.getIgnoreSpecs()) {
        log.debug(`Adding ${spec.patterns.length} patterns from ${spec.filePath} to ignored paths.`);
        for (const pattern of spec.patterns) {
          patterns.add(normalizePattern(pattern));
        }
      }
    }

    this.ignoredPatterns = Array.from(patterns);
    this.ignoreMatcher = new IgnoreMatcher(this.ignoredPatterns);

    this.languageMatcher = this.resolveLanguageMatcher(this.projectConfig.language);
  }

  static load(projectRoot: string, autogenerate = true): Project {
    const resolvedRoot = path.resolve(projectRoot);
    if (!fs.existsSync(resolvedRoot)) {
      throw new Error(`Project root not found: ${resolvedRoot}`);
    }

    const projectConfig = ProjectConfig.load(resolvedRoot, autogenerate);
    return new Project({ projectRoot: resolvedRoot, projectConfig });
  }

  get projectName(): string {
    return this.projectConfig.projectName;
  }

  get project_name(): string {
    return this.projectName;
  }

  get language(): Language {
    return this.projectConfig.language;
  }

  pathToSmartEditDataFolder(): string {
    return path.join(this.projectRoot, SMART_EDIT_MANAGED_DIR_NAME);
  }

  path_to_smart_edit_data_folder(): string {
    return this.pathToSmartEditDataFolder();
  }

  pathToProjectYml(): string {
    return path.join(this.projectRoot, ProjectConfig.relPathToProjectYml());
  }

  path_to_project_yml(): string {
    return this.pathToProjectYml();
  }

  readFile(relativePath: string): string {
    const absolutePath = path.resolve(this.projectRoot, relativePath);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`File not found: ${absolutePath}`);
    }
    const encoding = this.projectConfig.encoding;
    if (!Buffer.isEncoding(encoding)) {
      throw new Error(`Unsupported file encoding '${encoding}' for ${absolutePath}`);
    }
    return fs.readFileSync(absolutePath, { encoding });
  }

  read_file(relativePath: string): string {
    return this.readFile(relativePath);
  }

  getIgnoreSpec(): PathMatcher {
    return this.ignoreMatcher;
  }

  get_ignore_spec(): PathMatcher {
    return this.getIgnoreSpec();
  }

  isIgnoredPath(candidate: string, ignoreNonSourceFiles = false): boolean {
    const absolutePath = path.isAbsolute(candidate)
      ? path.resolve(candidate)
      : path.resolve(this.projectRoot, candidate);

    if (!absolutePath.startsWith(`${this.projectRoot}${path.sep}`) && absolutePath !== this.projectRoot) {
      log.warn(`Path ${absolutePath} is not relative to the project root ${this.projectRoot} and will be ignored.`);
      return true;
    }

    const relative = path.relative(this.projectRoot, absolutePath);
    return this._isIgnoredRelativePath(relative, ignoreNonSourceFiles);
  }

  is_ignored_path(candidate: string, ignore_non_source_files = false): boolean {
    return this.isIgnoredPath(candidate, ignore_non_source_files);
  }

  isPathInProject(candidate: string): boolean {
    const absolutePath = path.isAbsolute(candidate)
      ? path.resolve(candidate)
      : path.resolve(this.projectRoot, candidate);

    const relative = path.relative(this.projectRoot, absolutePath);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  }

  is_path_in_project(candidate: string): boolean {
    return this.isPathInProject(candidate);
  }

  relativePathExists(relativePath: string): boolean {
    const absolutePath = path.resolve(this.projectRoot, relativePath);
    return fs.existsSync(absolutePath);
  }

  relative_path_exists(relativePath: string): boolean {
    return this.relativePathExists(relativePath);
  }

  validateRelativePath(relativePath: string): void {
    if (!this.isPathInProject(relativePath)) {
      throw new Error(
        `${relativePath} points to path outside of the repository root; cannot access for safety reasons`
      );
    }

    if (this.isIgnoredPath(relativePath)) {
      throw new Error(`Path ${relativePath} is ignored; cannot access for safety reasons`);
    }
  }

  validate_relative_path(relativePath: string): void {
    this.validateRelativePath(relativePath);
  }

  gatherSourceFiles(relativePath = ''): string[] {
    const startPath = path.resolve(this.projectRoot, relativePath);
    if (!fs.existsSync(startPath)) {
      throw new Error(`Relative path ${startPath} not found.`);
    }

    const stats = safeStat(startPath);
    if (!stats) {
      throw new Error(`Failed to stat path: ${startPath}`);
    }

    if (stats.isFile()) {
      return [toPosixRelative(path.relative(this.projectRoot, startPath))];
    }

    const queue: string[] = [startPath];
    const results: string[] = [];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        continue;
      }

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch (error) {
        log.warn(`Skipping directory ${current} during source discovery`, error as Error);
        continue;
      }

      for (const entry of entries) {
        const absoluteEntryPath = path.join(current, entry.name);
        const entryStats = safeStat(absoluteEntryPath);
        if (!entryStats) {
          log.warn(`File ${absoluteEntryPath} not found (possibly symlink), skipping in gatherSourceFiles.`);
          continue;
        }

        const relativeEntryPath = path.relative(this.projectRoot, absoluteEntryPath);

        if (entryStats.isDirectory()) {
          if (!this.isIgnoredPath(relativeEntryPath)) {
            queue.push(absoluteEntryPath);
          }
          continue;
        }

        if (entryStats.isFile()) {
          try {
            if (!this.isIgnoredPath(relativeEntryPath, true)) {
              results.push(toPosixRelative(relativeEntryPath));
            }
          } catch (error) {
            log.warn(`Skipping file ${absoluteEntryPath} during source discovery`, error as Error);
          }
        }
      }
    }

    return results;
  }

  gather_source_files(relativePath = ''): string[] {
    return this.gatherSourceFiles(relativePath);
  }

  searchSourceFilesForPattern(options: ProjectSearchOptions): MatchedConsecutiveLines[] {
    const {
      pattern,
      relative_path = '',
      context_lines_before = 0,
      context_lines_after = 0,
      paths_include_glob,
      paths_exclude_glob
    } = options;

    const relativeFilePaths = this.gatherSourceFiles(relative_path);
    return searchFiles(relativeFilePaths, pattern, {
      rootPath: this.projectRoot,
      contextLinesBefore: context_lines_before,
      contextLinesAfter: context_lines_after,
      pathsIncludeGlob: paths_include_glob ?? null,
      pathsExcludeGlob: paths_exclude_glob ?? null
    });
  }

  search_source_files_for_pattern(
    pattern: string,
    relative_path = '',
    context_lines_before = 0,
    context_lines_after = 0,
    paths_include_glob?: string,
    paths_exclude_glob?: string
  ): MatchedConsecutiveLines[] {
    return this.searchSourceFilesForPattern({
      pattern,
      relative_path,
      context_lines_before,
      context_lines_after,
      paths_include_glob,
      paths_exclude_glob
    });
  }

  retrieveContentAroundLine(
    relativeFilePath: string,
    line: number,
    contextLinesBefore = 0,
    contextLinesAfter = 0
  ): MatchedConsecutiveLines {
    const fileContents = this.readFile(relativeFilePath);
    return MatchedConsecutiveLines.fromFileContents({
      fileContents,
      line,
      contextLinesBefore,
      contextLinesAfter,
      sourceFilePath: relativeFilePath
    });
  }

  retrieve_content_around_line(
    relative_file_path: string,
    line: number,
    context_lines_before = 0,
    context_lines_after = 0
  ): MatchedConsecutiveLines {
    return this.retrieveContentAroundLine(
      relative_file_path,
      line,
      context_lines_before,
      context_lines_after
    );
  }

  createLanguageServer(options: CreateLanguageServerOptions): SmartLanguageServer {
    const lsTimeout = options.lsTimeout === undefined ? DEFAULT_TOOL_TIMEOUT - 5 : options.lsTimeout;
    return SmartLanguageServer.create(
      {
        codeLanguage: this.projectConfig.language,
        traceLspCommunication: options.traceLspCommunication,
        startIndependentLspProcess: true,
        ignoredPaths: this.projectConfig.ignoredPaths
      },
      { level: options.logLevel },
      this.projectRoot,
      {
        timeout: lsTimeout,
        smartLspSettings: {
          lsSpecificSettings: options.lsSpecificSettings ?? {},
          smartLspDir: SMART_EDIT_MANAGED_DIR_IN_HOME,
          projectDataRelativePath: SMART_EDIT_MANAGED_DIR_NAME
        }
      }
    );
  }

  private ensureSmartEditDataGitignore(): void {
    const gitignorePath = path.join(this.pathToSmartEditDataFolder(), '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      return;
    }

    ensureDirectoryExists(path.dirname(gitignorePath));
    log.info(`Creating .gitignore file in ${gitignorePath}`);
    fs.writeFileSync(gitignorePath, `/${SmartLanguageServer.CACHE_FOLDER_NAME}\n`, {
      encoding: 'utf-8'
    });
  }

  private _isIgnoredRelativePath(relativePath: string, ignoreNonSourceFiles = true): boolean {
    const normalizedRelative = toPosixRelative(path.normalize(relativePath));
    const absolutePath = path.resolve(this.projectRoot, normalizedRelative);

    if (!fs.existsSync(absolutePath)) {
      log.warn(`File ${absolutePath} not found while evaluating ignore rules; treating as ignored.`);
      return true;
    }

    const stats = fs.statSync(absolutePath);

    if (stats.isFile() && ignoreNonSourceFiles) {
      if (this.languageMatcher && !this.languageMatcher.isRelevantFilename(path.basename(absolutePath))) {
        return true;
      }
    }

    const parts = normalizedRelative.split('/');
    if (parts.length > 0 && parts[0] === '.git') {
      return true;
    }

    return matchPath(normalizedRelative, this.ignoreMatcher, this.projectRoot);
  }

  private resolveLanguageMatcher(language: Language): FilenameMatcherLike | null {
    try {
      return getLanguageFilenameMatcher(language);
    } catch (error) {
      log.warn(`Failed to resolve filename matcher for language ${language}`, error as Error);
      return null;
    }
  }
}
