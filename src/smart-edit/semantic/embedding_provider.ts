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
  data: { embedding: number[]; index: number }[];
  model: string;
  usage: { prompt_tokens: number; total_tokens: number };
}

async function fetchWithRetry(url: string, options: globalThis.RequestInit, retries = MAX_RETRIES): Promise<globalThis.Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await globalThis.fetch(url, options);

    if (response.ok) {
      return response;
    }

    if (response.status === 429 && attempt < retries) {
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      log.warn(`Rate limited (429). Retrying in ${delay}ms (attempt ${attempt + 1}/${retries})`);
      await new Promise((resolve) => globalThis.setTimeout(resolve, delay));
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
    const results: Float32Array[] = Array.from<Float32Array>({ length: texts.length });
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
        await new Promise((resolve) => globalThis.setTimeout(resolve, 100));
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
    const results: Float32Array[] = Array.from<Float32Array>({ length: texts.length });
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
        await new Promise((resolve) => globalThis.setTimeout(resolve, 100));
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

  throw new Error(`Unknown embedding provider: ${String(config.provider)}`);
}
