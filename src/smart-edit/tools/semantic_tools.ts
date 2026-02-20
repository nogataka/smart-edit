// src/smart-edit/tools/semantic_tools.ts
import fs from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import {
  Tool,
  ToolMarkerCanEdit,
  ToolMarkerDoesNotRequireActiveProject,
  ToolMarkerOptional,
  ToolMarkerSymbolicRead,
  type SmartEditConfigLike
} from './tools_base.js';
import { createSmartEditLogger } from '../util/logging.js';
import { createEmbeddingProvider } from '../semantic/embedding_provider.js';
import { SemanticVectorDB } from '../semantic/vector_db.js';
import { SemanticIndexer } from '../semantic/indexer.js';
import { SemanticSearcher } from '../semantic/searcher.js';
import type { EmbeddingProviderConfig, SemanticIndexResult } from '../semantic/types.js';
import type { SymbolInfo } from '../semantic/indexer.js';

const { logger: log } = createSmartEditLogger({ name: 'smart-edit.tools.semantic' });

/** Common source-code file extensions */
const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rs', '.go', '.java', '.rb', '.c', '.cpp', '.h', '.hpp',
  '.cs', '.lua', '.r', '.sh', '.bash'
]);

/** Default patterns to ignore when listing project files */
const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.smart-edit', 'dist', 'build', 'out',
  '.next', '.nuxt', 'coverage', '__pycache__', '.venv', 'venv',
  'target', '.idea', '.vscode'
]);

function getEmbeddingConfig(agentConfig?: SmartEditConfigLike['semanticSearch']): EmbeddingProviderConfig {
  if (agentConfig) {
    return {
      provider: agentConfig.provider ?? 'openai',
      model: agentConfig.model ?? 'text-embedding-3-small',
      openaiApiKey: agentConfig.openaiApiKey ?? process.env.OPENAI_API_KEY,
      azureEndpoint: agentConfig.azureEndpoint,
      azureApiKey: agentConfig.azureApiKey,
      azureApiVersion: agentConfig.azureApiVersion,
      azureDeployment: agentConfig.azureDeployment
    };
  }
  return {
    provider: 'openai' as const,
    model: process.env.SMART_EDIT_EMBEDDING_MODEL ?? 'text-embedding-3-small',
    openaiApiKey: process.env.OPENAI_API_KEY
  };
}

function getDbPath(projectRoot: string): string {
  const dir = path.join(projectRoot, '.smart-edit');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'semantic.db');
}

/**
 * Recursively list source files in a directory, respecting basic ignore patterns.
 */
function listSourceFiles(dirPath: string): string[] {
  const results: string[] = [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.') && IGNORE_DIRS.has(entry.name)) {
      continue;
    }
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) {
        continue;
      }
      results.push(...listSourceFiles(fullPath));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (SOURCE_EXTENSIONS.has(ext)) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// IndexSemanticSymbolsTool
// ---------------------------------------------------------------------------

interface IndexSemanticSymbolsInput {
  paths?: string[];
}

export class IndexSemanticSymbolsTool extends Tool {
  static override readonly markers = new Set([ToolMarkerCanEdit, ToolMarkerOptional]);
  static override readonly description =
    'Indexes project symbols for semantic code search. Creates embeddings for functions, classes, methods, etc.';
  static override readonly inputSchema = z.object({
    paths: z.array(z.string()).optional()
  });

  override async apply(args: IndexSemanticSymbolsInput): Promise<string> {
    const projectRoot = this.getProjectRoot();
    const config = getEmbeddingConfig(this.agent.smartEditConfig.semanticSearch);
    const provider = createEmbeddingProvider(config);
    const dbPath = getDbPath(projectRoot);
    const db = new SemanticVectorDB(dbPath, provider.dimensions);

    try {
      // Check for model change
      const modelChanged = db.isModelChanged(provider.modelName, provider.dimensions);
      if (modelChanged) {
        const storedModel = db.getMetadata('model');
        if (storedModel !== null) {
          log.warn(
            `Embedding model changed from '${storedModel}' to '${provider.modelName}'. ` +
            'Previously indexed embeddings may be incompatible. Consider re-indexing all files.'
          );
        }
        db.setMetadata('model', provider.modelName);
        db.setMetadata('dimensions', String(provider.dimensions));
        db.setMetadata('provider', config.provider);
      }

      // Determine file paths
      let filePaths: string[];
      if (args.paths && args.paths.length > 0) {
        filePaths = args.paths.map((p) => path.resolve(projectRoot, p));
      } else {
        filePaths = listSourceFiles(projectRoot);
      }

      // Build getSymbols callback using LSP symbol retriever
      const getSymbols = async (filePath: string): Promise<SymbolInfo[]> => {
        const relativePath = path.relative(projectRoot, filePath);
        try {
          const retriever = this.createLanguageServerSymbolRetriever();
          const symbols = retriever.getDocumentSymbols(relativePath);
          const result: SymbolInfo[] = [];
          for (const symbol of symbols) {
            const [startLine, endLine] = symbol.getBodyLineNumbers();
            result.push({
              name: symbol.name,
              namePath: symbol.getNamePath(),
              kind: symbol.kind,
              startLine: startLine ?? 0,
              endLine: endLine ?? 0,
              bodyText: symbol.body ?? ''
            });
            // Also collect children recursively
            for (const child of symbol.iterChildren()) {
              const [childStart, childEnd] = child.getBodyLineNumbers();
              result.push({
                name: child.name,
                namePath: child.getNamePath(),
                kind: child.kind,
                startLine: childStart ?? 0,
                endLine: childEnd ?? 0,
                bodyText: child.body ?? ''
              });
            }
          }
          return result;
        } catch (err) {
          log.warn(`Failed to get symbols for ${relativePath}: ${err}`);
          return [];
        }
      };

      const indexer = new SemanticIndexer();
      const indexResult: SemanticIndexResult = await indexer.indexFiles({
        filePaths,
        projectRoot,
        getSymbols,
        db,
        provider,
        onProgress: (message) => log.info(message)
      });

      return JSON.stringify(indexResult);
    } finally {
      db.close();
    }
  }
}

