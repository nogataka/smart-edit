// test/smart-edit/semantic/embedding_provider.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OpenAIEmbeddingProvider,
  AzureOpenAIEmbeddingProvider,
  createEmbeddingProvider
} from '../../../src/smart-edit/semantic/embedding_provider.js';
import type { EmbeddingProviderConfig } from '../../../src/smart-edit/semantic/types.js';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function createMockEmbeddingResponse(vectors: number[][]): globalThis.Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({
      data: vectors.map((v, i) => ({ embedding: v, index: i })),
      model: 'text-embedding-3-small',
      usage: { prompt_tokens: 10, total_tokens: 10 }
    })
  } as unknown as globalThis.Response;
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

    const [url, options] = mockFetch.mock.calls[0] as [string, { method: string; body: string; headers: Record<string, string> }];
    expect(url).toBe('https://api.openai.com/v1/embeddings');
    expect(options.method).toBe('POST');
    const body = JSON.parse(options.body) as { input: string[]; model: string };
    expect(body.input).toEqual(['test text']);
    expect(body.model).toBe('text-embedding-3-small');
  });

  it('embedBatch() splits into chunks and returns correct order', async () => {
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
    vi.useFakeTimers();

    const rateLimitResponse = {
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      json: () => Promise.resolve({ error: { message: 'Rate limit exceeded' } })
    } as unknown as globalThis.Response;

    const vector = Array.from({ length: 1536 }, () => 0.1);
    const successResponse = createMockEmbeddingResponse([vector]);

    mockFetch
      .mockResolvedValueOnce(rateLimitResponse)
      .mockResolvedValueOnce(successResponse);

    const embedPromise = provider.embed('test');

    // Advance past the retry delay (1000ms base * 2^0 = 1000ms)
    await vi.advanceTimersByTimeAsync(1500);

    const result = await embedPromise;

    expect(result).toBeInstanceOf(Float32Array);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });
});

describe('AzureOpenAIEmbeddingProvider', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

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

    const [url, options] = mockFetch.mock.calls[0] as [string, { method: string; body: string; headers: Record<string, string> }];
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
    // Ensure env var is not set
    const originalKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    try {
      const config: EmbeddingProviderConfig = {
        provider: 'openai',
        model: 'text-embedding-3-small'
      };
      expect(() => createEmbeddingProvider(config)).toThrow(/API key/);
    } finally {
      if (originalKey !== undefined) {
        process.env.OPENAI_API_KEY = originalKey;
      }
    }
  });
});
