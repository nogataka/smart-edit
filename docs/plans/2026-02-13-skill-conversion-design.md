# Smart-Edit Skill化 デザインドキュメント

## 概要

smart-editをClaude Code Skillとして提供する。MCPサーバーは裏方として自動管理し、ユーザーはSkillインストールだけで全機能を利用可能にする。

## 背景と動機

- **配布の簡素化**: MCP設定の手動セットアップを不要にしたい
- **Claude Code統合強化**: ネイティブなSkill体験として提供したい
- **LSP精度の維持**: ast-grep等の代替ではなく、フルLSP機能を保持する

## 方針

**Skill + MCP自動設定ハイブリッド**

- SkillがMCPサーバー設定を完全自動化する
- ユーザーはMCPの存在を意識しない
- LSPベースの全機能（23+言語対応）を維持
- まずは自分用として構築し、後に配布方法を検討

## Skill構造

```
~/.claude/skills/smart-edit/
├── SKILL.md                      # メインスキル（自動トリガー + ワークフロー指示）
├── scripts/
│   ├── setup_mcp.py              # MCP自動設定
│   ├── check_health.py           # MCPサーバー状態チェック
│   └── onboarding.py             # プロジェクトオンボーディング
├── references/
│   ├── tool-guide.md             # 全MCPツールリファレンス
│   ├── lsp-workflows.md          # LSPベース高度ワークフロー
│   ├── memory-guide.md           # メモリシステム活用ガイド
│   └── dashboard-guide.md        # ダッシュボード活用ガイド
└── assets/
    └── (必要に応じて)
```

## SKILL.md フロントマター

```yaml
name: smart-edit
description: >-
  AI-powered code editing with language server intelligence.
  Provides LSP-based symbol search, definition jump, refactoring,
  project memory, and onboarding workflows via smart-edit MCP server.
  Auto-configures smart-edit if not already set up.
  Use when: editing code, searching for symbols or definitions,
  refactoring code, navigating code structure, setting up a new project,
  managing project memory/context, コード編集, シンボル検索, 定義ジャンプ,
  リファクタリング, プロジェクトセットアップ, メモリ管理.
  Triggers: "edit code", "find symbol", "go to definition", "refactor",
  "onboard", "project memory", "code navigation", "smart edit".
```

## MCP自動設定

### setup_mcp.py

PEP 723インライン依存。処理フロー:

1. `claude mcp list` でsmart-edit設定確認
2. 未設定 → `npx @nogataka/smart-edit --version` でインストール確認
3. `claude mcp add smart-edit -- npx @nogataka/smart-edit@latest start-mcp-server --transport stdio` 実行
4. 設定済み → バージョンチェック、必要に応じて更新案内

### check_health.py

- MCPサーバー応答確認
- 問題時の自動修復（再設定、再起動）
- JSON形式で結果返却

### スコープ

MCP設定はユーザーレベル（`~/.claude/settings.json`）に追加。プロジェクト固有設定不要。

## ワークフローガイド

### tool-guide.md — 全ツールリファレンス

**File Tools**: `smart_read_file`, `smart_write_file`, `smart_edit_file`

**Symbol Tools (LSP)**:
- `smart_get_symbols` — シンボル一覧
- `smart_go_to_definition` — 定義ジャンプ
- `smart_find_references` — 参照検索
- `smart_hover` — 型情報・ドキュメント
- `smart_rename_symbol` — プロジェクト全体リネーム
- `smart_get_diagnostics` — エラー・警告一覧
- `smart_check_duplicate_definitions` — 重複定義チェック

**Memory Tools**: `smart_memory_store`, `smart_memory_get`, `smart_memory_list`, `smart_memory_delete`

**Workflow Tools**: `smart_onboard`, `smart_collect_project_symbols`

**Config Tools**: `smart_get_config`, `smart_set_config`

### lsp-workflows.md — 高度なワークフロー

- リファクタリングワークフロー（シンボル特定→影響調査→衝突確認→変更→診断）
- コードナビゲーションワークフロー（構造把握→定義→型情報→参照一覧）

### memory-guide.md / dashboard-guide.md

それぞれ必要時のみロード。

## SKILL.md 本体の指示内容

### smart-editツール優先ルール

**smart-editを優先する場面**:
- シンボル検索（Grepより正確）
- 定義ジャンプ（正規表現より確実）
- リネーム（sed/Editより安全）
- 型情報（コード読解より速い）
- 診断（ビルドより軽量）

**Claude Code組み込みツールを使う場面**:
- 単純なファイル読み書き
- テキスト検索（キーワードベース）
- Git操作

### オンボーディングフロー

新プロジェクト初回操作時:
1. `smart_onboard` 呼び出し
2. 結果をメモリ保存
3. 以降メモリ参照で文脈維持

## テスト計画

1. Skillインストール後、コード編集タスクで自動発動を確認
2. 未設定状態からの自動セットアップフロー確認
3. 各ワークフロー動作確認（シンボル検索、リファクタリング等）
4. 既にMCP設定済みの場合のスキップ動作確認

## 備考

- ダッシュボードは `npx @nogataka/smart-edit start-dashboard` で起動（Skillから案内）
- smart-editのバージョン更新は `npx @nogataka/smart-edit@latest` で自動追従
- 将来的な配布: GitHub同梱 or Skill公式レジストリ
