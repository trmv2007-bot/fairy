// Chat e2e: launches the built app with a provider seeded from env pointing at a
// LOCAL mock LLM (OpenAI-compatible SSE), then drives a full streaming chat round
// trip through the real UI. No network, no real key.
import { test, expect, _electron as electron } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function freshUserData(): string {
  return mkdtempSync(join(tmpdir(), 'fairy-e2e-chat-'));
}

const DELTAS = ['He', 'llo from', ' the mock!'];

function startMockLlm(): Promise<{ server: Server; port: number; requests: unknown[] }> {
  return new Promise(resolve => {
    const requests: unknown[] = [];
    const server = createServer((req, res) => {
      if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
        res.writeHead(404).end();
        return;
      }
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        requests.push(JSON.parse(body));
        const parsed = JSON.parse(body) as { stream?: boolean };
        res.writeHead(200, { 'content-type': parsed.stream ? 'text/event-stream' : 'application/json' });
        if (parsed.stream) {
          for (const d of DELTAS) {
            res.write(`data: ${JSON.stringify({ model: 'mock-model', choices: [{ delta: { content: d } }] })}\n\n`);
          }
          res.write('data: [DONE]\n\n');
          res.end();
        } else {
          res.end(JSON.stringify({ model: 'mock-model', choices: [{ message: { content: DELTAS.join('') } }] }));
        }
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server, port, requests });
    });
  });
}

test('chat round trip streams a reply through the real UI', async () => {
  const { server, port, requests } = await startMockLlm();
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${freshUserData()}`],
    env: {
      ...process.env,
      FAIRY_SEED_PROVIDER_ENDPOINT_ID: 'mock',
      FAIRY_SEED_PROVIDER_BASE_URL: `http://127.0.0.1:${port}/v1`,
      FAIRY_SEED_PROVIDER_API_KEY: 'sk-e2e-mock-key',
      FAIRY_SEED_PROVIDER_INCLUDED_COST: 'true',
      FAIRY_SEED_PROVIDER_MODEL: 'mock-model',
    },
  });
  const window = await app.firstWindow();

  const orb = window.locator('button[aria-label^="Fairy orb"]');
  await expect(orb).toBeVisible({ timeout: 15_000 });
  await orb.click();
  const dialog = window.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // Chat is the default tab; the provider seeded from env unlocks the input.
  const input = dialog.locator('textarea');
  await expect(input).toBeEnabled({ timeout: 10_000 });
  await input.fill('Hello Fairy');
  await input.press('Enter');

  // streamed assistant reply lands in the conversation
  await expect(dialog.getByText('Hello from the mock!')).toBeVisible({ timeout: 20_000 });
  // user turn echo is present
  await expect(dialog.getByText('Hello Fairy')).toBeVisible();

  // the mock received the message with the seeded model
  await expect.poll(async () => requests.length).toBeGreaterThan(0);
  expect(JSON.stringify(requests[0])).toContain('mock-model');

  // raw key must not be on disk — neither in config nor in the encrypted key file.
  // (read from the test process: dynamic import inside app.evaluate is unsupported here)
  const userData = await app.evaluate(({ app }) => app.getPath('userData'));
  const configRaw = existsSync(join(userData, 'fairy-config.json')) ? readFileSync(join(userData, 'fairy-config.json'), 'utf8') : '';
  const keysRaw = existsSync(join(userData, 'fairy-keys.json')) ? readFileSync(join(userData, 'fairy-keys.json'), 'utf8') : '';
  expect(configRaw).not.toContain('sk-e2e-mock-key');
  expect(keysRaw).not.toContain('sk-e2e-mock-key');

  await app.close();
  await new Promise<void>(r => server.close(() => r()));
});

test('chat surfaces provider errors instead of dying', async () => {
  // a mock that always answers 503
  const server = createServer((_req, res) => {
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'backend down' } }));
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;

  const app = await electron.launch({
    args: ['.', `--user-data-dir=${freshUserData()}`],
    env: {
      ...process.env,
      FAIRY_SEED_PROVIDER_ENDPOINT_ID: 'broken',
      FAIRY_SEED_PROVIDER_BASE_URL: `http://127.0.0.1:${port}/v1`,
      FAIRY_SEED_PROVIDER_API_KEY: 'sk-e2e-broken',
      FAIRY_SEED_PROVIDER_INCLUDED_COST: 'true',
    },
  });
  const window = await app.firstWindow();
  const orb = window.locator('button[aria-label^="Fairy orb"]');
  await expect(orb).toBeVisible({ timeout: 15_000 });
  await orb.click();
  const dialog = window.getByRole('dialog');
  const input = dialog.locator('textarea');
  await expect(input).toBeEnabled({ timeout: 10_000 });
  await input.fill('hi');
  await input.press('Enter');
  await expect(dialog.getByText(/HTTP 503/)).toBeVisible({ timeout: 20_000 });
  // the app is still interactive afterwards
  await expect(input).toBeEnabled();

  await app.close();
  await new Promise<void>(r => server.close(() => r()));
});
