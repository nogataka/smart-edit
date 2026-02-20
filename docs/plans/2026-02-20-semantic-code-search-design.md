# Semantic Code Search for smart-edit

## Overview

smart-edit に OpenAI/Azure OpenAI エンベディングと SQLite (sqlite-vec) を使ったセマンティックコード検索機能を追加する。LSP シンボル単位でコードをベクトル化し、自然言語による意味検索と類似コード検出を実現する。

marp-lens プロジェクトのセマンティック検索アーキテクチャ（Gemini Embedding + SQLite sqlite-vec）をベースに、コード領域に最適化して移植する。

## 利用シーン

1. **関数・クラスの自然言語検索**: 「ユーザー認証を処理する関数」のような自然言語でコードシンボルを検索
2. **類似コード検出**: 指定シンボルと意味的に類似するコードを発見（重複・パターン検出）

## アプローチ

**smart-edit 内蔵モジュール**として実装する。LSP シンボルシステムとの密結合が「シンボル単位のエンベディング」に不可欠であり、MCP ツールとしての提供も単一パッケージ内で完結する。

## アーキテクチャ

```
src/smart-edit/semantic/
├── embedding_provider.ts    # OpenAI/Azure OpenAI 抽象化レイヤー
├── vector_db.ts             # SQLite + sqlite-vec によるベクトルDB
├── indexer.ts               # LSPシンボル → テキスト → エンベディング変換
├── searcher.ts              # セマンティック検索 + 類似コード検索エンジン
└── types.ts                 # 型定義
```

### データフロー

```
[インデックス時]
プロジェクトファイル
  → LSP (getDocumentSymbols) → シンボルツリー
  → シンボルごとにボディテキスト抽出
  → OpenAI/Azure embedding API → ベクトル
  → SQLite (sqlite-vec) に保存
  → .smart-edit/semantic.db に永続化

[検索時]
自然言語クエリ or コードスニペット
  → OpenAI/Azure embedding API → クエリベクトル
  → sqlite-vec コサイン距離検索
  → シンボル情報付き結果を返却
```

## データベーススキーマ

保存場所: `{project_root}/.smart-edit/semantic.db`

```sql
CREATE TABLE semantic_files (
    id INTEGER PRIMARY KEY,
    path TEXT UNIQUE NOT NULL,      -- プロジェクト相対パス
    hash TEXT NOT NULL,             -- ファイルハッシュ（差分検出用）
    language TEXT,                  -- プログラミング言語
    indexed_at INTEGER NOT NULL     -- タイムスタンプ
);

CREATE TABLE semantic_symbols (
    id INTEGER PRIMARY KEY,
    file_id INTEGER NOT NULL REFERENCES semantic_files(id),
    name TEXT NOT NULL,             -- シンボル名 (例: "authenticate")
    name_path TEXT NOT NULL,        -- 階層パス (例: "/AuthService/authenticate")
    kind TEXT NOT NULL,             -- シンボル種別 (Function, Class, Method等)
    start_line INTEGER NOT NULL,
    end_line INTEGER NOT NULL,
    body_text TEXT NOT NULL,        -- シンボルの実コード
    summary_text TEXT,              -- エンベディング用テキスト
    UNIQUE(file_id, name_path)
);

CREATE VIRTUAL TABLE semantic_embeddings USING vec0(
    embedding float[1536]          -- text-embedding-3-small: 1536次元
);

CREATE INDEX idx_semantic_symbols_file ON semantic_symbols(file_id);
CREATE INDEX idx_semantic_symbols_kind ON semantic_symbols(kind);
CREATE INDEX idx_semantic_files_path ON semantic_files(path);
```

metadata テーブルにモデル名・次元数を保存し、モデル変更時に全再インデックスを検出する。

## エンベディングプロバイダ

### インターフェース

```typescript
interface EmbeddingProvider {
    embed(text: string): Promise<Float32Array>;
    embedBatch(texts: string[]): Promise<Float32Array[]>;
    readonly dimensions: number;
    readonly modelName: string;
}
```

### 実装

- **OpenAIEmbeddingProvider**: `POST https://api.openai.com/v1/embeddings`
- **AzureOpenAIEmbeddingProvider**: `POST https://{endpoint}/openai/deployments/{deployment}/embeddings`

### モデル

- デフォルト: `text-embedding-3-small` (1536 次元)
- オプション: `text-embedding-3-large` (3072 次元)

### バッチ処理

marp-lens の実績を踏まえ、100 件ずつ並列 3 バッチで処理。レート制限エラー時は指数バックオフ（1s → 2s → 4s、最大 3 回リトライ）。

