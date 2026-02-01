import { useEffect, useRef, useCallback } from 'react';
import { useDashboard } from '../context/DashboardContext';
import { fetchLogMessages, fetchToolNames } from '../utils/api';
import type { LogMessage } from '../types';

const POLL_INTERVAL_MS = 1000;
const MAX_FAILURES_BEFORE_CLOSE = 3;

function parseLogLevel(message: string): LogMessage['level'] {
  if (message.startsWith('DEBUG')) return 'debug';
  if (message.startsWith('INFO')) return 'info';
  if (message.startsWith('WARNING')) return 'warning';
  if (message.startsWith('ERROR')) return 'error';
  return 'default';
}

function createLogMessage(message: string, idx: number): LogMessage {
  return {
    id: idx,
    message,
    level: parseLogLevel(message)
  };
}

export function useLogStream() {
  const { state, dispatch } = useDashboard();
  const eventSourceRef = useRef<EventSource | null>(null);
  const pollIntervalRef = useRef<number | null>(null);
  const failureCountRef = useRef(0);
  const maxLogIdxRef = useRef(state.maxLogIdx);

  maxLogIdxRef.current = state.maxLogIdx;

  const loadInitialData = useCallback(async () => {
    try {
      dispatch({ type: 'SET_LOADING', isLoading: true });

      const toolNames = await fetchToolNames();
      dispatch({ type: 'SET_TOOL_NAMES', toolNames });

      const logData = await fetchLogMessages(0);
      const logs = logData.messages.map((msg, i) => createLogMessage(msg, i));
      dispatch({ type: 'SET_LOGS', logs, maxIdx: logData.max_idx });
      dispatch({ type: 'SET_ACTIVE_PROJECT', project: logData.active_project });
      dispatch({ type: 'SET_ERROR', error: null });
    } catch (error) {
      dispatch({ type: 'SET_ERROR', error: error instanceof Error ? error.message : String(error) });
    } finally {
      dispatch({ type: 'SET_LOADING', isLoading: false });
    }
  }, [dispatch]);

  const pollForNewLogs = useCallback(async () => {
    try {
      const logData = await fetchLogMessages(maxLogIdxRef.current + 1);
      failureCountRef.current = 0;

      if (logData.messages.length > 0) {
        for (let i = 0; i < logData.messages.length; i++) {
          const idx = maxLogIdxRef.current + 1 + i;
          const log = createLogMessage(logData.messages[i], idx);
          dispatch({ type: 'APPEND_LOG', log, maxIdx: idx });
        }
      }
      dispatch({ type: 'SET_ACTIVE_PROJECT', project: logData.active_project });
    } catch {
      failureCountRef.current++;
      if (failureCountRef.current >= MAX_FAILURES_BEFORE_CLOSE) {
        window.close();
      }
    }
  }, [dispatch]);

  const startPolling = useCallback(() => {
    if (pollIntervalRef.current !== null) return;
    dispatch({ type: 'SET_CONNECTION_MODE', mode: 'polling' });
    pollIntervalRef.current = window.setInterval(pollForNewLogs, POLL_INTERVAL_MS);
  }, [dispatch, pollForNewLogs]);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current !== null) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  const setupStreaming = useCallback(() => {
    if (!window.EventSource) {
      return false;
    }

    try {
      const eventSource = new EventSource('/log_stream');
      eventSourceRef.current = eventSource;
      let initialized = false;

      eventSource.addEventListener('open', () => {
        dispatch({ type: 'SET_CONNECTION_MODE', mode: 'streaming' });
        stopPolling();
      });

      eventSource.addEventListener('history', (event) => {
        initialized = true;
        const payload = JSON.parse(event.data) as {
          messages: string[];
          maxIdx: number;
          activeProject: string | null;
        };
        const logs = payload.messages.map((msg, i) => createLogMessage(msg, i));
        dispatch({ type: 'SET_LOGS', logs, maxIdx: payload.maxIdx });
        dispatch({ type: 'SET_ACTIVE_PROJECT', project: payload.activeProject });
      });

      eventSource.addEventListener('log', (event) => {
        const payload = JSON.parse(event.data) as {
          message: string;
          idx: number;
          activeProject: string | null;
        };
        const log = createLogMessage(payload.message, payload.idx);
        dispatch({ type: 'APPEND_LOG', log, maxIdx: payload.idx });
        dispatch({ type: 'SET_ACTIVE_PROJECT', project: payload.activeProject });
      });

      eventSource.addEventListener('toolNames', (event) => {
        const payload = JSON.parse(event.data) as { toolNames: string[] };
        dispatch({ type: 'SET_TOOL_NAMES', toolNames: payload.toolNames });
      });

      eventSource.onerror = () => {
        eventSource.close();
        eventSourceRef.current = null;
        dispatch({ type: 'SET_CONNECTION_MODE', mode: 'disconnected' });

        if (!initialized) {
          loadInitialData().then(() => {
            startPolling();
          });
        } else {
          startPolling();
        }
      };

      return true;
    } catch {
      return false;
    }
  }, [dispatch, stopPolling, loadInitialData, startPolling]);

  const reconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    stopPolling();

    if (!setupStreaming()) {
      loadInitialData().then(() => {
        startPolling();
      });
    }
  }, [setupStreaming, stopPolling, loadInitialData, startPolling]);

  useEffect(() => {
    const initConnection = async () => {
      const toolNames = await fetchToolNames().catch(() => []);
      dispatch({ type: 'SET_TOOL_NAMES', toolNames });

      if (!setupStreaming()) {
        await loadInitialData();
        startPolling();
      }
    };

    initConnection();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      stopPolling();
    };
  }, [dispatch, setupStreaming, loadInitialData, startPolling, stopPolling]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && state.connectionMode === 'disconnected') {
        reconnect();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [state.connectionMode, reconnect]);

  const reloadLogs = useCallback(async () => {
    dispatch({ type: 'CLEAR_LOGS' });
    await loadInitialData();
  }, [dispatch, loadInitialData]);

  return { reloadLogs, reconnect };
}
