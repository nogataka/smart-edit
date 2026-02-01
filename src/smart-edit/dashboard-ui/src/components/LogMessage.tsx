import { useMemo } from 'react';
import type { LogMessage as LogMessageType } from '../types';
import { highlightToolNames } from '../utils/escapeHtml';
import { useDashboardState } from '../context/DashboardContext';

interface Props {
  log: LogMessageType;
}

export function LogMessage({ log }: Props) {
  const { toolNames } = useDashboardState();

  const highlightedMessage = useMemo(
    () => highlightToolNames(log.message, toolNames),
    [log.message, toolNames]
  );

  return (
    <div
      className={`log-${log.level}`}
      dangerouslySetInnerHTML={{ __html: highlightedMessage + '\n' }}
    />
  );
}
