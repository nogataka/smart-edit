/**
 * Instance Registry for Multi-Instance Dashboard
 *
 * Manages registration of multiple Smart Edit MCP server instances.
 * Each instance registers itself when starting and unregisters when stopping.
 * The dashboard reads this registry to discover and connect to all running instances.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';

import { SMART_EDIT_MANAGED_DIR_NAME } from './constants.js';
import { createSmartEditLogger } from './util/logging.js';

const { logger } = createSmartEditLogger({ name: 'smart-edit.instance-registry', emitToConsole: false, level: 'info' });

export const DEFAULT_DASHBOARD_PORT = 0x5eda; // 24282

export interface InstanceInfo {
  id: string;
  port: number;
  project: string | null;
  pid: number;
  startedAt: string;
  transport: 'stdio' | 'sse' | 'streamable-http';
}

interface InstanceRegistryData {
  instances: InstanceInfo[];
}

// Compute paths dynamically to respect runtime HOME changes (important for testing)
function getSmartEditDir(): string {
  return path.join(os.homedir(), SMART_EDIT_MANAGED_DIR_NAME);
}

function getInstancesFilePath(): string {
  return path.join(getSmartEditDir(), 'instances.json');
}

function getLockFilePath(): string {
  return path.join(getSmartEditDir(), 'instances.lock');
}

const LOCK_TIMEOUT_MS = 5000;
const LOCK_RETRY_INTERVAL_MS = 50;

function ensureDirectoryExists(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function acquireLock(): boolean {
  const lockFile = getLockFilePath();
  ensureDirectoryExists(lockFile);
  const startTime = Date.now();

  while (Date.now() - startTime < LOCK_TIMEOUT_MS) {
    try {
      fs.writeFileSync(lockFile, String(process.pid), { flag: 'wx' });
      return true;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'EEXIST') {
        // Lock file exists, check if the process is still alive
        try {
          const lockPid = Number.parseInt(fs.readFileSync(lockFile, 'utf-8').trim(), 10);
          if (!Number.isNaN(lockPid)) {
            try {
              // Check if process is alive (signal 0 doesn't kill, just checks)
              process.kill(lockPid, 0);
            } catch {
              // Process is dead, remove stale lock
              try {
                fs.unlinkSync(lockFile);
                continue;
              } catch {
                // Ignore unlink errors
              }
            }
          }
        } catch {
          // Can't read lock file, try to remove it
          try {
            fs.unlinkSync(lockFile);
            continue;
          } catch {
            // Ignore unlink errors
          }
        }
        // Brief busy-wait before retry (Atomics.wait requires SharedArrayBuffer which may not be available)
        const waitUntil = Date.now() + Math.min(LOCK_RETRY_INTERVAL_MS, LOCK_TIMEOUT_MS - (Date.now() - startTime));
        while (Date.now() < waitUntil) {
          // Busy wait - this is acceptable since lock contention should be rare
        }
        continue;
      }
      throw error;
    }
  }

  logger.warn('Failed to acquire lock for instance registry');
  return false;
}

function releaseLock(): void {
  try {
    fs.unlinkSync(getLockFilePath());
  } catch {
    // Ignore errors when releasing lock
  }
}

function readRegistry(): InstanceRegistryData {
  const instancesFile = getInstancesFilePath();
  ensureDirectoryExists(instancesFile);
  try {
    if (fs.existsSync(instancesFile)) {
      const content = fs.readFileSync(instancesFile, 'utf-8');
      const data = JSON.parse(content) as unknown;
      if (data && typeof data === 'object' && Array.isArray((data as InstanceRegistryData).instances)) {
        return data as InstanceRegistryData;
      }
    }
  } catch (error) {
    logger.warn('Failed to read instance registry, starting fresh', error instanceof Error ? error : undefined);
  }
  return { instances: [] };
}

function writeRegistry(data: InstanceRegistryData): void {
  const instancesFile = getInstancesFilePath();
  ensureDirectoryExists(instancesFile);
  fs.writeFileSync(instancesFile, JSON.stringify(data, null, 2), 'utf-8');
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function cleanupDeadInstances(data: InstanceRegistryData): InstanceRegistryData {
  const aliveInstances = data.instances.filter((instance) => isProcessAlive(instance.pid));
  if (aliveInstances.length !== data.instances.length) {
    logger.info(`Cleaned up ${data.instances.length - aliveInstances.length} dead instance(s) from registry`);
  }
  return { instances: aliveInstances };
}

export function generateInstanceId(): string {
  return crypto.randomBytes(6).toString('hex');
}

/**
 * Register a new MCP server instance in the registry.
 * This function is designed to be non-fatal - if registration fails, the instance
 * will still work, just won't be visible in the multi-instance dashboard.
 */
