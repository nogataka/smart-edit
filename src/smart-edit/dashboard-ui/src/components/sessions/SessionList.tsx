import { useTranslation } from '../../i18n';
import type { Session } from '../../types';
import { formatNumber } from '../../hooks/useRealTimeStats';

interface SessionListProps {
  sessions: Session[];
  onExport: (session: Session) => void;
}

function formatDate(date: Date, locale: string): string {
  return date.toLocaleDateString(locale === 'ja' ? 'ja-JP' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

function formatTime(date: Date, locale: string): string {
  return date.toLocaleTimeString(locale === 'ja' ? 'ja-JP' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatDuration(start: Date, end: Date | null, inProgressText: string): string {
  if (!end) return inProgressText;

  const diff = end.getTime() - start.getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

export function SessionList({ sessions, onExport }: SessionListProps) {
  const { t, locale } = useTranslation();

  if (sessions.length === 0) {
    return (
      <div className="session-list-empty">
        <p>{t('sessions.noHistory')}</p>
        <p className="session-list-empty-hint">{t('sessions.noHistoryHint')}</p>
      </div>
    );
  }

  return (
    <div className="session-list">
      {sessions.map((session) => (
        <div key={session.id} className="session-item">
          <div className="session-item-header">
            <div className="session-item-info">
              <span className="session-item-date">{formatDate(session.startTime, locale)}</span>
              <span className="session-item-time">
                {formatTime(session.startTime, locale)}
                {session.endTime && ` - ${formatTime(session.endTime, locale)}`}
              </span>
            </div>
            <span className="session-item-duration">
              {formatDuration(session.startTime, session.endTime, t('sessions.inProgress'))}
            </span>
          </div>

          {session.projectName && (
            <div className="session-item-project">{session.projectName}</div>
          )}

          <div className="session-item-stats">
            <div className="session-stat">
              <span className="session-stat-label">{t('sessions.calls')}</span>
              <span className="session-stat-value">{session.stats.totalCalls}</span>
            </div>
            <div className="session-stat">
              <span className="session-stat-label">{t('sessions.input')}</span>
              <span className="session-stat-value">{formatNumber(session.stats.totalInputTokens)}</span>
            </div>
            <div className="session-stat">
              <span className="session-stat-label">{t('sessions.output')}</span>
              <span className="session-stat-value">{formatNumber(session.stats.totalOutputTokens)}</span>
            </div>
          </div>

          <div className="session-item-actions">
            <button
              type="button"
              className="session-action-btn"
              onClick={() => onExport(session)}
              title={t('sessions.exportSession')}
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
              {t('sessions.export')}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
