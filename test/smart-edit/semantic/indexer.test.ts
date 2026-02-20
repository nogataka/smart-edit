// test/smart-edit/semantic/indexer.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SemanticIndexer } from '../../../src/smart-edit/semantic/indexer.js';
import type { EmbeddingProvider } from '../../../src/smart-edit/semantic/embedding_provider.js';
import type { SemanticVectorDB } from '../../../src/smart-edit/semantic/vector_db.js';

function createMockEmbeddingProvider(): EmbeddingProvider {
  return {
    embed: vi.fn(async () => new Float32Array([0.1, 0.2, 0.3, 0.4])),
    embedBatch: vi.fn(async (texts: string[]) =>
      texts.map(() => new Float32Array([0.1, 0.2, 0.3, 0.4]))
    ),
    dimensions: 4,
    modelName: 'test-model'
  };
}

describe('SemanticIndexer', () => {
  describe('buildSummaryText', () => {
    it('creates correct summary format', () => {
      const summary = SemanticIndexer.buildSummaryText(
        'Function', 'authenticate', 'src/auth/service.ts',
        'async function authenticate(username: string, password: string) { return true; }'
      );
      expect(summary).toBe(
        'Function authenticate in src/auth/service.ts: async function authenticate(username: string, password: string) { return true; }'
      );
    });

    it('truncates body text at MAX_BODY_TEXT_LENGTH', () => {
      const longBody = 'x'.repeat(3000);
      const summary = SemanticIndexer.buildSummaryText('Function', 'fn', 'file.ts', longBody);
      expect(summary.length).toBeLessThanOrEqual(2000 + 100); // body truncated + prefix
    });
  });

  describe('filterSymbolKinds', () => {
    it('includes Function, Class, Method', () => {
      const symbols = [
        { kind: 'Function', name: 'a' },
        { kind: 'Variable', name: 'b' },
        { kind: 'Class', name: 'c' },
        { kind: 'Method', name: 'd' }
      ];
      const filtered = SemanticIndexer.filterSymbolKinds(symbols as any);
      expect(filtered.map(s => s.name)).toEqual(['a', 'c', 'd']);
    });
  });
});
