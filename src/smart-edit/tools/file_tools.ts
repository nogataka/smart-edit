import fs from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import { searchFiles } from '../text_utils.js';
import type { MatchedConsecutiveLines } from '../text_utils.js';
import { scanDirectory, type IgnorePredicate } from '../util/file_system.js';
import {
  EditedFileContext,
  SUCCESS_RESULT,
  Tool,
  ToolMarkerCanEdit,
  ToolMarkerOptional,
  assertIsBufferEncoding,
  type ProjectLike,
  type SmartEditAgentLike,
  type ToolClass
} from './tools_base.js';

export { SUCCESS_RESULT } from './tools_base.js';

interface ReadFileInput {
  relative_path: string;
  start_line?: number;
  end_line?: number | null;
  max_answer_chars?: number;
}

interface CreateTextFileInput {
  relative_path: string;
  content: string;
}

interface ListDirInput {
  relative_path: string;
  recursive: boolean;
  skip_ignored_files?: boolean;
  max_answer_chars?: number;
}

interface FindFileInput {
  file_mask: string;
  relative_path: string;
}

interface ReplaceRegexInput {
  relative_path: string;
  regex: string;
  repl: string;
  allow_multiple_occurrences?: boolean;
}

interface DeleteLinesInput {
  relative_path: string;
  start_line: number;
  end_line: number;
}

interface ReplaceLinesInput extends DeleteLinesInput {
  content: string;
}

interface InsertAtLineInput {
  relative_path: string;
  line: number;
  content: string;
}

interface SearchForPatternInput {
  substring_pattern: string;
  context_lines_before?: number;
  context_lines_after?: number;
  paths_include_glob?: string;
  paths_exclude_glob?: string;
  relative_path?: string;
  restrict_search_to_code_files?: boolean;
  max_answer_chars?: number;
}

type ProjectWithPathUtilities = ProjectLike & {
  validateRelativePath?(relativePath: string): void;
  validate_relative_path?(relativePath: string): void;
  readFile?(relativePath: string): string | Promise<string>;
  read_file?(relativePath: string): string | Promise<string>;
  relativePathExists?(relativePath: string): boolean | Promise<boolean>;
  relative_path_exists?(relativePath: string): boolean | Promise<boolean>;
  isIgnoredPath?(absolutePath: string): boolean;
  is_ignored_path?(absolutePath: string): boolean;
  searchSourceFilesForPattern?(
    options: ProjectSearchOptions
  ): MatchedConsecutiveLines[] | Promise<MatchedConsecutiveLines[]>;
  search_source_files_for_pattern?(
    pattern: string,
    relative_path?: string,
    context_lines_before?: number,
    context_lines_after?: number,
    paths_include_glob?: string,
    paths_exclude_glob?: string
  ): MatchedConsecutiveLines[] | Promise<MatchedConsecutiveLines[]>;
};

interface ProjectSearchOptions {
  pattern: string;
  relative_path?: string;
  context_lines_before?: number;
  context_lines_after?: number;
  paths_include_glob?: string;
  paths_exclude_glob?: string;
}

interface LinesReadTracker {
  addLinesRead?(relativePath: string, range: [number, number]): void;
  add_lines_read?(relativePath: string, range: [number, number]): void;
  wereLinesRead?(relativePath: string, range: [number, number]): boolean;
  were_lines_read?(relativePath: string, range: [number, number]): boolean;
}

function resolveProjectEncoding(project: ProjectWithPathUtilities): BufferEncoding {
  const encodingValue = project.projectConfig.encoding ?? 'utf-8';
  assertIsBufferEncoding(encodingValue);
  return encodingValue;
}

interface CodeEditorWithLineOps {
  deleteLines?(relativePath: string, startLine: number, endLine: number): void | Promise<void>;
  delete_lines?(relativePath: string, startLine: number, endLine: number): void | Promise<void>;
  insertAtLine?(relativePath: string, startLine: number, content: string): void | Promise<void>;
  insert_at_line?(relativePath: string, startLine: number, content: string): void | Promise<void>;
}

