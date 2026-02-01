import { useCallback } from 'react';
import { useSessionStorage } from '../../hooks/useSessionStorage';
import { useTranslation } from '../../i18n';
import { SessionList } from './SessionList';
import { ExportButton } from './ExportButton';
import { Card } from '../common/Card';
import type { Session } from '../../types';

function downloadJson(data: string, filename: string) {
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}

export function SessionPanel() {
  const { sessionHistory, clearHistory, exportSession, exportAllSessions } = useSessionStorage();
  const { t } = useTranslation();

  const handleExportSession = useCallback(
    (session: Session) => {
      const data = exportSession(session);
      const date = session.startTime.toISOString().split('T')[0];
      downloadJson(data, `smart-edit-session-${date}.json`);
    },
    [exportSession]
  );

  const handleExportAll = useCallback(() => {
    return exportAllSessions();
  }, [exportAllSessions]);

  const sessionCountText =
    sessionHistory.length === 1
      ? t('sessions.sessionRecorded', { count: String(sessionHistory.length) })
      : t('sessions.sessionsRecorded', { count: String(sessionHistory.length) });

  return (
    <div className="session-panel">
      <Card>
        <div className="session-panel-header">
          <div>
            <h3 className="session-panel-title">{t('sessions.sessionHistory')}</h3>
            <p className="session-panel-subtitle">{sessionCountText}</p>
          </div>
          <div className="session-panel-actions">
            {sessionHistory.length > 0 && (
              <>
                <ExportButton
                  getData={handleExportAll}
                  filename={`smart-edit-sessions-${new Date().toISOString().split('T')[0]}.json`}
                  label={t('sessions.exportAll')}
                />
                <button type="button" className="btn btn-danger" onClick={clearHistory}>
                  {t('sessions.clearHistory')}
                </button>
              </>
            )}
          </div>
        </div>

        <SessionList sessions={sessionHistory} onExport={handleExportSession} />
      </Card>
    </div>
  );
}