### 設定

`smart_edit_config.yml` に追加:

```yaml
semantic_search:
  provider: "openai"           # "openai" | "azure_openai"
  model: "text-embedding-3-small"
  # OpenAI
  openai_api_key: "sk-..."     # 環境変数 OPENAI_API_KEY も可
  # Azure OpenAI
  azure_endpoint: "https://..."
  azure_api_key: "..."
  azure_api_version: "2024-02-01"
  azure_deployment: "text-embedding-3-small"
```

## インデクサー

### インデックス処理フロー

1. プロジェクトファイル一覧取得（.gitignore 尊重）
2. 各ファイルのハッシュを計算 → 変更ファイルのみ処理
3. 変更ファイルごとに:
   a. LSP `getDocumentSymbols` でシンボルツリー取得
   b. 対象シンボル種別をフィルタ
   c. シンボルごとにボディテキスト抽出
   d. `summary_text` を生成
4. 全シンボルの `summary_text` をバッチエンベディング
5. DB に保存

### 対象シンボル種別

- `Function`, `Method` — 関数・メソッド
- `Class`, `Interface`, `Struct` — 型定義
- `Enum` — 列挙型
- `Module`, `Namespace` — モジュール（オプション）

### summary_text の構成

```
"{kind} {name} in {filePath}: {bodyText}"
```

例: `"Function authenticate in src/auth/service.ts: async function authenticate(username, password) { ... }"`

長いボディは先頭 2000 文字でトランケート。

### 差分インデックス

marp-lens と同じ MD5 ハッシュ戦略。ファイル変更時はそのファイルの全シンボルを削除して再インデックス。

## MCP ツール

### 1. IndexSemanticSymbolsTool

プロジェクトのシンボルをセマンティックインデックスに登録。

- 入力: `{ paths?: string[] }` — 省略時はプロジェクト全体
- 出力: `{ indexed_files, indexed_symbols, skipped_files }`
- マーカー: `CanEdit`

### 2. SemanticSearchTool

自然言語クエリでコードシンボルを意味検索。

- 入力:
  - `query: string` — 検索クエリ
  - `limit?: number` — デフォルト 10
  - `threshold?: number` — 類似度閾値、デフォルト 0.5
  - `kind_filter?: string[]` — シンボル種別フィルタ
  - `file_filter?: string` — グロブパターン
- 出力: `{ name_path, file_path, kind, similarity, body_preview }[]`
- マーカー: `SymbolicRead`

### 3. FindSimilarCodeTool

指定シンボルと意味的に類似するコードを検出。

- 入力:
  - `symbol_name_path: string`
  - `file_path: string`
  - `limit?: number`
  - `threshold?: number`
- 出力: `{ name_path, file_path, kind, similarity, body_preview }[]`
- マーカー: `SymbolicRead`

### 4. SemanticSearchStatsTool

セマンティックインデックスの統計情報を表示。

- 入力: なし
- 出力: `{ total_files, total_symbols, last_indexed_at, symbols_by_kind, provider, model }`
- マーカー: `DoesNotRequireActiveProject`

## エラーハンドリング

### API エラー

- **レート制限 (429)**: 指数バックオフ（1s → 2s → 4s、最大 3 回リトライ）
- **API キー未設定**: 明確なエラーメッセージで設定方法を案内
- **ネットワークエラー**: タイムアウト 30 秒、リトライ 1 回

### LSP エラー

- **LSP 未起動**: 自動起動を試み、失敗したらエラー
- **シンボル取得失敗**: ファイル単位でスキップ、他ファイルは続行

### データ整合性

- **モデル変更時**: metadata テーブルでモデル名・次元数を管理。変更検出時に全再インデックスを促す
- **空シンボル**: ボディが空のシンボル（抽象メソッド等）はスキップ

### サイズ制限

- 大規模プロジェクト（10,000+ シンボル）: バッチ処理とプログレス表示で対応

## テスト戦略

### ユニットテスト

- `embedding_provider.ts`: API モック使用。バッチ分割・リトライロジック
- `vector_db.ts`: インメモリ SQLite で CRUD・検索
- `indexer.ts`: モック LSP シンボルから summary_text 生成・差分検出
- `searcher.ts`: モックエンベディングでフィルタリング・スコアリング

### 統合テスト

- テスト用 TypeScript fixture → LSP シンボル取得 → インデックス → 検索の一気通貫テスト
- embedding API はモック（コスト回避）

### テストフレームワーク

既存の vitest を使用。
