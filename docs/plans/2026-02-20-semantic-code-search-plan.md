# Semantic Code Search Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add semantic code search to smart-edit so AI agents can find code by meaning (natural language) and detect similar code patterns using OpenAI/Azure OpenAI embeddings + SQLite sqlite-vec.

**Architecture:** New `src/smart-edit/semantic/` module with 5 files (types, embedding provider, vector DB, indexer, searcher). Four new MCP tools registered in agent.ts. Database stored at `{project_root}/.smart-edit/semantic.db`. Leverages existing LSP symbol system for code chunking.

**Tech Stack:** OpenAI/Azure OpenAI embedding API, better-sqlite3, sqlite-vec, zod for schema validation. Follows existing smart-edit patterns (Tool base class, ToolMarkers, vitest).

---

### Task 1: Add Dependencies

**Files:**
- Modify: `package.json:41-56` (dependencies section)

**Step 1: Install better-sqlite3 and sqlite-vec**

Run:
```bash
cd /Volumes/Data/dev/smart-edit && pnpm add better-sqlite3 sqlite-vec
```

**Step 2: Install type definitions for better-sqlite3**

Run:
```bash
cd /Volumes/Data/dev/smart-edit && pnpm add -D @types/better-sqlite3
```

**Step 3: Verify installation**

Run:
```bash
cd /Volumes/Data/dev/smart-edit && node -e "const Database = require('better-sqlite3'); const db = new Database(':memory:'); console.log('better-sqlite3 OK')"
```

Expected: `better-sqlite3 OK`

**Step 4: Commit**

```bash
cd /Volumes/Data/dev/smart-edit
git add package.json pnpm-lock.yaml
git commit -m "chore: add better-sqlite3 and sqlite-vec dependencies for semantic search"
```

---

### Task 2: Create Type Definitions

**Files:**
- Create: `src/smart-edit/semantic/types.ts`
- Test: `test/smart-edit/semantic/types.test.ts`

**Step 1: Write the type definition file**

```typescript
// src/smart-edit/semantic/types.ts

export interface SemanticFileRecord {
  id: number;
  path: string;
  hash: string;
  language: string | null;
  indexedAt: number;
}

export interface SemanticSymbolRecord {
  id: number;
  fileId: number;
  name: string;
  namePath: string;
  kind: string;
  startLine: number;
  endLine: number;
  bodyText: string;
  summaryText: string | null;
}

export interface SemanticSearchResult {
  namePath: string;
  filePath: string;
  kind: string;
  similarity: number;
  bodyPreview: string;
  startLine: number;
  endLine: number;
}

export interface SemanticIndexStats {
  totalFiles: number;
  totalSymbols: number;
  lastIndexedAt: number | null;
  symbolsByKind: Record<string, number>;
  provider: string;
  model: string;
  dimensions: number;
}

export interface SemanticIndexResult {
  indexedFiles: number;
  indexedSymbols: number;
  skippedFiles: number;
}

export interface EmbeddingProviderConfig {
  provider: 'openai' | 'azure_openai';
  model: string;
  openaiApiKey?: string;
  azureEndpoint?: string;
  azureApiKey?: string;
  azureApiVersion?: string;
  azureDeployment?: string;
}

/** Symbol kinds eligible for semantic indexing */
export const INDEXABLE_SYMBOL_KINDS = new Set([
  'Function',
  'Method',
  'Class',
  'Interface',
  'Struct',
  'Enum',
  'Module',
  'Namespace'
]);

/** Maximum body text length before truncation */
export const MAX_BODY_TEXT_LENGTH = 2000;

/** Batch size for embedding API calls */
export const EMBEDDING_BATCH_SIZE = 100;

/** Number of parallel batches */
export const PARALLEL_BATCHES = 3;
```

**Step 2: Write a basic test to verify types import correctly**

