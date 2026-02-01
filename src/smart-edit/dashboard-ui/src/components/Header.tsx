import { useDashboardState } from '../context/DashboardContext';

export function Header() {
  const { activeProject } = useDashboardState();

  return (
    <div className="header">
      {activeProject ? `${activeProject} – Smart Edit Dashboard` : 'Smart Edit Dashboard'}
    </div>
  );
}
