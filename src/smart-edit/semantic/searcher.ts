// src/smart-edit/semantic/searcher.ts
import type { EmbeddingProvider } from './embedding_provider.js';
import type { SemanticVectorDB } from './vector_db.js';
import type { SemanticSearchResult } from './types.js';

export interface SearchOptions {
  query: string;
  limit: number;
  threshold: number;
  kindFilter?: string[];
  fileFilter?: string;
}

export interface FindSimilarOptions {
  symbolNamePath: string;
  filePath: string;
  limit: number;
  threshold: number;
}

export class SemanticSearcher {
  constructor(
    private readonly provider: EmbeddingProvider,
    private readonly db: SemanticVectorDB
  ) {}

  async search(options: SearchOptions): Promise<SemanticSearchResult[]> {
    const queryEmbedding = await this.provider.embed(options.query);
    const results = this.db.searchSimilar(queryEmbedding, options.limit + 10, {
      kindFilter: options.kindFilter,
      fileFilter: options.fileFilter ? [options.fileFilter] : undefined
    });
    return results.filter(r => r.similarity >= options.threshold).slice(0, options.limit);
  }

  async findSimilar(options: FindSimilarOptions): Promise<SemanticSearchResult[]> {
    const symbol = this.db.getSymbolByNamePath(options.symbolNamePath, options.filePath);
    if (!symbol) {
      return [];
    }
    const embedding = this.db.getSymbolEmbedding(symbol.id);
    if (!embedding) {
      return [];
    }
    const results = this.db.searchSimilar(embedding, options.limit + 10);
    return results
      .filter(r => r.namePath !== options.symbolNamePath && r.similarity >= options.threshold)
      .slice(0, options.limit);
  }
}