```typescript
// test/smart-edit/semantic/types.test.ts
import { describe, expect, it } from 'vitest';
import {
  INDEXABLE_SYMBOL_KINDS,
  MAX_BODY_TEXT_LENGTH,
  EMBEDDING_BATCH_SIZE,
  PARALLEL_BATCHES
} from '../../../src/smart-edit/semantic/types.js';

describe('semantic types', () => {
  it('INDEXABLE_SYMBOL_KINDS contains expected kinds', () => {
    expect(INDEXABLE_SYMBOL_KINDS.has('Function')).toBe(true);
    expect(INDEXABLE_SYMBOL_KINDS.has('Class')).toBe(true);
    expect(INDEXABLE_SYMBOL_KINDS.has('Method')).toBe(true);
    expect(INDEXABLE_SYMBOL_KINDS.has('Variable')).toBe(false);
  });

  it('constants have expected values', () => {
    expect(MAX_BODY_TEXT_LENGTH).toBe(2000);
    expect(EMBEDDING_BATCH_SIZE).toBe(100);
    expect(PARALLEL_BATCHES).toBe(3);
  });
});
```

**Step 3: Run the test**

Run: `cd /Volumes/Data/dev/smart-edit && pnpm test -- test/smart-edit/semantic/types.test.ts`

Expected: PASS

**Step 4: Commit**

```bash
cd /Volumes/Data/dev/smart-edit
git add src/smart-edit/semantic/types.ts test/smart-edit/semantic/types.test.ts
git commit -m "feat(semantic): add type definitions for semantic code search"
```

---

### Task 3: Create Embedding Provider

**Files:**
- Create: `src/smart-edit/semantic/embedding_provider.ts`
- Test: `test/smart-edit/semantic/embedding_provider.test.ts`

**Step 1: Write the failing test**

