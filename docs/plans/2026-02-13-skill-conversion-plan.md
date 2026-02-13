# Smart-Edit Skill化 実装計画

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** smart-editをClaude Code Skillとして提供し、MCP設定の自動化によりユーザーがSkillインストールだけで全機能を利用可能にする。

**Architecture:** Skill + MCP自動設定ハイブリッド。SKILL.mdがワークフロー指示書として機能し、Pythonスクリプト（PEP 723）がMCPサーバーの自動設定・ヘルスチェックを担当する。references/に分割されたガイドがプログレッシブに読み込まれる。

**Tech Stack:** Markdown (SKILL.md + references)、Python 3.10+ (PEP 723 inline deps, uv run)、Claude Code CLI (`claude mcp` commands)

**重要な注意**: デザインドキュメントのツール名は仮名（`smart_read_file`等）だが、実際のMCPツール名はプレフィックスなし（`read_file`, `find_symbol`等）。本計画では**実際のツール名**を使用する。

---

### Task 1: ディレクトリ構造の作成

**Files:**
- Create: `~/.claude/skills/smart-edit/`
- Create: `~/.claude/skills/smart-edit/scripts/`
- Create: `~/.claude/skills/smart-edit/references/`

**Step 1: ディレクトリ作成**

```bash
mkdir -p ~/.claude/skills/smart-edit/scripts
mkdir -p ~/.claude/skills/smart-edit/references
```

**Step 2: 確認**

Run: `ls -la ~/.claude/skills/smart-edit/`
Expected: `scripts/` と `references/` ディレクトリが存在

**Step 3: Commit**

```bash
# このタスクはユーザーのhomeディレクトリなのでgit管理外。コミット不要。
```

---

### Task 2: setup_mcp.py の作成

**Files:**
- Create: `~/.claude/skills/smart-edit/scripts/setup_mcp.py`

**Step 1: スクリプト作成**

```python
#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///

"""
Smart-Edit MCP自動設定スクリプト。
Claude Code の MCP設定にsmart-editサーバーを追加する。
"""

import json
import subprocess
import sys
from pathlib import Path


def run_cmd(cmd: list[str], check: bool = True) -> subprocess.CompletedProcess:
    """コマンドを実行し結果を返す。"""
    return subprocess.run(cmd, capture_output=True, text=True, check=check)


def is_smart_edit_configured() -> bool:
    """smart-editがMCPサーバーとして設定済みか確認する。"""
    settings_path = Path.home() / ".claude" / "settings.json"
    if not settings_path.exists():
        return False
    try:
        settings = json.loads(settings_path.read_text())
        mcp_servers = settings.get("mcpServers", {})
        return "smart-edit" in mcp_servers
    except (json.JSONDecodeError, KeyError):
        return False


def check_npx_available() -> bool:
    """npxが利用可能か確認する。"""
    result = run_cmd(["npx", "--version"], check=False)
    return result.returncode == 0


def get_smart_edit_version() -> str | None:
    """インストール済みsmart-editのバージョンを取得する。"""
    result = run_cmd(
        ["npx", "@nogataka/smart-edit", "--version"],
        check=False,
    )
    if result.returncode == 0:
        return result.stdout.strip()
    return None


def setup_mcp_server() -> dict:
    """smart-editをMCPサーバーとして設定する。"""
    result = {
        "action": "setup",
        "already_configured": False,
        "success": False,
        "message": "",
    }

    # 既に設定済みか確認
    if is_smart_edit_configured():
        version = get_smart_edit_version()
        result["already_configured"] = True
        result["success"] = True
        result["message"] = f"smart-edit is already configured as MCP server."
        if version:
            result["version"] = version
        return result

    # npx確認
    if not check_npx_available():
        result["message"] = "npx is not available. Please install Node.js >= 20."
        return result

    # smart-edit MCP設定を追加
    # claude mcp add コマンドで設定（環境変数CLAUDECODE回避のためsettings.jsonを直接編集）
    settings_path = Path.home() / ".claude" / "settings.json"
    settings_path.parent.mkdir(parents=True, exist_ok=True)

    if settings_path.exists():
        settings = json.loads(settings_path.read_text())
    else:
        settings = {}

    if "mcpServers" not in settings:
        settings["mcpServers"] = {}

    settings["mcpServers"]["smart-edit"] = {
        "command": "npx",
        "args": [
            "@nogataka/smart-edit@latest",
            "start-mcp-server",
            "--transport",
            "stdio",
        ],
    }

    settings_path.write_text(json.dumps(settings, indent=2, ensure_ascii=False) + "\n")

    version = get_smart_edit_version()
    result["success"] = True
    result["message"] = "smart-edit MCP server configured successfully."
    if version:
        result["version"] = version

    return result


def main():
    result = setup_mcp_server()
    print(json.dumps(result, indent=2, ensure_ascii=False))
    sys.exit(0 if result["success"] else 1)


if __name__ == "__main__":
    main()
```

