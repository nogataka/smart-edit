import { beforeEach, describe, expect, it } from 'vitest';
import {
  ToolUsageStats,
  ToolUsageStatsEntry,
  __internalResetEstimatorCacheForTests
} from '../../../src/smart-edit/analytics.js';
import { RegisteredTokenCountEstimator } from '../../../src/smart-edit/config/smart_edit_config.js';

describe('ToolUsageStats', () => {
  beforeEach(() => {
    __internalResetEstimatorCacheForTests();
  });

  it('記録したトークン使用量を正しく集計する', () => {
    const stats = new ToolUsageStats(RegisteredTokenCountEstimator.TIKTOKEN_GPT4O);
    stats.recordToolUsage('echo', 'Hello world!', 'Goodbye.');

    const entry = stats.getStats('echo');
    expect(entry).toBeInstanceOf(ToolUsageStatsEntry);
    expect(entry.numTimesCalled).toBe(1);
    expect(entry.inputTokens).toBeGreaterThan(0);
    expect(entry.outputTokens).toBeGreaterThan(0);

    const dict = stats.getToolStatsDict();
    expect(dict.echo.numTimesCalled).toBe(1);
  });

  it('取得したエントリはコピーであり内部状態を汚染しない', () => {
    const stats = new ToolUsageStats();
    stats.recordToolUsage('replace', 'aaa bbb', 'ccc ddd');

    const entry = stats.getStats('replace');
    entry.numTimesCalled = 999;
    entry.inputTokens = 999;
    entry.outputTokens = 999;

    const fresh = stats.getStats('replace');
    expect(fresh.numTimesCalled).toBe(1);
    expect(fresh.inputTokens).toBeGreaterThan(0);
    expect(fresh.outputTokens).toBeGreaterThan(0);
  });

  it('clear で統計を初期化できる', () => {
    const stats = new ToolUsageStats();
    stats.recordToolUsage('format', 'format me', 'formatted');
    expect(stats.getStats('format').numTimesCalled).toBe(1);

    stats.clear();
    const afterClear = stats.getStats('format');
    expect(afterClear.numTimesCalled).toBe(0);
    expect(stats.getToolStatsDict()).toEqual({});
  });

  it('Anthropic 推定器はフォールバックしても集計を継続できる', () => {
    const stats = new ToolUsageStats(RegisteredTokenCountEstimator.ANTHROPIC_CLAUDE_SONNET_4);
    stats.recordToolUsage('anthropic', 'count these tokens', 'and this response');

    const entry = stats.getStats('anthropic');
    expect(entry.numTimesCalled).toBe(1);
    expect(entry.inputTokens).toBeGreaterThan(0);
    expect(entry.outputTokens).toBeGreaterThan(0);
  });
});
