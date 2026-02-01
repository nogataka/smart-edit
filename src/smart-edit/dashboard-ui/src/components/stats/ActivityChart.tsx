import { Line } from 'react-chartjs-2';
import type { ChartOptions } from 'chart.js';
import { useChartTheme } from '../../hooks/useChartTheme';
import type { ActivityPoint } from '../../hooks/useActivityHistory';

interface ActivityChartProps {
  history: ActivityPoint[];
  onClear?: () => void;
}

export function ActivityChart({ history, onClear }: ActivityChartProps) {
  const chartColors = useChartTheme();

  if (history.length === 0) {
    return (
      <div className="chart-empty">
        <p>No activity recorded yet</p>
        <p className="chart-empty-hint">Activity will appear here as tools are used</p>
      </div>
    );
  }

  const data = {
    labels: history.map((p) => p.label),
    datasets: [
      {
        label: 'Calls',
        data: history.map((p) => p.calls),
        borderColor: 'rgba(139, 92, 246, 1)',
        backgroundColor: 'rgba(139, 92, 246, 0.1)',
        fill: true,
        tension: 0.3,
        yAxisID: 'y'
      },
      {
        label: 'Input Tokens',
        data: history.map((p) => p.inputTokens),
        borderColor: 'rgba(59, 130, 246, 1)',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        fill: false,
        tension: 0.3,
        yAxisID: 'y1'
      },
      {
        label: 'Output Tokens',
        data: history.map((p) => p.outputTokens),
        borderColor: 'rgba(34, 197, 94, 1)',
        backgroundColor: 'rgba(34, 197, 94, 0.1)',
        fill: false,
        tension: 0.3,
        yAxisID: 'y1'
      }
    ]
  };

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index',
      intersect: false
    },
    plugins: {
      legend: {
        position: 'top',
        labels: {
          color: chartColors.textColor,
          font: { size: 11 },
          usePointStyle: true,
          pointStyle: 'circle'
        }
      },
      datalabels: {
        display: false
      },
      tooltip: {
        callbacks: {
          label: (context) => {
            const value = context.parsed.y ?? 0;
            const label = context.dataset.label || '';
            if (label === 'Calls') {
              return `${label}: ${value}`;
            }
            return `${label}: ${value.toLocaleString()}`;
          }
        }
      }
    },
    scales: {
      x: {
        grid: { color: chartColors.gridColor },
        ticks: {
          color: chartColors.textColor,
          maxRotation: 45,
          minRotation: 0,
          autoSkip: true,
          maxTicksLimit: 10
        }
      },
      y: {
        type: 'linear',
        display: true,
        position: 'left',
        title: {
          display: true,
          text: 'Calls',
          color: chartColors.textColor
        },
        grid: { color: chartColors.gridColor },
        ticks: {
          color: chartColors.textColor,
          stepSize: 1
        },
        min: 0
      },
      y1: {
        type: 'linear',
        display: true,
        position: 'right',
        title: {
          display: true,
          text: 'Tokens',
          color: chartColors.textColor
        },
        grid: { drawOnChartArea: false },
        ticks: {
          color: chartColors.textColor,
          callback: function (value) {
            const num = typeof value === 'number' ? value : parseFloat(String(value));
            if (num >= 1000) {
              return (num / 1000).toFixed(0) + 'K';
            }
            return num;
          }
        },
        min: 0
      }
    }
  };

  return (
    <div className="activity-chart-wrapper">
      <div className="chart-container" style={{ height: 280 }}>
        <Line data={data} options={options} />
      </div>
      {onClear && history.length > 0 && (
        <div className="chart-actions">
          <button className="btn btn-sm" onClick={onClear}>
            Clear History
          </button>
        </div>
      )}
    </div>
  );
}
