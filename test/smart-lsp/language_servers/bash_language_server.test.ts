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
import { BashLanguageServer } from '../../../src/smart-lsp/language_servers/bash_language_server.js';

describe('BashLanguageServer', () => {
  let tempDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-edit-bash-ls-'));
    originalEnv = process.env.SMART_EDIT_SKIP_RUNTIME_INSTALL;
    process.env.SMART_EDIT_SKIP_RUNTIME_INSTALL = '1';
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.SMART_EDIT_SKIP_RUNTIME_INSTALL;
    } else {
      process.env.SMART_EDIT_SKIP_RUNTIME_INSTALL = originalEnv;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates a registered BashLanguageServer instance via SmartLanguageServer.create', () => {
    const config: LanguageServerConfigLike = {
      codeLanguage: Language.BASH
    };

    const server = SmartLanguageServer.create(config, { level: 'warn' }, tempDir, {
      smartLspSettings: {
        smartLspDir: tempDir,
        projectDataRelativePath: '.smart-edit-test'
      }
    });

    expect(server).toBeInstanceOf(BashLanguageServer);

    server.stop();
  });
});
