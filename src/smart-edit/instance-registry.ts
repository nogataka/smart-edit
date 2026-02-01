/**
 * Instance Registry for Multi-Instance Dashboard
 *
 * Manages registration of multiple Smart Edit MCP server instances.
 * Each instance registers itself when starting and unregisters when stopping.
 * The dashboard reads this registry to discover and connect to all running instances.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';

import { SMART_EDIT_MANAGED_DIR_IN_HOME } from './constants.js';
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

const INSTANCES_FILE = path.join(SMART_EDIT_MANAGED_DIR_IN_HOME, 'instances.json');
const LOCK_FILE = path.join(SMART_EDIT_MANAGED_DIR_IN_HOME, 'instances.lock');
const LOCK_TIMEOUT_MS = 5000;
const LOCK_RETRY_INTERVAL_MS = 50;

function ensureDirectoryExists(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function acquireLock(): boolean {
  ensureDirectoryExists(LOCK_FILE);
  const startTime = Date.now();

  while (Date.now() - startTime < LOCK_TIMEOUT_MS) {
    try {
      fs.writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' });
      return true;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'EEXIST') {
        // Lock file exists, check if the process is still alive
        try {
          const lockPid = Number.parseInt(fs.readFileSync(LOCK_FILE, 'utf-8').trim(), 10);
          if (!Number.isNaN(lockPid)) {
            try {
              // Check if process is alive (signal 0 doesn't kill, just checks)
              process.kill(lockPid, 0);
            } catch {
              // Process is dead, remove stale lock
              try {
                fs.unlinkSync(LOCK_FILE);
                continue;
              } catch {
                // Ignore unlink errors
              }
            }
          }
        } catch {
          // Can't read lock file, try to remove it
          try {
            fs.unlinkSync(LOCK_FILE);
            continue;
          } catch {
            // Ignore unlink errors
          }
        }
        // Wait and retry
        const waitTime = Math.min(LOCK_RETRY_INTERVAL_MS, LOCK_TIMEOUT_MS - (Date.now() - startTime));
        if (waitTime > 0) {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitTime);
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
    fs.unlinkSync(LOCK_FILE);
  } catch {
    // Ignore errors when releasing lock
  }
}

function readRegistry(): InstanceRegistryData {
  ensureDirectoryExists(INSTANCES_FILE);
  try {
    if (fs.existsSync(INSTANCES_FILE)) {
      const content = fs.readFileSync(INSTANCES_FILE, 'utf-8');
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
  ensureDirectoryExists(INSTANCES_FILE);
  fs.writeFileSync(INSTANCES_FILE, JSON.stringify(data, null, 2), 'utf-8');
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
 */
export function registerInstance(info: Omit<InstanceInfo, 'id' | 'startedAt'>): InstanceInfo {
  const id = generateInstanceId();
  const instance: InstanceInfo = {
    ...info,
    id,
    startedAt: new Date().toISOString()
  };

  if (!acquireLock()) {
    logger.error('Failed to acquire lock for registering instance');
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
