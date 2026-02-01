import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { LogLevel } from '../../smart-edit/util/logging.js';
import { ensureDefaultSubprocessOptions } from '../util/subprocess_util.js';
import { Language } from '../ls_config.js';
import {
  type DocumentSymbolResult,
  type DocumentSymbolsOptions,
  type LanguageServerConfigLike,
  type LspRange,
  type SmartLanguageServerConstructor,
  type SmartLanguageServerOptions,
  type UnifiedSymbolInformation,
  SmartLanguageServer,
  registerLanguageServer
} from '../ls.js';
import { NodeLanguageServerHandler } from '../ls_handler.js';

const NIXD_ASSUME_ENV = 'SMART_EDIT_ASSUME_NIXD';
const NIXD_PATH_ENV = 'SMART_EDIT_NIXD_PATH';

const NIX_IGNORED_PATTERNS = [
  '**/result',
  '**/result/**',
  '**/result-*',
  '**/result-*/**',
  '**/.direnv',
  '**/.direnv/**'
];

interface InitializeResponseLike {
  capabilities?: Record<string, unknown> | null;
}

interface CapabilitiesWithRequiredFields {
  textDocumentSync?: unknown;
  definitionProvider?: unknown;
  documentSymbolProvider?: unknown;
  referencesProvider?: unknown;
}

export class NixLanguageServer extends SmartLanguageServer {
  protected override readonly handler: NodeLanguageServerHandler;
  private initialized = false;

  constructor(
    config: LanguageServerConfigLike,
    loggerLike: { level?: number | LogLevel } | null,
    repositoryRootPath: string,
    options: SmartLanguageServerOptions = {}
  ) {
    const augmentedConfig: LanguageServerConfigLike = {
      ...config,
      ignoredPaths: mergeIgnoredPatterns(config.ignoredPaths, NIX_IGNORED_PATTERNS)
    };

    const binaryPath = ensureNixdRuntime();
    const providedHandler = options.handler;
    if (providedHandler && !(providedHandler instanceof NodeLanguageServerHandler)) {
      throw new TypeError('NixLanguageServer requires a NodeLanguageServerHandler when supplying a custom handler.');
    }
    const handler = providedHandler ?? new NodeLanguageServerHandler({
      cmd: binaryPath,
      cwd: repositoryRootPath
    });

    super(augmentedConfig, loggerLike, repositoryRootPath, {
      ...options,
      handler,
      smartLspSettings: options?.smartLspSettings
    });

    this.handler = handler;
    this.registerHandlers();
  }

  override start(): this {
    const shouldInitialize = !this.initialized;
    super.start();
    if (shouldInitialize) {
      this.initializeLanguageServer();
      this.initialized = true;
    }
    return this;
  }

  override stop(shutdownTimeout = 2.0): void {
    super.stop(shutdownTimeout);
    this.initialized = false;
  }

  override requestDocumentSymbols(
    relativePath: string,
    options: DocumentSymbolsOptions = {}
  ): DocumentSymbolResult {
    const result = super.requestDocumentSymbols(relativePath, options);
    let fileContents: string;
    try {
      fileContents = this.retrieveFullFileContent(relativePath);
    } catch (error) {
      this.logger.warn(`Failed to read file contents for ${relativePath}: ${(error as Error).message}`);
      return result;
    }

    return {
      documentSymbols: result.documentSymbols.map((symbol) => extendNixSymbolTree(symbol, fileContents)),
      outlineSymbols: result.outlineSymbols.map((symbol) => extendNixSymbolTree(symbol, fileContents))
    };
  }

  private registerHandlers(): void {
    const noop = () => undefined;
    this.handler.onRequest('client/registerCapability', noop);
    this.handler.onNotification('$/progress', noop);
    this.handler.onNotification('textDocument/publishDiagnostics', noop);
    this.handler.onNotification('experimental/serverStatus', noop);
    this.handler.onNotification('window/logMessage', (payload: unknown) => {
      const message = extractWindowMessage(payload);
      if (message) {
        this.logger.info(`nixd: ${message}`);
      }
    });
  }

  private initializeLanguageServer(): void {
    this.logger.info('Initializing nixd language server');
    const params = buildInitializeParams(this.repositoryRootPath);
    const response = this.handler.sendRequest('initialize', params) as InitializeResponseLike | null;

    this.verifyCapabilities(response?.capabilities ?? null);
    this.handler.notify.initialized({});
  }

