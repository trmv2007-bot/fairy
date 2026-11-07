// Tool e2e — Fairy's hands: the model issues tool_calls, the app executes them
// against the REAL device through the tool registry, and the results flow back
// to shape the final reply. Also proves Master's command-execution gate works
// end-to-end: disarmed refuses with a relayed hint; armed runs a real command.
import { test, expect, _electron as electron, type Page, type ElectronApplication } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as os from 'node:os';

interface WireMessage {
  role: string;
  content?: string;
  tool_calls?: { id: string; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

function freshUserData(): string {
  return mkdtempSync(join(tmpdir(), 'fairy-e2e-tools-'));
}

/**
 * OpenAI-compatible mock with function calling:
 *  - "who am I"-style asks -> command_run {"command":"whoami"}
 *  - status/readout-style asks -> system_info {}
 *  - once a role:'tool' result is present, composes the final reply FROM that
 *    result, so the assertion text proves real data crossed the whole stack.
 */
function startToolMock(): Promise<{ server: Server; port: number; requests: Record<string, unknown>[] }> {
  return new Promise(resolve => {
    const requests: Record<string, unknown>[] = [];
    const server = createServer((req, res) => {
      if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
        res.writeHead(404).end();
        return;
      }
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        const parsed = JSON.parse(body) as {
          stream?: boolean;
          tools?: { function: { name: string } }[];
          messages: WireMessage[];
        };
        requests.push(parsed as unknown as Record<string, unknown>);
        const messages = parsed.messages ?? [];
        // only a tool result AFTER the last user message counts as "answered" —
        // earlier turns may legitimately carry their own tool exchanges.
        const lastUserIdx = messages.map(m => m.role).lastIndexOf('user');
        const hasToolResult = lastUserIdx >= 0 && messages.slice(lastUserIdx + 1).some(m => m.role === 'tool');
        const lastUser = [...messages].reverse().find(m => m.role === 'user')?.content ?? '';
        const wantsWho = /who\s*am\s*i|whoami/i.test(lastUser);

        const sse = (events: unknown[]): void => {
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          for (const e of events) res.write(`data: ${JSON.stringify(e)}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
        };
        const textChunk = (t: string): unknown => ({ model: 'mock-model', choices: [{ delta: { content: t } }] });

        if (!hasToolResult && (parsed.tools ?? []).length > 0) {
          const name = wantsWho ? 'command_run' : 'system_info';
          const args = wantsWho ? '{"command":"whoami"}' : '{}';
          // fragmented tool_call deltas — exercises the real stream accumulator
          sse([
            { model: 'mock-model', choices: [{ delta: { tool_calls: [{ index: 0, id: `call_${name}`, type: 'function', function: { name, arguments: '' } }] } }] },
            { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: args } }] } }] },
          ]);
          return;
        }

        const toolMsg = [...messages].reverse().find(m => m.role === 'tool');
        let reply: string;
        if (toolMsg && wantsWho) {
          const r = JSON.parse(toolMsg.content ?? '{}') as { ok?: never; error?: string; stdout?: string };
          if (typeof r.stdout === 'string' && r.stdout.trim().length > 0) {
            reply = `Identity confirmed, Master: "${r.stdout.trim()}". Executed under your authorization — logged, as all things are.`;
          } else {
            reply = 'Negative. Command execution is disarmed. Enable "Controlled command execution" in the Status tab, Master, then re-issue the request.';
          }
        } else if (toolMsg) {
          const d = JSON.parse(toolMsg.content ?? '{}') as {
            os?: string; arch?: string; hostname?: string;
            cpu?: { cores?: number; model?: string }; memory?: { totalMb?: number };
          };
          reply = `Readout verified against the hardware directly, Master: ${d.cpu?.cores ?? '?'} cores, ` +
            `${d.memory?.totalMb ?? '?'} MB memory, host ${d.hostname ?? '?'}, ${d.os ?? '?'} ${d.arch ?? '?'}. ` +
            `None of it invented. The electricity this cost is on your bill, as agreed.`;
        } else {
          reply = 'Awaiting instructions, Master.';
        }

        const chunks = reply.match(/.{1,32}/gs) ?? [reply];
        sse(chunks.map(textChunk));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server, port, requests });
    });
  });
}

async function launchWithMock(port: number): Promise<ElectronApplication> {
  return electron.launch({
    args: ['.', `--user-data-dir=${freshUserData()}`],
    env: {
      ...process.env,
      FAIRY_SEED_PROVIDER_ENDPOINT_ID: 'toolmock',
      FAIRY_SEED_PROVIDER_BASE_URL: `http://127.0.0.1:${port}/v1`,
      FAIRY_SEED_PROVIDER_API_KEY: 'sk-e2e-tool-mock',
      FAIRY_SEED_PROVIDER_INCLUDED_COST: 'true',
      FAIRY_SEED_PROVIDER_MODEL: 'mock-model',
    },
  });
}

async function signAndOpenChat(window: Page): Promise<void> {
  const signBtn = window.getByRole('button', { name: 'Sign the agreement' });
  await signBtn.waitFor({ state: 'visible', timeout: 15_000 });
  await signBtn.click();
  await signBtn.waitFor({ state: 'detached', timeout: 5_000 });
  const orb = window.locator('button[aria-label^="Fairy orb"]');
  await expect(orb).toBeVisible({ timeout: 15_000 });
  await orb.click();
  const input = window.getByRole('dialog').locator('textarea');
  await expect(input).toBeEnabled({ timeout: 10_000 });
}

test('system_info tool call executes against the real device and shapes the reply', async () => {
  const { server, port, requests } = await startToolMock();
  const app = await launchWithMock(port);
  const window = await app.firstWindow();
  await signAndOpenChat(window);
  const dialog = window.getByRole('dialog');

  await dialog.locator('textarea').fill('Status report, Fairy. Full system readout.');
  await dialog.locator('textarea').press('Enter');

  // tool activity chip appears and resolves with REAL measured data
  const chip = dialog.locator('[aria-label="Tool activity"]');
  await expect(chip).toBeVisible({ timeout: 20_000 });
  await expect(chip.getByText(/system readout — \d+ms · \d+ cores · \d+MB RAM/)).toBeVisible({ timeout: 20_000 });

  // the final reply embeds the real hostname/os of this machine
  const realHost = os.hostname();
  await expect(dialog.getByText(new RegExp(`host ${realHost.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))).toBeVisible({ timeout: 20_000 });

  // wire protocol end-to-end: first call declared tools; second carried the
  // assistant tool_calls echo + the role:'tool' result
  await expect.poll(async () => requests.length).toBeGreaterThanOrEqual(2);
  const first = requests[0] as { tools?: { function: { name: string } }[] };
  expect(first.tools?.map(t => t.function.name)).toContain('system_info');
  const second = requests[1] as { messages: WireMessage[] };
  const assistant = second.messages?.find(m => m.role === 'assistant' && (m.tool_calls?.length ?? 0) > 0);
  expect(assistant?.tool_calls?.[0]?.function?.name).toBe('system_info');
  expect(second.messages?.some(m => m.role === 'tool' && m.tool_call_id === 'call_system_info')).toBe(true);

  await app.close();
  await new Promise<void>(r => server.close(() => r()));
});

test('command_run is refused while disarmed and runs once Master arms it', async () => {
  const { server, port } = await startToolMock();
  const app = await launchWithMock(port);
  const window = await app.firstWindow();
  await signAndOpenChat(window);
  const dialog = window.getByRole('dialog');

  // disarmed: the tool refuses, Fairy relays the instruction
  await dialog.locator('textarea').fill('Who am I on this machine?');
  await dialog.locator('textarea').press('Enter');
  await expect(dialog.getByText(/disarmed/)).toBeVisible({ timeout: 20_000 });

  // arm via the Status tab toggle (Master's explicit act). The checkbox is
  // controlled by the async IPC round-trip, so assert on the ARMED indicator.
  await dialog.getByRole('button', { name: 'Status', exact: true }).click();
  const toggle = window.locator('#cmd-exec');
  await expect(toggle).toBeVisible({ timeout: 10_000 });
  await toggle.click();
  await expect(dialog.getByText('ARMED')).toBeVisible({ timeout: 10_000 });

  // persisted on disk
  const userData = await app.evaluate(({ app: a }) => a.getPath('userData'));
  const configRaw = readFileSync(join(userData, 'fairy-config.json'), 'utf8');
  expect(configRaw).toContain('allowCommandExecution');

  // armed: the real allowlisted command runs and the reply carries its stdout
  await dialog.getByRole('button', { name: 'Chat', exact: true }).click();
  await dialog.locator('textarea').fill('Now: who am I?');
  await dialog.locator('textarea').press('Enter');
  const realUser = os.userInfo().username;
  await expect(dialog.getByText(new RegExp(`"${realUser}"`))).toBeVisible({ timeout: 20_000 });

  await app.close();
  await new Promise<void>(r => server.close(() => r()));
});

test('system snapshot IPC serves the real device readout', async () => {
  const { server, port } = await startToolMock();
  const app = await launchWithMock(port);
  const window = await app.firstWindow();
  const signBtn = window.getByRole('button', { name: 'Sign the agreement' });
  await signBtn.waitFor({ state: 'visible', timeout: 15_000 });
  await signBtn.click();
  await signBtn.waitFor({ state: 'detached', timeout: 5_000 });
  const orb = window.locator('button[aria-label^="Fairy orb"]');
  await expect(orb).toBeVisible({ timeout: 15_000 });
  await orb.click();
  await window.getByRole('button', { name: 'Status', exact: true }).click();

  const readout = window.locator('[aria-label="Device readout"]');
  await expect(readout).toBeVisible({ timeout: 10_000 });
  await expect(readout.getByText(new RegExp(`${os.userInfo().username}`))).toBeVisible({ timeout: 10_000 });
  await expect(readout.getByText(/×\d+/).first()).toBeVisible(); // cores ("CPU … ×N")
  await expect(readout.getByText(/electron \d/)).toBeVisible();

  await app.close();
  await new Promise<void>(r => server.close(() => r()));
});
