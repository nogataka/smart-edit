import { execFile, spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import type { ExecFileOptionsWithStringEncoding } from 'node:child_process';

import { ensureDefaultSubprocessOptions } from '../../smart-lsp/util/subprocess_util.js';

export interface ShellCommandResult {
  stdout: string;
  stderr?: string;
  returnCode: number;
  cwd: string;
  signal?: NodeJS.Signals;
}

export interface ExecuteShellCommandOptions {
  cwd?: string;
  captureStderr?: boolean;
  env?: NodeJS.ProcessEnv;
}

export async function executeShellCommand(
  command: string,
  { cwd, captureStderr = false, env }: ExecuteShellCommandOptions = {}
): Promise<ShellCommandResult> {
  const resolvedCwd = cwd ? path.resolve(cwd) : process.cwd();
  const mergedEnv = env ? { ...process.env, ...env } : process.env;

  return new Promise<ShellCommandResult>((resolve, reject) => {
    const spawnOptions = ensureDefaultSubprocessOptions({
      shell: true,
      cwd: resolvedCwd,
      env: mergedEnv,
      stdio: ['ignore', 'pipe', captureStderr ? 'pipe' : 'inherit']
    });
    const child = spawn(command, spawnOptions);

    let stdout = '';
    let stderr = '';

    if (child.stdout) {
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
      });
    }

    if (captureStderr && child.stderr) {
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });
    }

    child.once('error', reject);

    child.once('close', (code, signal) => {
      const returnCode = typeof code === 'number'
        ? code
        : resolveSignalExitCode(signal);

      resolve({
        stdout,
        stderr: captureStderr ? stderr : undefined,
        returnCode,
        cwd: resolvedCwd,
        signal: signal ?? undefined
      });
    });
  });
}

export interface SubprocessCheckOutputOptions {
  encoding?: BufferEncoding;
  strip?: boolean;
  timeoutMs?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export async function subprocessCheckOutput(
  args: string[],
  {
    encoding = 'utf8',
    strip = true,
    timeoutMs,
    cwd,
    env
  }: SubprocessCheckOutputOptions = {}
): Promise<string> {
  if (args.length === 0) {
    throw new Error('subprocessCheckOutput requires at least one argument');
  }

  const [command, ...commandArgs] = args;
  const resolvedCwd = cwd ? path.resolve(cwd) : undefined;
  /*
   * encoding option is validated by the SubprocessCheckOutputOptions schema above. The Node.js type
   * signatures expose these helper utilities with loose `any` assignments, so we locally suppress
   * the unsafe-assignment diagnostics while building the exec options object.
   */
  const execOptions = ensureDefaultSubprocessOptions<ExecFileOptionsWithStringEncoding>({
    encoding
  });

  if (resolvedCwd) {
    execOptions.cwd = resolvedCwd;
  }

  if (env) {
    execOptions.env = { ...process.env, ...env };
  }

  if (typeof timeoutMs === 'number') {
    execOptions.timeout = timeoutMs;
  }

  const { stdout } = await execFilePromise(command, commandArgs, execOptions);

  return strip ? stdout.trim() : stdout;
}

function resolveSignalExitCode(signal: NodeJS.Signals | null): number {
  if (!signal) {
    return 0;
  }

  const signalNumber = os.constants.signals[signal];
  if (typeof signalNumber === 'number') {
    return -signalNumber;
  }

  return 0;
}

function execFilePromise(
  command: string,
  args: string[],
  options: ExecFileOptionsWithStringEncoding
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        const wrappedError = error instanceof Error
          ? error
          : new Error('Subprocess execution failed');
        reject(wrappedError);
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}
