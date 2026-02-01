# Smart Edit

![Smart Edit Dashboard](docs/public/assets/screenshot.png)

Smart Edit は、TypeScript / Node.js 上で動作する MCP (Model Context Protocol) サーバーです。独自の言語サーバー管理システム「SmartLSP」と Smart-Edit 固有のツール群を TypeScript で実装しています。

## SmartLSP について

SmartLSP は、Smart Edit に組み込まれた言語サーバー管理システムです。AI コーディングツールが複数のプログラミング言語を扱う際に必要となる LSP (Language Server Protocol) サーバーの管理を自動化します。

### 主な特徴

| 特徴                         | 説明                                                                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **23言語サポート**           | Bash, C/C++, C#, Clojure, Dart, Erlang, Go, Java, Kotlin, Lua, Nix, PHP, Python (2種), R, Ruby (2種), Rust, Swift, Terraform, TypeScript/JavaScript, Vue, Zig |
| **オンデマンドダウンロード** | 言語サーバーは必要になったタイミングで自動的にダウンロード・インストールされます。起動時に全てをダウンロードする必要はありません                              |
| **クロスプラットフォーム**   | macOS (Intel/Apple Silicon)、Linux (x64/ARM64)、Windows (x64) に対応。プラットフォームに応じた適切なバイナリを自動選択                                        |
| **統一API**                  | 異なる言語サーバーを同一のインターフェースで操作可能。初期化、診断取得、コード補完、定義ジャンプなどを共通の方法で呼び出せます                                |
| **依存関係の自動管理**       | npm、pip、gem、go install など、各言語のパッケージマネージャーを通じた依存関係を自動的に解決                                                                  |

### 動作の流れ

```
1. プロジェクトの言語を検出（project.yml または自動検出）
       ↓
2. 該当する言語サーバーが未インストールの場合、自動ダウンロード
       ↓
3. 言語サーバーを起動し、LSP 通信を開始
       ↓
4. AI エージェントが LSP 機能（診断、補完、定義参照など）を利用
```

SmartLSP により、ユーザーは言語サーバーのインストールや設定を意識することなく、AI による高精度なコード支援を受けることができます。

## メモリ機能

Smart Edit は、AI エージェントがプロジェクトに関する情報を永続的に保存・参照できる「メモリ機能」を提供します。

### 主な特徴

| 特徴                 | 説明                                                                     |
| -------------------- | ------------------------------------------------------------------------ |
| **永続化**           | セッション間で完全に永続化され、IDE 再起動や PC 再起動後も保持されます   |
| **プロジェクト独立** | メモリはプロジェクトごとに独立しており、他プロジェクトとは共有されません |
| **Markdown 形式**    | 人間が読みやすい Markdown ファイルとして保存されます                     |
| **名前付き管理**     | 「kickoff」「retro」「architecture」など、用途に応じた名前でメモリを管理 |

### 利用可能なツール

| ツール         | 説明                       |
| -------------- | -------------------------- |
| `WriteMemory`  | 名前付きメモリを保存       |
| `ReadMemory`   | メモリの内容を読み込み     |
| `ListMemories` | 保存済みメモリの一覧を取得 |
| `DeleteMemory` | メモリを削除               |

保存場所: `{プロジェクトルート}/.smart-edit/memories/`

## プロンプト/モード/コンテキスト システム

Smart Edit は、AI の振る舞いをカスタマイズするための柔軟なテンプレートシステムを提供します。

### 構成要素

| 要素                       | 説明                                                               | 保存場所                          |
| -------------------------- | ------------------------------------------------------------------ | --------------------------------- |
| **コンテキスト**           | 接続先クライアント（Claude Code, Codex, Desktop など）に応じた設定 | `~/.smart-edit/contexts/`         |
| **モード**                 | AI の動作モード（editor, reviewer, architect など）を定義          | `~/.smart-edit/modes/`            |
| **プロンプトテンプレート** | 各ツールの出力形式やインストラクションを定義                       | `~/.smart-edit/prompt_templates/` |

