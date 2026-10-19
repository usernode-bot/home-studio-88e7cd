import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// The service worker ships with the list of build chunks to precache, so the
// editor opens offline after one online visit. Font files and images are
// left out of the list; the worker caches them the first time it fetches.
function swPrecache() {
  // The list must be the files that REALLY ship: at generateBundle some chunk
  // names (empty stubs of CSS-only dynamic imports) are still in the bundle
  // but never written, and precaching a file that 404s breaks the worker's
  // install. So the list is taken from the final bundle at writeBundle, and
  // the file written by hand at closeBundle (emitFile is too late by then).
  let dir = '';
  let sw = '';
  return {
    name: 'sw-precache',
    writeBundle(opts, bundle) {
      dir = opts.dir;
      const files = Object.keys(bundle).filter((f) => /\.(js|css)$/.test(f) && (bundle[f].type !== 'asset' || /\.css$/.test(f)));
      const list = [...new Set([...files, 'screens.css'].map((f) => '/' + f))].sort();
      sw = readFileSync('web/sw.js', 'utf8');
      sw = sw.replace('__BUILD__', Math.abs(list.join('|').split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7)).toString(36));
      sw = sw.replace('self.__PRECACHE__ = [];', 'self.__PRECACHE__ = ' + JSON.stringify(list) + ';');
    },
    closeBundle() {
      if (dir && sw) writeFileSync(join(dir, 'sw.js'), sw);
    },
  };
}

export default defineConfig({
  root: 'web',
  plugins: [react(), swPrecache()],
  publicDir: '../public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
});