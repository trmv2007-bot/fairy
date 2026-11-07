// Renderer entry (T02). Bundled by vite (see vite.config.ts) into dist/ui/.
// v0.6: the floating orb window loads the same bundle with ?view=orb and gets
// only the eye — no boot ritual, no agreement overlay, no panel.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { OrbDock } from './OrbDock.js';

const container = document.getElementById('root');
if (!container) throw new Error('missing #root mount element');

const view = new URLSearchParams(window.location.search).get('view');
if (view === 'orb') {
  // Transparent window: kill the CRT backdrop, scanlines and HUD corners.
  document.documentElement.classList.add('f-orb-view');
  createRoot(container).render(
    <StrictMode>
      <OrbDock />
    </StrictMode>,
  );
} else {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
