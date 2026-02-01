import fs from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import { executeShellCommand } from '../util/shell.js';
import { Tool, ToolMarkerCanEdit } from './tools_base.js';

const DEFAULT_CAPTURE_STDERR = true;

interface ExecuteShellCommandInput {
  command: string;
  cwd?: string;
  capture_stderr?: boolean;
  max_answer_chars?: number;
}

export class ExecuteShellCommandTool extends Tool {
  static override readonly markers = new Set([ToolMarkerCanEdit]);
  static override readonly description =
    'Executes a shell command and returns its stdout/stderr output as JSON.';
  static override readonly inputSchema = z.object({
    command: z.string().min(1, 'command must not be empty'),
    cwd: z.string().optional(),
    capture_stderr: z.boolean().optional(),
    max_answer_chars: z
      .number()
      .int()
      .gte(-1, 'max_answer_chars must be -1 or a positive integer')
      .optional()
  });

  override async apply(args: ExecuteShellCommandInput): Promise<string> {
    const {
      command,
      cwd,
      capture_stderr = DEFAULT_CAPTURE_STDERR,
      max_answer_chars = -1
    } = args;

    const resolvedCwd = this.resolveWorkingDirectory(cwd);
    const result = await executeShellCommand(command, {
      cwd: resolvedCwd,
      captureStderr: capture_stderr
    });

    const payload = JSON.stringify({
      stdout: result.stdout,
      stderr: result.stderr ?? null,
      return_code: result.returnCode,
      cwd: result.cwd
    });

    return this._limitLength(payload, max_answer_chars);
  }

  private resolveWorkingDirectory(cwd: string | undefined): string {
    if (!cwd) {
      return this.getProjectRoot();
    }
    if (path.isAbsolute(cwd)) {
      return cwd;
    }
    const resolved = path.join(this.getProjectRoot(), cwd);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new Error(
        `Specified a relative working directory (${cwd}), but the resulting path is not a directory: ${resolved}`
      );
    }
    return resolved;
  }
}
