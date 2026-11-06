// Renderer entry (T02). Bundled by vite (see vite.config.ts) into dist/ui/.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';

const container = document.getElementById('root');
if (!container) throw new Error('missing #root mount element');
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
