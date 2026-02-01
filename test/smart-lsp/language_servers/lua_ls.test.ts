import fs from 'node:fs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LuaLanguageServer } from '../../../src/smart-lsp/language_servers/lua_ls.js';
import { Language } from '../../../src/smart-lsp/ls_config.js';

const ORIGINAL_SKIP = process.env.SMART_EDIT_SKIP_RUNTIME_INSTALL;

describe('LuaLanguageServer', () => {
  let workspaceDir: string;
  let smartLspDir: string;

  beforeEach(() => {
    process.env.SMART_EDIT_SKIP_RUNTIME_INSTALL = '1';
    workspaceDir = mkdtempSync(path.join(tmpdir(), 'smart-edit-lua-workspace-'));
    smartLspDir = mkdtempSync(path.join(tmpdir(), 'smart-edit-lua-smart-lsp-'));
  });

  afterEach(() => {
    if (ORIGINAL_SKIP === undefined) {
      delete process.env.SMART_EDIT_SKIP_RUNTIME_INSTALL;
    } else {
      process.env.SMART_EDIT_SKIP_RUNTIME_INSTALL = ORIGINAL_SKIP;
    }
    rmSync(workspaceDir, { recursive: true, force: true });
    rmSync(smartLspDir, { recursive: true, force: true });
  });

  it('instantiates when runtime binary is present', () => {
    const runtimeDir = path.join(smartLspDir, 'language_servers', 'static', 'lua-language-server');
    const relativeBinaryPath = determineRuntimeBinaryRelativePath();
    const binaryPath = path.join(runtimeDir, relativeBinaryPath);
    fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
    writeFileSync(binaryPath, '');
    if (process.platform !== 'win32') {
      fs.chmodSync(binaryPath, 0o755);
    }

    const server = new LuaLanguageServer(
      { codeLanguage: Language.LUA },
      null,
      workspaceDir,
      { smartLspSettings: { smartLspDir } }
    );

    expect(server).toBeInstanceOf(LuaLanguageServer);
    server.stop();
  });
});

function determineRuntimeBinaryRelativePath(): string {
  const executableName = process.platform === 'win32' ? 'lua-language-server.exe' : 'lua-language-server';
  if (process.platform === 'win32') {
    return `lua-language-server-${LUA_VERSION}-win32-x64/bin/${executableName}`;
  }
  if (process.platform === 'darwin') {
    const archSuffix = process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
    return `lua-language-server-${LUA_VERSION}-${archSuffix}/bin/${executableName}`;
  }

  const linuxSuffix = process.arch === 'arm64' ? 'linux-arm64' : 'linux-x64';
  return `lua-language-server-${LUA_VERSION}-${linuxSuffix}/bin/${executableName}`;
}

const LUA_VERSION = '3.15.0';
