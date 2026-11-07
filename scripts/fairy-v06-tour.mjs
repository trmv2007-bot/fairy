// v0.6 visual tour: drives the real app against a local mock LLM and captures
// the new features — chat transcripts, History strip, light theme, accents,
// floating orb. Run: DISPLAY=:99 node scripts/fairy-v06-tour.mjs
import { _electron as electron } from 'playwright-core';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = '/home/z/my-project/download/fairy/screenshots-v06';
mkdirSync(OUT, { recursive: true });

const DELTAS = ['All systems ', 'nominal, Master. ', 'Routes are live.'];

function startMockLlm() {
  const requests = [];
  return new Promise(resolve => {
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        const parsed = JSON.parse(body || '{}');
        requests.push(parsed);
        res.writeHead(200, { 'content-type': parsed.stream ? 'text/event-stream' : 'application/json' });
        if (parsed.stream) {
          for (const d of DELTAS) res.write(`data: ${JSON.stringify({ model: 'mock-model', choices: [{ delta: { content: d } }] })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
        } else {
          res.end(JSON.stringify({ model: 'mock-model', choices: [{ message: { content: DELTAS.join('') } }] }));
        }
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

const shot = (page, name) => page.screenshot({ path: join(OUT, name) });

const { server, port } = await startMockLlm();
const userData = mkdtempSync(join(tmpdir(), 'fairy-tour-'));
const app = await electron.launch({
  args: ['.', `--user-data-dir=${userData}`],
  cwd: root,
  env: {
    ...process.env,
    FAIRY_SEED_PROVIDER_ENDPOINT_ID: 'mock',
    FAIRY_SEED_PROVIDER_BASE_URL: `http://127.0.0.1:${port}/v1`,
    FAIRY_SEED_PROVIDER_API_KEY: 'sk-tour-key',
    FAIRY_SEED_PROVIDER_INCLUDED_COST: 'true',
    FAIRY_SEED_PROVIDER_MODEL: 'mock-model',
  },
});
const page = await app.firstWindow();

// 01 — boot ritual in flight
await page.waitForTimeout(1600);
await shot(page, '01-boot.png');

// sign the agreement; the boot ritual keeps overlaying until it auto-dismisses,
// so the orb click retries through it (Playwright actionability).
await page.getByRole('button', { name: 'Sign the agreement' }).click();

// open the panel, hold a short exchange
await page.locator('button[aria-label^="Fairy orb"]').click({ timeout: 30000 });
const cmd = page.getByRole('textbox', { name: 'Command bar' });
await cmd.fill('Report status, Fairy.');
await cmd.press('Enter');
await page.getByText('All systems nominal, Master. Routes are live.').waitFor({ timeout: 15000 });
await cmd.fill('And the pool?');
await cmd.press('Enter');
await page.waitForTimeout(900);
await shot(page, '02-chat-exchange.png');

// 03 — history strip with archived conversations
await page.getByRole('button', { name: 'Chat history' }).click();
await page.waitForTimeout(600);
await shot(page, '03-history.png');
await page.getByRole('button', { name: 'Chat history' }).click();

// 04 — light theme
await page.getByRole('button', { name: 'Status' }).click();
await page.getByRole('button', { name: 'Theme: Daylight ops' }).click();
await page.waitForTimeout(500);
await shot(page, '04-light-theme.png');

// 05 — accent violet (still light)
await page.getByRole('button', { name: 'Accent: Holo Violet' }).click();
await page.waitForTimeout(400);
await shot(page, '05-accent-violet-light.png');

// 06 — floating orb: deploy, then shoot the orb window itself
await page.locator('#floating-orb').check();
await page.waitForTimeout(2500);
const orbPage = app.windows().find(w => w.url().includes('view=orb'));
if (orbPage) {
  await orbPage.waitForTimeout(800);
  await shot(orbPage, '06-floating-orb.png');
  console.log('orb window captured');
} else {
  console.log('WARN: orb window not found');
}
// back to dark for the record
await page.getByRole('button', { name: 'Theme: Night CRT' }).click();
await page.waitForTimeout(400);
await shot(page, '07-dark-final.png');

await app.close();
server.close();
console.log('tour complete →', OUT);