**Step 2: 実行権限付与と動作確認**

Run: `chmod +x ~/.claude/skills/smart-edit/scripts/setup_mcp.py`
Run: `uv run ~/.claude/skills/smart-edit/scripts/setup_mcp.py`
Expected: JSON出力で `"success": true`。`~/.claude/settings.json` に `smart-edit` MCPサーバー設定が追加される。

**Step 3: 冪等性確認**

Run: `uv run ~/.claude/skills/smart-edit/scripts/setup_mcp.py`
Expected: `"already_configured": true` で二重登録されないこと。

---

### Task 3: check_health.py の作成

**Files:**
- Create: `~/.claude/skills/smart-edit/scripts/check_health.py`

**Step 1: スクリプト作成**

```python
#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///

"""
Smart-Edit MCPサーバーのヘルスチェック。
設定の有無、npxの可用性、バージョンを確認しJSONで返す。
"""

import json
import subprocess
import sys
from pathlib import Path


def run_cmd(cmd: list[str], check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, check=check)


def check_health() -> dict:
    result = {
        "configured": False,
        "npx_available": False,
        "smart_edit_installed": False,
        "version": None,
        "healthy": False,
        "issues": [],
        "fix_command": None,
    }

    # 1. MCP設定確認
    settings_path = Path.home() / ".claude" / "settings.json"
    if settings_path.exists():
        try:
            settings = json.loads(settings_path.read_text())
            mcp_servers = settings.get("mcpServers", {})
            result["configured"] = "smart-edit" in mcp_servers
        except (json.JSONDecodeError, KeyError):
            result["issues"].append("settings.json is malformed")

    if not result["configured"]:
        result["issues"].append("smart-edit MCP server is not configured")
        result["fix_command"] = "uv run $SKILL_DIR/scripts/setup_mcp.py"

    # 2. npx確認
    npx_result = run_cmd(["npx", "--version"], check=False)
    result["npx_available"] = npx_result.returncode == 0
    if not result["npx_available"]:
        result["issues"].append("npx is not available")

    # 3. smart-editバージョン確認
    if result["npx_available"]:
        ver_result = run_cmd(
            ["npx", "@nogataka/smart-edit", "--version"],
            check=False,
        )
        if ver_result.returncode == 0:
            result["smart_edit_installed"] = True
            result["version"] = ver_result.stdout.strip()
        else:
            result["issues"].append("smart-edit package not found via npx")

    # 4. 総合判定
    result["healthy"] = (
        result["configured"]
        and result["npx_available"]
        and result["smart_edit_installed"]
    )

    return result


def main():
    health = check_health()
    print(json.dumps(health, indent=2, ensure_ascii=False))
    sys.exit(0 if health["healthy"] else 1)


if __name__ == "__main__":
    main()
```

**Step 2: 実行権限付与と動作確認**

Run: `chmod +x ~/.claude/skills/smart-edit/scripts/check_health.py`
Run: `uv run ~/.claude/skills/smart-edit/scripts/check_health.py`
Expected: JSON出力。MCP未設定なら `"healthy": false` + `"fix_command"` が提示される。

---

### Task 4: references/tool-guide.md の作成

**Files:**
- Create: `~/.claude/skills/smart-edit/references/tool-guide.md`

**Step 1: ツールガイド作成**

実際のMCPツール名・パラメータに基づいた完全なリファレンスを作成する。内容は以下のセクションで構成:

1. **Project/Config Tools** — `activate_project`, `remove_project`, `switch_modes`, `get_current_config`
2. **File Tools** — `read_file`, `create_text_file`, `list_dir`, `find_file`, `replace_regex`, `delete_lines`, `replace_lines`, `insert_at_line`, `search_for_pattern`
3. **Symbol Tools (LSP)** — `get_symbols_overview`, `find_symbol`, `find_referencing_symbols`, `replace_symbol_body`, `insert_after_symbol`, `insert_before_symbol`, `restart_language_server`
4. **Memory Tools** — `write_memory`, `read_memory`, `list_memories`, `delete_memory`
5. **Workflow Tools** — `check_onboarding_performed`, `onboarding`, `collect_project_symbols`
6. **Shell Tool** — `execute_shell_command`
7. **Thinking Tools** — `think_about_collected_information`, `think_about_task_adherence`, `think_about_whether_you_are_done`

各ツールに以下を記載:
- ツール名
- 説明（1行）
- 必須/オプションパラメータの表（名前、型、デフォルト値、説明）
- 使用例（最も一般的なユースケース1つ）

**Step 2: 確認**

ファイルが正しいMarkdown構文で、全38ツールをカバーしていることを確認。

---

