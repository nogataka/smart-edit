import { useRef, useEffect, useState, useCallback } from 'react';
import type { ToolStatsResponse } from '../types';

export interface ActivityPoint {
  timestamp: Date;
  label: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

interface TotalStats {
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

function sumToolStats(stats: ToolStatsResponse | null): TotalStats {
  if (!stats) {
    return { calls: 0, inputTokens: 0, outputTokens: 0 };
  }
  return Object.values(stats).reduce(
    (acc, tool) => ({
      calls: acc.calls + tool.num_times_called,
      inputTokens: acc.inputTokens + tool.input_tokens,
      outputTokens: acc.outputTokens + tool.output_tokens
    }),
    { calls: 0, inputTokens: 0, outputTokens: 0 }
  );
}

function formatTimeLabel(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

const MAX_HISTORY_POINTS = 60;

export function useActivityHistory(
  toolStats: ToolStatsResponse | null
): {
  history: ActivityPoint[];
  clearHistory: () => void;
} {
  const [history, setHistory] = useState<ActivityPoint[]>([]);
  const prevStatsRef = useRef<TotalStats | null>(null);

  useEffect(() => {
    const currentTotal = sumToolStats(toolStats);

    if (prevStatsRef.current === null) {
      prevStatsRef.current = currentTotal;
      return;
    }

    const prev = prevStatsRef.current;
    const deltaCalls = currentTotal.calls - prev.calls;
    const deltaInput = currentTotal.inputTokens - prev.inputTokens;
    const deltaOutput = currentTotal.outputTokens - prev.outputTokens;

    if (deltaCalls > 0 || deltaInput > 0 || deltaOutput > 0) {
      const now = new Date();
      const newPoint: ActivityPoint = {
        timestamp: now,
        label: formatTimeLabel(now),
        calls: deltaCalls,
        inputTokens: deltaInput,
        outputTokens: deltaOutput
      };

      setHistory((prevHistory) => {
        const updated = [...prevHistory, newPoint];
        return updated.length > MAX_HISTORY_POINTS
          ? updated.slice(-MAX_HISTORY_POINTS)
          : updated;
      });
    }

    prevStatsRef.current = currentTotal;
  }, [toolStats]);

  const clearHistory = useCallback(() => {
    setHistory([]);
    prevStatsRef.current = null;
  }, []);

  return { history, clearHistory };
}