### カスタマイズの流れ

```
1. 内蔵テンプレートを確認
   smart-edit mode list / smart-edit context list
       ↓
2. テンプレートをコピーして編集
   smart-edit mode create --from-internal default-editor
       ↓
3. MCP サーバー起動時に指定
   --context ide-assistant --mode default-editor
```

## Web ダッシュボード

リアルタイムでセッション情報を可視化する Web ベースのダッシュボードを提供します。

### 機能一覧

| タブ           | 機能                                                                   |
| -------------- | ---------------------------------------------------------------------- |
| **Dashboard**  | プロジェクト概要、リアルタイムメトリクス、最近のアクティビティ         |
| **Logs**       | ログ検索・フィルタ（レベル別、ツール名別）、リアルタイムストリーミング |
| **Statistics** | API 呼び出し統計、トークン使用量チャート、ライブカウンター             |
| **Sessions**   | セッション履歴、JSON エクスポート、過去セッション比較                  |

- `--enable-web-dashboard` オプションで有効化
- ダークモード / ライトモード切替対応
- モバイルレスポンシブ対応

## ワークフローツール

AI エージェントの作業効率を高めるためのワークフロー支援ツールを提供します。

| ツール                      | 説明                                                     |
| --------------------------- | -------------------------------------------------------- |
| `Onboarding`                | プロジェクト初回参加時のオンボーディングプロセスを支援   |
| `CheckOnboardingPerformed`  | オンボーディング完了確認 + Git 差分による変更検出        |
| `CollectProjectSymbols`     | プロジェクトシンボル（ユーティリティ、依存関係等）を収集 |

オンボーディングでは、プロジェクトの構造理解、コーディング規約の確認、既存メモリの参照などを AI エージェントに案内します。

## 重複定義チェック機能

AI エージェントが既存のコードや依存ライブラリと重複する実装を作成することを防ぐための機能です。

### 概要

| 機能 | 説明 |
|------|------|
| **careful-editor モード** | 既存コードを尊重し、重複実装を防ぐ動作モード |
| **プロジェクトシンボル収集** | ユーティリティ関数、共通コンポーネント、依存ライブラリを記録 |
| **Git 差分検出** | 前回オンボーディング以降の大きな変更を自動検出し、再オンボーディングを推奨 |

### 動作の流れ

```
1. オンボーディング時にプロジェクト構成を収集
   → CollectProjectSymbols ツールで project-symbols メモリに保存
       ↓
2. 次回セッション開始時
   → CheckOnboardingPerformed が Git 差分をチェック
       ↓
3. 大きな変更がある場合
   → 「再オンボーディング推奨」メッセージを表示
       ↓
4. careful-editor モードで実装
   → 既存のユーティリティ/ライブラリを優先利用
```

### careful-editor モードの使用

```bash
npx @nogataka/smart-edit smart-edit start-mcp-server \
  --mode careful-editor \
  --transport stdio
```

このモードでは、AI エージェントは実装前に以下を確認します：
- `project-symbols` メモリから既存のユーティリティ関数一覧
- `package.json` の依存ライブラリとその用途
- 類似機能の有無を `find_symbol` ツールで検索

### 変更検出の基準

以下の条件で「大きな変更」と判定されます：
- 10 ファイル以上の変更
- 5 ファイル以上の新規追加
- `src/` ディレクトリへの新規ファイル追加

## 主な構成

| ディレクトリ / ファイル    | 概要                                                        |
| -------------------------- | ----------------------------------------------------------- |
| `src/smart-edit`           | エージェント本体、CLI、各種ツール・コンフィグ周りのロジック |
| `src/smart-lsp`            | SmartLSP 本体：23言語サーバーの自動管理・LSP通信実装        |
| `src/smart-edit/resources` | Smart-Edit が自動生成・参照する YAML テンプレート群         |
| `test/`                    | Vitest によるユニットテスト・スモークテスト                 |

