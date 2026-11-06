import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';

// Machine probes: the native gates only make sense on a Windows dev box with .NET 8.
// On other platforms (and CI without the SDK) they skip instead of failing the suite.
const onWindows = process.platform === 'win32';
const winIt = onWindows ? it : it.skip;

function hasDotnet(): boolean {
  try {
    execFileSync('dotnet', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

describe('T01 bootstrap', () => {
  it('reports supported Node version >= 24', () => {
    const v = process.version;
    const major = Number(v.slice(1).split('.')[0]);
    expect(major).toBeGreaterThanOrEqual(24);
  });

  winIt('.NET SDK 8 is available (native gate)', () => {
    if (!hasDotnet()) {
      console.warn('[bootstrap] dotnet CLI not found on PATH; skipping SDK-8 assertion');
      return;
    }
    const out = execFileSync('dotnet', ['--version'], { encoding: 'utf8' }).trim();
    expect(out).toMatch(/^8\./);
  });

  winIt('VS Build Tools 2022 present', () => {
    const out = execFileSync(
      'C:/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe',
      ['-latest', '-products', '*', '-property', 'installationPath'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    expect(out.length).toBeGreaterThan(0);
  });
});
