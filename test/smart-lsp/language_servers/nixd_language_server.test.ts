import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  NixLanguageServer,
  extendNixSymbolTree
} from '../../../src/smart-lsp/language_servers/nixd_language_server.js';
import { Language } from '../../../src/smart-lsp/ls_config.js';
import type { LspRange } from '../../../src/smart-lsp/ls.js';

const ORIGINAL_SKIP = process.env.SMART_EDIT_SKIP_RUNTIME_INSTALL;
const ORIGINAL_ASSUME = process.env.SMART_EDIT_ASSUME_NIXD;
const ORIGINAL_PATH = process.env.SMART_EDIT_NIXD_PATH;

describe('NixLanguageServer', () => {
  let workspaceDir: string;
  let smartLspDir: string;

  beforeEach(() => {
    process.env.SMART_EDIT_SKIP_RUNTIME_INSTALL = '1';
    process.env.SMART_EDIT_ASSUME_NIXD = '1';
    workspaceDir = mkdtempSync(path.join(tmpdir(), 'smart-edit-nix-workspace-'));
    smartLspDir = mkdtempSync(path.join(tmpdir(), 'smart-edit-nix-smart-lsp-'));
  });

  afterEach(() => {
    if (ORIGINAL_SKIP === undefined) {
      delete process.env.SMART_EDIT_SKIP_RUNTIME_INSTALL;
    } else {
      process.env.SMART_EDIT_SKIP_RUNTIME_INSTALL = ORIGINAL_SKIP;
    }

    if (ORIGINAL_ASSUME === undefined) {
      delete process.env.SMART_EDIT_ASSUME_NIXD;
    } else {
      process.env.SMART_EDIT_ASSUME_NIXD = ORIGINAL_ASSUME;
    }

    if (ORIGINAL_PATH === undefined) {
      delete process.env.SMART_EDIT_NIXD_PATH;
    } else {
      process.env.SMART_EDIT_NIXD_PATH = ORIGINAL_PATH;
    }

    rmSync(workspaceDir, { recursive: true, force: true });
    rmSync(smartLspDir, { recursive: true, force: true });
  });

  it('instantiates when runtime check is assumed', () => {
    const server = new NixLanguageServer(
      { codeLanguage: Language.NIX },
      null,
      workspaceDir,
      { smartLspSettings: { smartLspDir } }
    );

    expect(server).toBeInstanceOf(NixLanguageServer);
    server.stop();
  });

  it('ignores Nix build artifacts and direnv cache', () => {
    const resultFile = path.join(workspaceDir, 'result', 'default.nix');
    const direnvFile = path.join(workspaceDir, '.direnv', 'shell.nix');
    const trackedFile = path.join(workspaceDir, 'src', 'main.nix');

    fs.mkdirSync(path.dirname(resultFile), { recursive: true });
    fs.mkdirSync(path.dirname(direnvFile), { recursive: true });
    fs.mkdirSync(path.dirname(trackedFile), { recursive: true });
    writeFileSync(resultFile, '{ };\n');
    writeFileSync(direnvFile, '{ };\n');
    writeFileSync(trackedFile, '{ };\n');

    const server = new NixLanguageServer(
      { codeLanguage: Language.NIX },
      null,
      workspaceDir,
      { smartLspSettings: { smartLspDir } }
    );

    expect(server.isIgnoredPath('result/default.nix')).toBe(true);
    expect(server.isIgnoredPath('.direnv/shell.nix')).toBe(true);
    expect(server.isIgnoredPath('src/main.nix')).toBe(false);

    server.stop();
  });
});

describe('extendNixSymbolTree', () => {
  it('extends ranges to include trailing semicolons', () => {
    const symbol = {
      name: 'example',
      kind: 5,
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 17 }
      },
      location: {
        relativePath: 'default.nix',
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 17 }
        }
      }
    };

    const fileContents = 'example = "value";\n';
    const extended = extendNixSymbolTree(symbol, fileContents);

    const extendedRange = (extended.range as LspRange | undefined)?.end?.character ?? null;
    const extendedLocationRange = ((extended.location as { range?: LspRange | null } | null)?.range ?? null)?.end
      ?.character ?? null;
    expect(extendedRange).toBe(18);
    expect(extendedLocationRange).toBe(18);
  });

  it('keeps original range when no semicolon present', () => {
    const symbol = {
      name: 'noSemicolon',
      kind: 5,
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 10 }
      }
    };

    const fileContents = 'noSemicolon = "value"\n';
    const extended = extendNixSymbolTree(symbol, fileContents);

    const extendedRange = (extended.range as LspRange | undefined)?.end?.character ?? null;
    expect(extendedRange).toBe(10);
  });
});