## 環境要件

- Node.js >= 20.11.0
- pnpm (推奨: v9 以降)
- macOS / Linux / Windows に対応（Windows では `ensureDefaultSubprocessOptions` により `windowsHide` などを自動付与）
- 言語サーバーの一部は追加のランタイム（`nix`, `rustup`, `gem`, `dotnet`, `go` など）や外部コマンドを必要とします

## セットアップ手順

```bash
pnpm install
# 必要に応じてビルド
pnpm build
```

`pnpm build` を実行すると TypeScript のトランスパイルに加えて `src/smart-edit/resources/` 以下の YAML テンプレート類も `dist/smart-edit/resources/` にコピーされ、`npx` 経由で配布した際にもコンテキスト定義が参照できるようになります。

テストや開発時に外部バイナリのダウンロードを抑止したい場合は、`SMART_EDIT_SKIP_RUNTIME_INSTALL=1` を設定してください。

## 開発用コマンド

| コマンド                            | 説明                               |
| ----------------------------------- | ---------------------------------- |
| `pnpm lint`                         | ESLint による静的解析              |
| `pnpm test`                         | Vitest 実行（ユニット / スモーク） |
| `pnpm typecheck`                    | `tsc --noEmit` での型検証          |
| `pnpm build`                        | 生成物を `dist/` に出力            |
| `pnpm format` / `pnpm format:check` | Prettier による整形                |

## ユーザーガイド

CLI は npm パッケージとして公開されており、`npx` または `node dist/cli.js` で呼び出します。

### CLI の呼び出し方法

```bash
# npm パッケージを利用する場合（推奨）
npx @nogataka/smart-edit smart-edit <command>

# ローカル開発時
node dist/cli.js <command>
# または
pnpm exec tsx src/smart-edit/cli.ts <command>
```

### 1. 初期設定フロー

1. **smart-edit 管理ディレクトリの生成**
   ```bash
   npx @nogataka/smart-edit smart-edit config edit
   ```
   初回実行時は `~/.smart-edit/smart_edit_config.yml` をテンプレートから生成し、既定エディタで開きます。

2. **プロジェクト設定 (project.yml) の生成**
   ```bash
   npx @nogataka/smart-edit smart-edit project generate-yml /path/to/project
   ```
   言語を手動指定したい場合は `--language <lang>` を付与します。生成された YAML をプロジェクトルートに配置してください。

3. **モード / コンテキストの確認とカスタマイズ**
   ```bash
   # 一覧表示
   npx @nogataka/smart-edit smart-edit mode list
   npx @nogataka/smart-edit smart-edit context list

   # テンプレートからコピー
   npx @nogataka/smart-edit smart-edit mode create --from-internal default-editor

   # 編集 / 削除
   npx @nogataka/smart-edit smart-edit mode edit <name>
   npx @nogataka/smart-edit smart-edit context delete <name>
   ```

4. **プロンプトテンプレートの更新**
   独自プロンプトを用意する場合は、`src/smart-edit/resources/prompt_templates/` 以下のテンプレートを `~/.smart-edit/prompt_templates/` にコピーして編集し、`prompts` グループコマンドで管理します。

### 2. MCP サーバーの起動

```bash
npx @nogataka/smart-edit smart-edit start-mcp-server \
  --project /path/to/project \
  --context ide-assistant \
  --mode default-editor \
  --transport stdio
```

ランタイムの自動インストールをスキップする場合は環境変数を設定します：
```bash
SMART_EDIT_SKIP_RUNTIME_INSTALL=1 npx @nogataka/smart-edit smart-edit start-mcp-server ...
```

主なオプション:

