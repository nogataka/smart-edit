import process from 'node:process';
import type { SpawnOptions, SpawnSyncOptions } from 'node:child_process';

export type PlatformSubprocessOptions = (SpawnOptions | SpawnSyncOptions) & { windowsHide?: boolean };

export function defaultSubprocessOptions(platform: NodeJS.Platform = process.platform): PlatformSubprocessOptions {
  return platform === 'win32' ? { windowsHide: true } : {};
}

export function ensureDefaultSubprocessOptions<T extends PlatformSubprocessOptions>(
  options: T,
  platform: NodeJS.Platform = process.platform
): T {
  const defaults = defaultSubprocessOptions(platform);
  if (defaults.windowsHide && options.windowsHide === undefined) {
    options.windowsHide = defaults.windowsHide;
  }
  return options;
}