interface AgentWithToolLookup extends SmartEditAgentLike {
  getTool?<T extends Tool>(toolClass: ToolClass<T>): T;
  get_tool?<T extends Tool>(toolClass: ToolClass<T>): T;
}

export class ReadFileTool extends Tool {
  static override readonly description = 'Reads a file within the project directory.';
  static override readonly inputSchema = z.object({
    relative_path: z.string().min(1, 'relative_path must not be empty'),
    start_line: z
      .number()
      .int()
      .min(0, 'start_line must be non-negative')
      .optional()
      .default(0),
    end_line: z
      .number()
      .int()
      .min(0, 'end_line must be non-negative')
      .nullable()
      .optional(),
    max_answer_chars: z
      .number()
      .int()
      .gte(-1, 'max_answer_chars must be -1 or a positive integer')
      .optional()
  });

  override async apply(args: ReadFileInput): Promise<string> {
    const { relative_path, start_line = 0, end_line = null, max_answer_chars = -1 } = args;
    const project = this.project as ProjectWithPathUtilities;

    await validateRelativePath(project, relative_path, this.getProjectRoot());
    const fileContents = await readProjectFile(project, relative_path, this.getProjectRoot());

    const lines = splitIntoLines(fileContents);
    let selected: string[];
    if (end_line === null || end_line === undefined) {
      selected = lines.slice(start_line);
    } else {
      recordLinesRead(this.linesRead as LinesReadTracker, relative_path, [start_line, end_line]);
      selected = lines.slice(start_line, end_line + 1);
    }

    const result = selected.join('\n');
    return this._limitLength(result, max_answer_chars);
  }
}

export class CreateTextFileTool extends Tool {
  static override readonly markers = new Set([ToolMarkerCanEdit]);
  static override readonly description = 'Creates or overwrites a text file in the project directory.';
  static override readonly inputSchema = z.object({
    relative_path: z.string().min(1, 'relative_path must not be empty'),
    content: z.string()
  });

  override async apply(args: CreateTextFileInput): Promise<string> {
    const { relative_path, content } = args;
    const projectRoot = this.getProjectRoot();
    const absolutePath = path.resolve(projectRoot, relative_path);
    const exists = fs.existsSync(absolutePath);

    if (exists) {
      await validateRelativePath(this.project as ProjectWithPathUtilities, relative_path, projectRoot);
    } else if (!isPathInsideRoot(absolutePath, projectRoot)) {
      throw new Error(`Cannot create file outside of the project directory, got relative_path='${relative_path}'`);
    }

    await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.promises.writeFile(absolutePath, content, { encoding: 'utf-8' });

    let answer = `File created: ${relative_path}.`;
    if (exists) {
      answer += ' Overwrote existing file.';
    }
    return JSON.stringify(answer);
  }
}

export class ListDirTool extends Tool {
  static override readonly description =
    'Lists files and directories for a given relative path. Honors gitignore rules when requested.';
  static override readonly inputSchema = z.object({
    relative_path: z.string().min(1, 'relative_path must not be empty'),
    recursive: z.boolean(),
    skip_ignored_files: z.boolean().optional(),
    max_answer_chars: z
      .number()
      .int()
      .gte(-1, 'max_answer_chars must be -1 or a positive integer')
      .optional()
  });

  override async apply(args: ListDirInput): Promise<string> {
    const {
      relative_path,
      recursive,
      skip_ignored_files = false,
      max_answer_chars = -1
    } = args;
    const project = this.project as ProjectWithPathUtilities;

    const pathExists = await projectRelativePathExists(project, relative_path, this.getProjectRoot());
    if (!pathExists) {
      const payload = JSON.stringify({
        error: `Directory not found: ${relative_path}`,
        project_root: this.getProjectRoot(),
        hint: 'Check if the path is correct relative to the project root'
      });
      return this._limitLength(payload, max_answer_chars);
    }

    await validateRelativePath(project, relative_path, this.getProjectRoot());

    const targetPath = path.join(this.getProjectRoot(), relative_path);
    const predicate = skip_ignored_files ? projectIgnorePredicate(project) : undefined;
    const result = scanDirectory(
      targetPath,
      recursive,
      this.getProjectRoot(),
      predicate,
      predicate
    );
    const payload = JSON.stringify({
      dirs: result.directories,
      files: result.files
    });
    return this._limitLength(payload, max_answer_chars);
  }
}