  private verifyCapabilities(capabilities: Record<string, unknown> | null): void {
    if (!capabilities || typeof capabilities !== 'object') {
      throw new Error('nixd initialization response is missing capabilities.');
    }

    const required = capabilities as CapabilitiesWithRequiredFields;
    for (const key of ['textDocumentSync', 'definitionProvider', 'documentSymbolProvider', 'referencesProvider']) {
      if (!(key in required)) {
        throw new Error(`nixd did not advertise required capability '${key}'.`);
      }
    }
  }
}

registerLanguageServer(Language.NIX, NixLanguageServer as SmartLanguageServerConstructor);

function mergeIgnoredPatterns(existing: string[] | undefined, additions: string[]): string[] {
  const merged = new Set(existing ?? []);
  for (const pattern of additions) {
    merged.add(pattern);
  }
  return Array.from(merged);
}

export function extendNixSymbolTree(
  symbol: UnifiedSymbolInformation,
  fileContents: string
): UnifiedSymbolInformation {
  const extended = extendSymbolRange(symbol, fileContents);
  const children = Array.isArray(symbol.children) ? symbol.children : undefined;

  return {
    ...extended,
    children: children?.map((child) => extendNixSymbolTree(child, fileContents))
  };
}

function extendSymbolRange(symbol: UnifiedSymbolInformation, fileContents: string): UnifiedSymbolInformation {
  const rangeHolder = symbol as UnifiedSymbolInformation & { range?: LspRange | null };
  const { range } = rangeHolder;
  const endPosition = range?.end ?? null;
  if (!endPosition) {
    return { ...symbol };
  }

  const endChar = endPosition.character;
  if (endChar == null) {
    return { ...symbol };
  }

  const endLine = endPosition.line;
  if (typeof endLine !== 'number' || typeof endChar !== 'number') {
    return { ...symbol };
  }

  const lines = fileContents.split('\n');
  if (endLine >= lines.length) {
    return { ...symbol };
  }

  const line = lines[endLine];
  if (!line || endChar >= line.length || line[endChar] !== ';') {
    return { ...symbol };
  }

  const extendedRange: LspRange = {
    ...(range ?? {}),
    end: { line: endLine, character: endChar + 1 }
  };

  const locationValue = symbol.location;
  let updatedLocation: typeof symbol.location = locationValue ?? null;
  if (isLocationObject(locationValue)) {
    const locationRange = locationValue.range ?? null;
    updatedLocation = {
      ...locationValue,
      range: {
        ...(locationRange ?? {}),
        end: { line: endLine, character: endChar + 1 }
      }
    };
  }

  return {
    ...symbol,
    range: extendedRange,
    selectionRange: extendedRange,
    location: updatedLocation
  };
}

function buildInitializeParams(repositoryRoot: string): Record<string, unknown> {
  const absoluteRoot = path.resolve(repositoryRoot);
  const rootUri = pathToFileURL(absoluteRoot).href;

  return {
    locale: 'en',
    processId: process.pid,
    rootPath: absoluteRoot,
    rootUri,
    workspaceFolders: [
      {
        uri: rootUri,
        name: path.basename(absoluteRoot)
      }
    ],
    capabilities: buildClientCapabilities(),
    initializationOptions: {
      nixpkgs: { expr: 'import <nixpkgs> { }' },
      formatting: { command: ['nixpkgs-fmt'] },
      options: {
        enable: true,
        target: {
          installable: ''
        }
      }
    }
  } satisfies Record<string, unknown>;
}

function buildClientCapabilities(): Record<string, unknown> {
  const symbolKinds = Array.from({ length: 26 }, (_, index) => index + 1);
  return {
    textDocument: {
      synchronization: { didSave: true, dynamicRegistration: true },
      definition: { dynamicRegistration: true },
      references: { dynamicRegistration: true },
      documentSymbol: {
        dynamicRegistration: true,
        hierarchicalDocumentSymbolSupport: true,
        symbolKind: { valueSet: symbolKinds }
      },
      completion: {
        dynamicRegistration: true,
        completionItem: {
          snippetSupport: true,
          commitCharactersSupport: true,
          documentationFormat: ['markdown', 'plaintext'],
          deprecatedSupport: true,
          preselectSupport: true
        }
      },
      hover: {
        dynamicRegistration: true,
        contentFormat: ['markdown', 'plaintext']
      },
      signatureHelp: {
        dynamicRegistration: true,
        signatureInformation: {
          documentationFormat: ['markdown', 'plaintext'],
          parameterInformation: { labelOffsetSupport: true }
        }
      },
      codeAction: {
        dynamicRegistration: true,
        codeActionLiteralSupport: {
          codeActionKind: {
            valueSet: ['', 'quickfix', 'refactor', 'refactor.extract', 'refactor.inline', 'refactor.rewrite', 'source', 'source.organizeImports']
          }
        }
      },
      rename: { dynamicRegistration: true, prepareSupport: true }
    },
    workspace: {
      workspaceFolders: true,
      didChangeConfiguration: { dynamicRegistration: true },
      configuration: true,
      symbol: {
        dynamicRegistration: true,
        symbolKind: { valueSet: symbolKinds }
      }
    }
  } satisfies Record<string, unknown>;
}

