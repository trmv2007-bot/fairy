// Real Electron e2e (T02): launches the built app via Playwright's Electron support
// and drives the actual UI. Requires `npm run build` first (dist/desktop + dist/ui).
import { test, expect, _electron as electron } from '@playwright/test';

test('shell opens, orb renders, panel + settings flow work', async () => {
  const app = await electron.launch({ args: ['.'] });
  const window = await app.firstWindow();

  // orb button renders
  const orb = window.locator('button[aria-label^="Fairy orb"]');
  await expect(orb).toBeVisible({ timeout: 15_000 });

  // clicking the orb opens the side panel
  await orb.click();
  const dialog = window.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Fairy' })).toBeVisible();

  // switch to providers tab, add a provider, expect it listed
  await dialog.getByRole('button', { name: 'Providers' }).click();
  await dialog.getByText('No providers configured yet.').waitFor();

  await dialog.locator('label:has-text("Provider id") input').fill('test-provider');
  await dialog.locator('label:has-text("Base URL") input').fill('https://api.example.com/v1');
  await dialog.locator('label:has-text("API key") input').fill('sk-e2e-test-key');
  await dialog.getByRole('button', { name: 'Save provider' }).click();
  await expect(dialog.getByText("saved 'test-provider'")).toBeVisible();
  await expect(dialog.getByText(/test-provider/).first()).toBeVisible();
  await expect(dialog.getByText('key vaulted')).toBeVisible();

  // persisted config must not contain the raw key
  const configOnDisk = await app.evaluate(async ({ app }) => {
    const { readFileSync } = await import('node:fs');
    const path = app.getPath('userData') + '/fairy-config.json';
    try { return readFileSync(path, 'utf8'); } catch { return ''; }
  });
  expect(configOnDisk).not.toContain('sk-e2e-test-key');

  await app.close();
});
