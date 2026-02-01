# LSPサーバーの実行方式調査

## 概要

`src/smart-lsp/language_servers/` ディレクトリ配下の各LSPサーバー実装について、実行方式の違いを調査しました。

## 調査結果サマリー

LSPサーバーの実行方式は大きく分けて以下の3パターンに分類されます:

1. **ダウンロード型**: バイナリまたはアーカイブをダウンロードして実行
2. **npm/パッケージマネージャー型**: npmやその他のパッケージマネージャーでインストール
3. **システム依存型**: システムにインストール済みのコマンドを実行

## 詳細な実行方式の分類

### 1. ダウンロード型（バイナリ直接ダウンロード）

プラットフォーム固有のバイナリをダウンロードして実行する方式。

#### Clangd
**ファイル**: [src/smart-lsp/language_servers/clangd_language_server.ts](../src/smart-lsp/language_servers/clangd_language_server.ts)

- **実行方式**: GitHubリリースからプラットフォーム別のZIPをダウンロード
- **バージョン**: 19.1.2
- **プラットフォーム対応**:
  - Linux x64: `clangd-linux-19.1.2.zip`
  - Windows x64: `clangd-windows-19.1.2.zip`
  - macOS x64/arm64: `clangd-mac-19.1.2.zip`
- **バイナリパス**: `clangd_19.1.2/bin/clangd[.exe]`
- **起動コマンド**:
  ```typescript
  cmd: quoteWindowsPath(binaryPath)
  ```

**特徴**:
- アーカイブ展開後、バイナリに実行権限を付与（Unix系）
- `SMART_EDIT_SKIP_RUNTIME_INSTALL=1` で自動ダウンロードをスキップ可能

---

### 2. npm/パッケージマネージャー型

npmやパッケージマネージャーを使ってインストールする方式。

#### TypeScript Language Server
**ファイル**: [src/smart-lsp/language_servers/typescript_language_server.ts](../src/smart-lsp/language_servers/typescript_language_server.ts)

- **実行方式**: npmでパッケージをインストール
- **依存パッケージ**:
  - `typescript@5.9.3`
  - `typescript-language-server@5.1.3`
- **インストールコマンド**:
  ```bash
  npm install --prefix ./ typescript@5.9.3
  npm install --prefix ./ typescript-language-server@5.1.3
  ```
- **バイナリパス**: `node_modules/.bin/typescript-language-server[.cmd]`
- **起動コマンド**:
  ```typescript
  cmd: `${quoteWindowsPath(localBinary)} --stdio`
  ```

**特徴**:
- `node` と `npm` の事前インストールが必要
- 初期化時にカスタムのLSPハンドラー登録が必要
- `experimental/serverStatus` で準備完了を検知

#### Bash Language Server
**ファイル**: [src/smart-lsp/language_servers/bash_language_server.ts](../src/smart-lsp/language_servers/bash_language_server.ts)

- **実行方式**: npmでインストール
- **依存パッケージ**: `bash-language-server@5.6.0`
- **インストールコマンド**:
  ```bash
  npm install --prefix ./ bash-language-server@5.6.0
  ```
- **バイナリパス**: `node_modules/.bin/bash-language-server[.cmd]`
- **起動コマンド**:
  ```typescript
  cmd: `${quoteWindowsPath(localBinary)} start`
  ```

**特徴**:
- インストール失敗時はシステムコマンドにフォールバック
- シンプルな実装（カスタムハンドラー登録なし）

---

### 3. システム依存型

システムにインストール済みのコマンドを使用する方式。

#### Pyright
**ファイル**: [src/smart-lsp/language_servers/pyright_server.ts](../src/smart-lsp/language_servers/pyright_server.ts)

- **実行方式**: システムのPythonモジュールとして実行
- **起動コマンド**:
  ```typescript
  cmd: 'python -m pyright.langserver --stdio'
  ```
- **前提条件**: Pythonとpyrightがインストール済み

**特徴**:
- ランタイムダウンロード不要
- `Found \d+ source files?` メッセージで準備完了を検知
- `__pycache__`, `.venv`, `.env` などを無視

#### rust-analyzer
**ファイル**: [src/smart-lsp/language_servers/rust_analyzer.ts](../src/smart-lsp/language_servers/rust_analyzer.ts)

