import { useMemo } from 'react';
import { Pie } from 'react-chartjs-2';
import type { ChartOptions } from 'chart.js';
import { useChartTheme } from '../../hooks/useChartTheme';
import { generateColors } from '../../utils/generateColors';

interface Props {
  title: string;
  labels: string[];
  data: number[];
}

export function PieChart({ title, labels, data }: Props) {
  const { textColor } = useChartTheme();
  const colors = useMemo(() => generateColors(labels.length), [labels.length]);

  const chartData = useMemo(
    () => ({
      labels,
      datasets: [
        {
          data,
          backgroundColor: colors
        }
      ]
    }),
    [labels, data, colors]
  );

  const options = useMemo<ChartOptions<'pie'>>(
    () => ({
      plugins: {
        legend: {
          display: true,
          labels: {
            color: textColor
          }
        },
        datalabels: {
          display: true,
          color: 'white',
          font: { weight: 'bold' as const },
          formatter: (value: number) => value
        }
      }
    }),
    [textColor]
  );

  return (
    <div className="chart-group">
      <h3>{title}</h3>
      <Pie data={chartData} options={options} />
    </div>
  );
}
