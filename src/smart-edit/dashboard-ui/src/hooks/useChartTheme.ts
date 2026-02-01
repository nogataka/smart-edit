import { useMemo } from 'react';
import { useDashboardState } from '../context/DashboardContext';

export interface ChartThemeColors {
  textColor: string;
  gridColor: string;
  legendColor: string;
}

export function useChartTheme(): ChartThemeColors {
  const { theme } = useDashboardState();

  return useMemo(
    () => ({
      textColor: theme === 'dark' ? '#ffffff' : '#000000',
      gridColor: theme === 'dark' ? '#444444' : '#dddddd',
      legendColor: theme === 'dark' ? '#ffffff' : '#000000'
    }),
    [theme]
  );
}
