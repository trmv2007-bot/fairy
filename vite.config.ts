// Renderer build (T02): bundles src/desktop/ui/index.html + React app into dist/ui/,
// which the Electron main process loads. Main-process code is compiled by tsc separately.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(rootDir, 'src/desktop/ui'),
  base: './',
  plugins: [react()],
  build: {
    outDir: path.join(rootDir, 'dist/ui'),
    emptyOutDir: true,
    target: 'chrome130',
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
