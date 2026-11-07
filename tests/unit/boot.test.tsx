import { describe, it, expect, vi, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { Boot } from '../../src/desktop/ui/Boot.js';

// Mirror the timings contract from Boot.tsx (deterministic by design).
const LINE_MS = 200;
const WAKE_MS = 7 * LINE_MS + 120;

interface Mount {
  host: HTMLElement;
  root: Root;
  onDone: () => void;
  cleanup: () => void;
}

function mount(): Mount {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const onDone = vi.fn<() => void>();
  return {
    host,
    root,
    onDone,
    cleanup: () => {
      root.unmount();
      host.remove();
    },
  };
}

function renderBoot(m: Mount, agreementSigned: boolean): Promise<void> {
  return act(async () => {
    m.root.render(<Boot agreementSigned={agreementSigned} onDone={m.onDone} />);
  });
}

async function advance(ms: number): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

describe('Boot component (canon power-on ritual)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders the boot surface with a skip control, wordmark not yet painted', () => {
    const html = renderToStaticMarkup(<Boot agreementSigned={false} onDone={() => {}} />);
    expect(html).toContain('aria-label="Fairy boot sequence"');
    expect(html).toContain('Skip');
    // eye/wordmark only appear after the scan phase — static render is pre-wake
    expect(html).not.toContain('Chief Assistant');
  });

  it('streams scan lines, wakes the eye, then auto-completes exactly once', async () => {
    vi.useFakeTimers();
    const m = mount();
    try {
      await renderBoot(m, false);
      expect(m.host.textContent).not.toContain('H.D.D. POWER ON');

      // mid-scan: all lines landed, eye still closed (wake fires at WAKE_MS)
      await advance(7 * LINE_MS);
      expect(m.host.textContent).toContain('H.D.D. POWER ON');
      expect(m.host.textContent).toContain('ACTIVATION KEY VERIFIED');
      expect(m.host.textContent).not.toContain('FAIRY');

      // wake: the eye-mandala emblem + wordmark are visible
      await advance(WAKE_MS + 200);
      expect(m.host.textContent).toContain('FAIRY');
      expect(m.host.textContent).toContain('Type-III general-purpose intelligence');

      // ready: first-run line references the pending agreement + the "opportunity"
      await advance(1000);
      expect(m.host.textContent).toContain('opportunity');
      expect(m.host.textContent).toContain('user agreement');

      // auto-dismiss fires onDone exactly once
      await advance(2500);
      expect(m.onDone).toHaveBeenCalledTimes(1);
    } finally {
      m.cleanup();
    }
  });

  it('greets a returning Master without re-mentioning the agreement', async () => {
    vi.useFakeTimers();
    const m = mount();
    try {
      await renderBoot(m, true);
      await advance(WAKE_MS + 1000);
      expect(m.host.textContent).toContain('Systems nominal');
      expect(m.host.textContent).toContain('electricity meter');
      expect(m.host.textContent).not.toContain('user agreement');
    } finally {
      m.cleanup();
    }
  });

  it('Skip finishes immediately — and only once', async () => {
    const m = mount();
    try {
      await renderBoot(m, false);
      const skip = m.host.querySelector<HTMLButtonElement>('button');
      expect(skip).not.toBeNull();
      await act(async () => { skip!.click(); });
      expect(m.onDone).toHaveBeenCalledTimes(1);
      // a second click must not re-fire
      await act(async () => { skip!.click(); });
      expect(m.onDone).toHaveBeenCalledTimes(1);
    } finally {
      m.cleanup();
    }
  });
});