- `--transport`: `stdio` (既定) / `sse` / `streamable-http` から選択
- `--enable-web-dashboard`, `--enable-gui-log-window`: Config の設定を一時的に上書き
- `--log-level`, `--trace-lsp-communication`: ログ詳細度や LSP トレースの制御
- `--tool-timeout`: ツール実行のタイムアウト秒数
- `--instructions-override`: MCP クライアントに渡す初期インストラクションをカスタム指定

サーバー起動後は、必要に応じてダッシュボード (`--enable-web-dashboard`) や GUI ログビューア (`--enable-gui-log-window`) を利用できます。GUI ログは `GuiLogViewer` 経由でブラウザが自動起動し、`logs/` ディレクトリにも出力されます。

#### Web ダッシュボード機能

ダッシュボードは以下の機能を提供します：

| タブ       | 機能                                                                   |
| ---------- | ---------------------------------------------------------------------- |
| Dashboard  | プロジェクト概要、リアルタイムメトリクス、最近のアクティビティ         |
| Logs       | ログ検索・フィルタ（レベル別、ツール名別）、リアルタイムストリーミング |
| Statistics | API 呼び出し統計、トークン使用量チャート、ライブカウンター             |
| Sessions   | セッション履歴、JSON エクスポート、過去セッション比較                  |

- ダークモード / ライトモード切替対応
- サイドバーナビゲーション（折りたたみ可能）
- モバイルレスポンシブ対応

#### MCP クライアント（Codex など）からの接続例

`npx` で公開パッケージを取得する場合、`mcp_servers.toml` の設定キーを `smart-edit` に合わせてください。

```toml
[mcp_servers.smart-edit]
command = "npx"
args = ["-y", "@nogataka/smart-edit@latest", "smart-edit", "start-mcp-server", "--context", "codex", "--transport", "stdio"]
```

CLI 側の `--context` や `--mode` は必要に応じて追加してください。`smart-edit` コマンドは `package.json` の `bin.smart-edit` で `./dist/cli.js` にマッピングされています。

### 3. プロジェクト / ツール管理

```bash
# プロジェクト設定 YAML の生成
npx @nogataka/smart-edit smart-edit project generate-yml /path/to/project

# 有効化されているツールを確認
npx @nogataka/smart-edit smart-edit tools list

# ツールごとの説明を表示
npx @nogataka/smart-edit smart-edit tools list
```

### 4. メモリ機能

Smart Edit はプロジェクト固有のメモリ機能を提供します。AI エージェントがプロジェクトに関する情報を永続的に保存・参照できます。

| ツール         | 説明                       |
| -------------- | -------------------------- |
| `WriteMemory`  | 名前付きメモリを保存       |
| `ReadMemory`   | メモリの内容を読み込み     |
| `ListMemories` | 保存済みメモリの一覧を取得 |
| `DeleteMemory` | メモリを削除               |

- 保存場所: `{プロジェクトルート}/.smart-edit/memories/`
- 形式: Markdown ファイル（`.md`）
- セッション間で完全に永続化（IDE 再起動、PC 再起動後も保持）
- プロジェクトごとに独立（他プロジェクトとは共有されない）

### 5. 主要な環境変数

| 変数                              | 用途                                                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `SMART_EDIT_SKIP_RUNTIME_INSTALL` | `1` の場合、言語サーバーなど外部バイナリの自動インストールをスキップ                                                           |
| `SMART_EDIT_ASSUME_<LANG>`        | 各言語サーバーで既存ランタイムを仮定（例: `SMART_EDIT_ASSUME_GOPLS`, `SMART_EDIT_ASSUME_NIXD`, `SMART_EDIT_ASSUME_SOURCEKIT`） |
| `SMART_EDIT_<LANG>_PATH`          | バイナリパスの明示指定（例: `SMART_EDIT_RUBY_BINARY`, `SMART_EDIT_ZLS_PATH`）                                                  |
| `EDITOR`                          | `mode edit` 等で使用する既定エディタ                                                                                           |
| `SMART_EDIT_SKIP_EDITOR`          | `1` の場合、CLI が自動でエディタを開かない                                                                                     |

