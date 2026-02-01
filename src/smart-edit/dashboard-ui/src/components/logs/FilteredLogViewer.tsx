import { useEffect, useRef } from 'react';
import { LogMessage } from '../LogMessage';
import type { LogMessage as LogMessageType } from '../../types';

interface FilteredLogViewerProps {
  logs: LogMessageType[];
  isLoading: boolean;
  totalCount: number;
}

export function FilteredLogViewer({ logs, isLoading, totalCount }: FilteredLogViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wasAtBottomRef = useRef(true);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const checkScrollPosition = () => {
      wasAtBottomRef.current =
        container.scrollTop + container.clientHeight >= container.scrollHeight - 10;
    };

    container.addEventListener('scroll', checkScrollPosition);
    return () => container.removeEventListener('scroll', checkScrollPosition);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (container && wasAtBottomRef.current) {
      container.scrollTop = container.scrollHeight;
    }
  }, [logs]);

  const isFiltered = logs.length !== totalCount;

  if (isLoading && totalCount === 0) {
    return (
      <div className="log-container" ref={containerRef}>
        <div className="loading">Loading logs...</div>
      </div>
    );
  }

  if (totalCount === 0) {
    return (
      <div className="log-container" ref={containerRef}>
        <div className="loading">No log messages found.</div>
      </div>
    );
  }

  if (logs.length === 0 && isFiltered) {
    return (
      <div className="log-container" ref={containerRef}>
        <div className="loading">No logs match the current filters.</div>
      </div>
    );
  }

  return (
    <div className="log-container" ref={containerRef}>
      {isFiltered && (
        <div className="filter-stats">
          Showing <span className="filter-stats-count">{logs.length}</span> of{' '}
          <span className="filter-stats-count">{totalCount}</span> logs
        </div>
      )}
      {logs.map((log) => (
        <LogMessage key={log.id} log={log} />
      ))}
    </div>
  );
}