export class FindFileTool extends Tool {
  static override readonly description =
    'Finds files within a directory tree that match a filename mask while respecting ignored paths.';
  static override readonly inputSchema = z.object({
    file_mask: z.string().min(1, 'file_mask must not be empty'),
    relative_path: z.string().min(1, 'relative_path must not be empty')
  });

  override async apply(args: FindFileInput): Promise<string> {
    const { file_mask, relative_path } = args;
    const project = this.project as ProjectWithPathUtilities;

    await validateRelativePath(project, relative_path, this.getProjectRoot());
    const dirToScan = path.join(this.getProjectRoot(), relative_path);

    const ignorePredicate = projectIgnorePredicate(project);
    const { files } = scanDirectory(
      dirToScan,
      true,
      this.getProjectRoot(),
      ignorePredicate,
      (absolutePath) => {
        if (ignorePredicate?.(absolutePath)) {
          return true;
        }
        const filename = path.basename(absolutePath);
        return !matchesFileMask(file_mask, filename);
      }
    );

    return JSON.stringify({ files });
  }
}

export class ReplaceRegexTool extends Tool {
  static override readonly markers = new Set([ToolMarkerCanEdit]);
  static override readonly description =
    'Replaces one or more regex matches within a file. Falls back to Python-style DOTALL matching.';
  static override readonly inputSchema = z.object({
    relative_path: z.string().min(1, 'relative_path must not be empty'),
    regex: z.string().min(1, 'regex must not be empty'),
    repl: z.string(),
    allow_multiple_occurrences: z.boolean().optional()
  });

  override async apply(args: ReplaceRegexInput): Promise<string> {
    const { relative_path, regex, repl, allow_multiple_occurrences = false } = args;
    await validateRelativePath(this.project as ProjectWithPathUtilities, relative_path, this.getProjectRoot());

    return EditedFileContext.use(relative_path, this.agent, (context) => {
      const original = context.getOriginalContent();
      let count = 0;
      let compiled: RegExp;
      try {
        compiled = new RegExp(regex, 'gms');
      } catch (error) {
        throw new Error(`Invalid regex '${regex}': ${(error as Error).message}`);
      }

      const updated = original.replace(compiled, () => {
        count += 1;
        return repl;
      });

      if (count === 0) {
        return `Error: No matches found for regex '${regex}' in file '${relative_path}'.`;
      }
      if (!allow_multiple_occurrences && count > 1) {
        return (
          `Error: Regex '${regex}' matches ${count} occurrences in file '${relative_path}'. ` +
          'Please revise the regex to be more specific or enable allow_multiple_occurrences if this is expected.'
        );
      }

      context.setUpdatedContent(updated);
      return SUCCESS_RESULT;
    });
  }
}

export class DeleteLinesTool extends Tool {
  static override readonly markers = new Set([ToolMarkerCanEdit, ToolMarkerOptional]);
  static override readonly description =
    'Deletes a range of lines within a file. Requires the same lines to be read beforehand.';
  static override readonly inputSchema = z.object({
    relative_path: z.string().min(1, 'relative_path must not be empty'),
    start_line: z
      .number()
      .int()
      .min(0, 'start_line must be non-negative'),
    end_line: z
      .number()
      .int()
      .min(0, 'end_line must be non-negative')
  });

  override async apply(args: DeleteLinesInput): Promise<string> {
    const { relative_path, start_line, end_line } = args;
    if (!linesWereRead(this.linesRead as LinesReadTracker, relative_path, [start_line, end_line])) {
      const toolName = ReadFileTool.getNameFromCls();
      return `Error: Must call \`${toolName}\` first to read exactly the affected lines.`;
    }

    const editor = this.createCodeEditor() as CodeEditorWithLineOps;
    await callEditorMethod(editor, ['deleteLines', 'delete_lines'], relative_path, start_line, end_line);
    return SUCCESS_RESULT;
  }
}

