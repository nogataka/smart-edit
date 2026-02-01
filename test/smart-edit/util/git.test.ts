import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

import { afterAll, describe, expect, it } from 'vitest';

import { getGitStatus } from '../../../src/smart-edit/util/git.js';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-edit-git-test-'));

afterAll(async () => {
  await fs.promises.rm(tempRoot, { recursive: true, force: true });
});

describe('getGitStatus', () => {
  it('returns commit hash and clean flags for a pristine repository', async () => {
    const repoPath = await setupRepository();
    const expectedCommit = await runGit(['rev-parse', 'HEAD'], repoPath);

    const status = await getGitStatus({ cwd: repoPath });

    expect(status).not.toBeNull();
    expect(status?.commit).toBe(expectedCommit);
    expect(status?.hasUnstagedChanges).toBe(false);
    expect(status?.hasStagedUncommittedChanges).toBe(false);
    expect(status?.hasUntrackedFiles).toBe(false);
  });

  it('detects unstaged modifications', async () => {
    const repoPath = await setupRepository();
    const trackedFile = path.join(repoPath, 'README.md');
    await fs.promises.appendFile(trackedFile, '\nExtra line');

    const status = await getGitStatus({ cwd: repoPath });

    expect(status).not.toBeNull();
    expect(status?.hasUnstagedChanges).toBe(true);
    expect(status?.hasStagedUncommittedChanges).toBe(false);
    expect(status?.hasUntrackedFiles).toBe(false);
  });

  it('detects staged but uncommitted changes', async () => {
    const repoPath = await setupRepository();
    const trackedFile = path.join(repoPath, 'README.md');
    await fs.promises.appendFile(trackedFile, '\nStaged change');
    await runGit(['add', 'README.md'], repoPath);

    const status = await getGitStatus({ cwd: repoPath });

    expect(status).not.toBeNull();
    expect(status?.hasUnstagedChanges).toBe(false);
    expect(status?.hasStagedUncommittedChanges).toBe(true);
    expect(status?.hasUntrackedFiles).toBe(false);
  });

  it('detects untracked files', async () => {
    const repoPath = await setupRepository();
    await fs.promises.writeFile(path.join(repoPath, 'new-file.txt'), 'hello', 'utf8');

    const status = await getGitStatus({ cwd: repoPath });

    expect(status).not.toBeNull();
    expect(status?.hasUnstagedChanges).toBe(false);
    expect(status?.hasStagedUncommittedChanges).toBe(false);
    expect(status?.hasUntrackedFiles).toBe(true);
  });

  it('returns null for directories without a Git repository', async () => {
    const nonRepoPath = await fs.promises.mkdtemp(path.join(tempRoot, 'plain-'));

    const status = await getGitStatus({ cwd: nonRepoPath });

    expect(status).toBeNull();
  });
});

async function setupRepository(): Promise<string> {
  const repoPath = await fs.promises.mkdtemp(path.join(tempRoot, 'repo-'));
  await runGit(['init'], repoPath);
  await runGit(['config', 'user.email', 'smart-edit@example.com'], repoPath);
  await runGit(['config', 'user.name', 'smart-edit'], repoPath);

  const readmePath = path.join(repoPath, 'README.md');
  await fs.promises.writeFile(readmePath, '# smart-edit\n', 'utf8');
  await runGit(['add', 'README.md'], repoPath);
  await runGit(['commit', '-m', 'Initial commit'], repoPath);

  return repoPath;
}

async function runGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd }, (error, stdout, stderr) => {
      if (error) {
        const message = stderr?.toString() || error.message;
        reject(new Error(`git ${args.join(' ')} failed: ${message}`));
        return;
      }
      resolve(stdout.toString().trim());
    });
  });
}
