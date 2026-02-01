import { useDashboardState } from '../../context/DashboardContext';
import { useLogFilter } from '../../hooks/useLogFilter';
import { LogFilterBar } from './LogFilterBar';
import { FilteredLogViewer } from './FilteredLogViewer';
import { ErrorContainer } from '../ErrorContainer';
import { Card } from '../common/Card';

export function LogPanel() {
  const { logs, logFilter, isLoading } = useDashboardState();
  const filteredLogs = useLogFilter(logs, logFilter);

  return (
    <div className="log-panel">
      <ErrorContainer />
      <Card className="log-card" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div className="log-panel-header">
          <LogFilterBar />
        </div>
        <div className="log-panel-content">
          <FilteredLogViewer logs={filteredLogs} isLoading={isLoading} totalCount={logs.length} />
        </div>
      </Card>
    </div>
  );
}
