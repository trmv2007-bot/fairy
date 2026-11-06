import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { GitConnector } from '../../src/connectors/git.js';

const hasGit = (() => {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
})();

describe.skipIf(!hasGit)('GitConnector (real temp repo)', () => {
  const repo = mkdtempSync(join(tmpdir(), 'fairy-git-'));
  const git = (args: string[]): void => {
    execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  };

  beforeAll(() => {
    git(['init', '-q']);
    git(['config', 'user.email', 'fairy@test.local']);
    git(['config', 'user.name', 'Fairy Test']);
    git(['config', 'commit.gpgsign', 'false']);
    writeFileSync(join(repo, 'a.txt'), 'hello\n');
    git(['add', '.']);
    git(['commit', '-q', '-m', 'first commit']);
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('status reports branch and clean tree', async () => {
    const c = new GitConnector(repo);
    const status = await c.status();
    expect(status.clean).toBe(true);
    expect(status.files).toHaveLength(0);
    expect(status.branch).not.toBeNull();
  });

  it('status detects modifications and reports them porcelain-style', async () => {
    writeFileSync(join(repo, 'a.txt'), 'changed\n');
    const c = new GitConnector(repo);
    const status = await c.status();
    expect(status.clean).toBe(false);
    expect(status.files).toEqual([{ path: 'a.txt', status: 'M' }]);
  });

  it('log returns parsed commits newest-first', async () => {
    const c = new GitConnector(repo);
    const commits = await c.log(5);
    expect(commits).toHaveLength(1);
    expect(commits[0]!.subject).toBe('first commit');
    expect(commits[0]!.author).toBe('Fairy Test');
    expect(commits[0]!.hash).toMatch(/^[0-9a-f]{40}$/);
  });

  it('diff shows the pending change', async () => {
    const c = new GitConnector(repo);
    const diff = await c.diff();
    expect(diff).toContain('a.txt');
    expect(diff).toContain('+changed');
  });

  it('injected runner is used instead of spawning git (testability)', async () => {
    const c = new GitConnector('/anywhere', async args => ({ stdout: args.join(' ') }));
    expect(await c.diff()).toBe('diff');
  });
});