### Task 5: references/lsp-workflows.md の作成

**Files:**
- Create: `~/.claude/skills/smart-edit/references/lsp-workflows.md`

**Step 1: ワークフローガイド作成**

以下のワークフローを記載:

#### 1. コードナビゲーション
```
get_symbols_overview → find_symbol → find_referencing_symbols
```
- ファイルの構造理解 → 特定シンボルの詳細 → 使用箇所の調査

#### 2. リファクタリング
```
find_symbol → find_referencing_symbols → replace_symbol_body or insert_before_symbol/insert_after_symbol
```
- 対象特定 → 影響範囲調査 → 安全な変更

#### 3. シンボルベース編集
```
find_symbol(include_body=true) → replace_symbol_body
```
- 行番号不要の正確な編集

#### 4. 新規コード追加
```
get_symbols_overview → insert_after_symbol or insert_before_symbol
```
- 既存コードの構造を把握してから適切な位置に挿入

#### 5. オンボーディング
```
check_onboarding_performed → onboarding → collect_project_symbols → write_memory
```
- プロジェクト初回分析 → シンボル収集 → メモリ保存

**Step 2: 確認**

各ワークフローが実際のツール名とパラメータで記述されていることを確認。

---

### Task 6: references/memory-guide.md の作成

**Files:**
- Create: `~/.claude/skills/smart-edit/references/memory-guide.md`

**Step 1: メモリガイド作成**

以下を記載:
- メモリの保存先: `~/.smart-edit/memories/{project_name}/`
- `write_memory` — Markdown形式でプロジェクト固有の情報を保存
- `read_memory` — 保存済みメモリの読み取り
- `list_memories` — 保存済みメモリの一覧
- `delete_memory` — 不要なメモリの削除
- 推奨用途: アーキテクチャ決定、命名規則、既知の問題、開発手順
- オンボーディング結果の保存パターン

**Step 2: 確認**

ファイルが正しいMarkdown構文であること。

---

### Task 7: references/dashboard-guide.md の作成

**Files:**
- Create: `~/.claude/skills/smart-edit/references/dashboard-guide.md`

**Step 1: ダッシュボードガイド作成**

以下を記載:
- ダッシュボード起動: `npx @nogataka/smart-edit start-dashboard`
- 機能: リアルタイムログ、ツール使用統計、セッション管理、プロジェクト情報
- 起動確認手順
- ブラウザで開くURL（デフォルトポート）

**Step 2: 確認**

ファイルが正しいMarkdown構文であること。

---

### Task 8: SKILL.md の作成

**Files:**
- Create: `~/.claude/skills/smart-edit/SKILL.md`

**Step 1: メインSkillファイル作成**

```markdown
---
name: smart-edit
description: >-
  AI-powered code editing with language server intelligence (23+ languages).
  Provides LSP-based symbol search, definition jump, refactoring, project
  memory, and onboarding workflows via smart-edit MCP server.
  Auto-configures smart-edit MCP if not already set up.
  Use when: editing code with symbol awareness, searching for symbol
  definitions or references, refactoring or renaming across files,
  navigating code structure, setting up a new project, managing project
  memory and context, checking for duplicate definitions, getting type
  information or diagnostics.
  コード編集, シンボル検索, 定義ジャンプ, リファクタリング, リネーム,
  プロジェクトセットアップ, メモリ管理, 型情報, 診断.
  Triggers: "edit code", "find symbol", "go to definition", "find references",
  "refactor", "rename symbol", "onboard project", "project memory",
  "code navigation", "smart edit", "type info", "diagnostics",
  "duplicate check".
requires:
  mcp: [smart-edit]
---

# Smart Edit — LSP-Powered Code Intelligence for Claude Code

smart-editは23+言語対応のLanguage Server Protocol統合を提供するMCPサーバー。
シンボルベースの正確なコード操作、プロジェクトメモリ、オンボーディングワークフローを実現する。

## Prerequisites Check (毎回実行)

1. Run `$SKILL_DIR/scripts/check_health.py` via Bash to verify smart-edit MCP availability
2. If not healthy:
   - Run `$SKILL_DIR/scripts/setup_mcp.py` via Bash to auto-configure
   - Inform the user: "smart-editのMCPサーバーを自動設定しました。次回のセッションから利用可能になります。"
   - If setup fails, report the issue and suggest manual troubleshooting
3. If healthy: proceed silently (do not inform the user about checks)

## When to Use smart-edit Tools vs Claude Code Built-in Tools

### Prefer smart-edit tools when:
- **Symbol search/navigation**: `find_symbol` and `get_symbols_overview` are AST-accurate, unlike regex-based Grep
- **Definition jump**: `find_symbol` with `include_body=true` gives exact symbol implementations
- **Reference finding**: `find_referencing_symbols` traces actual usage, not just text matches
- **Renaming**: `replace_symbol_body` respects symbol boundaries, safer than text replacement
- **Code insertion**: `insert_after_symbol` / `insert_before_symbol` for precise positioning
- **Diagnostics**: Run language-level checks without a full build

### Prefer Claude Code built-in tools when:
- Simple text search (keyword-based) → Grep/Glob
- Plain file read/write without symbol awareness → Read/Write/Edit
- Git operations → Bash
- File system navigation → Glob/Bash

## Onboarding (新プロジェクト初回操作)

When working with a project for the first time:
1. Call `check_onboarding_performed` to check if already onboarded
2. If not onboarded: call `onboarding` to analyze project structure
3. Call `collect_project_symbols` to index key symbols
4. Store results with `write_memory` for future reference

## Workflows

For detailed tool reference and parameters, see:
- [Tool Guide](references/tool-guide.md) — All 38 MCP tools with parameters
- [LSP Workflows](references/lsp-workflows.md) — Symbol-based editing patterns
- [Memory Guide](references/memory-guide.md) — Project memory management
- [Dashboard Guide](references/dashboard-guide.md) — Monitoring dashboard
```

