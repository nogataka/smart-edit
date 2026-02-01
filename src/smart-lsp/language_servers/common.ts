import type { Buffer } from 'node:buffer';
import { spawnSync, type SpawnSyncOptions, type SpawnSyncReturns } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { URL } from 'node:url';
import { gunzipSync } from 'node:zlib';

import AdmZip from 'adm-zip';
import * as tar from 'tar';

import type { SmartEditLogger } from '../../smart-edit/util/logging.js';
import { ensureDefaultSubprocessOptions } from '../util/subprocess_util.js';

export interface RuntimeDependency {
  id: string;
  platformId?: PlatformId | 'any' | 'platform-agnostic' | null;
  url?: string | null;
  archiveType?: string | null;
  binaryName?: string | null;
  command?: string | string[] | null;
  packageName?: string | null;
  packageVersion?: string | null;
  extractPath?: string | null;
  description?: string | null;
}

export type RuntimeDependencyOverride = RuntimeDependency;

export type PlatformId =
  | 'win-x86'
  | 'win-x64'
  | 'win-arm64'
  | 'osx'
  | 'osx-x64'
  | 'osx-arm64'
  | 'linux-x86'
  | 'linux-x64'
  | 'linux-arm64'
  | 'linux-musl-x64'
  | 'linux-musl-arm64';

function determinePlatformId(): PlatformId {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'win32') {
    if (arch === 'x64' || arch === 'arm64') {
      return arch === 'x64' ? 'win-x64' : 'win-arm64';
    }
    return 'win-x86';
  }

  if (platform === 'darwin') {
    return arch === 'arm64' ? 'osx-arm64' : 'osx-x64';
  }

  if (platform === 'linux') {
    const libc = os.type().toLowerCase().includes('musl') ? 'musl' : 'glibc';
    if (arch === 'arm64') {
      return libc === 'musl' ? 'linux-musl-arm64' : 'linux-arm64';
    }
    if (arch === 'x64') {
      return libc === 'musl' ? 'linux-musl-x64' : 'linux-x64';
    }
    return 'linux-x86';
  }

  throw new Error(`Unsupported platform: platform=${platform}, arch=${arch}`);
}

function currentPlatformId(): PlatformId {
  return determinePlatformId();
}

function normalizeCommand(command: string | string[]): { cmd: string; args: string[]; shell: boolean } {
  if (Array.isArray(command)) {
    const [cmd, ...args] = command;
    if (!cmd) {
      throw new Error('Runtime dependency command must not be empty.');
    }
    return { cmd, args, shell: false };
  }
  return { cmd: command, args: [], shell: true };
}

export type CommandRunner = (command: string, args: string[], options: SpawnSyncOptions) => SpawnSyncReturns<string | Buffer>;

export class RuntimeDependencyCollection {
  private readonly byKey: Map<string, RuntimeDependency> = new Map<string, RuntimeDependency>();
  private readonly commandRunner: CommandRunner;

  constructor(
    dependencies: RuntimeDependency[],
    overrides: RuntimeDependencyOverride[] = [],
    options: { runCommand?: CommandRunner } = {}
  ) {
    for (const dep of dependencies) {
      const key = this.makeKey(dep.id, dep.platformId ?? null);
      if (this.byKey.has(key)) {
        throw new Error(`Duplicate runtime dependency: id=${dep.id}, platform=${dep.platformId ?? 'default'}`);
      }
      this.byKey.set(key, dep);
    }

    for (const override of overrides) {
      const key = this.makeKey(override.id, override.platformId ?? null);
      const existing = this.byKey.get(key);
      if (existing) {
        this.byKey.set(key, { ...existing, ...override });
      } else {
        this.byKey.set(key, override);
      }
    }

    this.commandRunner =
      options.runCommand ??
      ((command, args, opt) => {
        const baseOptions: SpawnSyncOptions = opt ? { ...opt } : {};
        const spawnOptions = ensureDefaultSubprocessOptions(baseOptions);
        return spawnSync(command, args, spawnOptions);
      });
  }

  getDependenciesForPlatform(platformId: PlatformId): RuntimeDependency[] {
    return Array.from(this.byKey.values()).filter((dep) => {
      const target = dep.platformId ?? null;
      return target === null || target === 'any' || target === 'platform-agnostic' || target === platformId;
    });
  }

  getDependenciesForCurrentPlatform(): RuntimeDependency[] {
    return this.getDependenciesForPlatform(currentPlatformId());
  }

  getSingleDepForCurrentPlatform(dependencyId?: string | null): RuntimeDependency {
    let deps = this.getDependenciesForCurrentPlatform();
    if (dependencyId) {
      deps = deps.filter((dep) => dep.id === dependencyId);
    }
    if (deps.length !== 1) {
      throw new Error(
        `Expected exactly one runtime dependency (platform=${currentPlatformId()}, dependencyId=${dependencyId ?? 'any'}), found ${deps.length}.`
      );
    }
    return deps[0];
  }

