import { useEffect, useMemo } from 'react';
import { useDashboardState } from '../../context/DashboardContext';
import { useToolStats } from '../../hooks/useToolStats';
import { SummaryTable } from './SummaryTable';
import { PieChart } from './PieChart';
import { TokensBarChart } from './TokensBarChart';

export function StatsSection() {
  const { isStatsVisible, toolStats } = useDashboardState();
  const { loadStats, clearStats, isLoading, tokenEstimatorName } = useToolStats();

  useEffect(() => {
    if (isStatsVisible && !toolStats) {
      loadStats();
    }
  }, [isStatsVisible, toolStats, loadStats]);

  const statsData = useMemo(() => {
    if (!toolStats) return null;

    const names = Object.keys(toolStats);
    if (names.length === 0) return null;

    const counts = names.map((n) => toolStats[n].num_times_called);
    const inputTokens = names.map((n) => toolStats[n].input_tokens);
    const outputTokens = names.map((n) => toolStats[n].output_tokens);

    const totalCalls = counts.reduce((sum, count) => sum + count, 0);
    const totalInputTokens = inputTokens.reduce((sum, tokens) => sum + tokens, 0);
    const totalOutputTokens = outputTokens.reduce((sum, tokens) => sum + tokens, 0);

    return {
      names,
      counts,
      inputTokens,
      outputTokens,
      totalCalls,
      totalInputTokens,
      totalOutputTokens
    };
  }, [toolStats]);

  if (!isStatsVisible) {
    return null;
  }

  return (
    <div id="stats-section" style={{ marginTop: '20px' }}>
      <div style={{ textAlign: 'center', marginBottom: '20px' }}>
        <button className="btn" onClick={loadStats} disabled={isLoading}>
          {isLoading ? 'Loading...' : 'Refresh Stats'}
        </button>
        <button className="btn" onClick={clearStats} style={{ marginLeft: '10px' }}>
          Clear Stats
        </button>
      </div>

      {!statsData ? (
        <div
          id="no-stats-message"
          style={{ textAlign: 'center', color: 'var(--text-muted)', fontStyle: 'italic' }}
        >
          No tool stats collected. Have you enabled tool stats collection in the configuration?
        </div>
      ) : (
        <>
          <div id="stats-summary" style={{ marginBottom: '20px', textAlign: 'center' }}>
            <SummaryTable
              totalCalls={statsData.totalCalls}
              totalInputTokens={statsData.totalInputTokens}
              totalOutputTokens={statsData.totalOutputTokens}
            />
          </div>

          <div id="estimator-name" style={{ textAlign: 'center', marginBottom: '10px' }}>
            <strong>Token count estimator:</strong> {tokenEstimatorName}
          </div>

          <div className="charts-container">
            <PieChart title="Tool Calls" labels={statsData.names} data={statsData.counts} />
            <PieChart title="Input Tokens" labels={statsData.names} data={statsData.inputTokens} />
            <PieChart title="Output Tokens" labels={statsData.names} data={statsData.outputTokens} />
            <TokensBarChart
              labels={statsData.names}
              inputTokens={statsData.inputTokens}
              outputTokens={statsData.outputTokens}
            />
          </div>
        </>
      )}
    </div>
  );
}