環境変数の完全な一覧や詳細は `src/smart-lsp/language_servers/*.ts` および `src/smart-edit/config/*.ts` を参照してください。

### 6. 言語サーバー対応状況

以下の言語サーバーに対応しています：

| 言語                    | サーバー                   | バージョン           | ダウンロード元               | 備考                               |
| ----------------------- | -------------------------- | -------------------- | ---------------------------- | ---------------------------------- |
| Bash                    | bash-language-server       | 5.6.0                | npm                          | Node.js 20 以上必須                |
| C / C++                 | clangd                     | 19.1.2               | GitHub Releases              | LLVM プロジェクト                  |
| C#                      | csharp-language-server     | 5.0.0-1.25329.6      | NuGet                        | .NET ランタイム必要                |
| Clojure                 | clojure-lsp                | latest               | GitHub Releases              | Clojure 開発環境                   |
| Dart                    | Dart SDK                   | 3.10.4               | Google Storage               | Flutter SDK に同梱                 |
| Erlang                  | erlang_ls                  | (PATH 検出)          | 外部インストール             | Erlang/OTP ランタイム必要          |
| Go                      | gopls                      | latest               | `go install`                 | 公式 Go チームによる実装           |
| Java                    | Eclipse JDT.LS             | 1.42.0               | GitHub (vscode-java)         | Java 21 以上必須                   |
| Kotlin                  | kotlin-language-server     | 0.253.10629          | JetBrains CDN                | JVM ランタイム必要                 |
| Lua                     | lua-language-server        | 3.15.0               | GitHub Releases              | Lua 5.1〜5.5、LuaJIT 対応          |
| Nix                     | nixd                       | (PATH / nix profile) | 外部インストール             | Nix 式のサポート                   |
| PHP                     | Intelephense               | 1.16.4               | npm                          | 高機能 PHP サーバー                |
| Python                  | Jedi Language Server       | (PyPI)               | pip                          | 軽量・高速                         |
| Python                  | Pyright                    | (PyPI)               | pip                          | Microsoft 製・型チェック強化       |
| R                       | R Language Server          | (CRAN)               | R package                    | CRAN パッケージ                    |
| Ruby                    | Ruby LSP                   | (gem)                | RubyGems                     | Shopify 製・高速                   |
| Ruby                    | Solargraph                 | (gem)                | RubyGems                     | 従来からの定番                     |
| Rust                    | rust-analyzer              | (rustup)             | rustup component             | 公式推奨                           |
| Swift                   | SourceKit-LSP              | (PATH 検出)          | Xcode / Swift Toolchain      | Apple 公式                         |
| Terraform               | terraform-ls               | 0.38.3               | HashiCorp Releases           | HashiCorp 公式、Actions block 対応 |
| TypeScript / JavaScript | typescript-language-server | 5.1.3 (TS 5.9.3)     | npm                          | tsserver ラッパー                  |
| Vue                     | VTS (Volar)                | 0.3.0                | npm (@vtsls/language-server) | Vue 3 対応、TS 必須                |
| Zig                     | zls                        | (PATH 検出)          | 外部インストール             | Zig 公式                           |

**除外**: AL Language Server, elixir_tools, OmniSharp（TypeScript 版では対象外）

**バージョン更新日**: 2026-02-01

#### 実行方式の分類

言語サーバーは以下の方式で管理されます：

