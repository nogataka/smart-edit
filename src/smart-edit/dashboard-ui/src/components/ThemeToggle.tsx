import { useDashboard } from '../context/DashboardContext';

export function ThemeToggle() {
  const { state, dispatch } = useDashboard();

  const handleToggle = () => {
    const newTheme = state.theme === 'light' ? 'dark' : 'light';
    dispatch({ type: 'SET_THEME', theme: newTheme });
  };

  return (
    <button className="theme-toggle" onClick={handleToggle}>
      <span className="icon">{state.theme === 'dark' ? '☀️' : '🌙'}</span>
      <span>{state.theme === 'dark' ? 'Light' : 'Dark'}</span>
    </button>
  );
}
