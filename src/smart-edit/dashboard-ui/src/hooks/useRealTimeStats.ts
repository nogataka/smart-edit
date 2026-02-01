import { useMemo } from 'react';
import type { ToolStatsResponse } from '../types';

export interface RealTimeStats {
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  toolCount: number;
  mostUsedTool: { name: string; calls: number } | null;
  topTools: Array<{ name: string; calls: number; inputTokens: number; outputTokens: number }>;
}

export function useRealTimeStats(toolStats: ToolStatsResponse | null): RealTimeStats {
  return useMemo(() => {
    if (!toolStats) {
      return {
        totalCalls: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
        toolCount: 0,
        mostUsedTool: null,
        topTools: []
      };
    }

    const entries = Object.entries(toolStats);
    let totalCalls = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let mostUsedTool: { name: string; calls: number } | null = null;

    const toolsWithStats = entries.map(([name, stats]) => {
      totalCalls += stats.num_times_called;
      totalInputTokens += stats.input_tokens;
      totalOutputTokens += stats.output_tokens;

      if (!mostUsedTool || stats.num_times_called > mostUsedTool.calls) {
        mostUsedTool = { name, calls: stats.num_times_called };
      }

      return {
        name,
        calls: stats.num_times_called,
        inputTokens: stats.input_tokens,
        outputTokens: stats.output_tokens
      };
    });

    const topTools = toolsWithStats.sort((a, b) => b.calls - a.calls).slice(0, 5);

    return {
      totalCalls,
      totalInputTokens,
      totalOutputTokens,
      totalTokens: totalInputTokens + totalOutputTokens,
      toolCount: entries.length,
      mostUsedTool,
      topTools
    };
  }, [toolStats]);
}

export function formatNumber(num: number): string {
  if (num >= 1_000_000) {
    return (num / 1_000_000).toFixed(1) + 'M';
  }
  if (num >= 1_000) {
    return (num / 1_000).toFixed(1) + 'K';
  }
  return num.toString();
}
