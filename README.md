# Smart Edit

Smart Edit は、TypeScript / Node.js 上で動作する MCP (Model Context Protocol) サーバーです。SmartLSP ベースの言語サーバー管理や Smart-Edit 固有のツール群を TypeScript で実装しています。

## 主な構成

| ディレクトリ / ファイル    | 概要                                                        |
| -------------------------- | ----------------------------------------------------------- |
| `src/smart-edit`           | エージェント本体、CLI、各種ツール・コンフィグ周りのロジック |
| `src/smart-lsp`            | SmartLSP 連携と言語サーバーごとのランタイム管理実装         |
| `src/smart-edit/resources` | Smart-Edit が自動生成・参照する YAML テンプレート群         |
| `test/`                    | Vitest によるユニットテスト・スモークテスト                 |
| `docs/`                    | 言語サーバー対応状況などの資料                              |
| `tsconfig*.json`           | ビルド・テスト・Lint 用 TypeScript 設定                     |

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

| 言語                    | サーバー                   | バージョン           | ダウンロード元                    | 備考                               |
| ----------------------- | -------------------------- | -------------------- | --------------------------------- | ---------------------------------- |
| Bash                    | bash-language-server       | 5.6.0                | npm                               | Node.js 20 以上必須                |
| C / C++                 | clangd                     | 19.1.2               | GitHub Releases                   | LLVM プロジェクト                  |
| C#                      | csharp-language-server     | 5.0.0-1.25329.6      | NuGet                             | .NET ランタイム必要                |
| Clojure                 | clojure-lsp                | latest               | GitHub Releases                   | Clojure 開発環境                   |
| Dart                    | Dart SDK                   | 3.10.4               | Google Storage                    | Flutter SDK に同梱                 |
| Erlang                  | erlang_ls                  | (PATH 検出)          | 外部インストール                  | Erlang/OTP ランタイム必要          |
| Go                      | gopls                      | latest               | `go install`                      | 公式 Go チームによる実装           |
| Java                    | Eclipse JDT.LS             | 1.42.0               | GitHub (vscode-java)              | Java 21 以上必須                   |
| Kotlin                  | kotlin-language-server     | 0.253.10629          | JetBrains CDN                     | JVM ランタイム必要                 |
| Lua                     | lua-language-server        | 3.15.0               | GitHub Releases                   | Lua 5.1〜5.5、LuaJIT 対応          |
| Nix                     | nixd                       | (PATH / nix profile) | 外部インストール                  | Nix 式のサポート                   |
| PHP                     | Intelephense               | 1.16.4               | npm                               | 高機能 PHP サーバー                |
| Python                  | Jedi Language Server       | (PyPI)               | pip                               | 軽量・高速                         |
| Python                  | Pyright                    | (PyPI)               | pip                               | Microsoft 製・型チェック強化       |
| R                       | R Language Server          | (CRAN)               | R package                         | CRAN パッケージ                    |
| Ruby                    | Ruby LSP                   | (gem)                | RubyGems                          | Shopify 製・高速                   |
| Ruby                    | Solargraph                 | (gem)                | RubyGems                          | 従来からの定番                     |
| Rust                    | rust-analyzer              | (rustup)             | rustup component                  | 公式推奨                           |
| Swift                   | SourceKit-LSP              | (PATH 検出)          | Xcode / Swift Toolchain           | Apple 公式                         |
| Terraform               | terraform-ls               | 0.38.3               | HashiCorp Releases                | HashiCorp 公式、Actions block 対応 |
| TypeScript / JavaScript | typescript-language-server | 5.1.3 (TS 5.9.3)     | npm                               | tsserver ラッパー                  |
| Vue                     | VTS (Volar)                | 0.3.0                | npm (@vtsls/language-server)      | Vue 3 対応、TS 必須                |
| Zig                     | zls                        | (PATH 検出)          | 外部インストール                  | Zig 公式                           |

**除外**: AL Language Server, elixir_tools, OmniSharp（TypeScript 版では対象外）

**バージョン更新日**: 2026-02-01

### Claude Code への接続手順

Claude Code ではプロジェクトごとに MCP サーバーを追加します。smart-edit を使う場合の手順は以下の通りです。

1. プロジェクトのルートディレクトリで次のコマンドを実行します。
   ```bash
   claude mcp add smart-edit -- npx -y @nogataka/smart-edit@latest smart-edit start-mcp-server --context ide-assistant --project "$(pwd)" --transport stdio
   ```
   - `smart-edit` が Claude Code 上でのサーバー識別子になります（任意で変更可）。
   - `--context ide-assistant` は Claude Code 向けに最適化した設定です。用途に応じて `desktop-app` など他のコンテキストへ切り替えても構いません。
   - `--project` にはコードベースのルートパスを指定してください。`$(pwd)` を使うとカレントディレクトリをそのまま渡せます。
   - `--transport stdio` は標準入出力経由での通信を指定します。Claude Code は stdio を用いるため、この指定が必要です。

2. 追加が完了したら、`claude mcp list` で登録済みサーバーを確認できます。必要に応じて `claude mcp remove smart-edit` で削除し、再登録してください。

3. 会話を開始すると Claude が smart-edit の初期インストラクション（`initial_instructions`）を自動で読み込みます。もし読み込みに失敗した場合は、Claude に「smart-edit の初期インストラクションを読んで」と依頼するか、`/mcp__smart-edit__initial_instructions` を実行してください（初期インストラクションツールを有効化している場合）。

4. コンテキストやモードをカスタマイズしたい場合は、`~/.smart-edit/context/` 配下に YAML を配置した上で `--context` / `--mode` オプションで指定できます。

### Codex CLI への接続手順

Codex CLI はグローバル設定で MCP サーバーを追加します。`~/.codex/config.toml` に以下のエントリを追加してください。

```toml
[mcp_servers.smart-edit]
command = "npx"
args = ["-y", "@nogataka/smart-edit@latest", "smart-edit", "start-mcp-server", "--context", "codex", "--transport", "stdio"]
```

- `--context codex` は Codex 特有の I/O や制約に対応するための設定です。Codex では `codex` コンテキストを使うことでツールの動作が最適化されます。
- Codex 起動後、チャット内で「smart-edit で現在のディレクトリをプロジェクトとしてアクティブ化して」と依頼してください。プロジェクトをアクティブ化しないとツールを利用できません。
- ダッシュボード (`--enable-web-dashboard`) を利用する場合、Codex のサンドボックスではブラウザが自動起動しないことがあります。その場合は `http://localhost:24282/dashboard/index.html` （ポートは環境により変わります）へブラウザでアクセスしてください。
- Codex の UI ではツール実行が `failed` と表示されることがありますが、実際には処理が成功しているケースが多いです。ログ (`~/.codex/log/codex-tui.log`) を併せて確認してください。

これらの設定を行うことで、Claude Code / Codex ともに `npx -y @nogataka/smart-edit@latest` を通して smart-edit MCP サーバーを利用できます。`npm publish` 後に `@nogataka/smart-edit` のバージョンを最新に保つようご注意ください。

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
  - `--project` は必要に応じて省略できます（省略時は起動後にチャットからプロジェクトをアクティブ化します）。

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