function ensureNixdRuntime(): string {
  if (process.env[NIXD_ASSUME_ENV] === '1') {
    return process.env[NIXD_PATH_ENV] ?? defaultNixdCommand();
  }

  if (process.platform === 'win32') {
    throw new Error('nixd は Windows を公式サポートしていません。WSL または Linux/macOS 上で実行してください。');
  }

  ensureNixAvailable();

  const detected = detectNixdBinary();
  if (detected) {
    verifyNixdBinary(detected);
    return detected;
  }

  if (process.env.SMART_EDIT_SKIP_RUNTIME_INSTALL === '1') {
    throw new Error(
      'nixd バイナリが見つかりません。SMART_EDIT_SKIP_RUNTIME_INSTALL=0 で自動インストールを許可するか、nixd を手動でインストールしてください。'
    );
  }

  const installed = installNixdViaNix();
  if (installed) {
    verifyNixdBinary(installed);
    return installed;
  }

  throw new Error(
    'nixd (Nix Language Server) が見つかりません。`nix profile install github:nix-community/nixd` などでインストールし、PATH を更新してください。'
  );
}

function ensureNixAvailable(): void {
  const result = spawnSync(
    'nix',
    ['--version'],
    ensureDefaultSubprocessOptions({ encoding: 'utf-8', timeout: 5000 })
  );
  if (result.error || result.status !== 0) {
    throw new Error('Nix が見つかりません。https://nixos.org/download.html の手順で Nix をセットアップしてください。');
  }
}

function detectNixdBinary(): string | null {
  const overridePath = process.env[NIXD_PATH_ENV];
  if (overridePath) {
    return overridePath;
  }

  const locator = process.platform === 'win32' ? 'where' : 'which';
  const whichResult = spawnSync(
    locator,
    ['nixd'],
    ensureDefaultSubprocessOptions({ encoding: 'utf-8', timeout: 2000 })
  );
  if (whichResult.status === 0 && whichResult.stdout) {
    const firstLine = whichResult.stdout.split(/\r?\n/)[0]?.trim();
    if (firstLine) {
      return firstLine;
    }
  }

  const home = os.homedir();
  const candidates = [
    path.join(home, '.local', 'bin', 'nixd'),
    path.join(home, '.smart-edit', 'language_servers', 'nixd', 'nixd'),
    path.join(home, '.nix-profile', 'bin', 'nixd'),
    '/usr/local/bin/nixd',
    '/run/current-system/sw/bin/nixd',
    '/opt/homebrew/bin/nixd',
    '/usr/local/opt/nixd/bin/nixd'
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function installNixdViaNix(): string | null {
  const commands: { cmd: string; args: string[] }[] = [
    { cmd: 'nix', args: ['profile', 'install', 'github:nix-community/nixd'] },
    { cmd: 'nix-env', args: ['-iA', 'nixpkgs.nixd'] }
  ];

  for (const command of commands) {
    const result = spawnSync(
      command.cmd,
      command.args,
      ensureDefaultSubprocessOptions({ encoding: 'utf-8', timeout: 600_000 })
    );
    if (result.status === 0) {
      const detected = detectNixdBinary();
      if (detected) {
        return detected;
      }
    }
  }

  return null;
}

function verifyNixdBinary(binaryPath: string): void {
  const result = spawnSync(
    binaryPath,
    ['--version'],
    ensureDefaultSubprocessOptions({ encoding: 'utf-8', timeout: 5000 })
  );
  if (result.error || result.status !== 0) {
    throw new Error(`nixd 実行ファイルの検証に失敗しました: ${result.stderr ?? result.stdout ?? ''}`.trim());
  }
}

function extractWindowMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const maybeMessage = (payload as { message?: unknown }).message;
  return typeof maybeMessage === 'string' ? maybeMessage : null;
}

function defaultNixdCommand(): string {
  return process.platform === 'win32' ? 'nixd.exe' : 'nixd';
}

function isLocationObject(
  value: unknown
): value is Record<string, unknown> & { range?: LspRange | null } {
  return typeof value === 'object' && value !== null;
}
