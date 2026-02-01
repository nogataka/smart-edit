export interface LogMessage {
  id: number;
  message: string;
  level: 'debug' | 'info' | 'warning' | 'error' | 'default';
}

export interface ToolStats {
  num_times_called: number;
  input_tokens: number;
  output_tokens: number;
}

export type ToolStatsResponse = Record<string, ToolStats>;

export type ConnectionMode = 'streaming' | 'polling' | 'disconnected';

export type Theme = 'light' | 'dark';

export type NavigationView = 'dashboard' | 'logs' | 'stats' | 'sessions';

export type LogLevel = 'debug' | 'info' | 'warning' | 'error' | 'default';

export interface LogFilter {
  searchKeyword: string;
  logLevels: Set<LogLevel>;
  toolNames: Set<string>;
}

export interface Session {
  id: string;
  startTime: Date;
  endTime: Date | null;
  projectName: string | null;
  stats: {
    totalCalls: number;
    totalInputTokens: number;
    totalOutputTokens: number;
  };
  toolStats: ToolStatsResponse | null;
}

export interface DashboardState {
  logs: LogMessage[];
  maxLogIdx: number;
  toolNames: string[];
  toolStats: ToolStatsResponse | null;
  theme: Theme;
  isStatsVisible: boolean;
  connectionMode: ConnectionMode;
  activeProject: string | null;
  error: string | null;
  isLoading: boolean;
  // Navigation
  currentView: NavigationView;
  sidebarCollapsed: boolean;
  // Log filtering
  logFilter: LogFilter;
  // Sessions
  currentSession: Session | null;
  sessionHistory: Session[];
}

export type DashboardAction =
  | { type: 'SET_LOGS'; logs: LogMessage[]; maxIdx: number }
  | { type: 'APPEND_LOG'; log: LogMessage; maxIdx: number }
  | { type: 'SET_TOOL_NAMES'; toolNames: string[] }
  | { type: 'SET_TOOL_STATS'; stats: ToolStatsResponse | null }
  | { type: 'SET_THEME'; theme: Theme }
  | { type: 'TOGGLE_STATS' }
  | { type: 'SET_CONNECTION_MODE'; mode: ConnectionMode }
  | { type: 'SET_ACTIVE_PROJECT'; project: string | null }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'SET_LOADING'; isLoading: boolean }
  | { type: 'CLEAR_LOGS' }
  // Navigation
  | { type: 'SET_CURRENT_VIEW'; view: NavigationView }
  | { type: 'TOGGLE_SIDEBAR' }
  // Log filtering
  | { type: 'SET_LOG_FILTER'; filter: Partial<LogFilter> }
  | { type: 'CLEAR_LOG_FILTERS' }
  // Sessions
  | { type: 'START_SESSION'; session: Session }
  | { type: 'END_SESSION' }
  | { type: 'LOAD_SESSION_HISTORY'; sessions: Session[] }
  | { type: 'CLEAR_SESSION_HISTORY' };