  binaryPath(targetDir: string): string {
    const dep = this.getSingleDepForCurrentPlatform();
    if (!dep.binaryName) {
      return targetDir;
    }
    return path.join(targetDir, dep.binaryName);
  }

  install(logger: SmartEditLogger, targetDir: string): Record<string, string> {
    fs.mkdirSync(targetDir, { recursive: true });
    const results: Record<string, string> = {};
    for (const dep of this.getDependenciesForCurrentPlatform()) {
      if (dep.url) {
        this.installFromUrl(dep, logger, targetDir);
      }

      if (dep.command) {
        this.runCommand(dep, targetDir, logger);
      }

      const key = dep.id;
      const binaryPath = dep.binaryName ? path.join(targetDir, dep.binaryName) : targetDir;
      results[key] = binaryPath;
    }
    return results;
  }

  private runCommand(dep: RuntimeDependency, cwd: string, logger: SmartEditLogger): void {
    const command = dep.command;
    if (!command) {
      return;
    }
    const { cmd, args, shell } = normalizeCommand(command);
    const options: SpawnSyncOptions = ensureDefaultSubprocessOptions({
      cwd,
      shell,
      stdio: 'inherit'
    });

    logger.info(`Installing dependency ${dep.id} via ${Array.isArray(command) ? command.join(' ') : command}`);
    const result = this.commandRunner(cmd, args, options);
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      throw new Error(`Command for dependency ${dep.id} exited with status ${result.status ?? 'unknown'}.`);
    }
  }

  private makeKey(id: string, platformId: string | null): string {
    return `${id}::${platformId ?? 'default'}`;
  }

  private installFromUrl(dep: RuntimeDependency, logger: SmartEditLogger, targetDir: string): void {
    if (!dep.url) {
      return;
    }

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-edit-runtime-'));
    const downloadPath = path.join(tempRoot, inferFilenameFromUrl(dep));
    try {
      this.downloadArchive(dep, downloadPath, logger);
      this.extractArchive(dep, downloadPath, targetDir, logger);
    } finally {
      try {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      } catch {
        // best effort cleanup
      }
    }
  }

  private downloadArchive(dep: RuntimeDependency, destination: string, logger: SmartEditLogger): void {
    logger.info(`Downloading runtime dependency ${dep.id} from ${dep.url}`);
    fs.mkdirSync(path.dirname(destination), { recursive: true });

    const commonOptions: SpawnSyncOptions = {
      cwd: path.dirname(destination),
      stdio: 'inherit'
    };

    const run = (command: string, args: string[]): SpawnSyncReturns<string | Buffer> =>
      this.commandRunner(command, args, commonOptions);

    const url = dep.url!;
    const curlArgs = ['-L', url, '-o', destination];
    const curlResult = run('curl', curlArgs);
    if (curlResult.status === 0) {
      return;
    }

    if (process.platform !== 'win32') {
      const wgetResult = run('wget', ['-O', destination, url]);
      if (wgetResult.status === 0) {
        return;
      }
    } else {
      const psArgs = [
        '-NoLogo',
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `Invoke-WebRequest -Uri ${JSON.stringify(url)} -OutFile ${JSON.stringify(destination)} -UseBasicParsing`
      ];
      const psResult = run('powershell', psArgs);
      if (psResult.status === 0) {
        return;
      }
    }

    throw new Error(
      `Failed to download runtime dependency ${dep.id}. Ensure curl, wget, or PowerShell is available in PATH.`
    );
  }

  private extractArchive(dep: RuntimeDependency, archivePath: string, targetDir: string, logger: SmartEditLogger): void {
    const archiveType = normalizeArchiveType(dep.archiveType, archivePath);
    fs.mkdirSync(targetDir, { recursive: true });

    switch (archiveType) {
      case null:
        copyFileToTarget(archivePath, targetDir, dep.binaryName);
        break;
      case 'gz':
        this.extractGz(archivePath, targetDir, dep);
        break;
      case 'zip':
        extractZipArchive(archivePath, targetDir, logger);
        break;
      case 'tar':
        extractTarArchive(archivePath, targetDir, logger);
        break;
      case 'zip.gz': {
        const buffer = gunzipSync(fs.readFileSync(archivePath));
        const tmpZipPath = `${archivePath}.unzipped.zip`;
        fs.writeFileSync(tmpZipPath, buffer);
        try {
          extractZipArchive(tmpZipPath, targetDir, logger);
        } finally {
          fs.rmSync(tmpZipPath, { force: true });
        }
        break;
      }
      default: {
        const rawType = dep.archiveType ?? 'unknown';
        throw new Error(`Unsupported archive type '${rawType}' for dependency ${dep.id}.`);
      }
    }
  }

  private extractGz(archivePath: string, targetDir: string, dep: RuntimeDependency): void {
    if (!dep.binaryName) {
      throw new Error(`Dependency ${dep.id} with archiveType=gz must set binaryName.`);
    }
    const outputPath = path.join(targetDir, dep.binaryName);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const data = gunzipSync(fs.readFileSync(archivePath));
    fs.writeFileSync(outputPath, data);
    trySetExecutable(outputPath);
  }
}

