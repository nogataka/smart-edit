// src/smart-edit/semantic/vector_db.ts
import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import type { SemanticFileRecord, SemanticSearchResult } from './types.js';

export interface UpsertFileInput {
  path: string;
  hash: string;
  language: string | null;
  indexedAt: number;
}

export interface InsertSymbolInput {
  fileId: number;
  name: string;
  namePath: string;
  kind: string;
  startLine: number;
  endLine: number;
  bodyText: string;
  summaryText: string | null;
}

export interface SearchOptions {
  kindFilter?: string[];
  fileFilter?: string[];
}

export interface VectorDBStats {
  totalFiles: number;
  totalSymbols: number;
  lastIndexedAt: number | null;
  symbolsByKind: Record<string, number>;
}

function float32ToBuffer(arr: Float32Array): Buffer {
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
}

export class SemanticVectorDB {
  private db: BetterSqlite3.Database;
  private readonly dimensions: number;

  constructor(dbPath: string, dimensions: number) {
    this.dimensions = dimensions;
    this.db = new Database(dbPath);
    sqliteVec.load(this.db);

    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    this.createTables();
  }

  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS semantic_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL UNIQUE,
        hash TEXT NOT NULL,
        language TEXT,
        indexed_at INTEGER NOT NULL
      );
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS semantic_symbols (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        name_path TEXT NOT NULL,
        kind TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        body_text TEXT NOT NULL,
        summary_text TEXT,
        FOREIGN KEY (file_id) REFERENCES semantic_files(id) ON DELETE CASCADE
      );
    `);

    // vec0 virtual tables don't support IF NOT EXISTS, so check first
    const vecTableExists = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='semantic_embeddings'"
    ).get();

    if (!vecTableExists) {
      this.db.exec(`
        CREATE VIRTUAL TABLE semantic_embeddings USING vec0(
          embedding float[${this.dimensions}] distance_metric=cosine
        );
      `);
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  upsertFile(input: UpsertFileInput): number {
    const existing = this.db.prepare(
      'SELECT id FROM semantic_files WHERE path = ?'
    ).get(input.path) as { id: number } | undefined;

    if (existing) {
      // Delete old symbols and their embeddings for this file
      this.deleteSymbolsForFile(existing.id);

      // Update the file record
      this.db.prepare(
        'UPDATE semantic_files SET hash = ?, language = ?, indexed_at = ? WHERE id = ?'
      ).run(input.hash, input.language, input.indexedAt, existing.id);

      return existing.id;
    }

    const result = this.db.prepare(
      'INSERT INTO semantic_files (path, hash, language, indexed_at) VALUES (?, ?, ?, ?)'
    ).run(input.path, input.hash, input.language, input.indexedAt);

    return Number(result.lastInsertRowid);
  }

  private deleteSymbolsForFile(fileId: number): void {
    // Get symbol IDs to delete from embeddings table
    const symbols = this.db.prepare(
      'SELECT id FROM semantic_symbols WHERE file_id = ?'
    ).all(fileId) as { id: number }[];

    for (const symbol of symbols) {
      this.db.prepare('DELETE FROM semantic_embeddings WHERE rowid = ?').run(symbol.id);
    }

    // Delete the symbols themselves
    this.db.prepare('DELETE FROM semantic_symbols WHERE file_id = ?').run(fileId);
  }

  getFileByPath(path: string): SemanticFileRecord | null {
    const row = this.db.prepare(
      'SELECT id, path, hash, language, indexed_at FROM semantic_files WHERE path = ?'
    ).get(path) as { id: number; path: string; hash: string; language: string | null; indexed_at: number } | undefined;

    if (!row) return null;

    return {
      id: row.id,
      path: row.path,
      hash: row.hash,
      language: row.language,
      indexedAt: row.indexed_at,
    };
  }

  insertSymbol(input: InsertSymbolInput, embedding: Float32Array): number {
    const result = this.db.prepare(
      `INSERT INTO semantic_symbols (file_id, name, name_path, kind, start_line, end_line, body_text, summary_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      input.fileId,
      input.name,
      input.namePath,
      input.kind,
      input.startLine,
      input.endLine,
      input.bodyText,
      input.summaryText,
    );

    const symbolId = Number(result.lastInsertRowid);

    // Insert embedding with same rowid as symbol
    this.db.prepare(
      'INSERT INTO semantic_embeddings(rowid, embedding) VALUES (?, ?)'
    ).run(BigInt(symbolId), float32ToBuffer(embedding));

    return symbolId;
  }

  searchSimilar(
    queryEmbedding: Float32Array,
    limit: number,
    options?: SearchOptions
  ): SemanticSearchResult[] {
    const queryBuf = float32ToBuffer(queryEmbedding);

    // First, get candidate rowids from the vector search
    // We fetch more than needed to allow for filtering
    const fetchLimit = options?.kindFilter || options?.fileFilter
      ? limit * 5
      : limit;

    const vecResults = this.db.prepare(
      `SELECT rowid, distance
       FROM semantic_embeddings
       WHERE embedding MATCH ?
       AND k = ?
       ORDER BY distance`
    ).all(queryBuf, fetchLimit) as { rowid: number; distance: number }[];

    if (vecResults.length === 0) return [];

    const results: SemanticSearchResult[] = [];

    for (const vecRow of vecResults) {
      if (results.length >= limit) break;

      const symbolRow = this.db.prepare(
        `SELECT s.name_path, s.kind, s.body_text, s.start_line, s.end_line, f.path as file_path
         FROM semantic_symbols s
         JOIN semantic_files f ON s.file_id = f.id
         WHERE s.id = ?`
      ).get(vecRow.rowid) as {
        name_path: string;
        kind: string;
        body_text: string;
        start_line: number;
        end_line: number;
        file_path: string;
      } | undefined;

      if (!symbolRow) continue;

      // Apply filters
      if (options?.kindFilter && !options.kindFilter.includes(symbolRow.kind)) {
        continue;
      }
      if (options?.fileFilter && !options.fileFilter.includes(symbolRow.file_path)) {
        continue;
      }

      results.push({
        namePath: symbolRow.name_path,
        filePath: symbolRow.file_path,
        kind: symbolRow.kind,
        similarity: 1 - vecRow.distance,
        bodyPreview: symbolRow.body_text,
        startLine: symbolRow.start_line,
        endLine: symbolRow.end_line,
      });
    }

    return results;
  }

  getStats(): VectorDBStats {
    const fileCount = this.db.prepare(
      'SELECT COUNT(*) as count FROM semantic_files'
    ).get() as { count: number };

    const symbolCount = this.db.prepare(
      'SELECT COUNT(*) as count FROM semantic_symbols'
    ).get() as { count: number };

    const kindRows = this.db.prepare(
      'SELECT kind, COUNT(*) as count FROM semantic_symbols GROUP BY kind'
    ).all() as { kind: string; count: number }[];

    const symbolsByKind: Record<string, number> = {};
    for (const row of kindRows) {
      symbolsByKind[row.kind] = row.count;
    }

    const lastIndexed = this.db.prepare(
      'SELECT MAX(indexed_at) as last_indexed FROM semantic_files'
    ).get() as { last_indexed: number | null };

    return {
      totalFiles: fileCount.count,
      totalSymbols: symbolCount.count,
      lastIndexedAt: lastIndexed.last_indexed,
      symbolsByKind,
    };
  }

  getSymbolEmbedding(symbolId: number): Float32Array | null {
    const row = this.db.prepare(
      'SELECT embedding FROM semantic_embeddings WHERE rowid = ?'
    ).get(symbolId) as { embedding: Buffer } | undefined;

    if (!row) return null;

    return new Float32Array(
      row.embedding.buffer,
      row.embedding.byteOffset,
      row.embedding.byteLength / 4
    );
  }

  setMetadata(key: string, value: string): void {
    this.db.prepare(
      'INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)'
    ).run(key, value);
  }

  getMetadata(key: string): string | null {
    const row = this.db.prepare(
      'SELECT value FROM metadata WHERE key = ?'
    ).get(key) as { value: string } | undefined;

    return row?.value ?? null;
  }

  isModelChanged(model: string, dimensions: number): boolean {
    const storedModel = this.getMetadata('model');
    const storedDimensions = this.getMetadata('dimensions');

    if (storedModel === null || storedDimensions === null) {
      return true;
    }

    return storedModel !== model || storedDimensions !== String(dimensions);
  }

  close(): void {
    this.db.close();
  }
}