```typescript
// test/smart-edit/semantic/embedding_provider.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OpenAIEmbeddingProvider,
  AzureOpenAIEmbeddingProvider,
  createEmbeddingProvider
} from '../../../src/smart-edit/semantic/embedding_provider.js';
import type { EmbeddingProviderConfig } from '../../../src/smart-edit/semantic/types.js';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function createMockEmbeddingResponse(vectors: number[][]): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      data: vectors.map((v, i) => ({ embedding: v, index: i })),
      model: 'text-embedding-3-small',
      usage: { prompt_tokens: 10, total_tokens: 10 }
    })
  } as unknown as Response;
}

describe('OpenAIEmbeddingProvider', () => {
  let provider: OpenAIEmbeddingProvider;

  beforeEach(() => {
    mockFetch.mockReset();
    provider = new OpenAIEmbeddingProvider('test-api-key', 'text-embedding-3-small');
  });

  it('has correct dimensions for text-embedding-3-small', () => {
    expect(provider.dimensions).toBe(1536);
  });

  it('has correct dimensions for text-embedding-3-large', () => {
    const largeProvider = new OpenAIEmbeddingProvider('key', 'text-embedding-3-large');
    expect(largeProvider.dimensions).toBe(3072);
  });

  it('embed() sends correct request and returns Float32Array', async () => {
    const vector = Array.from({ length: 1536 }, (_, i) => i * 0.001);
    mockFetch.mockResolvedValueOnce(createMockEmbeddingResponse([vector]));

    const result = await provider.embed('test text');

    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(1536);
    expect(mockFetch).toHaveBeenCalledOnce();

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/embeddings');
    expect(options.method).toBe('POST');
    const body = JSON.parse(options.body);
    expect(body.input).toEqual(['test text']);
    expect(body.model).toBe('text-embedding-3-small');
  });

  it('embedBatch() splits into chunks and returns correct order', async () => {
    // Create 3 texts, mock returns unique vectors
    const texts = ['text1', 'text2', 'text3'];
    const vectors = texts.map((_, i) => Array.from({ length: 1536 }, () => i));
    mockFetch.mockResolvedValueOnce(createMockEmbeddingResponse(vectors));

    const results = await provider.embedBatch(texts);

    expect(results).toHaveLength(3);
    results.forEach((r) => {
      expect(r).toBeInstanceOf(Float32Array);
      expect(r.length).toBe(1536);
    });
  });

  it('retries on 429 rate limit', async () => {
    const rateLimitResponse = {
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      json: async () => ({ error: { message: 'Rate limit exceeded' } })
    } as unknown as Response;

    const vector = Array.from({ length: 1536 }, () => 0.1);
    const successResponse = createMockEmbeddingResponse([vector]);

    mockFetch
      .mockResolvedValueOnce(rateLimitResponse)
      .mockResolvedValueOnce(successResponse);

    const result = await provider.embed('test');

    expect(result).toBeInstanceOf(Float32Array);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe('AzureOpenAIEmbeddingProvider', () => {
  it('sends request to correct Azure endpoint', async () => {
    const vector = Array.from({ length: 1536 }, () => 0.1);
    mockFetch.mockResolvedValueOnce(createMockEmbeddingResponse([vector]));

    const provider = new AzureOpenAIEmbeddingProvider({
      endpoint: 'https://my-resource.openai.azure.com',
      apiKey: 'azure-key',
      apiVersion: '2024-02-01',
      deployment: 'my-embedding',
      model: 'text-embedding-3-small'
    });

    await provider.embed('test');

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain('my-resource.openai.azure.com');
    expect(url).toContain('my-embedding');
    expect(url).toContain('api-version=2024-02-01');
    expect(options.headers['api-key']).toBe('azure-key');
  });
});

describe('createEmbeddingProvider', () => {
  it('creates OpenAI provider', () => {
    const config: EmbeddingProviderConfig = {
      provider: 'openai',
      model: 'text-embedding-3-small',
      openaiApiKey: 'sk-test'
    };
    const provider = createEmbeddingProvider(config);
    expect(provider).toBeInstanceOf(OpenAIEmbeddingProvider);
  });

  it('creates Azure provider', () => {
    const config: EmbeddingProviderConfig = {
      provider: 'azure_openai',
      model: 'text-embedding-3-small',
      azureEndpoint: 'https://test.openai.azure.com',
      azureApiKey: 'key',
      azureApiVersion: '2024-02-01',
      azureDeployment: 'deploy'
    };
    const provider = createEmbeddingProvider(config);
    expect(provider).toBeInstanceOf(AzureOpenAIEmbeddingProvider);
  });

  it('throws if OpenAI key missing', () => {
    const config: EmbeddingProviderConfig = {
      provider: 'openai',
      model: 'text-embedding-3-small'
    };
    expect(() => createEmbeddingProvider(config)).toThrow(/API key/);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd /Volumes/Data/dev/smart-edit && pnpm test -- test/smart-edit/semantic/embedding_provider.test.ts`

Expected: FAIL (module not found)

**Step 3: Write the implementation**