| 方式                       | 説明                                         | 対象サーバー                                 |
| -------------------------- | -------------------------------------------- | -------------------------------------------- |
| **バイナリDL型**           | プラットフォーム別バイナリを自動ダウンロード | Clangd, Dart SDK, Lua, Zig, Terraform        |
| **npm型**                  | npm でパッケージをインストール               | TypeScript, Bash, PHP, Vue                   |
| **システム依存型**         | システムにインストール済みのコマンドを使用   | Pyright, Jedi, gopls, SourceKit, Erlang, Nix |
| **システム依存型(半自動)** | 未検出時に自動インストール                   | rust-analyzer (rustup経由)                   |
| **言語パッケージ型**       | 各言語のパッケージマネージャーでインストール | Ruby LSP, Solargraph (gem), R (CRAN)         |
| **複合ダウンロード型**     | 複数コンポーネントをダウンロード・展開       | Eclipse JDT (Java), Kotlin                   |

詳細は [LSPサーバー実行方式調査](docs/public/lsp_server_execution_methods.md) および [LSPサーバー実行方式一覧表](docs/public/lsp_servers_execution_type_table.md) を参照してください。

## MCP クライアント接続ガイド

Smart Edit は MCP (Model Context Protocol) サーバーとして動作し、様々な AI コーディングツールから利用できます。

### `--project` オプションについて

**`--project` は省略可能です。** MCP サーバー起動時にプロジェクトを指定しなくても、以下の方法でプロジェクトをアクティブ化できます：

1. **チャットから指示**: 「現在のディレクトリをプロジェクトとしてアクティブ化して」と依頼
2. **`activate_project` ツール**: MCP 経由で `activate_project` ツールを呼び出し

```bash
# --project なし（推奨: 柔軟に複数プロジェクトを切り替え可能）
npx @nogataka/smart-edit smart-edit start-mcp-server --transport stdio

# --project あり（特定プロジェクトに固定する場合）
npx @nogataka/smart-edit smart-edit start-mcp-server --project /path/to/project --transport stdio
```

以下の各クライアント設定例では `--project` を省略していますが、必要に応じて追加できます。

---

### 対応 MCP クライアント一覧

| クライアント       | 開発元           | 対応状況   | 備考                                 |
| ------------------ | ---------------- | ---------- | ------------------------------------ |
| **Claude Code**    | Anthropic        | ✅ 完全対応 | CLI ベースのコーディングアシスタント |
| **Claude Desktop** | Anthropic        | ✅ 完全対応 | デスクトップアプリ版 Claude          |
| **Codex CLI**      | OpenAI           | ✅ 完全対応 | OpenAI の CLI コーディングツール     |
| **Cursor**         | Cursor Inc       | ✅ 対応     | AI ファースト IDE                    |
| **Windsurf**       | Codeium          | ✅ 対応     | AI コードエディタ                    |
| **Continue**       | Continue         | ✅ 対応     | オープンソース AI アシスタント       |
| **Cline**          | Cline            | ✅ 対応     | VS Code 拡張 (旧 Claude Dev)         |
| **Zed**            | Zed              | ✅ 対応     | 高速 AI コードエディタ               |
| **GitHub Copilot** | GitHub/Microsoft | ✅ 対応     | VS Code 1.102+, JetBrains で公式対応 |

---

### Claude Code への接続手順

Claude Code ではプロジェクトごとに MCP サーバーを追加します。

```bash
# プロジェクトのルートディレクトリで実行
claude mcp add smart-edit -- npx -y @nogataka/smart-edit@latest smart-edit start-mcp-server --transport stdio
```

**オプション付きの例:**
```bash
# プロジェクトを指定する場合
claude mcp add smart-edit -- npx -y @nogataka/smart-edit@latest smart-edit start-mcp-server --project "$(pwd)" --transport stdio

# コンテキストを指定する場合
claude mcp add smart-edit -- npx -y @nogataka/smart-edit@latest smart-edit start-mcp-server --context ide-assistant --transport stdio
```

**管理コマンド:**
```bash
claude mcp list              # 登録済みサーバー一覧
claude mcp remove smart-edit # サーバー削除
```

---

### Codex CLI への接続手順

`~/.codex/config.toml` に以下を追加します。

