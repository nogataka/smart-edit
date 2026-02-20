// test/smart-edit/semantic/vector_db.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SemanticVectorDB } from '../../../src/smart-edit/semantic/vector_db.js';

describe('SemanticVectorDB', () => {
  let db: SemanticVectorDB;

  beforeEach(() => {
    db = new SemanticVectorDB(':memory:', 4); // 4 dimensions for testing
  });

  afterEach(() => {
    db.close();
  });

  describe('file operations', () => {
    it('upserts and retrieves a file', () => {
      const fileId = db.upsertFile({ path: 'src/main.ts', hash: 'abc123', language: 'typescript', indexedAt: Date.now() });
      expect(fileId).toBeGreaterThan(0);

      const file = db.getFileByPath('src/main.ts');
      expect(file).not.toBeNull();
      expect(file!.path).toBe('src/main.ts');
      expect(file!.hash).toBe('abc123');
    });

    it('updates file on re-upsert and deletes old symbols', () => {
      const id1 = db.upsertFile({ path: 'src/main.ts', hash: 'v1', language: 'typescript', indexedAt: 1 });
      db.insertSymbol({
        fileId: id1, name: 'foo', namePath: '/foo', kind: 'Function',
        startLine: 1, endLine: 5, bodyText: 'function foo() {}', summaryText: 'Function foo'
      }, new Float32Array([1, 0, 0, 0]));

      const id2 = db.upsertFile({ path: 'src/main.ts', hash: 'v2', language: 'typescript', indexedAt: 2 });
      expect(id2).toBe(id1);

      const stats = db.getStats();
      expect(stats.totalSymbols).toBe(0); // old symbols deleted
    });
  });

  describe('symbol operations', () => {
    it('inserts a symbol with embedding', () => {
      const fileId = db.upsertFile({ path: 'src/main.ts', hash: 'abc', language: 'typescript', indexedAt: Date.now() });
      const symbolId = db.insertSymbol({
        fileId, name: 'authenticate', namePath: '/AuthService/authenticate', kind: 'Method',
        startLine: 10, endLine: 25, bodyText: 'async authenticate(user, pass) { ... }',
        summaryText: 'Method authenticate in src/main.ts: ...'
      }, new Float32Array([0.5, 0.5, 0.5, 0.5]));

      expect(symbolId).toBeGreaterThan(0);
    });
  });

  describe('search', () => {
    it('returns results ordered by similarity', () => {
      const fileId = db.upsertFile({ path: 'src/auth.ts', hash: 'h1', language: 'typescript', indexedAt: Date.now() });

      db.insertSymbol({
        fileId, name: 'login', namePath: '/login', kind: 'Function',
        startLine: 1, endLine: 5, bodyText: 'function login() {}', summaryText: 'login'
      }, new Float32Array([1, 0, 0, 0]));

      db.insertSymbol({
        fileId, name: 'logout', namePath: '/logout', kind: 'Function',
        startLine: 6, endLine: 10, bodyText: 'function logout() {}', summaryText: 'logout'
      }, new Float32Array([0, 1, 0, 0]));

      db.insertSymbol({
        fileId, name: 'validate', namePath: '/validate', kind: 'Function',
        startLine: 11, endLine: 15, bodyText: 'function validate() {}', summaryText: 'validate'
      }, new Float32Array([0.9, 0.1, 0, 0]));

      // Search with query close to "login"
      const results = db.searchSimilar(new Float32Array([1, 0, 0, 0]), 10);

      expect(results.length).toBe(3);
      expect(results[0].namePath).toBe('/login');       // most similar
      expect(results[0].similarity).toBeCloseTo(1.0, 1);
      expect(results[1].namePath).toBe('/validate');     // second
    });

    it('filters by kind', () => {
      const fileId = db.upsertFile({ path: 'src/app.ts', hash: 'h', language: 'typescript', indexedAt: Date.now() });

      db.insertSymbol({
        fileId, name: 'MyClass', namePath: '/MyClass', kind: 'Class',
        startLine: 1, endLine: 20, bodyText: 'class MyClass {}', summaryText: 'class'
      }, new Float32Array([1, 0, 0, 0]));

      db.insertSymbol({
        fileId, name: 'myFunc', namePath: '/myFunc', kind: 'Function',
        startLine: 21, endLine: 25, bodyText: 'function myFunc() {}', summaryText: 'function'
      }, new Float32Array([1, 0, 0, 0]));

      const results = db.searchSimilar(new Float32Array([1, 0, 0, 0]), 10, { kindFilter: ['Function'] });
      expect(results.length).toBe(1);
      expect(results[0].kind).toBe('Function');
    });
  });

  describe('stats', () => {
    it('returns correct statistics', () => {
      const fileId = db.upsertFile({ path: 'src/a.ts', hash: 'h', language: 'typescript', indexedAt: 100 });
      db.insertSymbol({
        fileId, name: 'fn', namePath: '/fn', kind: 'Function',
        startLine: 1, endLine: 3, bodyText: 'fn', summaryText: 'fn'
      }, new Float32Array([1, 0, 0, 0]));

      const stats = db.getStats();
      expect(stats.totalFiles).toBe(1);
      expect(stats.totalSymbols).toBe(1);
      expect(stats.symbolsByKind).toEqual({ Function: 1 });
      expect(stats.lastIndexedAt).toBe(100);
    });
  });

  describe('metadata', () => {
    it('stores and retrieves metadata', () => {
      db.setMetadata('model', 'text-embedding-3-small');
      expect(db.getMetadata('model')).toBe('text-embedding-3-small');
    });

    it('detects model change', () => {
      db.setMetadata('model', 'text-embedding-3-small');
      db.setMetadata('dimensions', '1536');

      expect(db.isModelChanged('text-embedding-3-small', 1536)).toBe(false);
      expect(db.isModelChanged('text-embedding-3-large', 3072)).toBe(true);
    });
  });

  describe('getSymbolEmbedding', () => {
    it('returns embedding for a known symbol', () => {
      const fileId = db.upsertFile({ path: 'src/a.ts', hash: 'h', language: 'typescript', indexedAt: Date.now() });
      const symbolId = db.insertSymbol({
        fileId, name: 'fn', namePath: '/fn', kind: 'Function',
        startLine: 1, endLine: 3, bodyText: 'fn', summaryText: 'fn'
      }, new Float32Array([0.1, 0.2, 0.3, 0.4]));

      const embedding = db.getSymbolEmbedding(symbolId);
      expect(embedding).not.toBeNull();
      expect(embedding!.length).toBe(4);
    });
  });
});
