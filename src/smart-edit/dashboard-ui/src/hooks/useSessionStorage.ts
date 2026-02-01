import { useEffect, useCallback } from 'react';
import { useDashboard } from '../context/DashboardContext';
import type { Session, ToolStatsResponse } from '../types';

const STORAGE_KEY = 'smart-edit-session-history';
const MAX_SESSIONS = 50;

interface StoredSession {
  id: string;
  startTime: string;
  endTime: string | null;
  projectName: string | null;
  stats: {
    totalCalls: number;
    totalInputTokens: number;
    totalOutputTokens: number;
  };
  toolStats: ToolStatsResponse | null;
}

function sessionToStored(session: Session): StoredSession {
  return {
    id: session.id,
    startTime: session.startTime.toISOString(),
    endTime: session.endTime ? session.endTime.toISOString() : null,
    projectName: session.projectName,
    stats: session.stats,
    toolStats: session.toolStats
  };
}

function storedToSession(stored: StoredSession): Session {
  return {
    id: stored.id,
    startTime: new Date(stored.startTime),
    endTime: stored.endTime ? new Date(stored.endTime) : null,
    projectName: stored.projectName,
    stats: stored.stats,
    toolStats: stored.toolStats
  };
}

export function useSessionStorage() {
  const { state, dispatch } = useDashboard();

  // Load session history from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: StoredSession[] = JSON.parse(stored);
        const sessions = parsed.map(storedToSession);
        dispatch({ type: 'LOAD_SESSION_HISTORY', sessions });
      }
    } catch (error) {
      console.error('Failed to load session history:', error);
    }
  }, [dispatch]);

  // Save session history to localStorage when it changes
  useEffect(() => {
    try {
      const stored = state.sessionHistory.map(sessionToStored);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch (error) {
      console.error('Failed to save session history:', error);
    }
  }, [state.sessionHistory]);

  const startSession = useCallback(
    (projectName: string | null) => {
      const session: Session = {
        id: crypto.randomUUID(),
        startTime: new Date(),
        endTime: null,
        projectName,
        stats: {
          totalCalls: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0
        },
        toolStats: null
      };
      dispatch({ type: 'START_SESSION', session });
    },
    [dispatch]
  );

  const endSession = useCallback(() => {
    if (state.currentSession && state.toolStats) {
      // Update current session with final stats before ending
      const finalStats = Object.values(state.toolStats).reduce(
        (acc, tool) => ({
          totalCalls: acc.totalCalls + tool.num_times_called,
          totalInputTokens: acc.totalInputTokens + tool.input_tokens,
          totalOutputTokens: acc.totalOutputTokens + tool.output_tokens
        }),
        { totalCalls: 0, totalInputTokens: 0, totalOutputTokens: 0 }
      );

      const updatedSession: Session = {
        ...state.currentSession,
        stats: finalStats,
        toolStats: state.toolStats
      };
      dispatch({ type: 'START_SESSION', session: updatedSession });
    }
    dispatch({ type: 'END_SESSION' });
  }, [dispatch, state.currentSession, state.toolStats]);

  const clearHistory = useCallback(() => {
    dispatch({ type: 'CLEAR_SESSION_HISTORY' });
    localStorage.removeItem(STORAGE_KEY);
  }, [dispatch]);

  const exportSession = useCallback((session: Session): string => {
    const exportData = {
      ...sessionToStored(session),
      exportedAt: new Date().toISOString()
    };
    return JSON.stringify(exportData, null, 2);
  }, []);

  const exportAllSessions = useCallback((): string => {
    const exportData = {
      sessions: state.sessionHistory.map(sessionToStored),
      exportedAt: new Date().toISOString()
    };
    return JSON.stringify(exportData, null, 2);
  }, [state.sessionHistory]);

  return {
    currentSession: state.currentSession,
    sessionHistory: state.sessionHistory,
    startSession,
    endSession,
    clearHistory,
    exportSession,
    exportAllSessions
  };
}