```toml
[mcp_servers.smart-edit]
command = "npx"
args = ["-y", "@nogataka/smart-edit@latest", "smart-edit", "start-mcp-server", "--context", "codex", "--transport", "stdio"]
```

**使用方法:**
1. Codex 起動後、チャット内で「smart-edit で現在のディレクトリをプロジェクトとしてアクティブ化して」と依頼
2. プロジェクトをアクティブ化するとツールが利用可能に

> **Note**:
> - `--project` を追加すれば起動時にプロジェクトを指定できます（上記「`--project` オプションについて」を参照）
> - Codex の UI でツール実行が `failed` と表示されても、実際には成功していることがあります。ログ (`~/.codex/log/codex-tui.log`) で確認してください。

---

### Cursor への接続手順

Cursor では `~/.cursor/mcp.json` (または Settings → MCP) で設定します。

```json
{
  "mcpServers": {
    "smart-edit": {
      "command": "npx",
      "args": ["-y", "@nogataka/smart-edit@latest", "smart-edit", "start-mcp-server", "--transport", "stdio"]
    }
  }
}
```

> `--project` を追加する場合: `args` に `"--project", "/path/to/project"` を追加

---

### Windsurf (Codeium) への接続手順

Windsurf では `~/.codeium/windsurf/mcp_config.json` で設定します。

```json
{
  "mcpServers": {
    "smart-edit": {
      "command": "npx",
      "args": ["-y", "@nogataka/smart-edit@latest", "smart-edit", "start-mcp-server", "--transport", "stdio"]
    }
  }
}
```

> `--project` を追加する場合: `args` に `"--project", "/path/to/project"` を追加

---

### Continue への接続手順

Continue では `~/.continue/config.json` の `experimental.modelContextProtocolServers` に追加します。

```json
{
  "experimental": {
    "modelContextProtocolServers": [
      {
        "transport": {
          "type": "stdio",
          "command": "npx",
          "args": ["-y", "@nogataka/smart-edit@latest", "smart-edit", "start-mcp-server", "--transport", "stdio"]
        }
      }
    ]
  }
}
```

> `--project` を追加する場合: `args` に `"--project", "/path/to/project"` を追加

---

### Cline (VS Code 拡張) への接続手順

Cline では VS Code の設定 (`settings.json`) または Cline の MCP 設定画面から追加します。

```json
{
  "cline.mcpServers": {
    "smart-edit": {
      "command": "npx",
      "args": ["-y", "@nogataka/smart-edit@latest", "smart-edit", "start-mcp-server", "--transport", "stdio"]
    }
  }
}
```

> `--project` を追加する場合: `args` に `"--project", "/path/to/project"` を追加

---

### Zed への接続手順

Zed では `~/.config/zed/settings.json` の `context_servers` に追加します。

```json
{
  "context_servers": {
    "smart-edit": {
      "command": {
        "path": "npx",
        "args": ["-y", "@nogataka/smart-edit@latest", "smart-edit", "start-mcp-server", "--transport", "stdio"]
      }
    }
  }
}
```

> `--project` を追加する場合: `args` に `"--project", "/path/to/project"` を追加

---

### GitHub Copilot への接続手順

GitHub Copilot は VS Code 1.102 以降で MCP を公式サポートしています。

#### VS Code での設定

`.vscode/mcp.json` または `settings.json` の `mcp.servers` に追加します。

```json
{
  "servers": {
    "smart-edit": {
      "command": "npx",
      "args": ["-y", "@nogataka/smart-edit@latest", "smart-edit", "start-mcp-server", "--transport", "stdio"]
    }
  }
}
```

> `--project` を追加する場合: `args` に `"--project", "/path/to/project"` を追加

#### JetBrains IDE での設定

JetBrains IDE（IntelliJ IDEA, WebStorm 等）でも MCP がサポートされています。設定は IDE の MCP 設定画面から追加できます。

