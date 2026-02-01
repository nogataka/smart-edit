import { useDashboardState } from '../context/DashboardContext';

export function ErrorContainer() {
  const { error } = useDashboardState();

  if (!error) {
    return null;
  }

  return (
    <div id="error-container">
      <div className="error-message">{error}</div>
    </div>
  );
}
