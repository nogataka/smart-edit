import type { ToolStatsResponse } from '../types';

interface LogMessagesResponse {
  messages: string[];
  max_idx: number;
  active_project: string | null;
}

interface ToolNamesResponse {
  tool_names: string[];
}

interface ToolStatsApiResponse {
  stats: ToolStatsResponse;
}

interface TokenEstimatorResponse {
  token_count_estimator_name: string;
}

export async function fetchLogMessages(startIdx: number = 0): Promise<LogMessagesResponse> {
  const response = await fetch('/get_log_messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ start_idx: startIdx })
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch logs: ${response.statusText}`);
  }
  return response.json();
}

export async function fetchToolNames(): Promise<string[]> {
  const response = await fetch('/get_tool_names');
  if (!response.ok) {
    throw new Error(`Failed to fetch tool names: ${response.statusText}`);
  }
  const data: ToolNamesResponse = await response.json();
  return data.tool_names ?? [];
}

export async function fetchToolStats(): Promise<ToolStatsResponse> {
  const response = await fetch('/get_tool_stats');
  if (!response.ok) {
    throw new Error(`Failed to fetch tool stats: ${response.statusText}`);
  }
  const data: ToolStatsApiResponse = await response.json();
  return data.stats ?? {};
}

export async function clearToolStats(): Promise<void> {
  const response = await fetch('/clear_tool_stats', { method: 'POST' });
  if (!response.ok) {
    throw new Error(`Failed to clear tool stats: ${response.statusText}`);
  }
}

export async function fetchTokenEstimatorName(): Promise<string> {
  const response = await fetch('/get_token_count_estimator_name');
  if (!response.ok) {
    throw new Error(`Failed to fetch token estimator name: ${response.statusText}`);
  }
  const data: TokenEstimatorResponse = await response.json();
  return data.token_count_estimator_name ?? 'unknown';
}

export async function shutdownServer(): Promise<void> {
  await fetch('/shutdown', { method: 'PUT' });
}
