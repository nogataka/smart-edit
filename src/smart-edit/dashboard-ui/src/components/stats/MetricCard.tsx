import type { ReactNode } from 'react';

interface MetricCardProps {
  title: string;
  value: ReactNode;
  subtitle?: string;
  icon?: ReactNode;
  trend?: {
    value: number;
    direction: 'up' | 'down' | 'neutral';
  };
  className?: string;
}

export function MetricCard({ title, value, subtitle, icon, trend, className = '' }: MetricCardProps) {
  return (
    <div className={`metric-card ${className}`}>
      <div className="metric-card-header">
        <span className="metric-card-title">{title}</span>
        {icon && <span className="metric-card-icon">{icon}</span>}
      </div>
      <div className="metric-card-value">{value}</div>
      {(subtitle || trend) && (
        <div className="metric-card-footer">
          {subtitle && <span className="metric-card-subtitle">{subtitle}</span>}
          {trend && (
            <span className={`metric-card-trend ${trend.direction}`}>
              {trend.direction === 'up' && '+'}
              {trend.direction === 'down' && '-'}
              {Math.abs(trend.value)}%
            </span>
          )}
        </div>
      )}
    </div>
  );
}
