import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

import { createSmartEditLogger } from './util/logging.js';

const require = createRequire(import.meta.url);
const { version: packageVersion } = require('../../package.json') as { version?: string };

const { logger } = createSmartEditLogger({ name: 'smart-edit.version', emitToConsole: false, level: 'info' });

export function smartEditVersion(): string {
  let version = packageVersion ?? '0.0.0';

  try {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
    if (commit.length > 0) {
      version += `-${commit.slice(0, 8)}`;
    }

    const status = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf-8' }).trim();
    if (status.length > 0) {
      version += '-dirty';
    }
  } catch (error) {
    logger.debug('Failed to read git metadata for version string', error);
  }

  return version;
}
