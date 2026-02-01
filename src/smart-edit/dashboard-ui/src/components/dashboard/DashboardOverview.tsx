import { useEffect } from 'react';
import { useDashboardState, useDashboardDispatch } from '../../context/DashboardContext';
import { useTranslation } from '../../i18n';
import { useToolStats } from '../../hooks/useToolStats';
import { useRealTimeStats, formatNumber } from '../../hooks/useRealTimeStats';
import { MetricCard } from '../stats/MetricCard';
import { LiveCounter } from '../stats/LiveCounter';
import { Card } from '../common/Card';
import type { NavigationView } from '../../types';

function ActivityIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}

function LogIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
      <path d="M10 9H8" />
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

function ToolIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

interface QuickNavCardProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  view: NavigationView;
}

function QuickNavCard({ title, description, icon, view }: QuickNavCardProps) {
  const dispatch = useDashboardDispatch();

  const handleClick = () => {
    dispatch({ type: 'SET_CURRENT_VIEW', view });
  };

  return (
    <button type="button" className="quick-nav-card" onClick={handleClick}>
      <div className="quick-nav-icon">{icon}</div>
      <div className="quick-nav-content">
        <h4 className="quick-nav-title">{title}</h4>
        <p className="quick-nav-description">{description}</p>
      </div>
      <svg
        className="quick-nav-arrow"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M9 18l6-6-6-6" />
      </svg>
    </button>
  );
}

export function DashboardOverview() {
  const { logs, toolStats, activeProject } = useDashboardState();
  const { t } = useTranslation();
  const { loadStats } = useToolStats();
  const realTimeStats = useRealTimeStats(toolStats);

  useEffect(() => {
    if (!toolStats) {
      loadStats();
    }
  }, [toolStats, loadStats]);

  return (
    <div className="dashboard-overview">
      <Card>
        <div className="welcome-section">
          <div className="welcome-content">
            <h2 className="welcome-title">
              {activeProject
                ? t('dashboard.welcomeWithProject', { project: activeProject })
                : t('dashboard.welcome')}
            </h2>
            <p className="welcome-description">
              {t('dashboard.description')}
            </p>
          </div>
        </div>
      </Card>

      <div className="metrics-grid">
        <MetricCard
          title={t('dashboard.logEntries')}
          value={<LiveCounter value={logs.length} />}
          subtitle={t('dashboard.currentSession')}
          icon={<LogIcon />}
        />
        <MetricCard
          title={t('dashboard.toolCalls')}
          value={<LiveCounter value={realTimeStats.totalCalls} />}
          subtitle={t('dashboard.toolsUsed', { count: realTimeStats.toolCount })}
          icon={<ActivityIcon />}
        />
        <MetricCard
          title={t('dashboard.totalTokens')}
          value={<LiveCounter value={realTimeStats.totalTokens} formatter={formatNumber} />}
          subtitle={t('dashboard.inputOutput')}
          icon={<TokenIcon />}
        />
        <MetricCard
          title={t('dashboard.topTool')}
          value={realTimeStats.mostUsedTool?.name || '-'}
          subtitle={
            realTimeStats.mostUsedTool
              ? t('dashboard.calls', { count: realTimeStats.mostUsedTool.calls })
              : t('dashboard.noData')
          }
          icon={<ToolIcon />}
        />
      </div>

      <Card title={t('dashboard.quickNavigation')}>
        <div className="quick-nav-grid">
          <QuickNavCard
            title={t('dashboard.viewLogs')}
            description={t('dashboard.viewLogsDesc')}
            icon={<LogIcon />}
            view="logs"
          />
          <QuickNavCard
            title={t('nav.statistics')}
            description={t('dashboard.statisticsDesc')}
            icon={<ActivityIcon />}
            view="stats"
          />
          <QuickNavCard
            title={t('nav.sessions')}
            description={t('dashboard.sessionsDesc')}
            icon={<TokenIcon />}
            view="sessions"
          />
        </div>
      </Card>
    </div>
  );
}
