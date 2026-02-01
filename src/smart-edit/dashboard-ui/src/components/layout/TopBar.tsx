import { useDashboardState } from '../../context/DashboardContext';
import { ThemeToggle } from '../ThemeToggle';
import type { NavigationView } from '../../types';

const VIEW_TITLES: Record<NavigationView, string> = {
  dashboard: 'Dashboard',
  logs: 'Logs',
  stats: 'Statistics',
  sessions: 'Sessions'
};

export function TopBar() {
  const { currentView, activeProject, connectionMode } = useDashboardState();

  const getConnectionLabel = () => {
    switch (connectionMode) {
      case 'streaming':
        return 'Connected';
      case 'polling':
        return 'Polling';
      case 'disconnected':
        return 'Disconnected';
    }
  };

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div>
          <h1 className="topbar-title">{VIEW_TITLES[currentView]}</h1>
          {activeProject && (
            <p className="topbar-subtitle">{activeProject}</p>
          )}
        </div>
      </div>

      <div className="topbar-right">
        <div className="connection-indicator">
          <span className={`connection-dot ${connectionMode}`} />
          <span>{getConnectionLabel()}</span>
        </div>
        <ThemeToggle />
      </div>
    </header>
  );
}
