import { useDashboard } from '../../context/DashboardContext';
import { shutdownServer } from '../../utils/api';
import type { NavigationView } from '../../types';

interface NavItem {
  id: NavigationView;
  label: string;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '📊' },
  { id: 'logs', label: 'Logs', icon: '📝' },
  { id: 'stats', label: 'Statistics', icon: '📈' },
  { id: 'sessions', label: 'Sessions', icon: '📁' }
];

export function Sidebar() {
  const { state, dispatch } = useDashboard();
  const { currentView, sidebarCollapsed } = state;

  const handleNavClick = (view: NavigationView) => {
    dispatch({ type: 'SET_CURRENT_VIEW', view });
  };

  const handleToggleSidebar = () => {
    dispatch({ type: 'TOGGLE_SIDEBAR' });
  };

  const handleShutdown = () => {
    if (window.confirm('This will fully terminate the Smart Edit server.')) {
      shutdownServer();
      dispatch({ type: 'SET_ERROR', error: 'Shutting down ...' });
      setTimeout(() => window.close(), 2000);
    }
  };

  return (
    <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <span className="sidebar-logo-icon">⚡</span>
          <span className="sidebar-logo-text">Smart Edit</span>
        </div>
        <button
          className="sidebar-toggle"
          onClick={handleToggleSidebar}
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {sidebarCollapsed ? '→' : '←'}
        </button>
      </div>

      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={`nav-item ${currentView === item.id ? 'active' : ''}`}
            onClick={() => handleNavClick(item.id)}
            title={sidebarCollapsed ? item.label : undefined}
          >
            <span className="nav-item-icon">{item.icon}</span>
            <span className="nav-item-label">{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <button
          className="nav-item shutdown-btn"
          onClick={handleShutdown}
          title={sidebarCollapsed ? 'Shutdown Server' : undefined}
        >
          <span className="nav-item-icon">⏻</span>
          <span className="nav-item-label">Shutdown</span>
        </button>
      </div>
    </aside>
  );
}
