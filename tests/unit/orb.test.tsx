import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Orb } from '../../src/desktop/ui/Orb.js';

describe('Orb component', () => {
  it('renders state text and aria-label', () => {
    const html = renderToStaticMarkup(<Orb state="idle" />);
    expect(html).toContain('idle');
    expect(html).toContain('aria-label="Fairy orb: idle"');
  });

  it('approval-needed state renders distinct label', () => {
    const html = renderToStaticMarkup(<Orb state="approval-needed" />);
    expect(html).toContain('approval-needed');
  });

  it('renders the canon dot-matrix face: eyes + mouth pixels', () => {
    const html = renderToStaticMarkup(<Orb state="idle" />);
    // 8 eye cells (2x2 blocks) + 7 mouth cells + off matrix dots
    expect((html.match(/f-px-eye/g) ?? []).length).toBe(8);
    expect((html.match(/f-px-off/g) ?? []).length).toBe(63 - 8 - 7);
    expect(html).toContain('Fairy: online');
  });
});
