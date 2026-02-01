import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import type { SmartEditLogger } from '../../smart-edit/util/logging.js';
import { ensureDefaultSubprocessOptions } from '../util/subprocess_util.js';

export const RUBY_BINARY_ENV = 'SMART_EDIT_RUBY_BINARY';
export const BUNDLE_BINARY_ENV = 'SMART_EDIT_BUNDLE_BINARY';

const DEFAULT_RUBY_BINARY = process.platform === 'win32' ? 'ruby.exe' : 'ruby';
const DEFAULT_BUNDLE_CANDIDATES = process.platform === 'win32'
  ? ['bundle.bat', 'bundle.cmd', 'bundle.exe', 'bundle']
  : ['bundle'];

export function resolveRubyBinary(): string {
  const raw = process.env[RUBY_BINARY_ENV];
  const trimmed = raw?.trim();
  return trimmed ?? DEFAULT_RUBY_BINARY;
}

export function ensureRubyAvailable(logger: SmartEditLogger, repositoryRootPath: string): void {
  const rubyBinary = resolveRubyBinary();
  const versionResult = spawnSync(
    rubyBinary,
    ['--version'],
    ensureDefaultSubprocessOptions({
      cwd: repositoryRootPath,
      encoding: 'utf-8'
    })
  );

  if (versionResult.error || versionResult.status !== 0) {
    const detailSource =
      versionResult.stderr ??
      versionResult.stdout ??
      versionResult.error?.message ??
      '';
    const detail = detailSource.trim();
    throw new Error(
      `Ruby が見つかりませんでした。${detail ? `詳細: ${detail}。` : ''}Ruby をインストールし PATH に追加してください。`
    );
  }

  const output = (versionResult.stdout || versionResult.stderr || '').trim();
  if (output) {
    logger.info(`検出した Ruby: ${output}`);
  }
}

export function findCommand(command: string): string | null {
  const locator = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(locator, [command], ensureDefaultSubprocessOptions({ encoding: 'utf-8' }));
  if (result.error || result.status !== 0) {
    return null;
  }

  const stdout = result.stdout ?? '';
  const line = stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);
  return line ?? null;
}

export function findBundleExecutable(repositoryRootPath: string): string | null {
  const override = process.env[BUNDLE_BINARY_ENV]?.trim();
  if (override) {
    return override;
  }

  for (const candidate of DEFAULT_BUNDLE_CANDIDATES) {
    const localPath = path.join(repositoryRootPath, 'bin', candidate);
    if (fs.existsSync(localPath)) {
      return localPath;
    }
  }

  for (const candidate of DEFAULT_BUNDLE_CANDIDATES) {
    const resolved = findCommand(candidate);
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

export function gemfileLockContains(gemfileLockPath: string, gemName: string): boolean {
  if (!fs.existsSync(gemfileLockPath)) {
    return false;
  }

  try {
    const content = fs.readFileSync(gemfileLockPath, 'utf-8');
    return content.toLowerCase().includes(gemName.toLowerCase());
  } catch {
    return false;
  }
}

export function installGem(gemName: string, logger: SmartEditLogger, repositoryRootPath: string): void {
  if (process.env.SMART_EDIT_SKIP_RUNTIME_INSTALL === '1') {
    throw new Error(
      `${gemName} が見つかりません。SMART_EDIT_SKIP_RUNTIME_INSTALL=1 を解除するか、` +
        `gem install ${gemName} を手動で実行してください。`
    );
  }

  logger.info(`gem install ${gemName} を試行します`);
  const installResult = spawnSync(
    'gem',
    ['install', gemName],
    ensureDefaultSubprocessOptions({
      cwd: repositoryRootPath,
      encoding: 'utf-8'
    })
  );

  if (installResult.error || installResult.status !== 0) {
    const detail = `${installResult.stdout ?? ''}${installResult.stderr ?? ''}`.trim();
    throw new Error(
      `gem install ${gemName} に失敗しました。${detail ? `詳細: ${detail}` : 'gem が利用可能か確認してください。'}`
    );
  }

  logger.info(`gem install ${gemName} が成功しました。`);
}

export function buildRubyExcludePatterns(repositoryRootPath: string): string[] {
  const basePatterns = [
    '**/vendor/**',
    '**/.bundle/**',
    '**/tmp/**',
    '**/log/**',
    '**/coverage/**',
    '**/.yardoc/**',
    '**/doc/**',
    '**/.git/**',
    '**/node_modules/**',
    '**/public/assets/**'
  ];

  if (isRailsProject(repositoryRootPath)) {
    basePatterns.push(
      '**/app/assets/builds/**',
      '**/storage/**',
      '**/public/packs/**',
      '**/public/webpack/**'
    );
  }

  return basePatterns;
}

function isRailsProject(repositoryRootPath: string): boolean {
  const indicators = [
    path.join('config', 'application.rb'),
    path.join('config', 'environment.rb'),
    path.join('app', 'controllers', 'application_controller.rb'),
    'Rakefile'
  ];

  for (const relative of indicators) {
    if (fs.existsSync(path.join(repositoryRootPath, relative))) {
      return true;
    }
  }

  const gemfilePath = path.join(repositoryRootPath, 'Gemfile');
  if (!fs.existsSync(gemfilePath)) {
    return false;
  }

  try {
    const content = fs.readFileSync(gemfilePath, 'utf-8').toLowerCase();
    return content.includes("gem 'rails'") || content.includes('gem "rails"');
  } catch {
    return false;
  }
}