export function registerInstance(info: Omit<InstanceInfo, 'id' | 'startedAt'>): InstanceInfo {
  const id = generateInstanceId();
  const instance: InstanceInfo = {
    ...info,
    id,
    startedAt: new Date().toISOString()
  };

  try {
    if (!acquireLock()) {
      logger.warn('Failed to acquire lock for registering instance, continuing without registration');
      return instance;
    }

    try {
      let data = readRegistry();
      data = cleanupDeadInstances(data);

      // Check for duplicate port (shouldn't happen, but just in case)
      const existingIndex = data.instances.findIndex((i) => i.port === info.port);
      if (existingIndex !== -1) {
        data.instances.splice(existingIndex, 1);
      }

      data.instances.push(instance);
      writeRegistry(data);
      logger.info(`Registered instance ${id} on port ${info.port} for project: ${info.project ?? '(none)'}`);
    } finally {
      releaseLock();
    }
  } catch (error) {
    logger.warn('Failed to register instance in registry', error instanceof Error ? error : undefined);
  }

  return instance;
}

/**
 * Unregister an MCP server instance from the registry.
 */
export function unregisterInstance(instanceId: string): void {
  if (!acquireLock()) {
    logger.error('Failed to acquire lock for unregistering instance');
    return;
  }

  try {
    const data = readRegistry();
    const index = data.instances.findIndex((i) => i.id === instanceId);
    if (index !== -1) {
      const removed = data.instances.splice(index, 1)[0];
      writeRegistry(data);
      logger.info(`Unregistered instance ${instanceId} (port: ${removed.port})`);
    }
  } finally {
    releaseLock();
  }
}

/**
 * Get all registered instances (with cleanup of dead processes).
 */
export function getInstances(): InstanceInfo[] {
  if (!acquireLock()) {
    // Even if we can't acquire lock, try to read
    const data = readRegistry();
    return data.instances.filter((instance) => isProcessAlive(instance.pid));
  }

  try {
    let data = readRegistry();
    data = cleanupDeadInstances(data);
    writeRegistry(data);
    return data.instances;
  } finally {
    releaseLock();
  }
}

/**
 * Get a specific instance by ID.
 */
export function getInstance(instanceId: string): InstanceInfo | null {
  const instances = getInstances();
  return instances.find((i) => i.id === instanceId) ?? null;
}

/**
 * Find an available port for the dashboard, starting from the default port.
 */
export function findAvailablePort(startPort: number = DEFAULT_DASHBOARD_PORT): number {
  const instances = getInstances();
  const usedPorts = new Set(instances.map((i) => i.port));

  let port = startPort;
  while (usedPorts.has(port) && port <= 65535) {
    port++;
  }

  return port;
}

/**
 * Update instance info (e.g., when project changes).
 */
export function updateInstance(instanceId: string, updates: Partial<Pick<InstanceInfo, 'project'>>): void {
  if (!acquireLock()) {
    logger.error('Failed to acquire lock for updating instance');
    return;
  }

  try {
    const data = readRegistry();
    const instance = data.instances.find((i) => i.id === instanceId);
    if (instance) {
      if (updates.project !== undefined) {
        instance.project = updates.project;
      }
      writeRegistry(data);
      logger.info(`Updated instance ${instanceId}`);
    }
  } finally {
    releaseLock();
  }
}