**Step 2: 構文確認**

YAMLフロントマターが正しいこと、Markdownリンクが正しいpathを指していること。

---

### Task 9: 手動テスト — MCP未設定状態からの自動セットアップ

**Step 1: MCP設定のバックアップ（既に設定済みの場合）**

```bash
cp ~/.claude/settings.json ~/.claude/settings.json.bak
```

**Step 2: smart-editのMCP設定を削除（テスト用）**

settings.jsonからsmart-editエントリを手動削除。

**Step 3: check_health.py の実行確認**

Run: `uv run ~/.claude/skills/smart-edit/scripts/check_health.py`
Expected: `"configured": false`, `"healthy": false`, `"fix_command"` が出力される。

**Step 4: setup_mcp.py の実行確認**

Run: `uv run ~/.claude/skills/smart-edit/scripts/setup_mcp.py`
Expected: `"success": true`。settings.jsonにsmart-editが追加される。

**Step 5: 再度 check_health.py の実行**

Run: `uv run ~/.claude/skills/smart-edit/scripts/check_health.py`
Expected: `"healthy": true`

**Step 6: バックアップの復元**

```bash
mv ~/.claude/settings.json.bak ~/.claude/settings.json
```

---

### Task 10: 手動テスト — Skill自動発動の確認

**Step 1: 新しいClaude Codeセッションを開始**

任意のプロジェクトディレクトリでClaude Codeを起動。

**Step 2: コード編集系のタスクを依頼**

例: 「このプロジェクトのシンボル構造を教えて」
Expected: smart-edit Skillが自動発動し、smart-editのMCPツール（`get_symbols_overview`, `find_symbol`等）を使用する。

**Step 3: オンボーディングの確認**

例: 「このプロジェクトをセットアップして」
Expected: `onboarding` → `collect_project_symbols` → `write_memory` のフローが実行される。

**Step 4: メモリの確認**

例: 「プロジェクトのメモリを見せて」
Expected: `list_memories` → `read_memory` が使用される。

---

### Task 11: smart-editリポジトリへのSkillコピー同梱

**Files:**
- Create: `/Volumes/Data/dev/smart-edit/skill/` ディレクトリ
- Copy: `~/.claude/skills/smart-edit/` の全ファイルを `/Volumes/Data/dev/smart-edit/skill/` にコピー

**Step 1: リポジトリにskillディレクトリを作成しコピー**

```bash
mkdir -p /Volumes/Data/dev/smart-edit/skill
cp -r ~/.claude/skills/smart-edit/* /Volumes/Data/dev/smart-edit/skill/
```

**Step 2: .gitignoreの確認**

`skill/` ディレクトリがgitignoreされていないことを確認。必要なら`.gitignore`を修正。

**Step 3: Commit**

```bash
cd /Volumes/Data/dev/smart-edit
git add skill/
git commit -m "feat: Claude Code Skill同梱（MCP自動設定ハイブリッド）"
```

---

## 実装順序の依存関係

```
Task 1 (ディレクトリ)
  → Task 2 (setup_mcp.py)
  → Task 3 (check_health.py)
  → Task 4 (tool-guide.md)
  → Task 5 (lsp-workflows.md)
  → Task 6 (memory-guide.md)
  → Task 7 (dashboard-guide.md)
  → Task 8 (SKILL.md) ← Task 4-7に依存（リンク先が必要）
    → Task 9 (テスト: セットアップ)
    → Task 10 (テスト: 自動発動)
    → Task 11 (リポジトリ同梱)
```

Task 2-7 は互いに独立しており並列実行可能。Task 8 は Task 4-7 のファイルを参照するため、それらの完了後に実行する。
