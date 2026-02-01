#!/usr/bin/env node
/* eslint-env node */
import { cp, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const sourceDir = path.join(rootDir, 'src', 'smart-edit', 'resources');
const targetDir = path.join(rootDir, 'dist', 'smart-edit', 'resources');

async function main() {
  try {
    await stat(sourceDir);
  } catch (error) {
    if ((error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
      process.stderr.write('[copy-resources] Source resources directory not found, skipping.\n');
      return;
    }
    throw error;
  }

  await mkdir(path.join(rootDir, 'dist', 'smart-edit'), { recursive: true });
  await cp(sourceDir, targetDir, { recursive: true });
  process.stdout.write('[copy-resources] Copied resource assets to dist/smart-edit/resources.\n');
}

main().catch((error) => {
  process.stderr.write(`[copy-resources] Failed to copy resources: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
