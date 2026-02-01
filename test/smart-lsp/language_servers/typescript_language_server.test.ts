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
import { TypeScriptLanguageServer } from '../../../src/smart-lsp/language_servers/typescript_language_server.js';

describe('TypeScriptLanguageServer', () => {
  let tempDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-edit-typescript-ls-'));
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

  it('registers TypeScript language server and instantiates via SmartLanguageServer.create', () => {
    const config: LanguageServerConfigLike = {
      codeLanguage: Language.TYPESCRIPT
    };

    const server = SmartLanguageServer.create(config, { level: 'warn' }, tempDir, {
      smartLspSettings: {
        smartLspDir: tempDir,
        projectDataRelativePath: '.smart-edit-test'
      }
    });

    expect(server).toBeInstanceOf(TypeScriptLanguageServer);

    server.stop();
  });
});
