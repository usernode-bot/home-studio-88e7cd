// Writes dist/sw.js at build time: web/sw.js with the list of files to
// cache on install and a version hash of them, so a new build replaces the
// old cache. Of the bundled fonts only the Latin files are cached up front
// (about 600 KB), so templates draw in their own fonts offline; other
// scripts' font files and large files (pdf.js, over PRECACHE_MAX_BYTES) are
// cached the first time they are used.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const PRECACHE_MAX_BYTES = 600 * 1024;
const FONT = /\.(woff2?|ttf|otf)$/i;
const LATIN_FONT = /-latin-\d+-(normal|italic)-[\w-]+\.woff2$/i;

// The URLs to cache on install, from the build's own files: [{ name, size }].
export function precacheList(files) {
  const urls = files
    .filter((f) => f.name !== 'sw.js' && !f.name.endsWith('.map') && (!FONT.test(f.name) || LATIN_FONT.test(f.name)) && f.size <= PRECACHE_MAX_BYTES)
    .map((f) => '/' + f.name.replace(/^\/+/, ''))
    .sort();
  return ['/index.html', ...urls.filter((u) => u !== '/index.html')];
}

export function renderServiceWorker(source, urls) {
  const version = crypto.createHash('sha256').update(urls.join('\n')).update(source).digest('hex').slice(0, 12);
  return `self.__HS_VERSION__ = ${JSON.stringify(version)};\nself.__HS_PRECACHE__ = ${JSON.stringify(urls)};\n${source}`;
}

export function serviceWorker({ source, publicDir }) {
  return {
    name: 'home-studio-service-worker',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const files = Object.values(bundle).map((b) => ({
        name: b.fileName,
        size: b.type === 'chunk' ? Buffer.byteLength(b.code) : (typeof b.source === 'string' ? Buffer.byteLength(b.source) : b.source.length),
      }));
      for (const name of fs.readdirSync(publicDir)) {
        const full = path.join(publicDir, name);
        if (fs.statSync(full).isFile()) files.push({ name, size: fs.statSync(full).size });
      }
      const urls = precacheList(files);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: renderServiceWorker(fs.readFileSync(source, 'utf8'), urls) });
    },
  };
}
