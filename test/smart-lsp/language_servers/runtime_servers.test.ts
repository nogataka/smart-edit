import fs, { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ClangdLanguageServer } from '../../../src/smart-lsp/language_servers/clangd_language_server.js';
import { CSharpLanguageServer } from '../../../src/smart-lsp/language_servers/csharp_language_server.js';
import { ClojureLanguageServer } from '../../../src/smart-lsp/language_servers/clojure_lsp.js';
import { IntelephenseLanguageServer } from '../../../src/smart-lsp/language_servers/intelephense.js';
import { DartLanguageServer } from '../../../src/smart-lsp/language_servers/dart_language_server.js';
import { GoplsLanguageServer } from '../../../src/smart-lsp/language_servers/gopls.js';
import { TerraformLanguageServer } from '../../../src/smart-lsp/language_servers/terraform_ls.js';
import { RustAnalyzerLanguageServer } from '../../../src/smart-lsp/language_servers/rust_analyzer.js';
import { VtsLanguageServer } from '../../../src/smart-lsp/language_servers/vts_language_server.js';
import { EclipseJdtLanguageServer } from '../../../src/smart-lsp/language_servers/eclipse_jdtls.js';
import { KotlinLanguageServer } from '../../../src/smart-lsp/language_servers/kotlin_language_server.js';
import { LuaLanguageServer } from '../../../src/smart-lsp/language_servers/lua_ls.js';
import { RLanguageServer } from '../../../src/smart-lsp/language_servers/r_language_server.js';
import { RubyLspLanguageServer } from '../../../src/smart-lsp/language_servers/ruby_lsp.js';
import { SolargraphLanguageServer } from '../../../src/smart-lsp/language_servers/solargraph.js';
import { SourceKitLanguageServer } from '../../../src/smart-lsp/language_servers/sourcekit_lsp.js';
import { ErlangLanguageServer } from '../../../src/smart-lsp/language_servers/erlang_language_server.js';
import { NixLanguageServer } from '../../../src/smart-lsp/language_servers/nixd_language_server.js';
import { ZigLanguageServer } from '../../../src/smart-lsp/language_servers/zls.js';
import { Language } from '../../../src/smart-lsp/ls_config.js';

const ORIGINAL_SKIP = process.env.SMART_EDIT_SKIP_RUNTIME_INSTALL;

