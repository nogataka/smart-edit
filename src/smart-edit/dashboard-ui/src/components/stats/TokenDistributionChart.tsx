import { Bar } from 'react-chartjs-2';
import type { ChartOptions } from 'chart.js';
import { useChartTheme } from '../../hooks/useChartTheme';
import type { ToolStatsResponse } from '../../types';

interface TokenDistributionChartProps {
  toolStats: ToolStatsResponse | null;
  maxTools?: number;
}

export function TokenDistributionChart({ toolStats, maxTools = 8 }: TokenDistributionChartProps) {
  const chartColors = useChartTheme();

  if (!toolStats || Object.keys(toolStats).length === 0) {
    return (
      <div className="chart-empty">
        <p>No tool usage data available</p>
      </div>
    );
  }

  const sortedTools = Object.entries(toolStats)
    .map(([name, stats]) => ({
      name,
      inputTokens: stats.input_tokens,
      outputTokens: stats.output_tokens,
      total: stats.input_tokens + stats.output_tokens
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, maxTools);

  const data = {
    labels: sortedTools.map((t) => t.name),
    datasets: [
      {
        label: 'Input Tokens',
        data: sortedTools.map((t) => t.inputTokens),
        backgroundColor: 'rgba(59, 130, 246, 0.8)',
        borderColor: 'rgba(59, 130, 246, 1)',
        borderWidth: 1
      },
      {
        label: 'Output Tokens',
        data: sortedTools.map((t) => t.outputTokens),
        backgroundColor: 'rgba(34, 197, 94, 0.8)',
        borderColor: 'rgba(34, 197, 94, 1)',
        borderWidth: 1
      }
    ]
  };

  const options: ChartOptions<'bar'> = {
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top',
        labels: {
          color: chartColors.textColor,
          font: { size: 11 }
        }
      },
      datalabels: {
        display: false
      },
      tooltip: {
        callbacks: {
          label: (context) => {
            const value = context.parsed.x ?? 0;
            return `${context.dataset.label}: ${value.toLocaleString()}`;
          }
        }
      }
    },
    scales: {
      x: {
        stacked: true,
        grid: { color: chartColors.gridColor },
        ticks: {
          color: chartColors.textColor,
          callback: function (value) {
            const num = typeof value === 'number' ? value : parseFloat(String(value));
            if (num >= 1000) {
              return (num / 1000).toFixed(0) + 'K';
            }
            return num;
          }
        }
      },
      y: {
        stacked: true,
        grid: { display: false },
        ticks: { color: chartColors.textColor }
      }
    }
  };

  return (
    <div className="chart-container" style={{ height: Math.max(200, sortedTools.length * 40) }}>
      <Bar data={data} options={options} />
    </div>
  );
}
