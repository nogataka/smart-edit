export const en = {
  // Navigation
  nav: {
    dashboard: 'Dashboard',
    logs: 'Logs',
    statistics: 'Statistics',
    sessions: 'Sessions',
    shutdown: 'Shutdown'
  },

  // Connection status
  status: {
    connected: 'Connected',
    polling: 'Polling',
    disconnected: 'Disconnected'
  },

  // Dashboard Overview
  dashboard: {
    welcome: 'Welcome to Smart Edit',
    welcomeWithProject: 'Welcome to {project}',
    description: 'Monitor your coding sessions, view logs, and analyze tool usage statistics.',
    logEntries: 'Log Entries',
    toolCalls: 'Tool Calls',
    totalTokens: 'Total Tokens',
    topTool: 'Top Tool',
    currentSession: 'Current session',
    toolsUsed: '{count} tools used',
    inputOutput: 'Input + Output',
    calls: '{count} calls',
    noData: 'No data',
    quickNavigation: 'Quick Navigation',
    viewLogs: 'View Logs',
    viewLogsDesc: 'Real-time log stream with filtering',
    statisticsDesc: 'Tool usage and token analytics',
    sessionsDesc: 'Session history and export'
  },

  // Statistics Panel
  stats: {
    refresh: 'Refresh',
    loading: 'Loading...',
    clearStats: 'Clear Stats',
    tokenEstimator: 'Token estimator: {name}',
    noStatsYet: 'No tool stats collected yet.',
    noStatsHint: 'Tool statistics will appear here once tools are used during the session.',
    totalCalls: 'Total Calls',
    inputTokens: 'Input Tokens',
    outputTokens: 'Output Tokens',
    totalInput: 'Total input',
    totalOutput: 'Total output',
    mostUsedTool: 'Most Used Tool',
    activityOverTime: 'Activity Over Time',
    noActivityYet: 'No activity recorded yet',
    activityHint: 'Activity will appear here as tools are used',
    clearHistory: 'Clear History',
    tokenDistribution: 'Token Distribution by Tool',
    callDistribution: 'Call Distribution',
    tokenBreakdown: 'Token Breakdown',
    noToolData: 'No tool usage data available'
  },

  // Log Panel
  logs: {
    searchPlaceholder: 'Search logs...',
    logLevel: 'Log Level',
    tool: 'Tool',
    clearFilters: 'Clear Filters',
    reloadLogs: 'Reload logs',
    noLogs: 'No log entries to display.',
    noLogsHint: 'Logs will appear here once the server starts producing output.',
    noMatchingLogs: 'No logs match the current filters.',
    debug: 'Debug',
    info: 'Info',
    warning: 'Warning',
    error: 'Error'
  },

  // Session Panel
  sessions: {
    currentSession: 'Current Session',
    noActiveSession: 'No active session',
    sessionHistory: 'Session History',
    sessionsRecorded: '{count} sessions recorded',
    sessionRecorded: '{count} session recorded',
    noHistory: 'No session history available.',
    noHistoryHint: 'Session history will appear here as you use Smart Edit.',
    exportJson: 'Export JSON',
    exportAll: 'Export All',
    export: 'Export',
    exportSession: 'Export session as JSON',
    clearHistory: 'Clear History',
    started: 'Started',
    ended: 'Ended',
    duration: 'Duration',
    inProgress: 'In progress',
    calls: 'Calls',
    input: 'Input',
    output: 'Output',
    tokens: 'Tokens',
    active: 'Active',
    confirmClearHistory: 'Are you sure you want to clear all session history?'
  },

  // Common
  common: {
    close: 'Close',
    cancel: 'Cancel',
    confirm: 'Confirm',
    loading: 'Loading...',
    error: 'Error',
    success: 'Success'
  },

  // Sidebar
  sidebar: {
    expand: 'Expand sidebar',
    collapse: 'Collapse sidebar',
    shutdownConfirm: 'This will fully terminate the Smart Edit server.',
    project: 'Project',
    noProject: 'No project active',
    instances: 'Projects',
    onboardingCompleted: 'Onboarded',
    onboardingNotCompleted: 'Not onboarded'
  },

  // Onboarding Modal
  onboarding: {
    title: 'Onboarding Information',
    memories: 'Memories',
    noMemories: 'No memories available',
    loading: 'Loading...',
    close: 'Close'
  },

  // Theme
  theme: {
    switchToLight: 'Switch to light mode',
    switchToDark: 'Switch to dark mode'
  }
};