export class ReplaceLinesTool extends Tool {
  static override readonly markers = new Set([ToolMarkerCanEdit, ToolMarkerOptional]);
  static override readonly description =
    'Replaces a range of lines within a file. Requires the range to be read beforehand.';
  static override readonly inputSchema = z.object({
    relative_path: z.string().min(1, 'relative_path must not be empty'),
    start_line: z
      .number()
      .int()
      .min(0, 'start_line must be non-negative'),
    end_line: z
      .number()
      .int()
      .min(0, 'end_line must be non-negative'),
    content: z.string()
  });

  override async apply(args: ReplaceLinesInput): Promise<string> {
    const { relative_path, start_line, end_line, content } = args;
    const normalizedContent = content.endsWith('\n') ? content : `${content}\n`;

    const deleteTool = getToolInstance(this.agent, DeleteLinesTool);
    const deleteResult = await Promise.resolve(deleteTool.apply({ relative_path, start_line, end_line }));
    if (deleteResult !== SUCCESS_RESULT) {
      return deleteResult;
    }

    const insertTool = getToolInstance(this.agent, InsertAtLineTool);
    await Promise.resolve(insertTool.apply({ relative_path, line: start_line, content: normalizedContent }));
    return SUCCESS_RESULT;
  }
}

export class InsertAtLineTool extends Tool {
  static override readonly markers = new Set([ToolMarkerCanEdit, ToolMarkerOptional]);
  static override readonly description =
    'Inserts content at a specific line. The insertion will push existing content down.';
  static override readonly inputSchema = z.object({
    relative_path: z.string().min(1, 'relative_path must not be empty'),
    line: z
      .number()
      .int()
      .min(0, 'line must be non-negative'),
    content: z.string()
  });

  override async apply(args: InsertAtLineInput): Promise<string> {
    const { relative_path, line, content } = args;
    const normalizedContent = content.endsWith('\n') ? content : `${content}\n`;

    const editor = this.createCodeEditor() as CodeEditorWithLineOps;
    await callEditorMethod(editor, ['insertAtLine', 'insert_at_line'], relative_path, line, normalizedContent);
    return SUCCESS_RESULT;
  }
}

export class SearchForPatternTool extends Tool {
  static override readonly description =
    'Searches files for a substring/regex pattern, returning grouped matches with optional context.';
  static override readonly inputSchema = z.object({
    substring_pattern: z.string().min(1, 'substring_pattern must not be empty'),
    context_lines_before: z
      .number()
      .int()
      .min(0, 'context_lines_before must be non-negative')
      .optional()
      .default(0),
    context_lines_after: z
      .number()
      .int()
      .min(0, 'context_lines_after must be non-negative')
      .optional()
      .default(0),
    paths_include_glob: z.string().optional(),
    paths_exclude_glob: z.string().optional(),
    relative_path: z.string().optional().default(''),
    restrict_search_to_code_files: z.boolean().optional().default(false),
    max_answer_chars: z
      .number()
      .int()
      .gte(-1, 'max_answer_chars must be -1 or a positive integer')
      .optional()
  });

