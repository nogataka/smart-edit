// src/smart-edit/semantic/indexer.ts
import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import { createSmartEditLogger } from '../util/logging.js';
import { INDEXABLE_SYMBOL_KINDS, MAX_BODY_TEXT_LENGTH } from './types.js';
import type { SemanticIndexResult } from './types.js';
import type { EmbeddingProvider } from './embedding_provider.js';
import type { SemanticVectorDB } from './vector_db.js';

const { logger: log } = createSmartEditLogger({ name: 'smart-edit.semantic.indexer' });

export interface SymbolInfo {
  name: string;
  namePath: string;
  kind: string;
  startLine: number;
  endLine: number;
  bodyText: string;
}

export interface IndexFilesParams {
  filePaths: string[];
  projectRoot: string;
  getSymbols: (filePath: string) => Promise<SymbolInfo[]>;
  db: SemanticVectorDB;
  provider: EmbeddingProvider;
  onProgress?: (message: string) => void;
}

export class SemanticIndexer {
  /**
   * Build a summary text string for embedding.
   * Format: "{kind} {name} in {filePath}: {bodyText}"
   * Body text is truncated to MAX_BODY_TEXT_LENGTH characters.
   */
  static buildSummaryText(kind: string, name: string, filePath: string, bodyText: string): string {
    const truncatedBody = bodyText.length > MAX_BODY_TEXT_LENGTH
      ? bodyText.slice(0, MAX_BODY_TEXT_LENGTH)
      : bodyText;
    return `${kind} ${name} in ${filePath}: ${truncatedBody}`;
  }

  /**
   * Filter symbols to only include indexable kinds (Function, Method, Class, etc.).
   */
  static filterSymbolKinds<T extends { kind: string }>(symbols: T[]): T[] {
    return symbols.filter(s => INDEXABLE_SYMBOL_KINDS.has(s.kind));
  }

  /**
   * Index files by extracting symbols, computing embeddings, and storing in the vector DB.
   *
   * For each file:
   * 1. Compute MD5 hash of file contents
   * 2. Skip if file hash is unchanged in DB
   * 3. For changed files: get symbols, filter by kind, build summary texts
   * 4. Batch embed all summary texts using provider.embedBatch
   * 5. Store in DB (upsertFile + insertSymbol for each)
   *
   * Returns counts of indexed/skipped files and symbols.
   */
  async indexFiles(params: IndexFilesParams): Promise<SemanticIndexResult> {
    const { filePaths, projectRoot, getSymbols, db, provider, onProgress } = params;

    let indexedFiles = 0;
    let indexedSymbols = 0;
    let skippedFiles = 0;

    // Phase 1: Determine which files need indexing
    const filesToIndex: {
      filePath: string;
      relativePath: string;
      hash: string;
      content: string;
    }[] = [];

    for (const filePath of filePaths) {
      try {
        const content = await readFile(filePath, 'utf-8');
        const hash = createHash('md5').update(content).digest('hex');

        const relativePath = filePath.startsWith(projectRoot)
          ? filePath.slice(projectRoot.length).replace(/^\//, '')
          : filePath;

        // Check if file hash is unchanged
        const existingFile = db.getFileByPath(relativePath);
        if (existingFile?.hash === hash) {
          skippedFiles++;
          onProgress?.(`Skipped ${relativePath} (unchanged)`);
          continue;
        }

        filesToIndex.push({ filePath, relativePath, hash, content });
      } catch (err) {
        log.warn(`Failed to read file ${filePath}: ${String(err)}`);
      }
    }

    if (filesToIndex.length === 0) {
      return { indexedFiles, indexedSymbols, skippedFiles };
    }

    // Phase 2: Collect symbols for all files that need indexing
    const allSymbolEntries: {
      fileIndex: number;
      symbol: SymbolInfo;
      summaryText: string;
    }[] = [];

    for (let i = 0; i < filesToIndex.length; i++) {
      const file = filesToIndex[i];
      onProgress?.(`Extracting symbols from ${file.relativePath} (${i + 1}/${filesToIndex.length})`);

      try {
        const symbols = await getSymbols(file.filePath);
        const filtered = SemanticIndexer.filterSymbolKinds(symbols);

        for (const symbol of filtered) {
          const summaryText = SemanticIndexer.buildSummaryText(
            symbol.kind, symbol.name, file.relativePath, symbol.bodyText
          );
          allSymbolEntries.push({ fileIndex: i, symbol, summaryText });
        }
      } catch (err) {
        log.warn(`Failed to get symbols for ${file.filePath}: ${String(err)}`);
      }
    }

    // Phase 3: Batch embed all summary texts
    let embeddings: Float32Array[] = [];
    if (allSymbolEntries.length > 0) {
      onProgress?.(`Embedding ${allSymbolEntries.length} symbols...`);
      const summaryTexts = allSymbolEntries.map(e => e.summaryText);
      embeddings = await provider.embedBatch(summaryTexts, (completed, total) => {
        onProgress?.(`Embedding symbols: ${completed}/${total}`);
      });
    }

    // Phase 4: Store in DB
    const fileIdMap = new Map<number, number>(); // fileIndex -> DB file ID

    for (let i = 0; i < allSymbolEntries.length; i++) {
      const entry = allSymbolEntries[i];
      const file = filesToIndex[entry.fileIndex];
      const embedding = embeddings[i];

      // Upsert file if not yet done
      if (!fileIdMap.has(entry.fileIndex)) {
        const language = detectLanguage(file.relativePath);
        const fileId = db.upsertFile({
          path: file.relativePath,
          hash: file.hash,
          language,
          indexedAt: Date.now(),
        });
        fileIdMap.set(entry.fileIndex, fileId);
        indexedFiles++;
      }

      const fileId = fileIdMap.get(entry.fileIndex)!;

      db.insertSymbol({
        fileId,
        name: entry.symbol.name,
        namePath: entry.symbol.namePath,
        kind: entry.symbol.kind,
        startLine: entry.symbol.startLine,
        endLine: entry.symbol.endLine,
        bodyText: entry.symbol.bodyText,
        summaryText: entry.summaryText,
      }, embedding);

      indexedSymbols++;
    }

    // Handle files that had symbols extracted but all were filtered out
    for (let i = 0; i < filesToIndex.length; i++) {
      if (!fileIdMap.has(i)) {
        const file = filesToIndex[i];
        const language = detectLanguage(file.relativePath);
        db.upsertFile({
          path: file.relativePath,
          hash: file.hash,
          language,
          indexedAt: Date.now(),
        });
        indexedFiles++;
      }
    }

    onProgress?.(`Indexing complete: ${indexedFiles} files, ${indexedSymbols} symbols indexed, ${skippedFiles} files skipped`);
    log.info(`Indexed ${indexedFiles} files with ${indexedSymbols} symbols, skipped ${skippedFiles} unchanged files`);

    return { indexedFiles, indexedSymbols, skippedFiles };
  }
}

/** Detect language from file extension */
function detectLanguage(filePath: string): string | null {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const languageMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    py: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    rb: 'ruby',
    c: 'c',
    cpp: 'cpp',
    h: 'c',
    hpp: 'cpp',
    cs: 'csharp',
    lua: 'lua',
    r: 'r',
    sh: 'shell',
    bash: 'shell',
  };
  return ext ? (languageMap[ext] ?? null) : null;
}
