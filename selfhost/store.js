// The self-hosted Home Studio node's store: designs as project files,
// content-addressed blobs, and the community gallery, over plain HTTP.
// No framework and no database: every design is a byte-for-byte project
// file on disk, so the store is dumb, inspectable and easy to back up.
//
//   GET    /api/v1/ping            is this a Home Studio node
//   GET    /api/v1/designs         the stored designs (id, updatedAt)
//   GET    /api/v1/designs/:id     one design's bytes
//   PUT    /api/v1/designs/:id     store a design (bearer key when one is set)
//   DELETE /api/v1/designs/:id     remove a design (same key)
//   GET    /api/v1/blobs/:cid      one blob's bytes
//   PUT    /api/v1/blobs/:cid      store a blob (same key)
//   GET    /api/gallery            the gallery index
//   GET    /api/gallery/:id        one gallery item's bytes
//   PUT    /api/gallery            publish (admin key) — see gallery.js
//
// Reads are open on purpose: another device only needs the address.
// Writes need the bearer key when HOME_STUDIO_KEY is set; without one the
// store is write-open and anyone who can reach it can write.
//
// Run it:  node store.js          (or: npm start in this directory)
// Config:  PORT, DATA, KEY, ADMIN_KEY — see docs/self-hosting.md.
// Signaling for collaboration runs separately: node signal.js.

import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { handleGallery } from './gallery.js';

const PORT = Number(process.env.PORT || process.env.HOME_STUDIO_PORT || 8787);
const DATA = process.env.HOME_STUDIO_DATA || path.join(process.cwd(), 'data');
const KEY = String(process.env.HOME_STUDIO_KEY || '');
const ADMIN_KEY = String(process.env.HOME_STUDIO_ADMIN_KEY || '');

const GALLERY_DIR = path.join(DATA, 'gallery');
const DESIGNS_DIR = path.join(DATA, 'designs');
const BLOBS_DIR = path.join(DATA, 'blobs');

const MAX_BYTES = 64 * 1024 * 1024; // a design or blob this node will take
const GALLERY_MAX_BYTES = 25 * 1024 * 1024; // gallery items are capped smaller

const log = (...args) => console.log('[store]', ...args);

await fs.mkdir(DESIGNS_DIR, { recursive: true });
await fs.mkdir(BLOBS_DIR, { recursive: true });
await fs.mkdir(GALLERY_DIR, { recursive: true });

// ── Small helpers ─────────────────────────────────────────────────────────

const cors = (res, req) => {
  res.setHeader('access-control-allow-origin', '*');
  if (req.method === 'OPTIONS') {
    res.setHeader('access-control-allow-methods', 'GET, PUT, DELETE');
    res.setHeader('access-control-allow-headers', 'authorization, content-type, x-home-studio-admin');
    res.writeHead(204);
    res.end();
    return true;
  }
  return false;
};

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

// A design id from the URL is untrusted: it becomes part of a file path.
// Keep the boring characters and refuse anything that could climb out.
const safeId = (raw) => {
  const id = String(raw || '').trim();
  if (!id || id.length > 100) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) || id.includes('..')) return null;
  return id;
};

// Blob addresses are our own CIDs; anything else never touches disk.
const isCid = (raw) => /^bafkrei[a-z2-7]{52}$/.test(String(raw || ''));

// The bearer key, when the node has one, guards every write.
const allowedToWrite = (req) => !KEY || req.headers.authorization === 'Bearer ' + KEY;

// Read a request body, refusing anything larger than the cap up front.
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

const designPath = (id) => path.join(DESIGNS_DIR, id + '.hsproj');
const blobPath = (cid) => path.join(BLOBS_DIR, cid);

// ── The /api/v1 routes ────────────────────────────────────────────────────

