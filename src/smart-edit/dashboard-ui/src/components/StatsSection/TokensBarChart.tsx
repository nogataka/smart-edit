import { useMemo } from 'react';
import { Bar } from 'react-chartjs-2';
import type { ChartOptions } from 'chart.js';
import { useChartTheme } from '../../hooks/useChartTheme';
import { generateColors } from '../../utils/generateColors';

interface Props {
  labels: string[];
  inputTokens: number[];
  outputTokens: number[];
}

export function TokensBarChart({ labels, inputTokens, outputTokens }: Props) {
  const { textColor, gridColor } = useChartTheme();
  const colors = useMemo(() => generateColors(labels.length), [labels.length]);

  const chartData = useMemo(
    () => ({
      labels,
      datasets: [
        {
          label: 'Input Tokens',
          data: inputTokens,
          backgroundColor: colors.map((color) => color + '80'),
          borderColor: colors,
          borderWidth: 2,
          yAxisID: 'y'
        },
        {
          label: 'Output Tokens',
          data: outputTokens,
          backgroundColor: colors,
          yAxisID: 'y1'
        }
      ]
    }),
    [labels, inputTokens, outputTokens, colors]
  );

  const options = useMemo<ChartOptions<'bar'>>(
    () => ({
      responsive: true,
      plugins: {
        legend: {
          labels: {
            color: textColor
          }
        }
      },
      scales: {
        x: {
          ticks: { color: textColor },
          grid: { color: gridColor }
        },
        y: {
          type: 'linear',
          display: true,
          position: 'left',
          beginAtZero: true,
          title: {
            display: true,
            text: 'Input Tokens',
            color: textColor
          },
          ticks: { color: textColor },
          grid: { color: gridColor }
        },
        y1: {
          type: 'linear',
          display: true,
          position: 'right',
          beginAtZero: true,
          title: {
            display: true,
            text: 'Output Tokens',
            color: textColor
          },
          ticks: { color: textColor },
          grid: { drawOnChartArea: false, color: gridColor }
        }
      }
    }),
    [textColor, gridColor]
  );

  return (
    <div className="chart-group chart-wide">
      <h3>Input vs Output Tokens</h3>
      <Bar data={chartData} options={options} height={120} />
    </div>
  );
}