```typescript
// src/smart-edit/semantic/embedding_provider.ts
import { createSmartEditLogger } from '../util/logging.js';
import { EMBEDDING_BATCH_SIZE, PARALLEL_BATCHES } from './types.js';
import type { EmbeddingProviderConfig } from './types.js';

const { logger: log } = createSmartEditLogger({ name: 'smart-edit.semantic.embedding' });

const MODEL_DIMENSIONS: Record<string, number> = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072
};

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;

export interface EmbeddingProvider {
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: string[], onProgress?: (completed: number, total: number) => void): Promise<Float32Array[]>;
  readonly dimensions: number;
  readonly modelName: string;
}

interface OpenAIEmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
  model: string;
  usage: { prompt_tokens: number; total_tokens: number };
}

async function fetchWithRetry(url: string, options: RequestInit, retries = MAX_RETRIES): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch(url, options);

    if (response.ok) {
      return response;
    }

    if (response.status === 429 && attempt < retries) {
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      log.warn(`Rate limited (429). Retrying in ${delay}ms (attempt ${attempt + 1}/${retries})`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }

    const errorBody = await response.json().catch(() => ({}));
    const message = (errorBody as Record<string, Record<string, string>>)?.error?.message ?? response.statusText;
    throw new Error(`Embedding API error (${response.status}): ${message}`);
  }

  throw new Error('Max retries exceeded');
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private readonly apiKey: string;
  readonly modelName: string;
  readonly dimensions: number;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.modelName = model;
    this.dimensions = MODEL_DIMENSIONS[model] ?? 1536;
  }

  async embed(text: string): Promise<Float32Array> {
    const results = await this.callApi([text]);
    return results[0];
  }

  async embedBatch(texts: string[], onProgress?: (completed: number, total: number) => void): Promise<Float32Array[]> {
    const results: Float32Array[] = new Array(texts.length);
    let completed = 0;

    const chunks: { startIndex: number; texts: string[] }[] = [];
    for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
      chunks.push({
        startIndex: i,
        texts: texts.slice(i, i + EMBEDDING_BATCH_SIZE)
      });
    }

    for (let i = 0; i < chunks.length; i += PARALLEL_BATCHES) {
      const parallelChunks = chunks.slice(i, i + PARALLEL_BATCHES);

      const responses = await Promise.all(
        parallelChunks.map((chunk) => this.callApi(chunk.texts))
      );

      for (let j = 0; j < responses.length; j++) {
        const chunk = parallelChunks[j];
        const embeddings = responses[j];
        for (let k = 0; k < embeddings.length; k++) {
          results[chunk.startIndex + k] = embeddings[k];
          completed++;
          onProgress?.(completed, texts.length);
        }
      }

      if (i + PARALLEL_BATCHES < chunks.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    return results;
  }

  private async callApi(input: string[]): Promise<Float32Array[]> {
    const response = await fetchWithRetry('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({ input, model: this.modelName })
    });

    const data = (await response.json()) as OpenAIEmbeddingResponse;
    const sorted = data.data.sort((a, b) => a.index - b.index);
    return sorted.map((item) => new Float32Array(item.embedding));
  }
}

export interface AzureOpenAIConfig {
  endpoint: string;
  apiKey: string;
  apiVersion: string;
  deployment: string;
  model: string;
}

export class AzureOpenAIEmbeddingProvider implements EmbeddingProvider {
  private readonly config: AzureOpenAIConfig;
  readonly modelName: string;
  readonly dimensions: number;

  constructor(config: AzureOpenAIConfig) {
    this.config = config;
    this.modelName = config.model;
    this.dimensions = MODEL_DIMENSIONS[config.model] ?? 1536;
  }

  async embed(text: string): Promise<Float32Array> {
    const results = await this.callApi([text]);
    return results[0];
  }

  async embedBatch(texts: string[], onProgress?: (completed: number, total: number) => void): Promise<Float32Array[]> {
    const results: Float32Array[] = new Array(texts.length);
    let completed = 0;

    const chunks: { startIndex: number; texts: string[] }[] = [];
    for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
      chunks.push({
        startIndex: i,
        texts: texts.slice(i, i + EMBEDDING_BATCH_SIZE)
      });
    }

    for (let i = 0; i < chunks.length; i += PARALLEL_BATCHES) {
      const parallelChunks = chunks.slice(i, i + PARALLEL_BATCHES);

      const responses = await Promise.all(
        parallelChunks.map((chunk) => this.callApi(chunk.texts))
      );

      for (let j = 0; j < responses.length; j++) {
        const chunk = parallelChunks[j];
        const embeddings = responses[j];
        for (let k = 0; k < embeddings.length; k++) {
          results[chunk.startIndex + k] = embeddings[k];
          completed++;
          onProgress?.(completed, texts.length);
        }
      }

      if (i + PARALLEL_BATCHES < chunks.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    return results;
  }

  private async callApi(input: string[]): Promise<Float32Array[]> {
    const baseUrl = this.config.endpoint.replace(/\/$/, '');
    const url = `${baseUrl}/openai/deployments/${this.config.deployment}/embeddings?api-version=${this.config.apiVersion}`;

    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': this.config.apiKey
      },
      body: JSON.stringify({ input, model: this.config.model })
    });

    const data = (await response.json()) as OpenAIEmbeddingResponse;
    const sorted = data.data.sort((a, b) => a.index - b.index);
    return sorted.map((item) => new Float32Array(item.embedding));
  }
}

export function createEmbeddingProvider(config: EmbeddingProviderConfig): EmbeddingProvider {
  if (config.provider === 'openai') {
    const apiKey = config.openaiApiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        'OpenAI API key not configured. Set semantic_search.openai_api_key in smart_edit_config.yml or OPENAI_API_KEY environment variable.'
      );
    }
    return new OpenAIEmbeddingProvider(apiKey, config.model);
  }

  if (config.provider === 'azure_openai') {
    if (!config.azureEndpoint || !config.azureApiKey || !config.azureDeployment) {
      throw new Error(
        'Azure OpenAI configuration incomplete. Set azure_endpoint, azure_api_key, and azure_deployment in smart_edit_config.yml.'
      );
    }
    return new AzureOpenAIEmbeddingProvider({
      endpoint: config.azureEndpoint,
      apiKey: config.azureApiKey,
      apiVersion: config.azureApiVersion ?? '2024-02-01',
      deployment: config.azureDeployment,
      model: config.model
    });
  }

  throw new Error(`Unknown embedding provider: ${config.provider}`);
}
```