- **実行方式**: システムのrust-analyzerバイナリを実行
- **バイナリ検出順序**:
  1. `SMART_EDIT_RUST_ANALYZER_PATH` 環境変数
  2. `rustup which rust-analyzer`
  3. システムPATH (`which rust-analyzer`)
  4. 見つからない場合: `rustup component add rust-analyzer` で自動インストール
- **起動コマンド**:
  ```typescript
  cmd: binaryPath  // 検出されたパス
  ```

**特徴**:
- rustupによる自動インストール機能
- `target` ディレクトリを無視

#### gopls (Go Language Server)
**ファイル**: [src/smart-lsp/language_servers/gopls.ts](../src/smart-lsp/language_servers/gopls.ts)

- **実行方式**: システムのgoplsコマンドを実行
- **前提条件チェック**:
  - `go` コマンドの存在確認
  - `gopls` コマンドの存在確認
- **起動コマンド**:
  ```typescript
  cmd: 'gopls'
  ```
- **推奨インストール方法**:
  ```bash
  go install golang.org/x/tools/gopls@latest
  ```

**特徴**:
- `SMART_EDIT_ASSUME_GOPLS=1` で存在チェックをスキップ可能
- `vendor`, `node_modules`, `dist`, `build` を無視

---

### 4. 複雑なダウンロード型（VSCode拡張ベース）

VSCode拡張のVSIXファイルをダウンロードして使用する方式。

#### Eclipse JDT Language Server (Java)
**ファイル**: [src/smart-lsp/language_servers/eclipse_jdtls.ts](../src/smart-lsp/language_servers/eclipse_jdtls.ts)

- **実行方式**: 複数のコンポーネントをダウンロード・展開
- **必要なコンポーネント**:
  1. **Gradle** (`8.14.2`): ビルドツール
     - URL: `https://services.gradle.org/distributions/gradle-8.14.2-bin.zip`
  2. **VS Code Java拡張** (`1.42.0`): JREとJDT LSを含む
     - プラットフォーム別VSIX (darwin-arm64, darwin-x64, linux-x64, linux-arm64, win32-x64)
     - 含まれるもの: JRE 21.0.7, Lombok, JDT LSサーバー
  3. **IntelliCode** (`1.2.30`): コード補完支援
     - VSIX形式でダウンロード

- **起動コマンド**: Javaコマンドライン（非常に複雑）
  ```typescript
  [
    jrePath,
    '--add-modules=ALL-SYSTEM',
    '--add-opens', 'java.base/java.util=ALL-UNNAMED',
    '--add-opens', 'java.base/java.lang=ALL-UNNAMED',
    '--add-opens', 'java.base/sun.nio.fs=ALL-UNNAMED',
    '-Declipse.application=org.eclipse.jdt.ls.core.id1',
    '-Dosgi.bundles.defaultStartLevel=4',
    // ... 多数のJVMオプション
    '-Xmx3G',
    '-Xms100m',
    `-javaagent:${lombokJarPath}`,
    '-jar', jdtlsLauncherJarPath,
    '-configuration', configDir,
    '-data', dataDir
  ]
  ```

**特徴**:
- 最も複雑な実行方式
- ワークスペースごとに一時ディレクトリを作成
- 設定ディレクトリのコピーが必要
- IntelliCode有効化のための追加コマンド送信
- 環境変数で `JAVA_HOME` を設定

---

## 実行方式の比較表

| LSPサーバー | 実行方式 | ランタイム管理 | プラットフォーム対応 | 複雑度 |
|------------|---------|--------------|-------------------|--------|
| **Clangd** | バイナリDL | 自動 | Linux, macOS, Windows | 低 |
| **TypeScript** | npm | 自動 | プラットフォーム非依存 | 中 |
| **Bash** | npm | 自動（フォールバック有） | プラットフォーム非依存 | 低 |
| **Pyright** | システムコマンド | 手動 | プラットフォーム非依存 | 低 |
| **rust-analyzer** | システムコマンド | 半自動（rustup） | プラットフォーム非依存 | 低 |
| **gopls** | システムコマンド | 手動 | プラットフォーム非依存 | 低 |
| **Eclipse JDT** | VSIX + JRE DL | 自動 | Linux, macOS, Windows | 高 |

## 共通パターンとユーティリティ

### RuntimeDependencyCollection
**場所**: [src/smart-lsp/language_servers/common.ts](../src/smart-lsp/language_servers/common.ts)

すべてのダウンロード型LSPサーバーで使用される共通ユーティリティ。

