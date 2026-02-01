import { mkdtempSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { SpawnSyncReturns } from 'node:child_process';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createSmartEditLogger } from '../../../src/smart-edit/util/logging.js';
import { RuntimeDependencyCollection } from '../../../src/smart-lsp/language_servers/common.js';
import AdmZip from 'adm-zip';

describe('RuntimeDependencyCollection', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'smart-edit-runtime-deps-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('executes shell command for the current platform', () => {
    const calls: { cmd: string; args: string[] }[] = [];
    const collection = new RuntimeDependencyCollection([
      {
        id: 'example',
        command: 'echo install-example',
        binaryName: 'bin/example'
      }
    ], [], {
      runCommand: (cmd, args) => {
        calls.push({ cmd, args });
        return { status: 0, error: undefined } as SpawnSyncReturns<string>;
      }
    });

    const { logger } = createSmartEditLogger({ emitToConsole: false, name: 'test.runtime' });
    const results = collection.install(logger, tempDir);

    expect(Object.keys(results)).toEqual(['example']);
    expect(results.example).toBe(path.join(tempDir, 'bin/example'));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.cmd).toBe('echo install-example');
  });

  it('downloads and extracts a zip dependency using the provided command runner', () => {
    const archiveEntries = ['mytool/bin/tool'];
    const runCommand = (cmd: string, args: string[]): SpawnSyncReturns<string> => {
      if (cmd === 'curl') {
        const outputIndex = args.findIndex((arg) => arg === '-o');
        const destination = outputIndex >= 0 ? args[outputIndex + 1] : null;
        if (!destination) {
          throw new Error('curl invocation missing -o destination argument');
        }
        mkdirSync(path.dirname(destination), { recursive: true });
        const zip = new AdmZip();
        for (const entry of archiveEntries) {
          zip.addFile(entry, Buffer.from('binary'));
        }
        zip.writeZip(destination);
        return { status: 0, error: undefined } as SpawnSyncReturns<string>;
      }
      return { status: 0, error: undefined } as SpawnSyncReturns<string>;
    };

    const collection = new RuntimeDependencyCollection(
      [
        {
          id: 'mytool',
          url: 'https://example.com/mytool.zip',
          archiveType: 'zip',
          binaryName: 'mytool/bin/tool'
        }
      ],
      [],
      { runCommand }
    );

    const { logger } = createSmartEditLogger({ emitToConsole: false, name: 'test.runtime' });
    const results = collection.install(logger, tempDir);

    const expectedBinary = path.join(tempDir, 'mytool', 'bin', 'tool');
    expect(results.mytool).toBe(expectedBinary);
    expect(existsSync(expectedBinary)).toBe(true);
  });
});