  override async apply(args: SearchForPatternInput): Promise<string> {
    const {
      substring_pattern,
      context_lines_before = 0,
      context_lines_after = 0,
      paths_include_glob,
      paths_exclude_glob,
      relative_path = '',
      restrict_search_to_code_files = false,
      max_answer_chars = -1
    } = args;

    const absolutePath = path.join(this.getProjectRoot(), relative_path);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Relative path ${relative_path} does not exist.`);
    }

    let matches: MatchedConsecutiveLines[];
    const project = this.project as ProjectWithPathUtilities;

    if (restrict_search_to_code_files) {
      matches = await searchWithProjectSourceFiles(project, {
        pattern: substring_pattern,
        relative_path,
        context_lines_before,
        context_lines_after,
        paths_include_glob,
        paths_exclude_glob
      });
    } else {
      let relativePathsToSearch: string[];
      if (fs.statSync(absolutePath).isFile()) {
        relativePathsToSearch = [relative_path];
      } else {
        const ignorePredicate = projectIgnorePredicate(project);
        const { files } = scanDirectory(
          absolutePath,
          true,
          this.getProjectRoot(),
          ignorePredicate,
          ignorePredicate
        );
        relativePathsToSearch = files;
      }

      matches = searchFiles(relativePathsToSearch, substring_pattern, {
        rootPath: this.getProjectRoot(),
        contextLinesBefore: context_lines_before,
        contextLinesAfter: context_lines_after,
        pathsIncludeGlob: paths_include_glob,
        pathsExcludeGlob: paths_exclude_glob
      });
    }

    const grouped = new Map<string, string[]>();
    for (const match of matches) {
      const key = match.sourceFilePath ?? relative_path ?? '';
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(match.toDisplayString(true));
    }

    const payload = JSON.stringify(Object.fromEntries(grouped));
    return this._limitLength(payload, max_answer_chars);
  }
}

function splitIntoLines(content: string): string[] {
  const parts = content.split('\n');
  for (let index = 0; index < parts.length - 1; index += 1) {
    const current = parts[index];
    if (current?.endsWith('\r')) {
      parts[index] = current.slice(0, -1);
    }
  }
  return parts;
}

async function validateRelativePath(
  project: ProjectWithPathUtilities,
  relativePath: string,
  projectRoot: string
): Promise<void> {
  if (typeof project.validateRelativePath === 'function') {
    await Promise.resolve(project.validateRelativePath(relativePath));
    return;
  }
  if (typeof project.validate_relative_path === 'function') {
    await Promise.resolve(project.validate_relative_path(relativePath));
    return;
  }
  if (!isPathInsideRoot(path.resolve(projectRoot, relativePath), projectRoot)) {
    throw new Error(`Path '${relativePath}' escapes the project root.`);
  }
}

async function readProjectFile(
  project: ProjectWithPathUtilities,
  relativePath: string,
  projectRoot: string
): Promise<string> {
  if (typeof project.readFile === 'function') {
    return Promise.resolve(project.readFile(relativePath));
  }
  if (typeof project.read_file === 'function') {
    return Promise.resolve(project.read_file(relativePath));
  }
  const absolutePath = path.resolve(projectRoot, relativePath);
  const encoding: BufferEncoding = resolveProjectEncoding(project);
  return fs.promises.readFile(absolutePath, { encoding });
}

async function projectRelativePathExists(
  project: ProjectWithPathUtilities,
  relativePath: string,
  projectRoot: string
): Promise<boolean> {
  if (typeof project.relativePathExists === 'function') {
    return Promise.resolve(project.relativePathExists(relativePath));
  }
  if (typeof project.relative_path_exists === 'function') {
    return Promise.resolve(project.relative_path_exists(relativePath));
  }
  const candidate = path.resolve(projectRoot, relativePath);
  return fs.existsSync(candidate);
}

function projectIgnorePredicate(project: ProjectWithPathUtilities): IgnorePredicate | undefined {
  if (typeof project.isIgnoredPath === 'function') {
    const fn = project.isIgnoredPath.bind(project);
    return (absolutePath) => fn(absolutePath);
  }
  if (typeof project.is_ignored_path === 'function') {
    const fn = project.is_ignored_path.bind(project);
    return (absolutePath) => fn(absolutePath);
  }
  return undefined;
}

function matchesFileMask(mask: string, filename: string): boolean {
  let pattern = '';
  for (let index = 0; index < mask.length; index += 1) {
    const char = mask[index];
    if (!char) {
      continue;
    }
    if (char === '*') {
      pattern += '.*';
    } else if (char === '?') {
      pattern += '.';
    } else if (char === '\\') {
      index += 1;
      if (index < mask.length) {
        const nextChar = mask[index];
        if (nextChar) {
          pattern += escapeRegExpChar(nextChar);
        } else {
          pattern += '\\\\';
        }
      } else {
        pattern += '\\\\';
      }
    } else {
      pattern += escapeRegExpChar(char);
    }
  }
  const regex = new RegExp(`^${pattern}$`);
  return regex.test(filename);
}

function recordLinesRead(tracker: LinesReadTracker, relativePath: string, range: [number, number]): void {
  if (!tracker) {
    return;
  }
  if (typeof tracker.addLinesRead === 'function') {
    tracker.addLinesRead(relativePath, range);
  } else if (typeof tracker.add_lines_read === 'function') {
    tracker.add_lines_read(relativePath, range);
  }
}

function linesWereRead(tracker: LinesReadTracker, relativePath: string, range: [number, number]): boolean {
  if (!tracker) {
    return false;
  }
  if (typeof tracker.wereLinesRead === 'function') {
    return tracker.wereLinesRead(relativePath, range);
  }
  if (typeof tracker.were_lines_read === 'function') {
    return tracker.were_lines_read(relativePath, range);
  }
  return false;
}

function isPathInsideRoot(candidatePath: string, root: string): boolean {
  const normalizedRoot = path.resolve(root);
  const normalizedCandidate = path.resolve(candidatePath);
  const relative = path.relative(normalizedRoot, normalizedCandidate);
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function callEditorMethod(
  editor: CodeEditorWithLineOps,
  methodCandidates: (keyof CodeEditorWithLineOps)[],
  ...args: unknown[]
): Promise<void> {
  for (const candidate of methodCandidates) {
    const method = editor[candidate];
    if (typeof method === 'function') {
      const callable = method as (...fnArgs: unknown[]) => unknown;
      await Promise.resolve(callable.apply(editor, args));
      return;
    }
  }
  throw new Error(`Code editor does not implement any of the expected methods: ${methodCandidates.join(', ')}`);
}

function getToolInstance<T extends Tool>(agent: SmartEditAgentLike, toolClass: ToolClass<T>): T {
  const lookupAgent = agent as AgentWithToolLookup;
  if (typeof lookupAgent.getTool === 'function') {
    return lookupAgent.getTool(toolClass);
  }
  if (typeof lookupAgent.get_tool === 'function') {
    return lookupAgent.get_tool(toolClass);
  }
  const FallbackCtor: new (agent: SmartEditAgentLike) => T = toolClass;
  return new FallbackCtor(agent);
}

async function searchWithProjectSourceFiles(
  project: ProjectWithPathUtilities,
  options: ProjectSearchOptions
): Promise<MatchedConsecutiveLines[]> {
  if (typeof project.searchSourceFilesForPattern === 'function') {
    const result = project.searchSourceFilesForPattern(options);
    return Promise.resolve(result);
  }
  if (typeof project.search_source_files_for_pattern === 'function') {
    const result = project.search_source_files_for_pattern(
      options.pattern,
      options.relative_path,
      options.context_lines_before,
      options.context_lines_after,
      options.paths_include_glob,
      options.paths_exclude_glob
    );
    return Promise.resolve(result);
  }

  const relativePaths = projectRelativePathList(project, options.relative_path ?? '');
  return searchFiles(relativePaths, options.pattern, {
    rootPath: (project.projectRoot ?? projectRootFallback(project)) ?? '',
    contextLinesBefore: options.context_lines_before,
    contextLinesAfter: options.context_lines_after,
    pathsIncludeGlob: options.paths_include_glob ?? undefined,
    pathsExcludeGlob: options.paths_exclude_glob ?? undefined
  });
}

function projectRelativePathList(project: ProjectWithPathUtilities, relativePath: string): string[] {
  const projectRoot = project.projectRoot ?? projectRootFallback(project);
  if (!projectRoot) {
    return [];
  }

  const absolute = path.join(projectRoot, relativePath);
  const predicate = projectIgnorePredicate(project);
  if (fs.existsSync(absolute)) {
    const stats = fs.statSync(absolute);
    if (stats.isFile()) {
      return [relativePath];
    }
    if (stats.isDirectory()) {
      const { files } = scanDirectory(
        absolute,
        true,
        projectRoot,
        predicate,
        predicate
      );
      return files;
    }
  }
  return [];
}

function projectRootFallback(project: ProjectWithPathUtilities): string | undefined {
  if (typeof project.projectRoot === 'string') {
    return project.projectRoot;
  }
  const candidate = (project as { project_root?: string }).project_root;
  if (typeof candidate === 'string') {
    return candidate;
  }
  return undefined;
}

function escapeRegExpChar(char: string): string {
  return char.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}
