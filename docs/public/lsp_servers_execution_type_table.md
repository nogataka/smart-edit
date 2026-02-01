# LSPサーバー実行方式一覧表

## 全LSPサーバーの実行方式分類

| # | 言語/サーバー | ファイル名 | 実行方式 | インストール方法 | 起動コマンド | バージョン | 備考 |
|---|-------------|-----------|---------|----------------|------------|-----------|------|
| 1 | **TypeScript** | `typescript_language_server.ts` | **npm型** | `npm install typescript@5.9.3`<br/>`npm install typescript-language-server@5.1.3` | `typescript-language-server --stdio` | 5.1.3 | node/npm必須 |
| 2 | **Python (Pyright)** | `pyright_server.ts` | **システム依存型** | システムのPythonモジュール | `python -m pyright.langserver --stdio` | - | 事前インストール必要 |
| 3 | **Python (Jedi)** | `jedi_server.ts` | **システム依存型** | Pythonパッケージ | `jedi-language-server` | - | Pyright代替 |
| 4 | **Rust** | `rust_analyzer.ts` | **システム依存型<br/>(半自動)** | 1. 環境変数<br/>2. `rustup which`<br/>3. PATH<br/>4. `rustup component add` | `rust-analyzer` | - | rustup自動インストール |
| 5 | **Go** | `gopls.ts` | **システム依存型** | `go install golang.org/x/tools/gopls@latest` | `gopls` | - | go/gopls必須 |
| 6 | **Java** | `eclipse_jdtls.ts` | **複合ダウンロード型<br/>(VSIX)** | 1. Gradle 8.14.2<br/>2. VS Code Java 1.42.0 (JRE 21含む)<br/>3. IntelliCode 1.2.30 | JVMで起動（20+オプション） | 1.42.0 | 最も複雑 |
| 7 | **C/C++** | `clangd_language_server.ts` | **バイナリDL型** | GitHub Releases | `clangd` | 19.1.2 | プラットフォーム別 |
| 8 | **C#** | `csharp_language_server.ts` | **ダウンロード型** | - | - | - | 詳細未確認 |
| 9 | **Bash** | `bash_language_server.ts` | **npm型<br/>(フォールバック)** | `npm install bash-language-server@5.6.0` | `bash-language-server start` | 5.6.0 | 失敗時システムコマンド |
| 10 | **PHP** | `intelephense.ts` | **npm型** | `npm install intelephense@1.14.4` | `intelephense --stdio` | 1.14.4 | node/npm必須 |
| 11 | **Dart** | `dart_language_server.ts` | **バイナリDL型<br/>(SDK)** | Dart SDK 3.7.1 | `dart language-server` | 3.7.1 | SDKごとダウンロード |
| 12 | **Clojure** | `clojure_lsp.ts` | **バイナリDL型<br/>(+ システム要件)** | clojure-lsp latest | `clojure-lsp` | latest | Clojure CLI必須 |
| 13 | **Kotlin** | `kotlin_language_server.ts` | **複合ダウンロード型** | 1. Kotlin LSP 0.253<br/>2. JRE 21 (VSIXから) | `kotlin-lsp.sh --stdio` | 0.253 | JRE同梱 |
| 14 | **Terraform** | `terraform_ls.ts` | **バイナリDL型<br/>(+ システム要件)** | terraform-ls 0.36.5 | `terraform-ls serve` | 0.36.5 | terraform CLI必須 |
| 15 | **Ruby (ruby-lsp)** | `ruby_lsp.ts` | **gem型** | `gem install ruby-lsp` | `ruby-lsp` | - | Ruby/gem必須 |
| 16 | **Ruby (Solargraph)** | `solargraph.ts` | **gem型** | `gem install solargraph` | `solargraph stdio` | - | Ruby/gem必須 |
| 17 | **Swift** | `sourcekit_lsp.ts` | **システム依存型** | Xcode/Swift Toolchain | `sourcekit-lsp` | - | macOS/Linux |
| 18 | **Lua** | `lua_ls.ts` | **バイナリDL型** | GitHub Releases | `lua-language-server` | - | - |
| 19 | **R** | `r_language_server.ts` | **R パッケージ型** | R package | `R --slave -e "languageserver::run()"` | - | R必須 |
| 20 | **Erlang** | `erlang_language_server.ts` | **システム依存型** | - | `erlang_ls` | - | - |
| 21 | **Nix** | `nixd_language_server.ts` | **システム依存型** | - | `nixd` | - | - |
| 22 | **Zig** | `zls.ts` | **バイナリDL型** | - | `zls` | - | - |
| 23 | **Vue** | `vts_language_server.ts` | **npm型** | - | `volar-language-server` | - | - |

## 実行方式の分類

### 1. バイナリダウンロード型
プラットフォーム固有のバイナリを直接ダウンロードして実行。

- **Clangd** (C/C++)
- **Dart** (SDK全体)
- **Clojure** (ネイティブバイナリ)
- **Terraform-ls**
- **Lua**
- **Zig**

**特徴**:
- GitHubリリースやHashiCorpなどから取得
- プラットフォーム別URL
- 実行権限付与が必要(Unix)

### 2. npm/Node.jsパッケージ型
npmでインストールして実行。

- **TypeScript**
- **Bash** (フォールバック付き)
- **Intelephense** (PHP)
- **Vue/Volar**

