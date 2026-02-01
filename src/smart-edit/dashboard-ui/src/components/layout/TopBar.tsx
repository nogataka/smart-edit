import { useDashboard, useDashboardState } from '../../context/DashboardContext';
import { useTranslation } from '../../i18n';
import { ThemeToggle } from '../ThemeToggle';
import { LanguageToggle } from '../LanguageToggle';
import type { NavigationView } from '../../types';

function DashboardIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </svg>
  );
}

function LogsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
      <path d="M10 9H8" />
    </svg>
  );
}

function StatsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 20V10" />
      <path d="M12 20V4" />
      <path d="M6 20v-6" />
    </svg>
  );
}

function SessionsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

interface NavItem {
  id: NavigationView;
  labelKey: string;
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', labelKey: 'nav.dashboard', icon: <DashboardIcon /> },
  { id: 'logs', labelKey: 'nav.logs', icon: <LogsIcon /> },
  { id: 'stats', labelKey: 'nav.statistics', icon: <StatsIcon /> },
  { id: 'sessions', labelKey: 'nav.sessions', icon: <SessionsIcon /> }
];

export function TopBar() {
  const { state, dispatch } = useDashboard();
  const { connectionMode } = useDashboardState();
  const { currentView } = state;
  const { t } = useTranslation();

  const handleNavClick = (view: NavigationView) => {
    dispatch({ type: 'SET_CURRENT_VIEW', view });
  };

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
      <nav className="topbar-nav">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={`topbar-nav-item ${currentView === item.id ? 'active' : ''}`}
            onClick={() => handleNavClick(item.id)}
          >
            <span className="topbar-nav-icon">{item.icon}</span>
            <span className="topbar-nav-label">{t(item.labelKey)}</span>
          </button>
        ))}
      </nav>

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
