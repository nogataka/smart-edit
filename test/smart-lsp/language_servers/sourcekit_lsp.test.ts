import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SourceKitLanguageServer } from '../../../src/smart-lsp/language_servers/sourcekit_lsp.js';
import { Language } from '../../../src/smart-lsp/ls_config.js';

const ORIGINAL_ASSUME = process.env.SMART_EDIT_ASSUME_SOURCEKIT;
const ORIGINAL_INITIAL_DELAY = process.env.SMART_EDIT_SOURCEKIT_REFERENCE_INITIAL_DELAY_MS;
const ORIGINAL_RETRY_DELAY = process.env.SMART_EDIT_SOURCEKIT_REFERENCE_RETRY_DELAY_MS;

describe('SourceKitLanguageServer', () => {
  let workspaceDir: string;
  let smartLspDir: string;

  beforeEach(() => {
    process.env.SMART_EDIT_ASSUME_SOURCEKIT = '1';
    process.env.SMART_EDIT_SOURCEKIT_REFERENCE_INITIAL_DELAY_MS = '0';
    process.env.SMART_EDIT_SOURCEKIT_REFERENCE_RETRY_DELAY_MS = '0';
    workspaceDir = mkdtempSync(path.join(tmpdir(), 'smart-edit-sourcekit-workspace-'));
    smartLspDir = mkdtempSync(path.join(tmpdir(), 'smart-edit-sourcekit-smart-lsp-'));
  });

  afterEach(() => {
    if (ORIGINAL_ASSUME === undefined) {
      delete process.env.SMART_EDIT_ASSUME_SOURCEKIT;
    } else {
      process.env.SMART_EDIT_ASSUME_SOURCEKIT = ORIGINAL_ASSUME;
    }

    if (ORIGINAL_INITIAL_DELAY === undefined) {
      delete process.env.SMART_EDIT_SOURCEKIT_REFERENCE_INITIAL_DELAY_MS;
    } else {
      process.env.SMART_EDIT_SOURCEKIT_REFERENCE_INITIAL_DELAY_MS = ORIGINAL_INITIAL_DELAY;
    }

    if (ORIGINAL_RETRY_DELAY === undefined) {
      delete process.env.SMART_EDIT_SOURCEKIT_REFERENCE_RETRY_DELAY_MS;
    } else {
      process.env.SMART_EDIT_SOURCEKIT_REFERENCE_RETRY_DELAY_MS = ORIGINAL_RETRY_DELAY;
    }

    rmSync(workspaceDir, { recursive: true, force: true });
    rmSync(smartLspDir, { recursive: true, force: true });
  });

  it('marks Swift build artefact directories as ignored', () => {
    const server = new SourceKitLanguageServer(
      { codeLanguage: Language.SWIFT },
      null,
      workspaceDir,
      { smartLspSettings: { smartLspDir } }
    );

    const buildDir = path.join(workspaceDir, '.build');
    const distDir = path.join(workspaceDir, 'dist');
    mkdirSync(buildDir, { recursive: true });
    mkdirSync(distDir, { recursive: true });
    writeFileSync(path.join(buildDir, 'main.swift'), 'print("hello")');
    writeFileSync(path.join(distDir, 'artifact.swiftmodule'), 'binary');

    const sourcesDir = path.join(workspaceDir, 'Sources');
    mkdirSync(sourcesDir, { recursive: true });
    writeFileSync(path.join(sourcesDir, 'App.swift'), 'print("app")');

    expect(server.isIgnoredPath('.build/main.swift')).toBe(true);
    expect(server.isIgnoredPath('dist/artifact.swiftmodule')).toBe(true);
    expect(server.isIgnoredPath('Sources/App.swift')).toBe(false);

    server.stop();
  });

  it('includes repository metadata in initialize params', () => {
    const server = new SourceKitLanguageServer(
      { codeLanguage: Language.SWIFT },
      null,
      workspaceDir,
      { smartLspSettings: { smartLspDir } }
    );

    const params = (server as unknown as { buildInitializeParams: () => Record<string, unknown> }).buildInitializeParams();
    const rootPath = params.rootPath as string;
    const rootUri = params.rootUri as string;
    const workspaceFolders = params.workspaceFolders as { uri: string; name: string }[] | undefined;

    expect(rootPath).toBe(path.resolve(workspaceDir));
    expect(rootUri).toBe(pathToFileURL(path.resolve(workspaceDir)).href);
    expect(workspaceFolders?.[0]?.name).toBe(path.basename(workspaceDir));
    expect(workspaceFolders?.[0]?.uri).toBe(rootUri);

    const capabilities = params.capabilities as { textDocument?: unknown } | undefined;
    expect(capabilities?.textDocument).toBeTruthy();

    server.stop();
  });
});