**機能**:
- プラットフォーム検出 (`PlatformId`)
- アーカイブダウンロード（curl, wget, PowerShell対応）
- アーカイブ展開（ZIP, TAR, GZ, ZIP.GZ対応）
- コマンド実行（`npm install` など）
- 実行権限の付与

**サポートプラットフォーム**:
```typescript
type PlatformId =
  | 'win-x86' | 'win-x64' | 'win-arm64'
  | 'osx' | 'osx-x64' | 'osx-arm64'
  | 'linux-x86' | 'linux-x64' | 'linux-arm64'
  | 'linux-musl-x64' | 'linux-musl-arm64';
```

### NodeLanguageServerHandler
**場所**: [src/smart-lsp/ls_handler.ts](../src/smart-lsp/ls_handler.ts)（推定）

すべてのLSPサーバーで使用される共通のプロトコルハンドラー。

**提供機能**:
- LSPプロトコル通信（JSON-RPC）
- リクエスト/レスポンス管理
- 通知ハンドラー登録
- タイムアウト管理

## 環境変数による制御

| 環境変数 | 用途 | 影響するサーバー |
|---------|------|----------------|
| `SMART_EDIT_SKIP_RUNTIME_INSTALL` | ランタイム自動インストールをスキップ | Clangd, TypeScript, Bash, Eclipse JDT |
| `SMART_EDIT_RUST_ANALYZER_PATH` | rust-analyzerのパスを直接指定 | rust-analyzer |
| `SMART_EDIT_ASSUME_GOPLS` | gopls存在チェックをスキップ | gopls |

## 初期化パターンの違い

### 1. 単純初期化（Bash, Clangd）
- ハンドラー登録なし、またはシンプルなnoop登録のみ
- サーバー起動後すぐに使用可能

### 2. 準備完了検知型（TypeScript, Pyright, Eclipse JDT）
- 特定の通知を監視して準備完了を検知
  - TypeScript: `experimental/serverStatus` の `quiescent: true`
  - Pyright: `window/logMessage` の "Found N source files"
  - Eclipse JDT: `language/status` の `ServiceReady`

### 3. カスタム初期化型（Eclipse JDT）
- `initialize` レスポンス後に追加の設定送信
- 動的な機能登録（`client/registerCapability`）
- IntelliCodeなどの追加機能の有効化

## ファイル無視パターン

各LSPサーバーが無視するディレクトリ/パターン:

| サーバー | 無視パターン |
|---------|------------|
| **TypeScript** | `**/node_modules`, `**/dist`, `**/build`, `**/coverage` |
| **Pyright** | `**/__pycache__`, `**/.venv`, `**/.env`, `**/build`, `**/dist`, `**/.pixi` |
| **rust-analyzer** | `target` |
| **gopls** | `vendor`, `node_modules`, `dist`, `build` |

## その他確認されたLSPサーバー（未調査）

以下のLSPサーバーも実装されていますが、詳細は未調査:

- Dart (`dart_language_server.ts`)
- Clojure (`clojure_lsp.ts`)
- PHP/Intelephense (`intelephense.ts`)
- Terraform (`terraform_ls.ts`)
- Vue/Vetur (`vts_language_server.ts`)
- Kotlin (`kotlin_language_server.ts`)
- Lua (`lua_ls.ts`)
- R (`r_language_server.ts`)
- Ruby (`ruby_lsp.ts`, `solargraph.ts`)
- Swift (`sourcekit_lsp.ts`)
- Erlang (`erlang_language_server.ts`)
- Nix (`nixd_language_server.ts`)
- Zig (`zls.ts`)
- C# (`csharp_language_server.ts`)
- Jedi (Python代替) (`jedi_server.ts`)

## まとめ

LSPサーバーの実行方式は以下のように分類できます:

1. **完全自動管理型** (Clangd, TypeScript, Eclipse JDT)
   - バイナリやパッケージを自動ダウンロード・インストール
   - ユーザーの事前準備不要

2. **半自動管理型** (Bash, rust-analyzer)
   - 自動インストール試行、失敗時はフォールバック
   - または条件付き自動インストール

3. **システム依存型** (Pyright, gopls)
   - システムにインストール済みのコマンドを使用
   - ユーザーによる事前インストールが必要

それぞれの方式には利点があり、言語やツールの特性に応じて適切な方式が選択されています。
