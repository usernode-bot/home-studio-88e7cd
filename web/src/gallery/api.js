// Reading a gallery: the index (a small JSON listing) and one item's
// bytes. A source speaks one of two dialects: the demo source is built in
// the app (demo.js, no network at all), and a node source is a self-hosted
// Home Studio node over HTTP. A listing entry is untrusted and cleaned
// here; the item bytes are cleaned by io/gallery.js when opened.

import { parseGalleryItem, GALLERY_LICENCES } from '../io/gallery.js';

// One listing row: id, title, author, licence, tags, size, updatedAt.
function cleanEntry(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id || raw.id.length > 80) return null;
  const tags = (Array.isArray(raw.tags) ? raw.tags : [])
    .filter((t) => typeof t === 'string' && t.length <= 24).slice(0, 10);
  return {
    id: raw.id,
    title: String(raw.title || '').trim().slice(0, 120) || 'Untitled',
    author: String(raw.author || '').trim().slice(0, 80) || 'Anonymous',
    licence: GALLERY_LICENCES.includes(raw.licence) ? raw.licence : null,
    tags,
    width: typeof raw.width === 'number' && Number.isFinite(raw.width) ? Math.round(raw.width) : null,
    height: typeof raw.height === 'number' && Number.isFinite(raw.height) ? Math.round(raw.height) : null,
    bytes: typeof raw.bytes === 'number' && Number.isFinite(raw.bytes) ? raw.bytes : null,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : null,
  };
}

const indexUrl = (source) => (source.kind === 'demo' ? null : `${source.url}/api/gallery`);
const itemUrl = (source, id) => (source.kind === 'demo' ? null : `${source.url}/api/gallery/${encodeURIComponent(id)}`);

// The index of one source. The demo source's index comes from demo.js —
// passed in as `demoIndex` so this module stays free of app wiring.
export async function fetchIndex(source, { demoIndex, timeoutMs = 8000 } = {}) {
  if (source.kind === 'demo') {
    if (!demoIndex) throw new Error('The demo gallery is only available in the staging demo. Open this app with ?demo=1.');
    return demoIndex.map(cleanEntry).filter(Boolean);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(indexUrl(source), { signal: ctrl.signal });
    if (!res.ok) throw new Error(`The gallery answered ${res.status}.`);
    const data = await res.json();
    const items = Array.isArray(data.items) ? data.items : [];
    const cleaned = items.map(cleanEntry).filter(Boolean);
    if (cleaned.length !== items.length) {
      // A listing row that cannot be read is skipped, never fatal.
      return cleaned;
    }
    return cleaned;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('The gallery took too long to answer.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// One item's cleaned contents: { item, design, images, fonts, warnings }.
export async function fetchItem(source, id, opts = {}) {
  if (source.kind === 'demo') {
    const bytes = opts.demoItem && opts.demoItem(id);
    if (!bytes) throw new Error('That demo item is not in the demo gallery.');
    return parseGalleryItem(bytes);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs || 15000);
  try {
    const res = await fetch(itemUrl(source, id), { signal: ctrl.signal });
    if (!res.ok) throw new Error(res.status === 404 ? 'That design is no longer in the gallery.' : `The gallery answered ${res.status}.`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    return parseGalleryItem(bytes);
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('The gallery took too long to answer.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}