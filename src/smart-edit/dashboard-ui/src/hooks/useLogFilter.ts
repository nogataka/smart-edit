import { useMemo } from 'react';
import { useDebounce } from './useDebounce';
import type { LogMessage, LogFilter } from '../types';

const TOOL_NAME_PATTERN = /\[tool:\s*([^\]]+)\]/i;

export function extractToolName(message: string): string | null {
  const match = message.match(TOOL_NAME_PATTERN);
  return match ? match[1].trim() : null;
}

export function useLogFilter(logs: LogMessage[], filter: LogFilter): LogMessage[] {
  const debouncedKeyword = useDebounce(filter.searchKeyword, 200);

  return useMemo(() => {
    return logs.filter((log) => {
      // Filter by log level
      if (filter.logLevels.size > 0 && !filter.logLevels.has(log.level)) {
        return false;
      }

      // Filter by tool name
      if (filter.toolNames.size > 0) {
        const toolName = extractToolName(log.message);
        if (!toolName || !filter.toolNames.has(toolName)) {
          return false;
        }
      }

      // Filter by keyword
      if (debouncedKeyword) {
        const keyword = debouncedKeyword.toLowerCase();
        if (!log.message.toLowerCase().includes(keyword)) {
          return false;
        }
      }

      return true;
    });
  }, [logs, filter.logLevels, filter.toolNames, debouncedKeyword]);
}

export function useAvailableToolNames(logs: LogMessage[]): string[] {
  return useMemo(() => {
    const toolNames = new Set<string>();
    for (const log of logs) {
      const toolName = extractToolName(log.message);
      if (toolName) {
        toolNames.add(toolName);
      }
    }
    return Array.from(toolNames).sort();
  }, [logs]);
}
