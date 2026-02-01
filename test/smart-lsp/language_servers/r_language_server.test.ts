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
import { RLanguageServer } from '../../../src/smart-lsp/language_servers/r_language_server.js';

describe('RLanguageServer', () => {
  let workspaceDir: string;
  let smartLspDir: string;
  let originalAssume: string | undefined;

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-edit-r-workspace-'));
    smartLspDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-edit-r-smart-'));
    originalAssume = process.env.SMART_EDIT_ASSUME_R;
    process.env.SMART_EDIT_ASSUME_R = '1';
  });

  afterEach(() => {
    if (originalAssume === undefined) {
      delete process.env.SMART_EDIT_ASSUME_R;
    } else {
      process.env.SMART_EDIT_ASSUME_R = originalAssume;
    }
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    fs.rmSync(smartLspDir, { recursive: true, force: true });
  });

  it('registers with SmartLanguageServer registry for Language.R', () => {
    const config: LanguageServerConfigLike = {
      codeLanguage: Language.R
    };

    const server = SmartLanguageServer.create(config, { level: 'warn' }, workspaceDir, {
      smartLspSettings: { smartLspDir }
    });

    expect(server).toBeInstanceOf(RLanguageServer);

    server.stop();
  });

  it('builds initialize parameters with workspace metadata and capabilities', () => {
    const server = new RLanguageServer(
      { codeLanguage: Language.R },
      { level: 'warn' },
      workspaceDir,
      { smartLspSettings: { smartLspDir } }
    );

    const params = (server as unknown as { buildInitializeParams(): Record<string, unknown> }).buildInitializeParams();

    expect(params).toMatchObject({
      locale: 'en',
      processId: process.pid,
      rootPath: workspaceDir
    });

    const typed = params as {
      capabilities?: { textDocument?: Record<string, unknown>; workspace?: Record<string, unknown> };
      workspaceFolders?: { uri?: string; name?: string }[];
    };

    expect(typed.capabilities?.textDocument).toBeTruthy();
    expect(typed.capabilities?.workspace).toBeTruthy();

    const [folder] = typed.workspaceFolders ?? [];
    expect(folder?.name).toBe(path.basename(workspaceDir));

    const matcher = server.ignoreSpec;
    expect(matcher.ignores('renv/library.R')).toBe(true);
    expect(matcher.ignores('src/main.R')).toBe(false);

    server.stop();
  });
});
