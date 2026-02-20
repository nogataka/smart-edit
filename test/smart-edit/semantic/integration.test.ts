// test/smart-edit/semantic/integration.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SemanticVectorDB } from '../../../src/smart-edit/semantic/vector_db.js';
import { SemanticIndexer } from '../../../src/smart-edit/semantic/indexer.js';
import { SemanticSearcher } from '../../../src/smart-edit/semantic/searcher.js';
import type { EmbeddingProvider } from '../../../src/smart-edit/semantic/embedding_provider.js';

// Create a deterministic mock embedding provider
// Maps specific text patterns to known vectors so search works predictably
function createDeterministicProvider(): EmbeddingProvider {
  // Use simple pattern: hash the text to generate a vector
  function textToVector(text: string): Float32Array {
    const vec = new Float32Array(4);
    // Simple deterministic hash-based embedding
    for (let i = 0; i < text.length; i++) {
      vec[i % 4] += text.charCodeAt(i) / 1000;
    }
    // Normalize
    const mag = Math.sqrt(vec[0] ** 2 + vec[1] ** 2 + vec[2] ** 2 + vec[3] ** 2);
    if (mag > 0) {
      for (let i = 0; i < 4; i++) vec[i] /= mag;
    }
    return vec;
  }

  return {
    embed: vi.fn((text: string) => Promise.resolve(textToVector(text))),
    embedBatch: vi.fn((texts: string[]) => Promise.resolve(texts.map(textToVector))),
    dimensions: 4,
    modelName: 'test-deterministic',
  };
}

