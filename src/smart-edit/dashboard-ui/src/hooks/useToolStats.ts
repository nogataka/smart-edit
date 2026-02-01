import { useCallback, useState } from 'react';
import { useDashboard } from '../context/DashboardContext';
import { fetchToolStats, clearToolStats as clearToolStatsApi, fetchTokenEstimatorName } from '../utils/api';

export function useToolStats() {
  const { dispatch } = useDashboard();
  const [isLoading, setIsLoading] = useState(false);
  const [tokenEstimatorName, setTokenEstimatorName] = useState<string>('unknown');

  const loadStats = useCallback(async () => {
    setIsLoading(true);
    try {
      const [stats, estimatorName] = await Promise.all([fetchToolStats(), fetchTokenEstimatorName()]);
      dispatch({ type: 'SET_TOOL_STATS', stats });
      setTokenEstimatorName(estimatorName);
    } catch (error) {
      console.error('Failed to load stats:', error);
    } finally {
      setIsLoading(false);
    }
  }, [dispatch]);

  const clearStats = useCallback(async () => {
    try {
      await clearToolStatsApi();
      await loadStats();
    } catch (error) {
      console.error('Failed to clear stats:', error);
    }
  }, [loadStats]);

  return { loadStats, clearStats, isLoading, tokenEstimatorName };
}
