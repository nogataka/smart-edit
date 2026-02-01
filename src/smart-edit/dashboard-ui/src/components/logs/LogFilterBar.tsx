import { useState } from 'react';
import { useDashboardState, useDashboardDispatch } from '../../context/DashboardContext';
import { useLogStream } from '../../hooks/useLogStream';
import { SearchInput } from '../common/SearchInput';
import { Dropdown } from '../common/Dropdown';
import { useAvailableToolNames } from '../../hooks/useLogFilter';
import type { LogLevel } from '../../types';

const LOG_LEVEL_OPTIONS: { value: LogLevel; label: string }[] = [
  { value: 'debug', label: 'Debug' },
  { value: 'info', label: 'Info' },
  { value: 'warning', label: 'Warning' },
  { value: 'error', label: 'Error' }
];

export function LogFilterBar() {
  const { logs, logFilter } = useDashboardState();
  const dispatch = useDashboardDispatch();
  const availableToolNames = useAvailableToolNames(logs);
  const { reloadLogs } = useLogStream();
  const [isReloading, setIsReloading] = useState(false);

  const toolNameOptions = availableToolNames.map((name) => ({
    value: name,
    label: name
  }));

  const handleSearchChange = (searchKeyword: string) => {
    dispatch({ type: 'SET_LOG_FILTER', filter: { searchKeyword } });
  };

  const handleLogLevelChange = (logLevels: Set<string>) => {
    dispatch({
      type: 'SET_LOG_FILTER',
      filter: { logLevels: logLevels as Set<LogLevel> }
    });
  };

  const handleToolNameChange = (toolNames: Set<string>) => {
    dispatch({ type: 'SET_LOG_FILTER', filter: { toolNames } });
  };

  const handleClearFilters = () => {
    dispatch({ type: 'CLEAR_LOG_FILTERS' });
  };

  const handleReload = async () => {
    setIsReloading(true);
    try {
      await reloadLogs();
    } finally {
      setIsReloading(false);
    }
  };

  const hasActiveFilters =
    logFilter.searchKeyword ||
    logFilter.logLevels.size > 0 ||
    logFilter.toolNames.size > 0;

  return (
    <div className="log-filter-bar">
      <SearchInput
        value={logFilter.searchKeyword}
        onChange={handleSearchChange}
        placeholder="Search logs..."
        className="log-filter-search"
      />

      <div className="log-filter-dropdowns">
        <Dropdown
          options={LOG_LEVEL_OPTIONS}
          selected={logFilter.logLevels}
          onChange={handleLogLevelChange}
          placeholder="Log Level"
          className="log-filter-level"
        />

        {toolNameOptions.length > 0 && (
          <Dropdown
            options={toolNameOptions}
            selected={logFilter.toolNames}
            onChange={handleToolNameChange}
            placeholder="Tool"
            className="log-filter-tool"
          />
        )}

        <button
          type="button"
          className={`icon-btn reload-btn ${isReloading ? 'spinning' : ''}`}
          onClick={handleReload}
          disabled={isReloading}
          title="Reload logs"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
            <path d="M21 3v5h-5" />
          </svg>
        </button>
      </div>

      {hasActiveFilters && (
        <button type="button" className="log-filter-clear btn" onClick={handleClearFilters}>
          Clear Filters
        </button>
      )}
    </div>
  );
}