// ---------------------------------------------------------------------------
// SemanticSearchTool
// ---------------------------------------------------------------------------

interface SemanticSearchInput {
  query: string;
  limit?: number;
  threshold?: number;
  kind_filter?: string[];
  file_filter?: string;
}

export class SemanticSearchTool extends Tool {
  static override readonly markers = new Set([ToolMarkerSymbolicRead, ToolMarkerOptional]);
  static override readonly description =
    'Searches code symbols by natural language query using semantic similarity.';
  static override readonly inputSchema = z.object({
    query: z.string().min(1, 'query must not be empty'),
    limit: z.number().int().positive().optional().default(10),
    threshold: z.number().min(0).max(1).optional().default(0.3),
    kind_filter: z.array(z.string()).optional(),
    file_filter: z.string().optional()
  });

  override async apply(args: SemanticSearchInput): Promise<string> {
    const projectRoot = this.getProjectRoot();
    const config = getEmbeddingConfig(this.agent.smartEditConfig.semanticSearch);
    const provider = createEmbeddingProvider(config);
    const dbPath = getDbPath(projectRoot);
    const db = new SemanticVectorDB(dbPath, provider.dimensions);

    try {
      const searcher = new SemanticSearcher(provider, db);
      const results = await searcher.search({
        query: args.query,
        limit: args.limit ?? 10,
        threshold: args.threshold ?? 0.3,
        kindFilter: args.kind_filter,
        fileFilter: args.file_filter
      });
      return JSON.stringify(results);
    } finally {
      db.close();
    }
  }
}

// ---------------------------------------------------------------------------
// FindSimilarCodeTool
// ---------------------------------------------------------------------------

interface FindSimilarCodeInput {
  symbol_name_path: string;
  file_path: string;
  limit?: number;
  threshold?: number;
}

export class FindSimilarCodeTool extends Tool {
  static override readonly markers = new Set([ToolMarkerSymbolicRead, ToolMarkerOptional]);
  static override readonly description =
    'Finds code symbols that are semantically similar to a specified symbol.';
  static override readonly inputSchema = z.object({
    symbol_name_path: z.string().min(1, 'symbol_name_path must not be empty'),
    file_path: z.string().min(1, 'file_path must not be empty'),
    limit: z.number().int().positive().optional().default(10),
    threshold: z.number().min(0).max(1).optional().default(0.3)
  });

  override async apply(args: FindSimilarCodeInput): Promise<string> {
    const projectRoot = this.getProjectRoot();
    const config = getEmbeddingConfig(this.agent.smartEditConfig.semanticSearch);
    const provider = createEmbeddingProvider(config);
    const dbPath = getDbPath(projectRoot);
    const db = new SemanticVectorDB(dbPath, provider.dimensions);

    try {
      const searcher = new SemanticSearcher(provider, db);
      const results = await searcher.findSimilar({
        symbolNamePath: args.symbol_name_path,
        filePath: args.file_path,
        limit: args.limit ?? 10,
        threshold: args.threshold ?? 0.3
      });
      return JSON.stringify(results);
    } finally {
      db.close();
    }
  }
}

// ---------------------------------------------------------------------------
// SemanticSearchStatsTool
// ---------------------------------------------------------------------------

export class SemanticSearchStatsTool extends Tool {
  static override readonly markers = new Set([ToolMarkerDoesNotRequireActiveProject, ToolMarkerOptional]);
  static override readonly description =
    'Shows statistics about the semantic search index.';
  static override readonly inputSchema = z.object({});

  override async apply(_args: Record<string, unknown>): Promise<string> {
    let projectRoot: string;
    try {
      projectRoot = this.getProjectRoot();
    } catch {
      return JSON.stringify({ error: 'No active project. Cannot read semantic index.' });
    }

    const dbPath = path.join(projectRoot, '.smart-edit', 'semantic.db');
    if (!fs.existsSync(dbPath)) {
      return JSON.stringify({
        totalFiles: 0,
        totalSymbols: 0,
        lastIndexedAt: null,
        symbolsByKind: {},
        provider: null,
        model: null,
        dimensions: 0,
        message: 'No semantic index found. Run index_semantic_symbols first.'
      });
    }

    // Open with a default dimension; we'll read the actual from metadata
    const config = getEmbeddingConfig(this.agent.smartEditConfig.semanticSearch);
    let dimensions = 1536;
    try {
      const provider = createEmbeddingProvider(config);
      dimensions = provider.dimensions;
    } catch {
      // If we can't create provider (e.g. no API key), use default
    }

    const db = new SemanticVectorDB(dbPath, dimensions);

    try {
      const stats = db.getStats();
      const storedProvider = db.getMetadata('provider');
      const storedModel = db.getMetadata('model');
      const storedDimensions = db.getMetadata('dimensions');

      return JSON.stringify({
        ...stats,
        provider: storedProvider,
        model: storedModel,
        dimensions: storedDimensions ? Number(storedDimensions) : dimensions
      });
    } finally {
      db.close();
    }
  }
}
