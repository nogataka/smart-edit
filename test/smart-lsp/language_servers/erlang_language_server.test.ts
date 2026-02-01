import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import '../../../src/smart-lsp/language_servers/autoload.js';
import { Language } from '../../../src/smart-lsp/ls_config.js';
import {
  SmartLanguageServer,
  type LanguageServerConfigLike
} from '../../../src/smart-lsp/ls.js';
import { ErlangLanguageServer } from '../../../src/smart-lsp/language_servers/erlang_language_server.js';

describe('ErlangLanguageServer', () => {
  let workspaceDir: string;
  let smartLspDir: string;
  let originalAssume: string | undefined;
  let originalAssumeLs: string | undefined;
  let originalPath: string | undefined;

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-edit-erlang-workspace-'));
    smartLspDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-edit-erlang-smart-'));
    originalAssume = process.env.SMART_EDIT_ASSUME_ERLANG;
    originalAssumeLs = process.env.SMART_EDIT_ASSUME_ERLANG_LS;
    originalPath = process.env.SMART_EDIT_ERLANG_LS_PATH;
    process.env.SMART_EDIT_ASSUME_ERLANG = '1';
    process.env.SMART_EDIT_ASSUME_ERLANG_LS = '1';
  });

  afterEach(() => {
    if (originalAssume === undefined) {
      delete process.env.SMART_EDIT_ASSUME_ERLANG;
    } else {
      process.env.SMART_EDIT_ASSUME_ERLANG = originalAssume;
    }
    if (originalAssumeLs === undefined) {
      delete process.env.SMART_EDIT_ASSUME_ERLANG_LS;
    } else {
      process.env.SMART_EDIT_ASSUME_ERLANG_LS = originalAssumeLs;
    }
    if (originalPath === undefined) {
      delete process.env.SMART_EDIT_ERLANG_LS_PATH;
    } else {
      process.env.SMART_EDIT_ERLANG_LS_PATH = originalPath;
    }

    fs.rmSync(workspaceDir, { recursive: true, force: true });
    fs.rmSync(smartLspDir, { recursive: true, force: true });
  });

  it('registers with SmartLanguageServer registry for Language.ERLANG', () => {
    const config: LanguageServerConfigLike = {
      codeLanguage: Language.ERLANG
    };

    const server = SmartLanguageServer.create(config, { level: 'warn' }, workspaceDir, {
      smartLspSettings: { smartLspDir }
    });

    expect(server).toBeInstanceOf(ErlangLanguageServer);
    server.stop();
  });

  it('builds initialize parameters with capabilities and workspace metadata', () => {
    const server = new ErlangLanguageServer(
      { codeLanguage: Language.ERLANG },
      { level: 'warn' },
      workspaceDir,
      { smartLspSettings: { smartLspDir } }
    );

    const params = (server as unknown as { buildInitializeParams(): Record<string, unknown> }).buildInitializeParams();

    expect(params).toMatchObject({
      processId: process.pid,
      rootPath: workspaceDir,
      locale: 'en'
    });

    const typed = params as {
      workspaceFolders?: { uri?: string; name?: string }[];
      capabilities?: { textDocument?: Record<string, unknown>; workspace?: Record<string, unknown> };
    };

    expect(typed.capabilities?.textDocument).toBeTruthy();
    expect(typed.capabilities?.workspace).toBeTruthy();
    expect(typed.workspaceFolders?.[0]?.name).toBe(path.basename(workspaceDir));

    const matcher = server.ignoreSpec;
    expect(matcher.ignores(path.join('_build', 'index.erl'))).toBe(true);
    expect(matcher.ignores(path.join('src', 'main.erl'))).toBe(false);

    server.stop();
  });

  it('marks the server as ready when readiness messages are observed', async () => {
    const server = new ErlangLanguageServer(
      { codeLanguage: Language.ERLANG },
      { level: 'warn' },
      workspaceDir,
      { smartLspSettings: { smartLspDir } }
    );

    const readyPromise = (server as unknown as { readyPromise: Promise<void> }).readyPromise;
    (server as unknown as { handleWindowLogMessage(payload: unknown): void }).handleWindowLogMessage({
      message: 'Started Erlang LS and ready to serve requests'
    });

    await expect(readyPromise).resolves.toBeUndefined();
    server.stop();
  });
});
