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
