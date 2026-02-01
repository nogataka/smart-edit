import { useEffect } from 'react';
import { useDashboardState } from '../../context/DashboardContext';
import { useTranslation } from '../../i18n';
import { useToolStats } from '../../hooks/useToolStats';
import { useRealTimeStats, formatNumber } from '../../hooks/useRealTimeStats';
import { useActivityHistory } from '../../hooks/useActivityHistory';
import { MetricCard } from './MetricCard';
import { LiveCounter } from './LiveCounter';
import { TokenDistributionChart } from './TokenDistributionChart';
import { ActivityChart } from './ActivityChart';
import { Card } from '../common/Card';
import { PieChart } from '../StatsSection/PieChart';

function ToolIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

function TokenIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v12" />
      <path d="M8 10h8" />
      <path d="M8 14h8" />
    </svg>
  );
}

function CallIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}

export function StatsPanel() {
  const { toolStats } = useDashboardState();
  const { t } = useTranslation();
  const { loadStats, clearStats, isLoading, tokenEstimatorName } = useToolStats();
  const realTimeStats = useRealTimeStats(toolStats);
  const { history: activityHistory, clearHistory: clearActivityHistory } = useActivityHistory(toolStats);

  useEffect(() => {
    if (!toolStats) {
      loadStats();
    }
  }, [toolStats, loadStats]);

  const statsData = toolStats
    ? {
        names: Object.keys(toolStats),
        counts: Object.values(toolStats).map((s) => s.num_times_called),
        inputTokens: Object.values(toolStats).map((s) => s.input_tokens),
        outputTokens: Object.values(toolStats).map((s) => s.output_tokens)
      }
    : null;

  return (
    <div className="stats-panel">
      <div className="stats-panel-header">
        <div className="stats-panel-actions">
          <button className="btn" onClick={loadStats} disabled={isLoading}>
            {isLoading ? t('stats.loading') : t('stats.refresh')}
          </button>
          <button className="btn" onClick={clearStats}>
            {t('stats.clearStats')}
          </button>
        </div>
        {tokenEstimatorName && (
          <span className="stats-estimator">{t('stats.tokenEstimator', { name: tokenEstimatorName })}</span>
        )}
      </div>

      {!toolStats || Object.keys(toolStats).length === 0 ? (
        <Card>
          <div className="stats-empty">
            <p>{t('stats.noStatsYet')}</p>
            <p className="stats-empty-hint">
              {t('stats.noStatsHint')}
            </p>
          </div>
        </Card>
      ) : (
        <>
          <div className="metrics-grid">
            <MetricCard
              title={t('stats.totalCalls')}
              value={<LiveCounter value={realTimeStats.totalCalls} />}
              subtitle={t('dashboard.toolsUsed', { count: realTimeStats.toolCount })}
              icon={<CallIcon />}
            />
            <MetricCard
              title={t('stats.inputTokens')}
              value={<LiveCounter value={realTimeStats.totalInputTokens} formatter={formatNumber} />}
              subtitle={t('stats.totalInput')}
              icon={<TokenIcon />}
            />
            <MetricCard
              title={t('stats.outputTokens')}
              value={<LiveCounter value={realTimeStats.totalOutputTokens} formatter={formatNumber} />}
              subtitle={t('stats.totalOutput')}
              icon={<TokenIcon />}
            />
            <MetricCard
              title={t('stats.mostUsedTool')}
              value={realTimeStats.mostUsedTool?.name || '-'}
              subtitle={
                realTimeStats.mostUsedTool
                  ? t('dashboard.calls', { count: realTimeStats.mostUsedTool.calls })
                  : undefined
              }
              icon={<ToolIcon />}
            />
          </div>

          <div className="stats-charts-row">
            <Card title={t('stats.activityOverTime')}>
              <ActivityChart history={activityHistory} onClear={clearActivityHistory} />
            </Card>
          </div>

          <div className="stats-charts-grid">
            <Card title={t('stats.tokenDistribution')}>
              <TokenDistributionChart toolStats={toolStats} />
            </Card>

            <Card title={t('stats.callDistribution')}>
              {statsData && <PieChart title="" labels={statsData.names} data={statsData.counts} />}
            </Card>
          </div>

          <div className="stats-charts-row">
            <Card title={t('stats.tokenBreakdown')}>
              <div className="pie-charts-row">
                {statsData && (
                  <>
                    <div className="pie-chart-item">
                      <PieChart title={t('stats.inputTokens')} labels={statsData.names} data={statsData.inputTokens} />
                    </div>
                    <div className="pie-chart-item">
                      <PieChart title={t('stats.outputTokens')} labels={statsData.names} data={statsData.outputTokens} />
                    </div>
                  </>
                )}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
