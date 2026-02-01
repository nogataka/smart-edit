import { useDashboardState } from '../../context/DashboardContext';
import { useTranslation } from '../../i18n';
import { ThemeToggle } from '../ThemeToggle';
import { LanguageToggle } from '../LanguageToggle';
import type { NavigationView } from '../../types';

const VIEW_TITLE_KEYS: Record<NavigationView, string> = {
  dashboard: 'nav.dashboard',
  logs: 'nav.logs',
  stats: 'nav.statistics',
  sessions: 'nav.sessions'
};

export function TopBar() {
  const { currentView, activeProject, connectionMode } = useDashboardState();
  const { t } = useTranslation();

  const getConnectionLabel = () => {
    switch (connectionMode) {
      case 'streaming':
        return t('status.connected');
      case 'polling':
        return t('status.polling');
      case 'disconnected':
        return t('status.disconnected');
    }
  };

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div>
          <h1 className="topbar-title">{t(VIEW_TITLE_KEYS[currentView])}</h1>
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
        <LanguageToggle />
        <ThemeToggle />
      </div>
    </header>
  );
}
