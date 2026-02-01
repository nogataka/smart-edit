import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import type { InstanceInfo } from '../types';

const REFRESH_INTERVAL_MS = 5000; // Refresh instance list every 5 seconds

export interface MultiInstanceState {
  instances: InstanceInfo[];
  activeInstanceId: string | null;
  isLoading: boolean;
  error: string | null;
  isMultiInstanceMode: boolean;
}

export interface MultiInstanceContextValue {
  state: MultiInstanceState;
  setActiveInstance: (instanceId: string | null) => void;
  refreshInstances: () => Promise<void>;
  getActiveInstance: () => InstanceInfo | null;
}

const MultiInstanceContext = createContext<MultiInstanceContextValue | null>(null);

function getStoredActiveInstance(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('smart-edit-active-instance');
}

function storeActiveInstance(instanceId: string | null): void {
  if (typeof window === 'undefined') return;
  if (instanceId) {
    localStorage.setItem('smart-edit-active-instance', instanceId);
  } else {
    localStorage.removeItem('smart-edit-active-instance');
  }
}

/**
 * Detect if we're running in multi-instance mode (standalone dashboard)
 * by checking if the current URL path starts with /dashboard/ on the standalone port
 */
function detectMultiInstanceMode(): boolean {
  if (typeof window === 'undefined') return false;
  // Check if we're on the standalone dashboard by looking at a specific marker
  // The standalone dashboard adds a meta tag or we can check the API
  const params = new URLSearchParams(window.location.search);
  return params.get('multi') === 'true' || window.location.pathname === '/dashboard/';
}

export function MultiInstanceProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MultiInstanceState>({
    instances: [],
    activeInstanceId: getStoredActiveInstance(),
    isLoading: false,
    error: null,
    isMultiInstanceMode: detectMultiInstanceMode()
  });

  const fetchInstances = useCallback(async (): Promise<InstanceInfo[]> => {
    // Try to fetch from standalone dashboard API first
    // Then fall back to the current instance's API
    const baseUrls = [
      '', // Current origin (relative URL)
      `http://127.0.0.1:${window.location.port}` // Current server
    ];

    for (const baseUrl of baseUrls) {
      try {
        const response = await fetch(`${baseUrl}/api/instances`);
        if (response.ok) {
          const data = await response.json() as { instances: InstanceInfo[] };
          return data.instances || [];
        }
      } catch {
        // Try next URL
      }
    }

    return [];
  }, []);

  const refreshInstances = useCallback(async (): Promise<void> => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const instances = await fetchInstances();

      setState(prev => {
        // If active instance is no longer in the list, clear it
        let activeInstanceId = prev.activeInstanceId;
        if (activeInstanceId && !instances.some(i => i.id === activeInstanceId)) {
          activeInstanceId = instances.length > 0 ? instances[0].id : null;
          storeActiveInstance(activeInstanceId);
        }

        // If no active instance but we have instances, select the first one
        if (!activeInstanceId && instances.length > 0) {
          activeInstanceId = instances[0].id;
          storeActiveInstance(activeInstanceId);
        }

        return {
          ...prev,
          instances,
          activeInstanceId,
          isLoading: false,
          isMultiInstanceMode: instances.length > 1 || detectMultiInstanceMode()
        };
      });
    } catch (error) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to fetch instances'
      }));
    }
  }, [fetchInstances]);

  const setActiveInstance = useCallback((instanceId: string | null): void => {
    storeActiveInstance(instanceId);
    setState(prev => ({ ...prev, activeInstanceId: instanceId }));
  }, []);

  const getActiveInstance = useCallback((): InstanceInfo | null => {
    return state.instances.find(i => i.id === state.activeInstanceId) || null;
  }, [state.instances, state.activeInstanceId]);

  // Initial fetch and periodic refresh
  useEffect(() => {
    void refreshInstances();

    const intervalId = setInterval(() => {
      void refreshInstances();
    }, REFRESH_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [refreshInstances]);

  const contextValue: MultiInstanceContextValue = {
    state,
    setActiveInstance,
    refreshInstances,
    getActiveInstance
  };

  return (
    <MultiInstanceContext.Provider value={contextValue}>
      {children}
    </MultiInstanceContext.Provider>
  );
}

export function useMultiInstance(): MultiInstanceContextValue {
  const context = useContext(MultiInstanceContext);
  if (!context) {
    throw new Error('useMultiInstance must be used within a MultiInstanceProvider');
  }
  return context;
}

export function useActiveInstance(): InstanceInfo | null {
  const { getActiveInstance } = useMultiInstance();
  return getActiveInstance();
}

export function useInstances(): InstanceInfo[] {
  const { state } = useMultiInstance();
  return state.instances;
}

export function useIsMultiInstanceMode(): boolean {
  const { state } = useMultiInstance();
  return state.isMultiInstanceMode;
}
