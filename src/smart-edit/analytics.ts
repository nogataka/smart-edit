import { encoding_for_model, type Tiktoken, type TiktokenModel } from '@dqbd/tiktoken';
import { createSmartEditLogger } from './util/logging.js';
import { RegisteredTokenCountEstimator } from './config/smart_edit_config.js';

const { logger } = createSmartEditLogger({ name: 'smart-edit.analytics', emitToConsole: false, level: 'info' });

const DEFAULT_TIKTOKEN_MODEL: TiktokenModel = 'gpt-4o';

export interface TokenCountEstimator {
  estimateTokenCount(text: string): number;
}

class ApproximateTokenCountEstimator implements TokenCountEstimator {
  estimateTokenCount(text: string): number {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (normalized.length === 0) {
      return 0;
    }
    const roughWordCount = normalized.split(' ').length;
    return Math.max(1, Math.round((normalized.length + roughWordCount * 2) / 4));
  }
}

class TiktokenCountEstimator implements TokenCountEstimator {
  private readonly encoding: Tiktoken;

  constructor(private readonly modelName: TiktokenModel) {
    this.encoding = encoding_for_model(modelName);
    logger.info(`Loading tiktoken encoding for model ${modelName}, this may take a while on the first run.`);
  }

  estimateTokenCount(text: string): number {
    if (text.length === 0) {
      return 0;
    }
    return this.encoding.encode(text).length;
  }
}

class AnthropicTokenCountEstimator implements TokenCountEstimator {
  estimateTokenCount(text: string): number {
    logger.warn('Anthropic token counting is not yet implemented in Node; using approximate estimator.');
    return approximateEstimator.estimateTokenCount(text);
  }
}

const approximateEstimator = new ApproximateTokenCountEstimator();

const estimatorCache = new Map<RegisteredTokenCountEstimator, TokenCountEstimator>();

function createEstimator(registry: RegisteredTokenCountEstimator): TokenCountEstimator {
  try {
    switch (registry) {
      case RegisteredTokenCountEstimator.TIKTOKEN_GPT4O:
        return new TiktokenCountEstimator(DEFAULT_TIKTOKEN_MODEL);
      case RegisteredTokenCountEstimator.ANTHROPIC_CLAUDE_SONNET_4:
        return new AnthropicTokenCountEstimator();
      default:
        logger.warn(`Unknown token count estimator '${String(registry)}', using approximate fallback.`);
        return approximateEstimator;
    }
  } catch (error) {
    logger.error(
      `Failed to initialize estimator '${String(registry)}': ${(error as Error).message}. Falling back to approximate estimator.`
    );
    return approximateEstimator;
  }
}

export class ToolUsageStatsEntry {
  constructor(
    public numTimesCalled = 0,
    public inputTokens = 0,
    public outputTokens = 0
  ) {}

  updateOnCall(inputTokens: number, outputTokens: number): void {
    this.numTimesCalled += 1;
    this.inputTokens += inputTokens;
    this.outputTokens += outputTokens;
  }

  clone(): ToolUsageStatsEntry {
    return new ToolUsageStatsEntry(this.numTimesCalled, this.inputTokens, this.outputTokens);
  }
}

export class ToolUsageStats {
  private readonly estimator: TokenCountEstimator;
  private readonly estimatorName: string;
  private readonly stats = new Map<string, ToolUsageStatsEntry>();

  constructor(registry: RegisteredTokenCountEstimator = RegisteredTokenCountEstimator.TIKTOKEN_GPT4O) {
    let estimator = estimatorCache.get(registry);
    if (!estimator) {
      estimator = createEstimator(registry);
      estimatorCache.set(registry, estimator);
    }
    this.estimator = estimator;
    this.estimatorName = registry;
  }

  get tokenEstimatorName(): string {
    return this.estimatorName;
  }

  clear(): void {
    this.stats.clear();
  }

  getStats(toolName: string): ToolUsageStatsEntry {
    const entry = this.stats.get(toolName);
    if (entry) {
      return entry.clone();
    }
    return new ToolUsageStatsEntry();
  }

  getToolStatsDict(): Record<string, Record<string, number>> {
    const result: Record<string, Record<string, number>> = {};
    for (const [toolName, entry] of this.stats) {
      result[toolName] = {
        numTimesCalled: entry.numTimesCalled,
        inputTokens: entry.inputTokens,
        outputTokens: entry.outputTokens
      };
    }
    return result;
  }

  recordToolUsage(toolName: string, input: string, output: string): void {
    const entry = this.stats.get(toolName) ?? new ToolUsageStatsEntry();
    entry.updateOnCall(this.estimator.estimateTokenCount(input), this.estimator.estimateTokenCount(output));
    this.stats.set(toolName, entry);
  }
}

export function __internalResetEstimatorCacheForTests(): void {
  estimatorCache.clear();
}
