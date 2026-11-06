// Git connector (T25): local repository read operations.
// Read-only by design; anything mutating (push/PR/comment) stays behind the
// approval layer (policy broker) and is not implemented here.
//
// Safety: every git invocation goes through execFile with a fixed argument
// vector (no shell, no string interpolation into commands), a timeout, and a
// bounded output buffer. Limits are clamped to sane ranges.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface GitStatusEntry {
  path: string;
  /** Porcelain status: M / A / D / R / C / U / ? / ! */
  status: string;
}

export interface GitStatus {
  branch: string | null;
  clean: boolean;
  files: GitStatusEntry[];
}

export interface GitCommitInfo {
  hash: string;
  author: string;
  date: string;
  subject: string;
}

export type GitRunner = (args: string[], cwd: string) => Promise<{ stdout: string }>;

const GIT_TIMEOUT_MS = 15_000;
const MAX_BUFFER = 8 * 1024 * 1024;
const FIELD_SEP = '\u001f';
const LINE_SEP = '\u001e';

export class GitConnector {
  private readonly run: GitRunner;

  constructor(private readonly cwd: string, runner?: GitRunner) {
    if (cwd.length === 0) throw new Error('git connector: cwd must be non-empty');
    this.run = runner ?? (async (args, dir) => {
      const { stdout } = await execFileAsync('git', args, {
        cwd: dir,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        windowsHide: true,
      });
      return { stdout };
    });
  }

  private async git(args: string[]): Promise<string> {
    const { stdout } = await this.run(args, this.cwd);
    return stdout;
  }

  /** Short-form status via porcelain v1. Empty repo (unborn HEAD) → branch null. */
  async status(): Promise<GitStatus> {
    const out = await this.git(['status', '--porcelain=v1', '-b']);
    let branch: string | null = null;
    const files: GitStatusEntry[] = [];
    for (const line of out.split('\n')) {
      if (line.length === 0) continue;
      if (line.startsWith('##')) {
        // ## branch...[tracking] / ## No commits yet on branch
        const head = line.slice(2).trim();
        if (!head.toLowerCase().startsWith('no commits yet')) {
          branch = head.split('...')[0]!.trim();
        }
        continue;
      }
      if (line.startsWith('#')) continue;
      const status = line.slice(0, 2).trim();
      let path = line.slice(3);
      // renames: "R  old -> new" — report the new path
      const arrow = path.indexOf(' -> ');
      if (arrow !== -1) path = path.slice(arrow + 4);
      files.push({ path, status: status === '' ? 'M' : status });
    }
    return { branch, clean: files.length === 0, files };
  }

  async currentBranch(): Promise<string | null> {
    const out = await this.git(['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => '');
    const branch = out.trim();
    return branch === '' || branch === 'HEAD' ? null : branch;
  }

  async log(limit = 10): Promise<GitCommitInfo[]> {
    const n = Math.max(1, Math.min(100, Math.floor(limit)));
    const out = await this.git([
      'log',
      `-n${n}`,
      `--pretty=format:%H${FIELD_SEP}%an${FIELD_SEP}%aI${FIELD_SEP}%s${LINE_SEP}`,
      '--no-merges',
    ]);
    const commits: GitCommitInfo[] = [];
    for (const entry of out.split(LINE_SEP)) {
      if (entry.trim().length === 0) continue;
      const [hash, author, date, subject] = entry.split(FIELD_SEP);
      if (!hash || !subject) continue;
      commits.push({ hash: hash.trim(), author: (author ?? '').trim(), date: (date ?? '').trim(), subject: subject.trim() });
    }
    return commits;
  }

  /** Unified diff of unstaged changes (empty string when clean). */
  async diff(): Promise<string> {
    return this.git(['diff']);
  }
}

// ── Remote/hosting surface (T25, held behind approvals — interfaces only) ────
export interface GitServiceConnector {
  readIssue(id: string): Promise<unknown>;
  createPr(input: unknown): Promise<{ held: true }>;
}