**参考リンク:**
- [VS Code MCP Servers ドキュメント](https://code.visualstudio.com/docs/copilot/customization/mcp-servers)
- [GitHub Copilot MCP 概要](https://docs.github.com/en/copilot/concepts/context/mcp)

---

### Claude Desktop への接続手順

Claude Desktop (Windows/macOS) では `claude_desktop_config.json` に MCP サーバー設定を追加します。メニューの **File → Settings → Developer → MCP Servers → Edit Config** を開き、以下のいずれかの設定を追記してください。識別子は例として `smart-edit` を使用しています。

- **npm (npx) 経由で最新版を利用する場合**
  ```json
  {
    "mcpServers": {
      "smart-edit": {
        "command": "npx",
        "args": ["-y", "@nogataka/smart-edit@latest", "smart-edit", "start-mcp-server", "--context", "desktop-app", "--transport", "stdio"]
      }
    }
  }
  ```

- **ローカルのクローンから開発ビルドを直接利用する場合**
  ```json
  {
    "mcpServers": {
      "smart-edit": {
        "command": "node",
        "args": ["/absolute/path/to/smart-edit/dist/cli.js", "start-mcp-server", "--context", "desktop-app", "--transport", "stdio", "--project", "/absolute/path/to/project"]
      }
    }
  }
  ```
  - `dist/cli.js` を呼び出す前に `pnpm build` を実行し、`dist/` に成果物を生成しておいてください。
  - `--project` は省略可能です（上記「`--project` オプションについて」を参照）。

- **Docker イメージを使う場合（PoC）**
  ```json
  {
    "mcpServers": {
      "smart-edit": {
        "command": "docker",
        "args": [
          "run", "--rm", "-i",
          "-v", "/path/to/your/projects:/workspace/projects",
          "ghcr.io/nogataka/smart-edit:latest",
          "smart-edit", "start-mcp-server", "--context", "desktop-app", "--transport", "stdio"
        ]
      }
    }
  }
  ```
  - 公式イメージを公開する場合はリポジトリ URL やボリューム設定を用途に合わせて変更してください。

#### 注意事項
- Windows でパスを指定する場合はバックスラッシュを二重にする (`\\`) か、スラッシュ (`/`) を利用してください。
- 設定を保存したら Claude Desktop を完全終了（システムトレイのアイコンも終了）し、再起動すると smart-edit のツールが利用可能になります。
- `desktop-app` コンテキストは Claude Desktop 向けにチューニングされています。必要に応じて `~/.smart-edit/contexts/` 配下に自作コンテキストを配置し、`--context` で差し替え可能です。
- ダッシュボードを利用したい場合は Config 側で `web_dashboard: true` を有効にしてください。ブラウザが自動起動しない場合は `http://localhost:24282/dashboard/index.html` へアクセスできます。
- MCP サーバーを終了するにはチャットを閉じるだけでなく、別コンソールから `smart-edit` プロセスを停止するか、CLI のログを確認しながら Ctrl+C で停止してください。

Claude Desktop の MCP 設定については [公式クイックスタート](https://modelcontextprotocol.io/quickstart/user) も参考になります。


## トラブルシューティング

- 言語サーバーのダウンロードが失敗する場合: ネットワーク設定を確認し、必要に応じて `SMART_EDIT_ASSUME_<LANG>` でローカルバイナリを指示します。
- macOS で `pnpm test` 実行時に `EPERM: operation not permitted, listen` が発生する場合: `sudo` での実行か、環境ポート (`SMART_EDIT_DASHBOARD_PORT` など) の明示指定をご検討ください。
- Windows でコンソールウィンドウが一瞬開く場合: 既に `ensureDefaultSubprocessOptions` が `windowsHide` を設定しますが、`SMART_EDIT_VERBOSE_PROCESS=1` を付与すると詳細ログで状況確認ができます。

## ライセンス

- 本リポジトリ（smart-edit）は MIT ライセンスで提供されます。詳細は [`LICENSE`](./LICENSE) を参照してください。