**Step 4: Run tests**

Run: `cd /Volumes/Data/dev/smart-edit && pnpm test -- test/smart-edit/semantic/embedding_provider.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
cd /Volumes/Data/dev/smart-edit
git add src/smart-edit/semantic/embedding_provider.ts test/smart-edit/semantic/embedding_provider.test.ts
git commit -m "feat(semantic): add OpenAI and Azure OpenAI embedding providers"
```

---

### Task 4: Create Vector Database

**Files:**
- Create: `src/smart-edit/semantic/vector_db.ts`
- Test: `test/smart-edit/semantic/vector_db.test.ts`

**Step 1: Write the failing test**

```typescript
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

      // Insert 3 symbols with known embeddings
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
```

**Step 2: Run tests to verify they fail**

Run: `cd /Volumes/Data/dev/smart-edit && pnpm test -- test/smart-edit/semantic/vector_db.test.ts`

Expected: FAIL

**Step 3: Write the implementation**

Create `src/smart-edit/semantic/vector_db.ts` implementing `SemanticVectorDB` class. Follow marp-lens `database.ts` pattern (lines 1-331) with these adaptations:
- Tables: `semantic_files`, `semantic_symbols`, `semantic_embeddings`, `metadata`
- Methods: `upsertFile`, `getFileByPath`, `insertSymbol`, `searchSimilar`, `getStats`, `getSymbolEmbedding`, `setMetadata`, `getMetadata`, `isModelChanged`, `clear`, `close`
- `searchSimilar` accepts optional `kindFilter` and `fileFilter` params; apply SQL WHERE after the JOIN
- Use `vec_distance_cosine` same as marp-lens
- Constructor takes `dbPath` and `dimensions` parameters; dimensions used for `CREATE VIRTUAL TABLE`
- The virtual table check pattern from marp-lens (`SELECT name FROM sqlite_master`) must be used since sqlite-vec virtual tables don't support `IF NOT EXISTS`

**Step 4: Run tests**

Run: `cd /Volumes/Data/dev/smart-edit && pnpm test -- test/smart-edit/semantic/vector_db.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
cd /Volumes/Data/dev/smart-edit
git add src/smart-edit/semantic/vector_db.ts test/smart-edit/semantic/vector_db.test.ts
git commit -m "feat(semantic): add SQLite + sqlite-vec vector database"
```

---

### Task 5: Create Indexer

