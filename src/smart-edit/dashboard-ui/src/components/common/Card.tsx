import type { CSSProperties, ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function Card({ children, title, subtitle, actions, className = '', style }: CardProps) {
  return (
    <div className={`card ${className}`} style={style}>
      {(title || actions) && (
        <div className="card-header">
          <div>
            {title && <h3 className="card-title">{title}</h3>}
            {subtitle && <p className="card-subtitle">{subtitle}</p>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </div>
      )}
      <div className="card-body">{children}</div>
    </div>
  );
}