function inferFilenameFromUrl(dep: RuntimeDependency): string {
  if (!dep.url) {
    return `${dep.id}.download`;
  }
  try {
    const parsed = new URL(dep.url);
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length > 0) {
      return segments[segments.length - 1];
    }
  } catch {
    // ignore invalid URLs
  }
  return `${dep.id}.download`;
}

function normalizeArchiveType(rawType: string | null | undefined, archivePath: string): 'gz' | 'zip' | 'tar' | 'zip.gz' | null {
  if (rawType) {
    const lowered = rawType.toLowerCase();
    if (['zip', 'vsix', 'nupkg'].includes(lowered)) {
      return 'zip';
    }
    if (['gz'].includes(lowered)) {
      return 'gz';
    }
    if (['zip.gz'].includes(lowered)) {
      return 'zip.gz';
    }
    if (['tar', 'gztar', 'bztar', 'xztar', 'tar.gz', 'tar.bz2', 'tar.xz', 'tgz'].includes(lowered)) {
      return 'tar';
    }
  }

  const loweredPath = archivePath.toLowerCase();
  if (loweredPath.endsWith('.zip')) {
    return 'zip';
  }
  if (loweredPath.endsWith('.tar.gz') || loweredPath.endsWith('.tgz') || loweredPath.endsWith('.tar.bz2') || loweredPath.endsWith('.tar.xz') || loweredPath.endsWith('.tar')) {
    return 'tar';
  }
  if (loweredPath.endsWith('.zip.gz')) {
    return 'zip.gz';
  }
  if (loweredPath.endsWith('.gz')) {
    return 'gz';
  }
  return null;
}

function extractZipArchive(archivePath: string, targetDir: string, logger: SmartEditLogger): void {
  logger.info(`Extracting ZIP archive ${archivePath} into ${targetDir}`);
  const zip = new AdmZip(archivePath);
  const entries = zip.getEntries();
  for (const entry of entries) {
    const entryPath = path.join(targetDir, entry.entryName);
    if (entry.isDirectory) {
      fs.mkdirSync(entryPath, { recursive: true });
      continue;
    }

    fs.mkdirSync(path.dirname(entryPath), { recursive: true });
    fs.writeFileSync(entryPath, entry.getData());
    trySetExecutable(entryPath, entry);
  }
}

function extractTarArchive(archivePath: string, targetDir: string, logger: SmartEditLogger): void {
  logger.info(`Extracting TAR archive ${archivePath} into ${targetDir}`);
  try {
    tar.x({ file: archivePath, cwd: targetDir, sync: true, strict: true });
  } catch (error) {
    logger.warn(`tar.x failed for ${archivePath}: ${String(error)}. Falling back to system tar command.`);
    const result = spawnSync(
      'tar',
      ['-xf', archivePath, '-C', targetDir],
      ensureDefaultSubprocessOptions({ stdio: 'inherit' })
    );
    if (result.error || result.status !== 0) {
      throw new Error(`Failed to extract TAR archive ${archivePath}: ${result.error ?? `exit code ${result.status}`}`);
    }
  }
}

function copyFileToTarget(sourcePath: string, targetDir: string, binaryName: string | null | undefined): void {
  const destination = binaryName ? path.join(targetDir, binaryName) : path.join(targetDir, path.basename(sourcePath));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(sourcePath, destination);
  trySetExecutable(destination);
}

function trySetExecutable(filePath: string, zipEntry?: AdmZip.IZipEntry): void {
  if (process.platform === 'win32') {
    return;
  }

  const attr = zipEntry?.header?.attr;
  if (attr != null) {
    const mode = (attr >>> 16) & 0o777;
    if (mode) {
      try {
        fs.chmodSync(filePath, mode);
        return;
      } catch {
        // ignore chmod errors
      }
    }
  }

  try {
    const stats = fs.statSync(filePath);
    if ((stats.mode & 0o111) === 0) {
      fs.chmodSync(filePath, stats.mode | 0o555);
    }
  } catch {
    // ignore chmod errors
  }
}

export function quoteWindowsPath(inputPath: string): string {
  if (process.platform !== 'win32') {
    return inputPath;
  }
  if (inputPath.startsWith('"') && inputPath.endsWith('"')) {
    return inputPath;
  }
  return `"${inputPath}"`;
}

export const Platform = {
  current(): PlatformId {
    return currentPlatformId();
  },
  isWindows(): boolean {
    return process.platform === 'win32';
  }
} as const;
