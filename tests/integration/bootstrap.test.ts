import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';

describe('T01 bootstrap', () => {
  it('reports supported Node version >= 24', () => {
    const v = process.version;
    const major = Number(v.slice(1).split('.')[0]);
    expect(major).toBeGreaterThanOrEqual(24);
  });

  it('.NET SDK 8 is available (native gate)', () => {
    const out = execSync('"C:/Program Files/dotnet/dotnet.exe" --version', { encoding: 'utf8' }).trim();
    expect(out).toMatch(/^8\./);
  });

  it('VS Build Tools 2022 present', () => {
    const out = execSync('"C:/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe" -latest -products "*" -property installationPath', { encoding: 'utf8' }).trim();
    expect(out.length).toBeGreaterThan(0);
  });
});
