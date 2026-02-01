import fs, { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import '../../../src/smart-lsp/language_servers/autoload.js';
import { Language } from '../../../src/smart-lsp/ls_config.js';
import {
  SmartLanguageServer,
  type LanguageServerConfigLike
} from '../../../src/smart-lsp/ls.js';
import { ZigLanguageServer } from '../../../src/smart-lsp/language_servers/zls.js';

const ORIGINAL_ASSUME = process.env.SMART_EDIT_ASSUME_ZLS;
const ORIGINAL_ZIG_PATH = process.env.SMART_EDIT_ZIG_PATH;
const ORIGINAL_ZLS_PATH = process.env.SMART_EDIT_ZLS_PATH;

describe('ZigLanguageServer', () => {
  let workspaceDir: string;
  let smartLspDir: string;

  beforeEach(() => {
    workspaceDir = mkdtempSync(path.join(os.tmpdir(), 'smart-edit-zig-workspace-'));
    smartLspDir = mkdtempSync(path.join(os.tmpdir(), 'smart-edit-zig-smart-lsp-'));

    const zigExecutable = path.join(workspaceDir, process.platform === 'win32' ? 'zig.exe' : 'zig');
    const zlsExecutable = path.join(workspaceDir, process.platform === 'win32' ? 'zls.exe' : 'zls');

    writeFileSync(zigExecutable, '', { mode: 0o755 });
    writeFileSync(zlsExecutable, '', { mode: 0o755 });

    process.env.SMART_EDIT_ASSUME_ZLS = '1';
    process.env.SMART_EDIT_ZIG_PATH = zigExecutable;
    process.env.SMART_EDIT_ZLS_PATH = zlsExecutable;
  });

  afterEach(() => {
    if (ORIGINAL_ASSUME === undefined) {
      delete process.env.SMART_EDIT_ASSUME_ZLS;
    } else {
      process.env.SMART_EDIT_ASSUME_ZLS = ORIGINAL_ASSUME;
    }

    if (ORIGINAL_ZIG_PATH === undefined) {
      delete process.env.SMART_EDIT_ZIG_PATH;
    } else {
      process.env.SMART_EDIT_ZIG_PATH = ORIGINAL_ZIG_PATH;
    }

    if (ORIGINAL_ZLS_PATH === undefined) {
      delete process.env.SMART_EDIT_ZLS_PATH;
    } else {
      process.env.SMART_EDIT_ZLS_PATH = ORIGINAL_ZLS_PATH;
    }

    rmSync(workspaceDir, { recursive: true, force: true });
    rmSync(smartLspDir, { recursive: true, force: true });
  });

  it('registers with SmartLanguageServer registry for Language.ZIG', () => {
    const config: LanguageServerConfigLike = {
      codeLanguage: Language.ZIG
    };

    const server = SmartLanguageServer.create(config, { level: 'warn' }, workspaceDir, {
      smartLspSettings: { smartLspDir }
    });

    expect(server).toBeInstanceOf(ZigLanguageServer);

    server.stop();
  });

  it('builds initialize parameters with Zig-specific options', () => {
    const server = new ZigLanguageServer(
      { codeLanguage: Language.ZIG },
      { level: 'warn' },
      workspaceDir,
      { smartLspSettings: { smartLspDir } }
    );

    const params = (server as unknown as { buildInitializeParams(): Record<string, unknown> }).buildInitializeParams();

    expect(params).toMatchObject({
      processId: process.pid,
      rootPath: workspaceDir
    });

    const workspaceFolders = (params as { workspaceFolders?: { name?: string }[] }).workspaceFolders ?? [];
    expect(workspaceFolders[0]?.name).toBe(path.basename(workspaceDir));

    const initOptions = (params as { initializationOptions?: Record<string, unknown> }).initializationOptions ?? {};
    expect(initOptions).toMatchObject({
      zig_exe_path: process.env.SMART_EDIT_ZIG_PATH,
      enable_build_on_save: true,
      semantic_tokens: 'full'
    });

    server.stop();
  });

  it('ignores Zig cache and build directories', () => {
    const cacheFile = path.join(workspaceDir, 'zig-cache', 'cache.bin');
    const zigOutFile = path.join(workspaceDir, 'zig-out', 'artifact');
    const trackedFile = path.join(workspaceDir, 'src', 'main.zig');

    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.mkdirSync(path.dirname(zigOutFile), { recursive: true });
    fs.mkdirSync(path.dirname(trackedFile), { recursive: true });

    writeFileSync(cacheFile, '');
    writeFileSync(zigOutFile, '');
    writeFileSync(trackedFile, 'const main = {};');

    const server = new ZigLanguageServer(
      { codeLanguage: Language.ZIG },
      null,
      workspaceDir,
      { smartLspSettings: { smartLspDir } }
    );

    expect(server.isIgnoredPath('zig-cache/cache.bin', false)).toBe(true);
    expect(server.isIgnoredPath('zig-out/artifact', false)).toBe(true);
    expect(server.isIgnoredPath('src/main.zig', false)).toBe(false);

    server.stop();
  });
});
