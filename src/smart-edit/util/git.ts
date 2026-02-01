import { createSmartEditLogger } from './logging.js';
import { subprocessCheckOutput } from './shell.js';

const { logger: gitLogger } = createSmartEditLogger({
  level: 'debug',
  emitToConsole: false,
  name: 'SmartEditGit'
});

export interface GitStatus {
  commit: string;
  hasUnstagedChanges: boolean;
  hasStagedUncommittedChanges: boolean;
  hasUntrackedFiles: boolean;
}

export interface GitDiffStats {
  filesChanged: number;
  insertions: number;
  deletions: number;
  newFiles: number;
  hasNewInSrc: boolean;
}

export interface GetGitStatusOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export async function getGitStatus(
  options: GetGitStatusOptions = {}
): Promise<GitStatus | null> {
  try {
    const commitHash = await runGitCommand(['rev-parse', 'HEAD'], options);
    const hasUnstagedChanges = await hasGitOutput(['diff', '--name-only'], options);
    const hasStagedUncommittedChanges = await hasGitOutput(
      ['diff', '--staged', '--name-only'],
      options
    );
    const hasUntrackedFiles = await hasGitOutput(
      ['ls-files', '--others', '--exclude-standard'],
      options
    );

    return {
      commit: commitHash,
      hasUnstagedChanges,
      hasStagedUncommittedChanges,
      hasUntrackedFiles
    };
  } catch (error) {
    gitLogger.debug('Failed to read git status', { error });
    return null;
  }
}

async function runGitCommand(
  args: string[],
  { cwd, env }: GetGitStatusOptions
): Promise<string> {
  const output = await subprocessCheckOutput(['git', ...args], {
    cwd,
    env,
    strip: true
  });
  return output;
}

async function hasGitOutput(
  args: string[],
  options: GetGitStatusOptions
): Promise<boolean> {
  const output = await runGitCommand(args, options);
  return output.length > 0;
}

/**
 * Get the current HEAD commit hash.
 */
export async function getCurrentCommit(
  options: GetGitStatusOptions = {}
): Promise<string | null> {
  try {
    return await runGitCommand(['rev-parse', 'HEAD'], options);
  } catch (error) {
    gitLogger.debug('Failed to get current commit', { error });
    return null;
  }
}

/**
 * Parse git diff --stat output to extract statistics.
 */
function parseDiffStatOutput(output: string): GitDiffStats {
  const lines = output.trim().split('\n').filter((line) => line.length > 0);

  let filesChanged = 0;
  let insertions = 0;
  let deletions = 0;
  let newFiles = 0;
  let hasNewInSrc = false;

  const filePattern = /^\s*(.+?)\s*\|\s*(\d+)/;
  const summaryPattern = /(\d+)\s+files?\s+changed(?:,\s+(\d+)\s+insertions?\(\+\))?(?:,\s+(\d+)\s+deletions?\(-\))?/;
  const plusPattern = /\+/g;
  const minusPattern = /-/g;

  // Parse individual file lines
  for (const line of lines) {
    // Match lines like: "src/file.ts | 10 ++++----"
    const fileMatch = filePattern.exec(line);
    if (fileMatch) {
      filesChanged++;
      const filePath = fileMatch[1].trim();

      // Check if it's a new file in src/
      if (filePath.startsWith('src/') && line.includes('(new)')) {
        newFiles++;
        hasNewInSrc = true;
      }

      // Count insertions and deletions from + and - symbols
      const plusMatches = line.match(plusPattern);
      const minusMatches = line.match(minusPattern);
      insertions += plusMatches?.length ?? 0;
      deletions += minusMatches?.length ?? 0;
    }

    // Parse the summary line: "3 files changed, 10 insertions(+), 5 deletions(-)"
    const summaryMatch = summaryPattern.exec(line);
    if (summaryMatch) {
      filesChanged = parseInt(summaryMatch[1], 10);
      if (summaryMatch[2]) {
        insertions = parseInt(summaryMatch[2], 10);
      }
      if (summaryMatch[3]) {
        deletions = parseInt(summaryMatch[3], 10);
      }
    }
  }

  return { filesChanged, insertions, deletions, newFiles, hasNewInSrc };
}

/**
 * Get diff statistics between two commits.
 */
export async function getGitDiffStats(
  fromCommit: string,
  toCommit = 'HEAD',
  options: GetGitStatusOptions = {}
): Promise<GitDiffStats | null> {
  try {
    const output = await runGitCommand(
      ['diff', '--stat', `${fromCommit}..${toCommit}`],
      options
    );
    return parseDiffStatOutput(output);
  } catch (error) {
    gitLogger.debug('Failed to get git diff stats', { error, fromCommit, toCommit });
    return null;
  }
}

/**
 * Check if the new files list contains files in src/ directory.
 */
export async function hasNewFilesInSrc(
  fromCommit: string,
  toCommit = 'HEAD',
  options: GetGitStatusOptions = {}
): Promise<boolean> {
  try {
    const output = await runGitCommand(
      ['diff', '--name-status', '--diff-filter=A', `${fromCommit}..${toCommit}`],
      options
    );
    const lines = output.trim().split('\n').filter((line) => line.length > 0);
    return lines.some((line) => {
      const parts = line.split('\t');
      const filePath = parts[1] || '';
      return filePath.startsWith('src/');
    });
  } catch (error) {
    gitLogger.debug('Failed to check for new files in src/', { error });
    return false;
  }
}

/**
 * Determine if there are significant changes since the last commit.
 * Significant changes are defined as:
 * - More than 10 files changed
 * - More than 5 new files
 * - Any new files in src/ directory
 */
export async function hasSignificantChanges(
  lastCommit: string,
  options: GetGitStatusOptions = {}
): Promise<{ significant: boolean; summary: string }> {
  const diffStats = await getGitDiffStats(lastCommit, 'HEAD', options);

  if (!diffStats) {
    return { significant: false, summary: 'Unable to determine changes' };
  }

  const hasNewInSrc = await hasNewFilesInSrc(lastCommit, 'HEAD', options);

  const reasons: string[] = [];

  if (diffStats.filesChanged > 10) {
    reasons.push(`${diffStats.filesChanged} files changed`);
  }

  if (diffStats.newFiles > 5) {
    reasons.push(`${diffStats.newFiles} new files`);
  }

  if (hasNewInSrc) {
    reasons.push('new files in src/ directory');
  }

  const significant = reasons.length > 0;
  const summary = significant
    ? `Significant changes detected: ${reasons.join(', ')}`
    : `Minor changes: ${diffStats.filesChanged} files, +${diffStats.insertions}/-${diffStats.deletions}`;

  return { significant, summary };
}