describe('Runtime language servers (binary preinstalled)', () => {
  let workspaceDir: string;
  let smartLspDir: string;

  beforeEach(() => {
    process.env.SMART_EDIT_SKIP_RUNTIME_INSTALL = '1';
    process.env.SMART_EDIT_ASSUME_CLOJURE = '1';
    process.env.SMART_EDIT_ASSUME_TERRAFORM = '1';
    process.env.SMART_EDIT_ASSUME_INTELEPHENSE = '1';
    process.env.SMART_EDIT_ASSUME_VTSLS = '1';
    workspaceDir = mkdtempSync(path.join(tmpdir(), 'smart-edit-lang-workspace-'));
    smartLspDir = mkdtempSync(path.join(tmpdir(), 'smart-edit-lang-smart-'));
  });

  afterEach(() => {
    process.env.SMART_EDIT_SKIP_RUNTIME_INSTALL = ORIGINAL_SKIP;
    delete process.env.SMART_EDIT_ASSUME_CLOJURE;
    delete process.env.SMART_EDIT_ASSUME_TERRAFORM;
    delete process.env.SMART_EDIT_ASSUME_INTELEPHENSE;
    delete process.env.SMART_EDIT_ASSUME_VTSLS;
    delete process.env.SMART_EDIT_ASSUME_ERLANG;
    delete process.env.SMART_EDIT_ASSUME_ERLANG_LS;
    delete process.env.SMART_EDIT_ERLANG_LS_PATH;
    delete process.env.SMART_EDIT_RUST_ANALYZER_PATH;
    delete process.env.SMART_EDIT_ASSUME_GOPLS;
    delete process.env.SMART_EDIT_ASSUME_R;
    delete process.env.SMART_EDIT_ASSUME_RUBY_LSP;
    delete process.env.SMART_EDIT_ASSUME_SOLARGRAPH;
    delete process.env.SMART_EDIT_ASSUME_SOURCEKIT;
    delete process.env.SMART_EDIT_ASSUME_NIXD;
    delete process.env.SMART_EDIT_ASSUME_ZLS;
    delete process.env.SMART_EDIT_ZLS_PATH;
    delete process.env.SMART_EDIT_ZIG_PATH;
    rmSync(workspaceDir, { recursive: true, force: true });
    rmSync(smartLspDir, { recursive: true, force: true });
  });

  it('instantiates ClangdLanguageServer when binary exists', () => {
    const binaryRelative = process.platform === 'win32' ? 'clangd_19.1.2/bin/clangd.exe' : 'clangd_19.1.2/bin/clangd';
    const binaryPath = prepareBinary('clangd', binaryRelative);

    const server = new ClangdLanguageServer(
      { codeLanguage: Language.CPP },
      null,
      workspaceDir,
      { smartLspSettings: { smartLspDir } }
    );

    expect(server).toBeInstanceOf(ClangdLanguageServer);
    expect(path.isAbsolute(binaryPath)).toBe(true);
    server.stop();
  });

  it('instantiates CSharpLanguageServer when dotnet runtime and Roslyn DLL exist', () => {
    const dotnetBinary = process.platform === 'win32' ? 'dotnet.exe' : 'dotnet';
    const dotnetPath = prepareCSharpDotnet(dotnetBinary);
    const { packageName, packageVersion } = resolveCSharpPackageInfo();
    const dllPath = prepareCSharpLanguageServer(packageName, packageVersion);

    expect(fs.existsSync(dotnetPath)).toBe(true);
    expect(fs.existsSync(dllPath)).toBe(true);

    const server = new CSharpLanguageServer(
      { codeLanguage: Language.CSHARP },
      null,
      workspaceDir,
      { smartLspSettings: { smartLspDir } }
    );

    expect(server).toBeInstanceOf(CSharpLanguageServer);
    server.stop();
  });

  it('instantiates EclipseJdtLanguageServer when runtime assets exist', () => {
    prepareEclipseJdtRuntime();

    const server = new EclipseJdtLanguageServer(
      { codeLanguage: Language.JAVA },
      null,
      workspaceDir,
      { smartLspSettings: { smartLspDir } }
    );

    expect(server).toBeInstanceOf(EclipseJdtLanguageServer);
    server.stop();
  });

  it('instantiates ClojureLanguageServer when binary exists', () => {
    const binaryRelative = process.platform === 'win32' ? 'clojure-lsp.exe' : 'clojure-lsp';
    prepareBinary('clojure-lsp', binaryRelative);

    const server = new ClojureLanguageServer(
      { codeLanguage: Language.CLOJURE },
      null,
      workspaceDir,
      { smartLspSettings: { smartLspDir } }
    );

    expect(server).toBeInstanceOf(ClojureLanguageServer);
    server.stop();
  });

  it('instantiates ErlangLanguageServer when runtime is assumed', () => {
    process.env.SMART_EDIT_ASSUME_ERLANG = '1';
    process.env.SMART_EDIT_ASSUME_ERLANG_LS = '1';

    const server = new ErlangLanguageServer(
      { codeLanguage: Language.ERLANG },
      null,
      workspaceDir,
      { smartLspSettings: { smartLspDir } }
    );

    expect(server).toBeInstanceOf(ErlangLanguageServer);
    server.stop();
  });

  it('instantiates DartLanguageServer when binary exists', () => {
    const binaryRelative = process.platform === 'win32' ? 'dart-sdk/bin/dart.exe' : 'dart-sdk/bin/dart';
    prepareBinary('dart-sdk', binaryRelative);

    const server = new DartLanguageServer(
      { codeLanguage: Language.DART },
      null,
      workspaceDir,
      { smartLspSettings: { smartLspDir } }
    );

    expect(server).toBeInstanceOf(DartLanguageServer);
    server.stop();
  });

  it('instantiates RustAnalyzerLanguageServer when override path is provided', () => {
    const customPath = path.join(workspaceDir, process.platform === 'win32' ? 'rust-analyzer.exe' : 'rust-analyzer');
    writeFileSync(customPath, '');
    process.env.SMART_EDIT_RUST_ANALYZER_PATH = customPath;

    const server = new RustAnalyzerLanguageServer(
      { codeLanguage: Language.RUST },
      null,
      workspaceDir
    );

    expect(server).toBeInstanceOf(RustAnalyzerLanguageServer);
    server.stop();
  });

  it('instantiates GoplsLanguageServer when runtime check is bypassed', () => {
    process.env.SMART_EDIT_ASSUME_GOPLS = '1';
    const server = new GoplsLanguageServer(
      { codeLanguage: Language.GO },
      null,
      workspaceDir
    );

    expect(server).toBeInstanceOf(GoplsLanguageServer);
    server.stop();
  });

  it('instantiates RLanguageServer when runtime check is bypassed', () => {
    process.env.SMART_EDIT_ASSUME_R = '1';
    const server = new RLanguageServer(
      { codeLanguage: Language.R },
      null,
      workspaceDir
    );

    expect(server).toBeInstanceOf(RLanguageServer);
    server.stop();
  });

  it('instantiates NixLanguageServer when runtime check is bypassed', () => {
    process.env.SMART_EDIT_ASSUME_NIXD = '1';
    const server = new NixLanguageServer(
      { codeLanguage: Language.NIX },
      null,
      workspaceDir,
      { smartLspSettings: { smartLspDir } }
    );

    expect(server).toBeInstanceOf(NixLanguageServer);
    server.stop();
  });

  it('instantiates ZigLanguageServer when runtime check is bypassed', () => {
    process.env.SMART_EDIT_ASSUME_ZLS = '1';
    const server = new ZigLanguageServer(
      { codeLanguage: Language.ZIG },
      null,
      workspaceDir,
      { smartLspSettings: { smartLspDir } }
    );

    expect(server).toBeInstanceOf(ZigLanguageServer);
    server.stop();
  });

  it('instantiates RubyLspLanguageServer when runtime check is bypassed', () => {
    process.env.SMART_EDIT_ASSUME_RUBY_LSP = '1';
    const server = new RubyLspLanguageServer(
      { codeLanguage: Language.RUBY },
      null,
      workspaceDir
    );

    expect(server).toBeInstanceOf(RubyLspLanguageServer);
    server.stop();
  });

  it('instantiates SolargraphLanguageServer when runtime check is bypassed', () => {
    process.env.SMART_EDIT_ASSUME_SOLARGRAPH = '1';
    const server = new SolargraphLanguageServer(
      { codeLanguage: Language.RUBY_SOLARGRAPH },
      null,
      workspaceDir
    );

    expect(server).toBeInstanceOf(SolargraphLanguageServer);
    server.stop();
  });

  it('instantiates SourceKitLanguageServer when runtime check is bypassed', () => {
    process.env.SMART_EDIT_ASSUME_SOURCEKIT = '1';
    const server = new SourceKitLanguageServer(
      { codeLanguage: Language.SWIFT },
      null,
      workspaceDir
    );

    expect(server).toBeInstanceOf(SourceKitLanguageServer);
    server.stop();
  });

  it('instantiates IntelephenseLanguageServer when binary exists', () => {
    const binaryName = process.platform === 'win32' ? 'intelephense.cmd' : 'intelephense';
    const binaryPath = prepareNpmBinary('php-lsp', binaryName);

    const server = new IntelephenseLanguageServer(
      { codeLanguage: Language.PHP },
      null,
      workspaceDir,
      { smartLspSettings: { smartLspDir } }
    );

    expect(server).toBeInstanceOf(IntelephenseLanguageServer);
    expect(fs.existsSync(binaryPath)).toBe(true);
    server.stop();
  });

  it('instantiates VtsLanguageServer when binary exists', () => {
    const binaryName = process.platform === 'win32' ? 'vtsls.cmd' : 'vtsls';
    const binaryPath = prepareNpmBinary('vts-lsp', binaryName);

    const server = new VtsLanguageServer(
      { codeLanguage: Language.TYPESCRIPT_VTS },
      null,
      workspaceDir,
      { smartLspSettings: { smartLspDir } }
    );

    expect(server).toBeInstanceOf(VtsLanguageServer);
    expect(fs.existsSync(binaryPath)).toBe(true);
    server.stop();
  });

  it('instantiates TerraformLanguageServer when binary exists', () => {
    const binaryRelative = process.platform === 'win32' ? 'terraform-ls.exe' : 'terraform-ls';
    const binaryPath = prepareBinary('terraform-ls', binaryRelative);

    const server = new TerraformLanguageServer(
      { codeLanguage: Language.TERRAFORM },
      null,
      workspaceDir,
      { smartLspSettings: { smartLspDir } }
    );

    expect(server).toBeInstanceOf(TerraformLanguageServer);
    expect(path.isAbsolute(binaryPath)).toBe(true);
    server.stop();
  });

  it('instantiates KotlinLanguageServer when runtime assets exist', () => {
    prepareKotlinRuntime();

    const server = new KotlinLanguageServer(
      { codeLanguage: Language.KOTLIN },
      null,
      workspaceDir,
      { smartLspSettings: { smartLspDir } }
    );

    expect(server).toBeInstanceOf(KotlinLanguageServer);
    server.stop();
  });

  it('instantiates LuaLanguageServer when runtime binary exists', () => {
    const binaryRelative = determineLuaBinaryRelativePath();
    prepareBinary('lua-language-server', binaryRelative);

    const server = new LuaLanguageServer(
      { codeLanguage: Language.LUA },
      null,
      workspaceDir,
      { smartLspSettings: { smartLspDir } }
    );

    expect(server).toBeInstanceOf(LuaLanguageServer);
    server.stop();
  });

  const LUA_LS_VERSION = '3.15.0';

  function determineLuaBinaryRelativePath(): string {
    const executableName = process.platform === 'win32' ? 'lua-language-server.exe' : 'lua-language-server';
    if (process.platform === 'win32') {
      return `lua-language-server-${LUA_LS_VERSION}-win32-x64/bin/${executableName}`;
    }
    if (process.platform === 'darwin') {
      const suffix = process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
      return `lua-language-server-${LUA_LS_VERSION}-${suffix}/bin/${executableName}`;
    }
    const linuxSuffix = process.arch === 'arm64' ? 'linux-arm64' : 'linux-x64';
    return `lua-language-server-${LUA_LS_VERSION}-${linuxSuffix}/bin/${executableName}`;
  }

  function prepareBinary(directoryName: string, relativeBinaryPath: string): string {
    const baseDir = path.join(smartLspDir, 'language_servers', 'static', directoryName);
    const fullPath = path.join(baseDir, relativeBinaryPath);
    mkdirSync(path.dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, '');
    return fullPath;
  }

  function prepareNpmBinary(directoryName: string, binaryName: string): string {
    const baseDir = path.join(smartLspDir, 'language_servers', 'static', directoryName, 'node_modules', '.bin');
    const binaryPath = path.join(baseDir, binaryName);
    mkdirSync(baseDir, { recursive: true });
    writeFileSync(binaryPath, '');
    if (process.platform !== 'win32') {
      fs.chmodSync(binaryPath, 0o755);
    }
    return binaryPath;
  }

  function resolveCSharpPackageInfo(): { packageName: string; packageVersion: string } {
    const version = '5.0.0-1.25329.6';
    if (process.platform === 'win32') {
      return {
        packageName:
          process.arch === 'arm64'
            ? 'Microsoft.CodeAnalysis.LanguageServer.win-arm64'
            : 'Microsoft.CodeAnalysis.LanguageServer.win-x64',
        packageVersion: version
      };
    }
    if (process.platform === 'darwin') {
      return {
        packageName:
          process.arch === 'arm64'
            ? 'Microsoft.CodeAnalysis.LanguageServer.osx-arm64'
            : 'Microsoft.CodeAnalysis.LanguageServer.osx-x64',
        packageVersion: version
      };
    }
    return {
      packageName:
        process.arch === 'arm64'
          ? 'Microsoft.CodeAnalysis.LanguageServer.linux-arm64'
          : 'Microsoft.CodeAnalysis.LanguageServer.linux-x64',
      packageVersion: version
    };
  }

  function prepareCSharpDotnet(binaryName: string): string {
    const baseDir = path.join(smartLspDir, 'language_servers', 'static', 'csharp', 'dotnet-runtime-9.0');
    const fullPath = path.join(baseDir, binaryName);
    mkdirSync(path.dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, '');
    if (process.platform !== 'win32') {
      fs.chmodSync(fullPath, 0o755);
    }
    return fullPath;
  }

  function prepareCSharpLanguageServer(packageName: string, packageVersion: string): string {
    const baseDir = path.join(
      smartLspDir,
      'language_servers',
      'static',
      'csharp',
      'language-server',
      `${packageName}.${packageVersion}`
    );
    const dllPath = path.join(baseDir, 'Microsoft.CodeAnalysis.LanguageServer.dll');
    mkdirSync(path.dirname(dllPath), { recursive: true });
    writeFileSync(dllPath, '');
    if (process.platform !== 'win32') {
      fs.chmodSync(dllPath, 0o755);
    }
    return dllPath;
  }

  function prepareEclipseJdtRuntime(): void {
    const baseDir = path.join(smartLspDir, 'language_servers', 'static', 'eclipse-jdtls');
    const gradleBinary = process.platform === 'win32' ? 'gradle.bat' : 'gradle';
    const gradlePath = path.join(baseDir, 'gradle-8.14.2', 'bin', gradleBinary);
    mkdirSync(path.dirname(gradlePath), { recursive: true });
    writeFileSync(gradlePath, '');

    const vscodeRoot = path.join(baseDir, 'vscode-java');
    const { jreHome, jreBinary, lombokJar, launcherJar, readonlyConfig } = resolveVsCodeJavaPaths();
    mkdirSync(path.join(vscodeRoot, jreHome), { recursive: true });
    mkdirSync(path.join(vscodeRoot, path.dirname(jreBinary)), { recursive: true });
    writeFileSync(path.join(vscodeRoot, jreBinary), '');
    mkdirSync(path.join(vscodeRoot, path.dirname(lombokJar)), { recursive: true });
    writeFileSync(path.join(vscodeRoot, lombokJar), '');
    mkdirSync(path.join(vscodeRoot, path.dirname(launcherJar)), { recursive: true });
    writeFileSync(path.join(vscodeRoot, launcherJar), '');
    mkdirSync(path.join(vscodeRoot, readonlyConfig), { recursive: true });

    const intellicodeJar = path.join(
      baseDir,
      'intellicode',
      'extension',
      'dist',
      'com.microsoft.jdtls.intellicode.core-0.7.0.jar'
    );
    const membersDir = path.join(
      baseDir,
      'intellicode',
      'extension',
      'dist',
      'bundledModels',
      'java_intellisense-members'
    );
    mkdirSync(path.dirname(intellicodeJar), { recursive: true });
    writeFileSync(intellicodeJar, '');
    mkdirSync(membersDir, { recursive: true });
  }

  function resolveVsCodeJavaPaths(): {
    jreHome: string;
    jreBinary: string;
    lombokJar: string;
    launcherJar: string;
    readonlyConfig: string;
  } {
    const platform = determineVsCodePlatform();
    const mapping: Record<string, { jreHome: string; jreBinary: string; lombok: string; launcher: string; config: string }> = {
      'osx-arm64': {
        jreHome: 'extension/jre/21.0.7-macosx-aarch64',
        jreBinary: 'extension/jre/21.0.7-macosx-aarch64/bin/java',
        lombok: 'extension/lombok/lombok-1.18.36.jar',
        launcher: 'extension/server/plugins/org.eclipse.equinox.launcher_1.7.0.v20250424-1814.jar',
        config: 'extension/server/config_mac_arm'
      },
      'osx-x64': {
        jreHome: 'extension/jre/21.0.7-macosx-x86_64',
        jreBinary: 'extension/jre/21.0.7-macosx-x86_64/bin/java',
        lombok: 'extension/lombok/lombok-1.18.36.jar',
        launcher: 'extension/server/plugins/org.eclipse.equinox.launcher_1.7.0.v20250424-1814.jar',
        config: 'extension/server/config_mac'
      },
      'linux-x64': {
        jreHome: 'extension/jre/21.0.7-linux-x86_64',
        jreBinary: 'extension/jre/21.0.7-linux-x86_64/bin/java',
        lombok: 'extension/lombok/lombok-1.18.36.jar',
        launcher: 'extension/server/plugins/org.eclipse.equinox.launcher_1.7.0.v20250424-1814.jar',
        config: 'extension/server/config_linux'
      },
      'linux-arm64': {
        jreHome: 'extension/jre/21.0.7-linux-aarch64',
        jreBinary: 'extension/jre/21.0.7-linux-aarch64/bin/java',
        lombok: 'extension/lombok/lombok-1.18.36.jar',
        launcher: 'extension/server/plugins/org.eclipse.equinox.launcher_1.7.0.v20250424-1814.jar',
        config: 'extension/server/config_linux'
      },
      'win-x64': {
        jreHome: 'extension/jre/21.0.7-win32-x86_64',
        jreBinary: 'extension/jre/21.0.7-win32-x86_64/bin/java.exe',
        lombok: 'extension/lombok/lombok-1.18.36.jar',
        launcher: 'extension/server/plugins/org.eclipse.equinox.launcher_1.7.0.v20250424-1814.jar',
        config: 'extension/server/config_win'
      }
    };

    const selected = mapping[platform] ?? mapping['osx-arm64'];
    return {
      jreHome: selected.jreHome,
      jreBinary: selected.jreBinary,
      lombokJar: selected.lombok,
      launcherJar: selected.launcher,
      readonlyConfig: selected.config
    };
  }

  function determineVsCodePlatform(): string {
    if (process.platform === 'win32') {
      return 'win-x64';
    }
    if (process.platform === 'darwin') {
      return process.arch === 'arm64' ? 'osx-arm64' : 'osx-x64';
    }
    if (process.platform === 'linux') {
      return process.arch === 'arm64' ? 'linux-arm64' : 'linux-x64';
    }
    return 'osx-arm64';
  }

  function prepareKotlinRuntime(): void {
    const baseDir = path.join(smartLspDir, 'language_servers', 'static', 'kotlin_language_server');
    const scriptName = process.platform === 'win32' ? 'kotlin-lsp.cmd' : 'kotlin-lsp.sh';
    const scriptPath = path.join(baseDir, scriptName);
    mkdirSync(path.dirname(scriptPath), { recursive: true });
    writeFileSync(scriptPath, '');
    if (process.platform !== 'win32') {
      fs.chmodSync(scriptPath, 0o755);
    }

    const javaDir = path.join(baseDir, 'java');
    const { javaHome, javaBinary } = resolveKotlinJavaPaths();
    const javaBinaryPath = path.join(javaDir, javaBinary);
    mkdirSync(path.dirname(javaBinaryPath), { recursive: true });
    writeFileSync(javaBinaryPath, '');
    if (process.platform !== 'win32') {
      fs.chmodSync(javaBinaryPath, 0o755);
    }

    mkdirSync(path.join(javaDir, javaHome), { recursive: true });
  }

  function resolveKotlinJavaPaths(): { javaHome: string; javaBinary: string } {
    const platform = determineVsCodePlatform();
    const mapping: Record<string, { javaHome: string; javaBinary: string }> = {
      'osx-arm64': {
        javaHome: 'extension/jre/21.0.7-macosx-aarch64',
        javaBinary: 'extension/jre/21.0.7-macosx-aarch64/bin/java'
      },
      'osx-x64': {
        javaHome: 'extension/jre/21.0.7-macosx-x86_64',
        javaBinary: 'extension/jre/21.0.7-macosx-x86_64/bin/java'
      },
      'linux-x64': {
        javaHome: 'extension/jre/21.0.7-linux-x86_64',
        javaBinary: 'extension/jre/21.0.7-linux-x86_64/bin/java'
      },
      'linux-arm64': {
        javaHome: 'extension/jre/21.0.7-linux-aarch64',
        javaBinary: 'extension/jre/21.0.7-linux-aarch64/bin/java'
      },
      'win-x64': {
        javaHome: 'extension/jre/21.0.7-win32-x86_64',
        javaBinary: 'extension/jre/21.0.7-win32-x86_64/bin/java.exe'
      }
    };

    const selected = mapping[platform] ?? mapping['osx-arm64'];
    return selected;
  }
});
