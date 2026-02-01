import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { afterAll, describe, expect, it } from 'vitest';

import {
  executeShellCommand,
  subprocessCheckOutput
} from '../../../src/smart-edit/util/shell.js';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-edit-shell-test-'));

async function createTempScript(content: string): Promise<string> {
  const scriptPath = path.join(
    tempRoot,
    `script-${Math.random().toString(16).slice(2)}.mjs`
  );
  await fs.promises.writeFile(scriptPath, `${content}\n`, 'utf-8');
  return scriptPath;
}

afterAll(async () => {
  await fs.promises.rm(tempRoot, { recursive: true, force: true });
});

describe('executeShellCommand', () => {
  it('captures stdout and exit code via shell invocation', async () => {
    const scriptPath = await createTempScript(
      "process.stdout.write('hello from shell');"
    );
    const command = `${JSON.stringify(process.execPath)} ${JSON.stringify(scriptPath)}`;

    const result = await executeShellCommand(command);

    expect(result.stdout).toBe('hello from shell');
    expect(result.returnCode).toBe(0);
    expect(result.cwd).toBe(process.cwd());
    expect(result.stderr).toBeUndefined();
  });

  it('captures stderr when requested', async () => {
    const scriptPath = await createTempScript(
      "process.stderr.write('problem occurred'); process.exit(3);"
    );
    const command = `${JSON.stringify(process.execPath)} ${JSON.stringify(scriptPath)}`;

    const result = await executeShellCommand(command, { captureStderr: true });

    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('problem occurred');
    expect(result.returnCode).toBe(3);
  });

  it('leaves stderr undefined when not captured explicitly', async () => {
    const scriptPath = await createTempScript(
      "process.stderr.write('warning message');"
    );
    const devNull = process.platform === 'win32' ? 'NUL' : '/dev/null';
    const command = `${JSON.stringify(process.execPath)} ${JSON.stringify(scriptPath)} 2>${devNull}`;

    const result = await executeShellCommand(command);

    expect(result.stdout).toBe('');
    expect(result.stderr).toBeUndefined();
  });

  it('respects the provided working directory', async () => {
    const cwdDir = await fs.promises.mkdtemp(path.join(tempRoot, 'cwd-'));
    const scriptPath = await createTempScript(
      "process.stdout.write(process.cwd());"
    );
    const command = `${JSON.stringify(process.execPath)} ${JSON.stringify(scriptPath)}`;

    const result = await executeShellCommand(command, { cwd: cwdDir });

    const expectedCwd = await fs.promises.realpath(cwdDir);
    const resolvedStdout = await fs.promises.realpath(result.stdout);

    expect(await fs.promises.realpath(result.cwd)).toBe(expectedCwd);
    expect(resolvedStdout).toBe(expectedCwd);
  });
});

describe('subprocessCheckOutput', () => {
  it('returns trimmed stdout by default', async () => {
    const scriptPath = await createTempScript("console.log('from execFile');");

    const output = await subprocessCheckOutput([process.execPath, scriptPath]);

    expect(output).toBe('from execFile');
  });

  it('preserves trailing newline when strip is false', async () => {
    const scriptPath = await createTempScript(
      "process.stdout.write('line with newline\\n');"
    );

    const output = await subprocessCheckOutput(
      [process.execPath, scriptPath],
      { strip: false }
    );

    expect(output).toBe('line with newline\n');
  });

  it('rejects when the command exits with a non-zero code', async () => {
    const scriptPath = await createTempScript('process.exit(5);');

    await expect(
      subprocessCheckOutput([process.execPath, scriptPath])
    ).rejects.toThrowError();
  });
});