async function handleV1(req, res, pathname) {
  const parts = pathname.split('/').filter(Boolean); // ['api', 'v1', ...]
  const tail = parts.slice(2).join('/');

  if (req.method === 'GET' && tail === 'ping') {
    send(res, 200, { ok: true, name: 'Home Studio node' });
    return true;
  }

  if (tail === 'designs') {
    if (req.method === 'GET') {
      const names = await fs.readdir(DESIGNS_DIR);
      const designs = [];
      for (const name of names) {
        if (!name.endsWith('.hsproj')) continue;
        const st = await fs.stat(path.join(DESIGNS_DIR, name));
        designs.push({ id: name.slice(0, -'.hsproj'.length), updatedAt: Math.round(st.mtimeMs) });
      }
      send(res, 200, { designs });
      return true;
    }
    return false; // /api/v1/designs alone is not writable
  }

  const designMatch = tail.match(/^designs\/([^/]+)$/);
  if (designMatch) {
    const id = safeId(designMatch[1]);
    if (!id) { send(res, 400, { error: 'That design id is not one this node accepts.' }); return true; }
    if (req.method === 'GET') {
      const bytes = await fs.readFile(designPath(id));
      send(res, 200, bytes, 'application/octet-stream');
      return true;
    }
    if (req.method === 'PUT') {
      if (!allowedToWrite(req)) { send(res, 401, { error: 'This node needs its access key to save designs.' }); return true; }
      const body = await readBody(req, MAX_BYTES);
      await fs.writeFile(designPath(id), body);
      log('stored design', id, body.length, 'bytes');
      send(res, 200, { updatedAt: Date.now() });
      return true;
    }
    if (req.method === 'DELETE') {
      if (!allowedToWrite(req)) { send(res, 401, { error: 'This node needs its access key to delete designs.' }); return true; }
      await fs.rm(designPath(id), { force: true });
      send(res, 200, { ok: true });
      return true;
    }
    return false;
  }

  const blobMatch = tail.match(/^blobs\/([^/]+)$/);
  if (blobMatch) {
    const cid = blobMatch[1];
    if (!isCid(cid)) { send(res, 400, { error: 'That is not a content address this node accepts.' }); return true; }
    if (req.method === 'GET') {
      const bytes = await fs.readFile(blobPath(cid)); // ENOENT -> the 404 below
      send(res, 200, bytes, 'application/octet-stream');
      return true;
    }
    if (req.method === 'PUT') {
      if (!allowedToWrite(req)) { send(res, 401, { error: 'This node needs its access key to store files.' }); return true; }
      const body = await readBody(req, MAX_BYTES);
      await fs.writeFile(blobPath(cid), body);
      send(res, 200, { cid });
      return true;
    }
    return false;
  }

  return false;
}

// ── The server ────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  if (cors(res, req)) return;
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  try {
    if (pathname === '/' && req.method === 'GET') {
      send(res, 200, 'This is a Home Studio node. Its API lives under /api/v1/ and /api/gallery.\n', 'text/plain');
      return;
    }
    if (pathname.startsWith('/api/v1/')) {
      const handled = await handleV1(req, res, pathname);
      if (handled) return;
      send(res, 405, { error: 'That request method is not one this route answers.' });
      return;
    }
    if (pathname === '/api/gallery' || pathname.startsWith('/api/gallery/')) {
      const handled = await handleGallery(req, res, pathname, {
        dir: GALLERY_DIR, adminKey: ADMIN_KEY, maxBytes: GALLERY_MAX_BYTES, log,
      });
      if (handled) return;
      send(res, 405, { error: 'That request method is not one this route answers.' });
      return;
    }
    send(res, 404, { error: 'Nothing is served at that address.' });
  } catch (err) {
    if (err && err.code === 'ENOENT') { send(res, 404, { error: 'Not found.' }); return; }
    if (err && err.status === 413) { send(res, 413, { error: 'That is too large for this node.' }); return; }
    if (err && err instanceof SyntaxError) { send(res, 400, { error: 'The request body was not readable JSON.' }); return; }
    log('request failed:', err && err.message);
    if (!res.headersSent) send(res, 500, { error: 'The node hit an error serving that request.' });
    else res.end();
  }
});

// A stopped container must not be killed mid-write: stop accepting,
// let in-flight requests finish briefly, close, exit.
let shuttingDown = false;
const shutdown = (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  log(signal + ' received, draining');
  server.close(() => process.exit(0));
  server.closeIdleConnections?.();
  const t = setTimeout(() => { server.closeAllConnections?.(); process.exit(0); }, 3000);
  t.unref?.();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

server.listen(PORT, () => log('listening on', PORT, '- data in', DATA, KEY ? '(writes need the key)' : '(writes are OPEN: set HOME_STUDIO_KEY)', ADMIN_KEY ? '' : '(gallery publish is off: set HOME_STUDIO_ADMIN_KEY)'));
