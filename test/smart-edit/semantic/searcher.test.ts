// test/smart-edit/semantic/searcher.test.ts
import { describe, expect, it, vi } from 'vitest';
import { SemanticSearcher } from '../../../src/smart-edit/semantic/searcher.js';
import type { EmbeddingProvider } from '../../../src/smart-edit/semantic/embedding_provider.js';
import type { SemanticVectorDB } from '../../../src/smart-edit/semantic/vector_db.js';
import type { SemanticSearchResult } from '../../../src/smart-edit/semantic/types.js';

describe('SemanticSearcher', () => {
  function createMockProvider(): EmbeddingProvider {
    return {
      embed: vi.fn(async () => new Float32Array([1, 0, 0, 0])),
      embedBatch: vi.fn(async (texts: string[]) => texts.map(() => new Float32Array([1, 0, 0, 0]))),
      dimensions: 4,
      modelName: 'test-model'
    };
  }

  function createMockDB(searchResults: SemanticSearchResult[]): SemanticVectorDB {
    return {
      searchSimilar: vi.fn(() => searchResults),
      getSymbolEmbedding: vi.fn(() => new Float32Array([0.5, 0.5, 0, 0])),
      getSymbolByNamePath: vi.fn(() => ({ id: 1 }))
    } as unknown as SemanticVectorDB;
  }

  it('searches by natural language query', async () => {
    const mockResults: SemanticSearchResult[] = [
      { namePath: '/auth', filePath: 'src/auth.ts', kind: 'Function', similarity: 0.9, bodyPreview: 'function auth...', startLine: 1, endLine: 10 }
    ];
    const provider = createMockProvider();
    const db = createMockDB(mockResults);
    const searcher = new SemanticSearcher(provider, db);

    const results = await searcher.search({ query: 'authentication handler', limit: 10, threshold: 0.5 });

    expect(provider.embed).toHaveBeenCalledWith('authentication handler');
    expect(db.searchSimilar).toHaveBeenCalled();
    expect(results).toHaveLength(1);
    expect(results[0].namePath).toBe('/auth');
  });

  it('filters results below threshold', async () => {
    const mockResults: SemanticSearchResult[] = [
      { namePath: '/a', filePath: 'a.ts', kind: 'Function', similarity: 0.8, bodyPreview: '...', startLine: 1, endLine: 5 },
      { namePath: '/b', filePath: 'b.ts', kind: 'Function', similarity: 0.3, bodyPreview: '...', startLine: 1, endLine: 5 }
    ];
    const provider = createMockProvider();
    const db = createMockDB(mockResults);
    const searcher = new SemanticSearcher(provider, db);

    const results = await searcher.search({ query: 'test', limit: 10, threshold: 0.5 });

    expect(results).toHaveLength(1);
    expect(results[0].namePath).toBe('/a');
  });

  it('finds similar code by symbol', async () => {
    const mockResults: SemanticSearchResult[] = [
      { namePath: '/other', filePath: 'other.ts', kind: 'Function', similarity: 0.85, bodyPreview: '...', startLine: 1, endLine: 5 }
    ];
    const provider = createMockProvider();
    const db = createMockDB(mockResults);
    const searcher = new SemanticSearcher(provider, db);

    const results = await searcher.findSimilar({ symbolNamePath: '/auth', filePath: 'src/auth.ts', limit: 10, threshold: 0.5 });

    expect(db.getSymbolByNamePath).toHaveBeenCalled();
    expect(db.getSymbolEmbedding).toHaveBeenCalled();
    expect(results).toHaveLength(1);
  });
});
