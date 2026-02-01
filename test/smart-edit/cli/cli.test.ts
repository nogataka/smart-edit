import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-edit-cli-tests-'));

let currentHome: string | null = null;

async function importCli() {
  const module = await import('../../../src/smart-edit/cli.js');
  return module;
}

beforeEach(async () => {
  currentHome = await fs.promises.mkdtemp(path.join(tempRoot, 'home-'));
  process.env.HOME = currentHome;
  process.env.USERPROFILE = currentHome;
  process.env.SMART_EDIT_SKIP_EDITOR = '1';
  vi.resetModules();
});

afterEach(async () => {
  if (currentHome) {
    await fs.promises.rm(currentHome, { recursive: true, force: true });
    currentHome = null;
  }
  delete process.env.SMART_EDIT_SKIP_EDITOR;
});

afterAll(async () => {
  await fs.promises.rm(tempRoot, { recursive: true, force: true });
});

describe('Smart-Edit CLI', () => {
  it('lists registered modes', async () => {
    const output: string[] = [];
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map((value) => String(value)).join(' '));
    });
    const { createSmartEditCli } = await importCli();
    const program = createSmartEditCli({
      enableExitOverride: true,
      writeOut: (str) => output.push(str),
      writeErr: () => {
        // ignore stderr in this test
      }
    });

    try {
      await program.parseAsync(['mode', 'list'], { from: 'user' });
    } finally {
      logSpy.mockRestore();
    }

    const combined = [output.join(''), logs.join('\n')].join('\n');
    expect(combined).toContain('interactive');
    expect(combined).toContain('editing');
  });

  it('creates a custom mode from template', async () => {
    const { createSmartEditCli } = await importCli();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const consoleErrors: string[] = [];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      consoleErrors.push(args.map((value) => String(value)).join(' '));
    });
    const program = createSmartEditCli({
      enableExitOverride: true,
      writeOut: (str) => stdout.push(str),
      writeErr: (str) => stderr.push(str)
    });

    await program.parseAsync(['mode', 'create', '--name', 'sample-mode'], { from: 'user' });

    const expectedPath = path.join(process.env.HOME ?? '', '.smart-edit', 'modes', 'sample-mode.yml');
    const exists = fs.existsSync(expectedPath);
    expect(exists).toBe(true);
    const content = await fs.promises.readFile(expectedPath, 'utf-8');
    expect(content.length).toBeGreaterThan(0);
    errorSpy.mockRestore();
  });

  it('starts the MCP server successfully with the embedded SmartEditAgent', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const infoLogs: string[] = [];
    const errorLogs: string[] = [];
    const infoSpy = vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => {
      infoLogs.push(args.map((value) => String(value)).join(' '));
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errorLogs.push(args.map((value) => String(value)).join(' '));
    });

    const { createSmartEditCli } = await importCli();
    const program = createSmartEditCli({
      enableExitOverride: true,
      writeOut: (str) => stdout.push(str),
      writeErr: (str) => stderr.push(str)
    });

    const commandPromise = program.parseAsync(
      ['start-mcp-server', '--transport', 'streamable-http', '--host', '127.0.0.1', '--port', '0'],
      { from: 'user' }
    );

    await new Promise<void>((resolve) => {
      globalThis.setTimeout(() => {
        process.emit('SIGINT');
        resolve();
      }, 50);
    });

    await commandPromise;

    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');

    infoSpy.mockRestore();
    errorSpy.mockRestore();

    expect(errorLogs.join('\n')).toBe('');
    const combinedInfo = [stdout.join(''), infoLogs.join('\n')].join('\n');
    expect(
      combinedInfo.includes('HTTP MCP サーバーが起動しました') ||
        combinedInfo.includes('Streamable HTTP MCP server started')
    ).toBe(true);
    expect(
      combinedInfo.includes('HTTP MCP サーバーを停止しています') ||
        combinedInfo.includes('Stopping HTTP MCP server')
    ).toBe(true);
    expect(stderr.join('')).toEqual('');
  });
});
