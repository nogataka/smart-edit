import { useDashboard } from '../../context/DashboardContext';
import { useMultiInstance } from '../../context/MultiInstanceContext';
import { useTranslation } from '../../i18n';
import { shutdownServer } from '../../utils/api';
import type { InstanceInfo } from '../../types';

function LogoIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
      <defs>
        <linearGradient id="logoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FFD700" />
          <stop offset="100%" stopColor="#FFA500" />
        </linearGradient>
        <filter id="logoGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1" result="glow" />
          <feMerge>
            <feMergeNode in="glow" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <polygon
        points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"
        fill="url(#logoGradient)"
        filter="url(#logoGlow)"
      />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function PowerIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
      <line x1="12" y1="2" x2="12" y2="12" />
    </svg>
  );
}

function getProjectNameFromPath(projectPath: string | null): string | null {
  if (!projectPath) return null;
  return projectPath.split('/').pop() || null;
}

function InstanceItem({ instance, isActive, onClick }: {
  instance: InstanceInfo;
  isActive: boolean;
  onClick: () => void;
}) {
  const projectName = getProjectNameFromPath(instance.project);

  return (
    <button
      className={`instance-item ${isActive ? 'active' : ''}`}
      onClick={onClick}
      title={instance.project || 'No project'}
    >
      <span className={`instance-indicator ${isActive ? 'active' : ''}`} />
      <FolderIcon />
      <span className="instance-name">
        {projectName || 'No project'}
      </span>
    </button>
  );
}

export function Sidebar() {
  const { state, dispatch } = useDashboard();
  const { activeProject } = state;
  const { state: multiState, setActiveInstance } = useMultiInstance();
  const { instances, activeInstanceId, isMultiInstanceMode } = multiState;
  const { t } = useTranslation();

  const handleShutdown = () => {
    if (window.confirm(t('sidebar.shutdownConfirm'))) {
      shutdownServer();
      dispatch({ type: 'SET_ERROR', error: 'Shutting down ...' });
      setTimeout(() => window.close(), 2000);
    }
  };

  const projectName = activeProject ? activeProject.split('/').pop() : null;

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <span className="sidebar-logo-icon"><LogoIcon /></span>
          <span className="sidebar-logo-text">Smart Edit</span>
        </div>
      </div>

      <div className="sidebar-content">
        {/* Multi-instance mode: show instance list */}
        {isMultiInstanceMode && instances.length > 0 ? (
          <div className="sidebar-section">
            <h3 className="sidebar-section-title">{t('sidebar.instances')}</h3>
            <div className="instance-list">
              {instances.map((instance) => (
                <InstanceItem
                  key={instance.id}
                  instance={instance}
                  isActive={instance.id === activeInstanceId}
                  onClick={() => setActiveInstance(instance.id)}
                />
              ))}
            </div>
          </div>
        ) : (
          /* Single instance mode: show current project */
          <div className="sidebar-section">
            <h3 className="sidebar-section-title">{t('sidebar.project')}</h3>
            {activeProject ? (
              <div className="project-info">
                <div className="project-name">
                  <FolderIcon />
                  <span className="project-name-text" title={activeProject}>
                    {projectName}
                  </span>
                </div>
                <div className="project-path" title={activeProject}>
                  {activeProject}
                </div>
              </div>
            ) : (
              <div className="project-empty">
                {t('sidebar.noProject')}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="sidebar-footer">
        <button
          className="sidebar-action-btn shutdown-btn"
          onClick={handleShutdown}
        >
          <PowerIcon />
          <span>{t('nav.shutdown')}</span>
        </button>
      </div>
    </aside>
  );
}
