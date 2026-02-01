import React, { useEffect } from 'react';
import { DashboardProvider, useDashboardState } from './context/DashboardContext';
import { MainLayout } from './components/layout/MainLayout';
import { LogPanel } from './components/logs/LogPanel';
import { StatsPanel } from './components/stats/StatsPanel';
import { SessionPanel } from './components/sessions/SessionPanel';
import { DashboardOverview } from './components/dashboard/DashboardOverview';
import type { NavigationView } from './types';

function DashboardView() {
  return <DashboardOverview />;
}

function LogsView() {
  return <LogPanel />;
}

function StatsView() {
  return <StatsPanel />;
}

function SessionsView() {
  return <SessionPanel />;
}

function ContentRouter() {
  const { currentView } = useDashboardState();

  const views: Record<NavigationView, React.JSX.Element> = {
    dashboard: <DashboardView />,
    logs: <LogsView />,
    stats: <StatsView />,
    sessions: <SessionsView />
  };

  return views[currentView];
}

function DashboardContent() {
  const { theme, activeProject } = useDashboardState();

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    document.title = activeProject
      ? `${activeProject} – Smart Edit Dashboard`
      : 'Smart Edit Dashboard';
  }, [activeProject]);

  return (
    <MainLayout>
      <ContentRouter />
    </MainLayout>
  );
}

export function App() {
  return (
    <DashboardProvider>
      <DashboardContent />
    </DashboardProvider>
  );
}
