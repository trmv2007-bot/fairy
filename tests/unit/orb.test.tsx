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
});