describe('Semantic Search Integration', () => {
  let db: SemanticVectorDB;
  let provider: EmbeddingProvider;
  let tmpDir: string;

  beforeEach(() => {
    db = new SemanticVectorDB(':memory:', 4);
    provider = createDeterministicProvider();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'semantic-test-'));

    // Create test source files
    fs.writeFileSync(
      path.join(tmpDir, 'auth.ts'),
      `
export class AuthService {
  async authenticate(username: string, password: string): Promise<boolean> {
    return username === 'admin' && password === 'secret';
  }

  async logout(sessionId: string): Promise<void> {
    console.log('Logging out', sessionId);
  }
}
`
    );

    fs.writeFileSync(
      path.join(tmpDir, 'user.ts'),
      `
export function createUser(name: string, email: string) {
  return { name, email, createdAt: new Date() };
}

export function deleteUser(userId: string) {
  console.log('Deleting user', userId);
}

export function findUserByEmail(email: string) {
  return { name: 'Test', email };
}
`
    );
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('indexes files, searches, and finds similar code', async () => {
    // Define mock symbols
    const symbolsByFile: Record<
      string,
      {
        name: string;
        namePath: string;
        kind: string;
        startLine: number;
        endLine: number;
        bodyText: string;
      }[]
    > = {
      [path.join(tmpDir, 'auth.ts')]: [
        {
          name: 'AuthService',
          namePath: '/AuthService',
          kind: 'Class',
          startLine: 2,
          endLine: 11,
          bodyText:
            'class AuthService { authenticate(username, password) { ... } logout(sessionId) { ... } }',
        },
        {
          name: 'authenticate',
          namePath: '/AuthService/authenticate',
          kind: 'Method',
          startLine: 3,
          endLine: 5,
          bodyText:
            'async authenticate(username: string, password: string): Promise<boolean> { return username === admin && password === secret; }',
        },
        {
          name: 'logout',
          namePath: '/AuthService/logout',
          kind: 'Method',
          startLine: 7,
          endLine: 9,
          bodyText:
            'async logout(sessionId: string): Promise<void> { console.log(Logging out, sessionId); }',
        },
      ],
      [path.join(tmpDir, 'user.ts')]: [
        {
          name: 'createUser',
          namePath: '/createUser',
          kind: 'Function',
          startLine: 2,
          endLine: 4,
          bodyText:
            'function createUser(name: string, email: string) { return { name, email, createdAt: new Date() }; }',
        },
        {
          name: 'deleteUser',
          namePath: '/deleteUser',
          kind: 'Function',
          startLine: 6,
          endLine: 8,
          bodyText:
            'function deleteUser(userId: string) { console.log(Deleting user, userId); }',
        },
        {
          name: 'findUserByEmail',
          namePath: '/findUserByEmail',
          kind: 'Function',
          startLine: 10,
          endLine: 12,
          bodyText:
            'function findUserByEmail(email: string) { return { name: Test, email }; }',
        },
      ],
    };

    // 1. Index
    const indexer = new SemanticIndexer();
    const result = await indexer.indexFiles({
      filePaths: [path.join(tmpDir, 'auth.ts'), path.join(tmpDir, 'user.ts')],
      projectRoot: tmpDir,
      getSymbols: (filePath) => Promise.resolve(symbolsByFile[filePath] ?? []),
      db,
      provider,
    });

    expect(result.indexedFiles).toBe(2);
    expect(result.indexedSymbols).toBe(6); // 3 from auth.ts + 3 from user.ts
    expect(result.skippedFiles).toBe(0);

    // 2. Verify stats
    const stats = db.getStats();
    expect(stats.totalFiles).toBe(2);
    expect(stats.totalSymbols).toBe(6);
    expect(stats.symbolsByKind).toEqual({
      Class: 1,
      Method: 2,
      Function: 3,
    });

    // 3. Search
    const searcher = new SemanticSearcher(provider, db);
    const searchResults = await searcher.search({
      query: 'authenticate user with password',
      limit: 5,
      threshold: 0.0, // low threshold to get results with our simple hash-based vectors
    });

    expect(searchResults.length).toBeGreaterThan(0);
    // Results should contain our symbols
    const namePaths = searchResults.map((r) => r.namePath);
    expect(namePaths.length).toBeGreaterThan(0);

    // 4. Find similar to authenticate method
    // The DB stores relative paths, so use the relative path
    const similarResults = await searcher.findSimilar({
      symbolNamePath: '/AuthService/authenticate',
      filePath: 'auth.ts',
      limit: 5,
      threshold: 0.0,
    });

    // Should find other symbols but not the same one
    expect(similarResults.every((r) => r.namePath !== '/AuthService/authenticate')).toBe(true);

    // 5. Re-indexing same files should skip them (same hash)
    const reResult = await indexer.indexFiles({
      filePaths: [path.join(tmpDir, 'auth.ts'), path.join(tmpDir, 'user.ts')],
      projectRoot: tmpDir,
      getSymbols: (filePath) => Promise.resolve(symbolsByFile[filePath] ?? []),
      db,
      provider,
    });

    expect(reResult.skippedFiles).toBe(2);
    expect(reResult.indexedFiles).toBe(0);
    expect(reResult.indexedSymbols).toBe(0);
  });

  it('handles kind filter in search', async () => {
    const symbolsByFile: Record<
      string,
      {
        name: string;
        namePath: string;
        kind: string;
        startLine: number;
        endLine: number;
        bodyText: string;
      }[]
    > = {
      [path.join(tmpDir, 'auth.ts')]: [
        {
          name: 'AuthService',
          namePath: '/AuthService',
          kind: 'Class',
          startLine: 2,
          endLine: 11,
          bodyText: 'class AuthService { authenticate() {} }',
        },
        {
          name: 'authenticate',
          namePath: '/AuthService/authenticate',
          kind: 'Method',
          startLine: 3,
          endLine: 5,
          bodyText: 'method authenticate(username, password) { return true; }',
        },
      ],
    };

    const indexer = new SemanticIndexer();
    await indexer.indexFiles({
      filePaths: [path.join(tmpDir, 'auth.ts')],
      projectRoot: tmpDir,
      getSymbols: (filePath) => Promise.resolve(symbolsByFile[filePath] ?? []),
      db,
      provider,
    });

    const searcher = new SemanticSearcher(provider, db);

    // Search for only Methods
    const methodResults = await searcher.search({
      query: 'authenticate',
      limit: 10,
      threshold: 0.0,
      kindFilter: ['Method'],
    });

    // All results should be Methods
    expect(methodResults.every((r) => r.kind === 'Method')).toBe(true);
  });
});
