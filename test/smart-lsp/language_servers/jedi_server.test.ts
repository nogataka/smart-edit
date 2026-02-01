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
import { JediLanguageServer } from '../../../src/smart-lsp/language_servers/jedi_server.js';

describe('JediLanguageServer', () => {
  let tempDir: string;
  let originalSkipRuntime: string | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-edit-jedi-ls-'));
    originalSkipRuntime = process.env.SMART_EDIT_SKIP_RUNTIME_INSTALL;
    process.env.SMART_EDIT_SKIP_RUNTIME_INSTALL = '1';
  });

  afterEach(() => {
    if (originalSkipRuntime === undefined) {
      delete process.env.SMART_EDIT_SKIP_RUNTIME_INSTALL;
    } else {
      process.env.SMART_EDIT_SKIP_RUNTIME_INSTALL = originalSkipRuntime;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('registers with SmartLanguageServer registry for Language.PYTHON_JEDI', () => {
    const config: LanguageServerConfigLike = {
      codeLanguage: Language.PYTHON_JEDI
    };

    const server = SmartLanguageServer.create(config, { level: 'warn' }, tempDir, {
      smartLspSettings: {
        smartLspDir: tempDir,
        projectDataRelativePath: '.smart-edit-test'
      }
    });

    expect(server).toBeInstanceOf(JediLanguageServer);

    server.stop();
  });

  it('builds initialize parameters matching jedi-language-server defaults', () => {
    const server = new JediLanguageServer(
      { codeLanguage: Language.PYTHON_JEDI },
      { level: 'warn' },
      tempDir,
      { smartLspSettings: { smartLspDir: tempDir } }
    );

    const params = (server as unknown as { buildInitializeParams(): Record<string, unknown> }).buildInitializeParams();

    expect(params).toMatchObject({
      processId: process.pid,
      rootPath: tempDir,
      initializationOptions: {
        workspace: {
          symbols: { maxSymbols: 0 }
        }
      }
    });

    const typedParams = params as {
      workspaceFolders?: { uri?: string; name?: string }[];
      capabilities?: { textDocument?: Record<string, unknown> };
    };

    const workspaceFolders = typedParams.workspaceFolders ?? [];
    expect(workspaceFolders).toHaveLength(1);
    expect(workspaceFolders[0]?.name).toBe(path.basename(tempDir));

    const capabilities = typedParams.capabilities;
    expect(capabilities?.textDocument).toBeTruthy();

    server.stop();
  });
});
