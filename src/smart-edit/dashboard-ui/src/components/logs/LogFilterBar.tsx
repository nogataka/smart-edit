import { useState } from 'react';
import { useDashboardState, useDashboardDispatch } from '../../context/DashboardContext';
import { useLogStreamActions } from '../../context/LogStreamContext';
import { useTranslation } from '../../i18n';
import { SearchInput } from '../common/SearchInput';
import { Dropdown } from '../common/Dropdown';
import { useAvailableToolNames } from '../../hooks/useLogFilter';
import type { LogLevel } from '../../types';

export function LogFilterBar() {
  const { logs, logFilter } = useDashboardState();
  const dispatch = useDashboardDispatch();
  const { t } = useTranslation();
  const availableToolNames = useAvailableToolNames(logs);
  const { reloadLogs } = useLogStreamActions();
  const [isReloading, setIsReloading] = useState(false);

  const logLevelOptions: { value: LogLevel; label: string }[] = [
    { value: 'debug', label: t('logs.debug') },
    { value: 'info', label: t('logs.info') },
    { value: 'warning', label: t('logs.warning') },
    { value: 'error', label: t('logs.error') }
  ];

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
        placeholder={t('logs.searchPlaceholder')}
        className="log-filter-search"
      />

      <div className="log-filter-dropdowns">
        <Dropdown
          options={logLevelOptions}
          selected={logFilter.logLevels}
          onChange={handleLogLevelChange}
          placeholder={t('logs.logLevel')}
          className="log-filter-level"
        />

        {toolNameOptions.length > 0 && (
          <Dropdown
            options={toolNameOptions}
            selected={logFilter.toolNames}
            onChange={handleToolNameChange}
            placeholder={t('logs.tool')}
            className="log-filter-tool"
          />
        )}

        <button
          type="button"
          className={`icon-btn reload-btn ${isReloading ? 'spinning' : ''}`}
          onClick={handleReload}
          disabled={isReloading}
          title={t('logs.reloadLogs')}
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
          {t('logs.clearFilters')}
        </button>
      )}
    </div>
  );
}
