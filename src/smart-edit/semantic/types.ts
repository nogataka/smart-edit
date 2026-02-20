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