**Files:**
- Create: `src/smart-edit/semantic/indexer.ts`
- Test: `test/smart-edit/semantic/indexer.test.ts`

**Step 1: Write the failing test**

```typescript
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
```

**Step 2: Run tests to verify they fail**

Run: `cd /Volumes/Data/dev/smart-edit && pnpm test -- test/smart-edit/semantic/indexer.test.ts`

Expected: FAIL

**Step 3: Write the implementation**

Create `src/smart-edit/semantic/indexer.ts`:

Key methods:
- `buildSummaryText(kind, name, filePath, bodyText)` — static, builds `"{kind} {name} in {filePath}: {bodyText}"` with truncation
- `filterSymbolKinds(symbols)` — static, filters by `INDEXABLE_SYMBOL_KINDS`
- `indexProject(options)` — main entry point. Takes project root, list of file paths (or auto-discover), LSP symbol retriever, embedding provider, vector DB. Returns `SemanticIndexResult`
- `indexFile(filePath, symbols, db, provider)` — indexes one file's symbols

The indexer:
1. Lists project files (respecting .gitignore via the `ignore` package already used by smart-edit's `Project` class)
2. Computes MD5 hash for each file (use `crypto.createHash('md5')`)
3. Skips unchanged files (hash comparison with DB)
4. For changed files: gets LSP symbols, filters by kind, extracts body, builds summary text
5. Batches all summary texts through embedding provider
6. Stores results in vector DB

**Step 4: Run tests**

Run: `cd /Volumes/Data/dev/smart-edit && pnpm test -- test/smart-edit/semantic/indexer.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
cd /Volumes/Data/dev/smart-edit
git add src/smart-edit/semantic/indexer.ts test/smart-edit/semantic/indexer.test.ts
git commit -m "feat(semantic): add symbol indexer with LSP integration"
```

---

### Task 6: Create Searcher

**Files:**
- Create: `src/smart-edit/semantic/searcher.ts`
- Test: `test/smart-edit/semantic/searcher.test.ts`

**Step 1: Write the failing test**

```typescript
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
      getSymbolEmbedding: vi.fn(() => new Float32Array([0.5, 0.5, 0, 0]))
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

    expect(db.getSymbolEmbedding).toHaveBeenCalled();
    expect(results).toHaveLength(1);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd /Volumes/Data/dev/smart-edit && pnpm test -- test/smart-edit/semantic/searcher.test.ts`

Expected: FAIL

**Step 3: Write the implementation**

Create `src/smart-edit/semantic/searcher.ts`:

Key methods:
- `search({ query, limit, threshold, kindFilter?, fileFilter? })` — embeds query, calls `db.searchSimilar`, filters by threshold
- `findSimilar({ symbolNamePath, filePath, limit, threshold })` — looks up symbol's embedding from DB via `getSymbolByNamePath`, calls `db.searchSimilar` with that embedding, excludes the source symbol from results

**Step 4: Run tests**

Run: `cd /Volumes/Data/dev/smart-edit && pnpm test -- test/smart-edit/semantic/searcher.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
cd /Volumes/Data/dev/smart-edit
git add src/smart-edit/semantic/searcher.ts test/smart-edit/semantic/searcher.test.ts
git commit -m "feat(semantic): add semantic searcher with threshold filtering"
```

---

### Task 7: Create Index Barrel Export

**Files:**
- Create: `src/smart-edit/semantic/index.ts`

**Step 1: Create the barrel file**

```typescript
// src/smart-edit/semantic/index.ts
export { type EmbeddingProvider, OpenAIEmbeddingProvider, AzureOpenAIEmbeddingProvider, createEmbeddingProvider } from './embedding_provider.js';
export { SemanticVectorDB } from './vector_db.js';
export { SemanticIndexer } from './indexer.js';
export { SemanticSearcher } from './searcher.js';
export * from './types.js';
```

**Step 2: Commit**

```bash
cd /Volumes/Data/dev/smart-edit
git add src/smart-edit/semantic/index.ts
git commit -m "feat(semantic): add barrel export"
```

---

### Task 8: Create MCP Tools

**Files:**
- Create: `src/smart-edit/tools/semantic_tools.ts`
- Test: `test/smart-edit/semantic/semantic_tools.test.ts`
- Modify: `src/smart-edit/agent.ts:40-124` (import + register new tools)

**Step 1: Write the failing test**

Test should verify:
- `IndexSemanticSymbolsTool` has `CanEdit` marker and correct input schema
- `SemanticSearchTool` has `SymbolicRead` marker
- `FindSimilarCodeTool` has `SymbolicRead` marker
- `SemanticSearchStatsTool` has `DoesNotRequireActiveProject` marker
- Tool name generation follows snake_case convention (`index_semantic_symbols`, `semantic_search`, etc.)

Pattern from existing test files: use `FakeAgent` implementing `SmartEditAgentLike`.

```typescript
// test/smart-edit/semantic/semantic_tools.test.ts
import { describe, expect, it } from 'vitest';
import {
  IndexSemanticSymbolsTool,
  SemanticSearchTool,
  FindSimilarCodeTool,
  SemanticSearchStatsTool
} from '../../../src/smart-edit/tools/semantic_tools.js';
import {
  ToolMarkerCanEdit,
  ToolMarkerSymbolicRead,
  ToolMarkerDoesNotRequireActiveProject
} from '../../../src/smart-edit/tools/tools_base.js';

describe('semantic tools', () => {
  describe('IndexSemanticSymbolsTool', () => {
    it('has CanEdit marker', () => {
      expect(IndexSemanticSymbolsTool.hasMarker(ToolMarkerCanEdit)).toBe(true);
    });
    it('generates correct tool name', () => {
      expect(IndexSemanticSymbolsTool.getNameFromCls()).toBe('index_semantic_symbols');
    });
  });

  describe('SemanticSearchTool', () => {
    it('has SymbolicRead marker', () => {
      expect(SemanticSearchTool.hasMarker(ToolMarkerSymbolicRead)).toBe(true);
    });
    it('generates correct tool name', () => {
      expect(SemanticSearchTool.getNameFromCls()).toBe('semantic_search');
    });
  });

  describe('FindSimilarCodeTool', () => {
    it('has SymbolicRead marker', () => {
      expect(FindSimilarCodeTool.hasMarker(ToolMarkerSymbolicRead)).toBe(true);
    });
    it('generates correct tool name', () => {
      expect(FindSimilarCodeTool.getNameFromCls()).toBe('find_similar_code');
    });
  });

  describe('SemanticSearchStatsTool', () => {
    it('has DoesNotRequireActiveProject marker', () => {
      expect(SemanticSearchStatsTool.hasMarker(ToolMarkerDoesNotRequireActiveProject)).toBe(true);
    });
    it('generates correct tool name', () => {
      expect(SemanticSearchStatsTool.getNameFromCls()).toBe('semantic_search_stats');
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd /Volumes/Data/dev/smart-edit && pnpm test -- test/smart-edit/semantic/semantic_tools.test.ts`

Expected: FAIL

**Step 3: Write the tool implementations**

Create `src/smart-edit/tools/semantic_tools.ts` following the pattern from `symbol_tools.ts`:

- Each tool extends `Tool` from `tools_base.js`
- Uses `static override readonly markers`, `description`, `inputSchema` (zod)
- The tools need access to a `SemanticVectorDB` and `EmbeddingProvider`. These should be lazily initialized in the tool's `apply()` method:
  - Get project root from `this.getProjectRoot()`
  - DB path: `path.join(projectRoot, '.smart-edit', 'semantic.db')`
  - Read embedding config from `smart_edit_config.yml` (access via `this.agent.smartEditConfig`)
  - Cache the DB and provider instances per project root

Mark all semantic tools as `Optional` so they don't break existing setups that lack the OpenAI key.

**Step 4: Register tools in agent.ts**

In `src/smart-edit/agent.ts`:
- Add import for the 4 new tool classes
- Add them to `DEFAULT_TOOL_CLASSES` array (around line 89-124)

**Step 5: Run tests**

Run: `cd /Volumes/Data/dev/smart-edit && pnpm test -- test/smart-edit/semantic/semantic_tools.test.ts`

Expected: PASS

**Step 6: Run all existing tests to verify no regression**

Run: `cd /Volumes/Data/dev/smart-edit && pnpm test`

Expected: All PASS

**Step 7: Commit**

```bash
cd /Volumes/Data/dev/smart-edit
git add src/smart-edit/tools/semantic_tools.ts test/smart-edit/semantic/semantic_tools.test.ts src/smart-edit/agent.ts
git commit -m "feat(semantic): add 4 MCP tools for semantic code search"
```

---

### Task 9: Add Configuration Support

**Files:**
- Modify: `src/smart-edit/config/smart_edit_config.ts` (add semantic_search config parsing)

**Step 1: Write test for config parsing**

Add test cases to existing `test/smart-edit/config/smart_edit_config.test.ts`:
- Verify `semantic_search` section is parsed from YAML
- Verify defaults when section is missing

**Step 2: Add semantic_search to the config YAML schema**

In `src/smart-edit/config/smart_edit_config.ts`:
- Add `semantic_search` to `SMART_EDIT_CONFIG_YAML_SCHEMA` as an optional passthrough object
- Add `semanticSearch?: EmbeddingProviderConfig` to `SmartEditConfigInit` and `SmartEditConfig`
- Parse the nested config in `fromConfigFile()`

The `semantic_search` section in the YAML:
```yaml
semantic_search:
  provider: "openai"
  model: "text-embedding-3-small"
  openai_api_key: "sk-..."
```

**Step 3: Run tests**

Run: `cd /Volumes/Data/dev/smart-edit && pnpm test`

Expected: All PASS

**Step 4: Commit**

```bash
cd /Volumes/Data/dev/smart-edit
git add src/smart-edit/config/smart_edit_config.ts test/smart-edit/config/smart_edit_config.test.ts
git commit -m "feat(semantic): add semantic_search configuration support"
```

---

### Task 10: Integration Test

**Files:**
- Create: `test/smart-edit/semantic/integration.test.ts`

**Step 1: Write integration test**

Test the full flow with mock embedding provider:
1. Create in-memory vector DB
2. Create mock embedding provider (returns deterministic vectors)
3. Create mock LSP symbol data
4. Run indexer
5. Run searcher
6. Verify search finds the right symbols

**Step 2: Run integration test**

Run: `cd /Volumes/Data/dev/smart-edit && pnpm test -- test/smart-edit/semantic/integration.test.ts`

Expected: PASS

**Step 3: Run full test suite**

Run: `cd /Volumes/Data/dev/smart-edit && pnpm test`

Expected: All PASS

**Step 4: Commit**

```bash
cd /Volumes/Data/dev/smart-edit
git add test/smart-edit/semantic/integration.test.ts
git commit -m "test(semantic): add integration test for semantic search pipeline"
```

---

### Task 11: Type Check and Lint

**Step 1: Run type checker**

Run: `cd /Volumes/Data/dev/smart-edit && pnpm typecheck`

Expected: No errors

**Step 2: Run linter**

Run: `cd /Volumes/Data/dev/smart-edit && pnpm lint`

Expected: No errors (fix any issues)

**Step 3: Run formatter**

Run: `cd /Volumes/Data/dev/smart-edit && pnpm format:check`

Expected: No formatting issues (run `pnpm format` if needed)

**Step 4: Run full test suite one final time**

Run: `cd /Volumes/Data/dev/smart-edit && pnpm test`

Expected: All PASS

**Step 5: Final commit if any fixes**

```bash
cd /Volumes/Data/dev/smart-edit
git add -A
git commit -m "chore: fix lint and type errors in semantic search module"
```
