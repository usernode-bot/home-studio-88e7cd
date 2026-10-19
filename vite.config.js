import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { serviceWorker } from './build/sw-plugin.js';

export default defineConfig({
  root: 'web',
  plugins: [react(), serviceWorker({ source: 'web/sw.js', publicDir: 'public' })],
  publicDir: '../public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    // pdf.js is one ~540 kB chunk, loaded only when a PDF is opened.
    chunkSizeWarningLimit: 600,
  },
});
