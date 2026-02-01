import type { Session } from '../../types';
import { formatNumber } from '../../hooks/useRealTimeStats';

interface SessionListProps {
  sessions: Session[];
  onExport: (session: Session) => void;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatDuration(start: Date, end: Date | null): string {
  if (!end) return 'In progress';

  const diff = end.getTime() - start.getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

export function SessionList({ sessions, onExport }: SessionListProps) {
  if (sessions.length === 0) {
    return (
      <div className="session-list-empty">
        <p>No session history available.</p>
        <p className="session-list-empty-hint">
          Session history will appear here as you use Smart Edit.
        </p>
      </div>
    );
  }

  return (
    <div className="session-list">
      {sessions.map((session) => (
        <div key={session.id} className="session-item">
          <div className="session-item-header">
            <div className="session-item-info">
              <span className="session-item-date">{formatDate(session.startTime)}</span>
              <span className="session-item-time">
                {formatTime(session.startTime)}
                {session.endTime && ` - ${formatTime(session.endTime)}`}
              </span>
            </div>
            <span className="session-item-duration">
              {formatDuration(session.startTime, session.endTime)}
            </span>
          </div>

          {session.projectName && (
            <div className="session-item-project">{session.projectName}</div>
          )}

          <div className="session-item-stats">
            <div className="session-stat">
              <span className="session-stat-label">Calls</span>
              <span className="session-stat-value">{session.stats.totalCalls}</span>
            </div>
            <div className="session-stat">
              <span className="session-stat-label">Input</span>
              <span className="session-stat-value">{formatNumber(session.stats.totalInputTokens)}</span>
            </div>
            <div className="session-stat">
              <span className="session-stat-label">Output</span>
              <span className="session-stat-value">{formatNumber(session.stats.totalOutputTokens)}</span>
            </div>
          </div>

          <div className="session-item-actions">
            <button
              type="button"
              className="session-action-btn"
              onClick={() => onExport(session)}
              title="Export session as JSON"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Export
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