**特徴**:
- `npm install` でインストール
- `node_modules/.bin/` 配下にバイナリ
- node/npm事前インストール必須

### 3. システム依存型
システムにインストール済みのコマンドを使用。

- **Pyright** (Python)
- **Jedi** (Python代替)
- **gopls** (Go)
- **SourceKit** (Swift)
- **Erlang LS**
- **nixd** (Nix)

**特徴**:
- ユーザーによる事前インストール必須
- `which`/`where` でコマンド存在確認
- ランタイムダウンロード不要

### 4. システム依存型(半自動)
システムコマンドを優先、見つからない場合は自動インストール。

- **rust-analyzer** (rustup経由で自動インストール可能)

### 5. 言語パッケージマネージャー型
各言語固有のパッケージマネージャーでインストール。

- **Ruby LSP** (gem)
- **Solargraph** (gem)
- **R Language Server** (R package)

### 6. 複合ダウンロード型 (VSIX)
VSCode拡張のVSIXファイルをダウンロードして使用。

- **Eclipse JDT** (Java) - 最も複雑
  - Gradle + VSIX(JRE含む) + IntelliCode
  - 20以上のJVMオプション
  - ワークスペース設定のコピー

- **Kotlin**
  - Kotlin LSP + JRE (VSIX)

**特徴**:
- 複数コンポーネントのダウンロード・展開
- JRE/JDKが同梱される場合がある
- 複雑な起動コマンドライン

### 7. SDK型
SDKごとダウンロード。

- **Dart** (Dart SDK全体)

## プラットフォーム対応状況

| サーバー | Windows | Linux | macOS (Intel) | macOS (ARM) |
|---------|---------|-------|---------------|-------------|
| TypeScript | ✅ | ✅ | ✅ | ✅ |
| Pyright | ✅ | ✅ | ✅ | ✅ |
| rust-analyzer | ✅ | ✅ | ✅ | ✅ |
| gopls | ✅ | ✅ | ✅ | ✅ |
| Eclipse JDT | ✅ | ✅ | ✅ | ✅ |
| Clangd | ✅ | ✅ | ✅ | ✅ |
| Bash | ✅ | ✅ | ✅ | ✅ |
| Intelephense | ✅ | ✅ | ✅ | ✅ |
| Dart | ✅ | ✅ | ✅ | ✅ |
| Clojure | ✅ | ✅ | ✅ | ✅ |
| Kotlin | ✅ | ✅ | ✅ | ✅ |
| Terraform | ✅ | ✅ | ✅ | ✅ |
| SourceKit | ❌ | ✅ | ✅ | ✅ |

## 環境変数による制御

| 環境変数 | 用途 | 影響するサーバー |
|---------|------|----------------|
| `SMART_EDIT_SKIP_RUNTIME_INSTALL` | ランタイム自動ダウンロードをスキップ | ほぼ全て(ダウンロード型) |
| `SMART_EDIT_RUST_ANALYZER_PATH` | rust-analyzerのパスを直接指定 | rust-analyzer |
| `SMART_EDIT_ASSUME_GOPLS` | gopls存在チェックをスキップ | gopls |
| `SMART_EDIT_ASSUME_CLOJURE` | Clojure CLI存在チェックをスキップ | Clojure LSP |
| `SMART_EDIT_ASSUME_TERRAFORM` | Terraform CLI存在チェックをスキップ | Terraform LS |
| `SMART_EDIT_ASSUME_INTELEPHENSE` | node/npm存在チェックをスキップ | Intelephense |

## 複雑度ランキング

| 順位 | サーバー | 複雑度 | 理由 |
|-----|---------|--------|------|
| 1 | Eclipse JDT (Java) | ⭐⭐⭐⭐⭐ | 3つのコンポーネント、JVM起動、設定コピー、IntelliCode有効化 |
| 2 | Kotlin | ⭐⭐⭐⭐ | 2つのコンポーネント(LSP+JRE)、複雑な初期化 |
| 3 | Dart | ⭐⭐⭐ | SDK全体のダウンロード、プラットフォーム別対応 |
| 4 | TypeScript | ⭐⭐⭐ | npm 2パッケージ、カスタム初期化 |
| 5 | Clojure | ⭐⭐⭐ | バイナリDL + Clojure CLI検証 |
| 6 | Terraform | ⭐⭐⭐ | バイナリDL + Terraform CLI検証 |
| 7 | Clangd | ⭐⭐ | シンプルなバイナリDL |
| 8 | Intelephense | ⭐⭐ | npm単一パッケージ |
| 9 | Bash | ⭐⭐ | npm + フォールバック |
| 10 | rust-analyzer | ⭐⭐ | システムコマンド + rustup自動インストール |
| 11 | gopls | ⭐ | シンプルなシステムコマンド |
| 12 | Pyright | ⭐ | シンプルなPythonモジュール |

## まとめ

- **合計**: 23種類のLSPサーバー実装
- **最もシンプル**: Pyright, gopls (システムコマンド直接実行)
- **最も複雑**: Eclipse JDT (3コンポーネント + 複雑な起動処理)
- **最も一般的**: npm型とバイナリDL型
- **共通ユーティリティ**: `RuntimeDependencyCollection` (ダウンロード・展開)
- **共通ハンドラー**: `NodeLanguageServerHandler` (LSPプロトコル通信)

各実行方式は言語エコシステムの特性に応じて選択されており、ユーザー体験とメンテナンス性のバランスが考慮されています。
