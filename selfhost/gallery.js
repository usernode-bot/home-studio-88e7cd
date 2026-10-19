// The self-hosted node's community gallery: an index of items people
// published, and each item's bytes, moderated by the node's admin key.
// Gallery handlers are mounted by store.js at /api/gallery — this module
// is the routes, so the store stays about designs and blobs.
//
// Publishing (PUT /api/gallery) is deliberately off until the runner sets
// HOME_STUDIO_ADMIN_KEY: a gallery nobody moderates is a spam magnet.
// The key goes in the x-home-studio-admin header, the same one the app's
// publish flow sends. Removing an item is deleting its file from the
// gallery directory and dropping its row from index.json — by hand, so
// the runner stays the moderator.

import { promises as fs } from 'node:fs';
import path from 'node:path';

// The licences the app accepts; an item outside them is refused.
const LICENCES = ['CC0-1.0', 'CC-BY-4.0', 'CC-BY-SA-4.0'];

const send = (res, status, body, type = 'application/json') => {
  if (Buffer.isBuffer(body)) {
    res.writeHead(status, { 'content-type': type, 'content-length': body.length });
    res.end(body);
    return;
  }
  const buf = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'content-type': type, 'content-length': Buffer.byteLength(buf) });
  res.end(buf);
};

const readBody = (req, cap) => new Promise((resolve, reject) => {
  const len = Number(req.headers['content-length'] || 0);
  if (len > cap) { reject(Object.assign(new Error('too large'), { status: 413 })); return; }
  const chunks = [];
  let size = 0;
  req.on('data', (c) => {
    size += c.length;
    if (size > cap) { req.destroy(); reject(Object.assign(new Error('too large'), { status: 413 })); return; }
    chunks.push(c);
  });
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});

const safeId = (raw) => {
  const id = String(raw || '').trim();
  if (!id || id.length > 80) return null;
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(id) || id.includes('..')) return null;
  return id;
};

const itemPath = (dir, id) => path.join(dir, id + '.json');
const indexPath = (dir) => path.join(dir, 'index.json');

// The index is one JSON file, rewritten on each publish. Fine at the size
// a moderated gallery reaches; the runner can always read it by hand.
async function readIndex(dir) {
  try {
    const data = JSON.parse(await fs.readFile(indexPath(dir), 'utf8'));
    return Array.isArray(data.items) ? data.items : [];
  } catch {
    return [];
  }
}

const writeIndex = (dir, items) => fs.writeFile(indexPath(dir), JSON.stringify({ items }, null, 2));

// One listing row, decided by the item itself, not by what the publisher
// sent outside the envelope.
const rowFor = (id, envelope, bytes) => {
  const item = envelope.item || {};
  const design = envelope.design || {};
  const clean = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  return {
    id,
    title: clean(item.title, 120) || 'Untitled',
    author: clean(item.author, 80) || 'Anonymous',
    licence: LICENCES.includes(item.licence) ? item.licence : null,
    tags: (Array.isArray(item.tags) ? item.tags : []).filter((t) => typeof t === 'string').map((t) => t.trim().toLowerCase().slice(0, 24)).filter(Boolean).slice(0, 10),
    width: typeof design.width === 'number' && Number.isFinite(design.width) ? Math.round(design.width) : null,
    height: typeof design.height === 'number' && Number.isFinite(design.height) ? Math.round(design.height) : null,
    bytes,
    updatedAt: Date.now(),
  };
};

// Returns true when the request was answered, false to fall through (a
// method this route does not take).
export async function handleGallery(req, res, pathname, { dir, adminKey, maxBytes, log, keyMatches }) {
  if (req.method === 'GET' && pathname === '/api/gallery') {
    send(res, 200, { items: await readIndex(dir) });
    return true;
  }

  const match = pathname.match(/^\/api\/gallery\/([^/]+)$/);
  if (req.method === 'GET' && match) {
    const id = safeId(match[1]);
    if (!id) { send(res, 400, { error: 'That item address is not one this gallery accepts.' }); return true; }
    const bytes = await fs.readFile(itemPath(dir, id)); // ENOENT -> the 404 below
    send(res, 200, bytes, 'application/json');
    return true;
  }

  if (req.method === 'PUT' && pathname === '/api/gallery') {
    if (!adminKey) {
      send(res, 403, { error: 'This gallery does not accept publishes. Whoever runs the node sets HOME_STUDIO_ADMIN_KEY to turn moderation on.' });
      return true;
    }
    if (!keyMatches(req.headers['x-home-studio-admin'], adminKey)) {
      send(res, 401, { error: 'The admin key was not accepted by this gallery.' });
      return true;
    }
    const body = await readBody(req, maxBytes);
    const envelope = JSON.parse(body.toString('utf8')); // SyntaxError -> 400
    if (!envelope || envelope.kind !== 'gallery-item' || !envelope.item || typeof envelope.item.title !== 'string' || !envelope.item.title.trim()) {
      send(res, 400, { error: 'That is not a Home Studio gallery item.' });
      return true;
    }
    if (!LICENCES.includes(envelope.item.licence)) {
      send(res, 400, { error: 'The item needs a licence this gallery lists (CC0-1.0, CC-BY-4.0 or CC-BY-SA-4.0).' });
      return true;
    }
    const wanted = envelope.id;
    const id = wanted ? safeId(wanted) : 'g-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    if (!id) { send(res, 400, { error: 'The item address is not one this gallery accepts.' }); return true; }
    await fs.writeFile(itemPath(dir, id), body);
    const items = (await readIndex(dir)).filter((r) => r && r.id !== id);
    items.push(rowFor(id, envelope, body.length));
    await writeIndex(dir, items);
    log('published gallery item', id, body.length, 'bytes');
    send(res, 200, { id });
    return true;
  }

  return false;
}