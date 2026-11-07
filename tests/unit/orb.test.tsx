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

  it('renders the canon eye-mandala: segmented rings + pupil, state hue', () => {
    const html = renderToStaticMarkup(<Orb state="thinking" />);
    // segmented outer ring + iris + glowing pupil, tinted by state
    expect((html.match(/<circle/g) ?? []).length).toBe(4);
    expect(html).toContain('stroke-dasharray'); // mandala segmentation
    expect(html).toContain('f-iris-thinking'); // state-tinted iris gradient
    expect(html).toContain('f-pupil'); // blink animation hook
    expect(html).toContain('Fairy: processing');
  });
});
