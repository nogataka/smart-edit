import { useEffect, useRef } from 'react';
import { useDashboardState } from '../context/DashboardContext';
import { LogMessage } from './LogMessage';

export function LogViewer() {
  const { logs, isLoading } = useDashboardState();
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

  if (isLoading && logs.length === 0) {
    return (
      <div className="log-container" ref={containerRef}>
        <div className="loading">Loading logs...</div>
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="log-container" ref={containerRef}>
        <div className="loading">No log messages found.</div>
      </div>
    );
  }

  return (
    <div className="log-container" ref={containerRef}>
      {logs.map((log) => (
        <LogMessage key={log.id} log={log} />
      ))}
    </div>
  );
}
