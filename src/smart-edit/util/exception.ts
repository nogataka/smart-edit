import { existsSync } from 'node:fs';
import os from 'node:os';

import { createSmartEditLogger } from './logging.js';
import type { SmartEditLogger } from './logging.js';

export interface ShowFatalExceptionOptions {
  logger?: SmartEditLogger;
  printToStderr?: boolean;
}

const { logger: consoleLogger } = createSmartEditLogger({ level: 'debug' });

export function evaluateHeadlessEnvironment(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  release: string,
  fileExists: (path: string) => boolean
): boolean {
  if (platform === 'win32') {
    return false;
  }

  if (!env.DISPLAY) {
    return true;
  }

  if (env.SSH_CONNECTION || env.SSH_CLIENT) {
    return true;
  }

  if (env.CI || env.CONTAINER || fileExists('/.dockerenv')) {
    return true;
  }

  if (release.toLowerCase().includes('microsoft')) {
    return true;
  }

  return false;
}

export function isHeadlessEnvironment(): boolean {
  return evaluateHeadlessEnvironment(
    process.env,
    process.platform,
    os.release(),
    existsSync
  );
}

export async function showFatalExceptionSafe(
  error: unknown,
  { logger = consoleLogger, printToStderr = true }: ShowFatalExceptionOptions = {}
): Promise<void> {
  const errorMessage = error instanceof Error ? error.message : String(error);

  logger.error(`Fatal exception: ${errorMessage}`, error);
  if (printToStderr) {
    if (error instanceof Error && error.stack) {
      console.error(`Fatal exception: ${error.message}\n${error.stack}`);
    } else {
      console.error(`Fatal exception: ${errorMessage}`);
    }
  }

  if (isHeadlessEnvironment()) {
    logger.debug('Skipping GUI error display in headless environment');
    return;
  }

  try {
    const { showFatalException } = await import('../gui_log_viewer.js');
    if (typeof showFatalException === 'function') {
      await Promise.resolve(showFatalException(error));
    } else {
      logger.debug('GUI error display is unavailable: showFatalException not implemented');
    }
  } catch (guiError) {
    logger.debug('Failed to show GUI error dialog', guiError);
  }
}
