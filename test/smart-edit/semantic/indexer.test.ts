// test/smart-edit/semantic/indexer.test.ts
import { describe, expect, it } from 'vitest';
import { SemanticIndexer } from '../../../src/smart-edit/semantic/indexer.js';

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
      const filtered = SemanticIndexer.filterSymbolKinds(symbols);
      expect(filtered.map(s => s.name)).toEqual(['a', 'c', 'd']);
    });
  });
});
