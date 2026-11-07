// Real Electron e2e (T02): launches the built app via Playwright's Electron support
// and drives the actual UI. Requires `npm run build` first (dist/desktop + dist/ui).
// Each run gets an isolated userData dir — shared state would leak between runs.
import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function freshUserData(): string {
  return mkdtempSync(join(tmpdir(), 'fairy-e2e-shell-'));
}

test('shell opens, orb renders, panel + settings flow work', async () => {
  const app = await electron.launch({ args: ['.', `--user-data-dir=${freshUserData()}`] });
  const window = await app.firstWindow();

  // canon boot gate: Fairy compels the user agreement on first run
  const signBtn = window.getByRole('button', { name: 'Sign the agreement' });
  await signBtn.waitFor({ state: 'visible', timeout: 15_000 });
  await signBtn.click();
  await signBtn.waitFor({ state: 'detached', timeout: 5_000 });

  // orb button renders
  const orb = window.locator('button[aria-label^="Fairy orb"]');
  await expect(orb).toBeVisible({ timeout: 15_000 });

  // clicking the orb opens the side panel
  await orb.click();
  const dialog = window.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Fairy' })).toBeVisible();

  // switch to providers tab, add a provider, expect it listed
  await dialog.getByRole('button', { name: 'Providers', exact: true }).click();
  await dialog.getByText('No providers registered yet.').waitFor();

  await dialog.locator('label:has-text("Provider id") input').fill('test-provider');
  await dialog.locator('label:has-text("Base URL") input').fill('https://api.example.com/v1');
  await dialog.locator('label:has-text("API key") input').fill('sk-e2e-test-key');
  await dialog.getByRole('button', { name: 'Save provider' }).click();
  await expect(dialog.getByText("registered 'test-provider'")).toBeVisible();
  await expect(dialog.getByText(/test-provider/).first()).toBeVisible();
  await expect(dialog.getByText('key vaulted')).toBeVisible();

  // persisted config must not contain the raw key (read from the test process —
  // dynamic import inside app.evaluate is not supported on this Node/Electron combo)
  const userData = await app.evaluate(({ app }) => app.getPath('userData'));
  const configPath = join(userData, 'fairy-config.json');
  const configOnDisk = existsSync(configPath) ? readFileSync(configPath, 'utf8') : '';
  expect(configOnDisk).not.toContain('sk-e2e-test-key');
  // the agreement signature persists with the config (canon contract record)
  expect(configOnDisk).toContain('agreementAcceptedAt');

  await app.close();
});
