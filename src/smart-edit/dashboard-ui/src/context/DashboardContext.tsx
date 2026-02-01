import { createContext, useContext, useReducer, type ReactNode } from 'react';
import type { DashboardState, DashboardAction, Theme, Locale, LogFilter } from '../types';

const MAX_LOG_ENTRIES = 1000;

function getStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  const stored = localStorage.getItem('smart-edit-theme');
  if (stored === 'dark' || stored === 'light') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getStoredSidebarState(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem('smart-edit-sidebar-collapsed') === 'true';
}

function getStoredLocale(): Locale {
  if (typeof window === 'undefined') return 'en';
  const stored = localStorage.getItem('smart-edit-locale');
  if (stored === 'ja' || stored === 'en') return stored;
  const browserLang = navigator.language.toLowerCase();
  return browserLang.startsWith('ja') ? 'ja' : 'en';
}

function createDefaultLogFilter(): LogFilter {
  return {
    searchKeyword: '',
    logLevels: new Set(),
    toolNames: new Set()
  };
}

const initialState: DashboardState = {
  logs: [],
  maxLogIdx: -1,
  toolNames: [],
  toolStats: null,
  theme: getStoredTheme(),
  locale: getStoredLocale(),
  isStatsVisible: false,
  connectionMode: 'disconnected',
  activeProject: null,
  error: null,
  isLoading: false,
  // Navigation
  currentView: 'dashboard',
  sidebarCollapsed: getStoredSidebarState(),
  // Log filtering
  logFilter: createDefaultLogFilter(),
  // Sessions
  currentSession: null,
  sessionHistory: []
};

function dashboardReducer(state: DashboardState, action: DashboardAction): DashboardState {
  switch (action.type) {
    case 'SET_LOGS':
      return {
        ...state,
        logs: action.logs.slice(-MAX_LOG_ENTRIES),
        maxLogIdx: action.maxIdx
      };
    case 'APPEND_LOG': {
      const newLogs = [...state.logs, action.log];
      return {
        ...state,
        logs: newLogs.length > MAX_LOG_ENTRIES ? newLogs.slice(-MAX_LOG_ENTRIES) : newLogs,
        maxLogIdx: action.maxIdx
      };
    }
    case 'SET_TOOL_NAMES':
      return { ...state, toolNames: action.toolNames };
    case 'SET_TOOL_STATS':
      return { ...state, toolStats: action.stats };
    case 'SET_THEME':
      localStorage.setItem('smart-edit-theme', action.theme);
      document.documentElement.setAttribute('data-theme', action.theme);
      return { ...state, theme: action.theme };
    case 'SET_LOCALE':
      localStorage.setItem('smart-edit-locale', action.locale);
      return { ...state, locale: action.locale };
    case 'TOGGLE_STATS':
      return { ...state, isStatsVisible: !state.isStatsVisible };
    case 'SET_CONNECTION_MODE':
      return { ...state, connectionMode: action.mode };
    case 'SET_ACTIVE_PROJECT':
      return { ...state, activeProject: action.project };
    case 'SET_ERROR':
      return { ...state, error: action.error };
    case 'SET_LOADING':
      return { ...state, isLoading: action.isLoading };
    case 'CLEAR_LOGS':
      return { ...state, logs: [], maxLogIdx: -1 };
    // Navigation
    case 'SET_CURRENT_VIEW':
      return { ...state, currentView: action.view };
    case 'TOGGLE_SIDEBAR': {
      const newCollapsed = !state.sidebarCollapsed;
      localStorage.setItem('smart-edit-sidebar-collapsed', String(newCollapsed));
      return { ...state, sidebarCollapsed: newCollapsed };
    }
    // Log filtering
    case 'SET_LOG_FILTER':
      return {
        ...state,
        logFilter: { ...state.logFilter, ...action.filter }
      };
    case 'CLEAR_LOG_FILTERS':
      return { ...state, logFilter: createDefaultLogFilter() };
    // Sessions
    case 'START_SESSION':
      return { ...state, currentSession: action.session };
    case 'END_SESSION':
      if (!state.currentSession) return state;
      return {
        ...state,
        sessionHistory: [
          { ...state.currentSession, endTime: new Date() },
          ...state.sessionHistory
        ].slice(0, 50),
        currentSession: null
      };
    case 'LOAD_SESSION_HISTORY':
      return { ...state, sessionHistory: action.sessions };
    case 'CLEAR_SESSION_HISTORY':
      return { ...state, sessionHistory: [] };
    default:
      return state;
  }
}

interface DashboardContextValue {
  state: DashboardState;
  dispatch: React.Dispatch<DashboardAction>;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(dashboardReducer, initialState);

  return (
    <DashboardContext.Provider value={{ state, dispatch }}>
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboard() {
  const context = useContext(DashboardContext);
  if (!context) {
    throw new Error('useDashboard must be used within a DashboardProvider');
  }
  return context;
}

export function useDashboardState() {
  return useDashboard().state;
}

export function useDashboardDispatch() {
  return useDashboard().dispatch;
}
