// Home Studio project files (.homestudio) and whole-library backups
// (.homestudio-backup): ZIPs holding a versioned JSON description plus the
// design's image and font blobs. A newer version's file is refused with a
// clear message, never half-read. Limits are checked before inflating, so a
// ZIP bomb is refused up front.

import { zipSync, unzipSync, strFromU8, strToU8 } from 'fflate';
import { uid, reidElement } from '../doc/model.js';
import { normalizeDesign } from '../doc/validate.js';
import { IMAGE_MAX_BYTES, FONT_MAX_BYTES } from '../assets/imports.js';
import { sanitizeSvg } from '../assets/svg.js';

export const PROJECT_FORMAT = 'home-studio-project';
export const BACKUP_FORMAT = 'home-studio-backup';
export const FORMAT_VERSION = 1;
const JSON_MAX_BYTES = 20 * 1024 * 1024;
const TOTAL_MAX_BYTES = 1024 * 1024 * 1024;
const FILE_IN_MAX = 500 * 1024 * 1024;

const extOf = (type) => (type === 'image/jpeg' ? 'jpg' : type === 'image/svg+xml' ? 'svg' : 'png');

// ── Project files ────────────────────────────────────────────────────────

// One design as a .homestudio ZIP. Imported fonts the design uses travel
// with it, keyed `user:<assetId>`; `fonts` maps assetId -> blob.
export async function writeProject(db, design) {
  const images = [];
  const files = {};
  const seen = new Set();
  const collect = (els) => {
    for (const el of els) {
      if (el.type === 'image' && el.imageId && !seen.has(el.imageId)) {
        seen.add(el.imageId);
        images.push(el.imageId);
      }
      if (el.children) collect(el.children);
    }
  };
  for (const p of design.pages) collect(p.elements);
  const entries = [];
  for (const id of images) {
    const row = await db.get('images', id);
    if (!row) continue;
    const bytes = new Uint8Array(await row.blob.arrayBuffer());
    const file = `images/${id}.png`;
    files[file] = bytes;
    entries.push({ id, file, type: 'image/png', size: bytes.length });
  }
  const fontEntries = [];
  const fontIds = new Set();
  const collectFonts = (els) => {
    for (const el of els) {
      if (el.type === 'text' && typeof el.font === 'string' && el.font.startsWith('user:')) fontIds.add(el.font.slice(5));
      if (el.children) collectFonts(el.children);
    }
  };
  for (const p of design.pages) collectFonts(p.elements);
  for (const assetId of fontIds) {
    const asset = await db.get('assets', assetId);
    if (!asset || !asset.blob) continue;
    const bytes = new Uint8Array(await asset.blob.arrayBuffer());
    const file = `fonts/${assetId}.bin`;
    files[file] = bytes;
    fontEntries.push({ key: `user:${assetId}`, name: asset.name, file, type: asset.blob.type || 'font' });
  }
  const meta = {
    format: PROJECT_FORMAT,
    version: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    design: structuredClone(design),
    images: entries,
    fonts: fontEntries,
  };
  files['project.json'] = strToU8(JSON.stringify(meta));
  return new Blob([zipSync(files)], { type: 'application/octet-stream' });
}

const extType = (name) => (/\.jpe?g$/i.test(name) ? 'image/jpeg' : /\.svg$/i.test(name) ? 'image/svg+xml' : 'image/png');

// A .homestudio file back into a new design, images and fonts, with fresh
// ids everywhere. `checks.imageSize(blob)` is the browser's decode check.
// Resolves { design, putImage, putAsset } lists ready to store.
export async function readProject(file, checks) {
  if (file.size > FILE_IN_MAX) throw new Error('That project file is larger than 500 MB.');
  let entries;
  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter: (f) => {
        if (f.originalSize > IMAGE_MAX_BYTES && !f.name.endsWith('.bin')) throw new Error('A file inside the project is too large.');
        if (f.name.endsWith('.bin') && f.originalSize > FONT_MAX_BYTES) throw new Error('A font inside the project is too large.');
        return true;
      },
    });
  } catch (err) {
    if (/too large|isn't/.test(err.message)) throw err;
    throw new Error("That file isn't a Home Studio project file.");
  }
  const json = entries['project.json'];
  if (!json) throw new Error("That file isn't a Home Studio project file.");
  if (json.length > JSON_MAX_BYTES) throw new Error('That project file is too large.');
  let meta;
  try { meta = JSON.parse(strFromU8(json)); } catch { throw new Error("The project file's contents can't be read."); }
  if (meta.format !== PROJECT_FORMAT) throw new Error("That file isn't a Home Studio project file.");
  if (meta.version > FORMAT_VERSION) throw new Error('That file was made by a newer Home Studio. Update the app, then try again.');
  if (meta.version < 1) throw new Error("That project file isn't a Home Studio project file.");
  const total = Object.values(entries).reduce((a, e) => a + e.length, 0);
  if (total > TOTAL_MAX_BYTES) throw new Error('That project file is too large.');

  const design = normalizeDesign(meta.design);
  // Everything gets fresh ids: the design, its pages and every element, so
  // importing never collides with a design already on the device.
  design.id = uid();
  for (const page of design.pages) {
    page.id = uid();
    for (const g of page.guides || []) g.id = uid();
    page.elements.forEach(reidElement);
  }
  const putImage = [];
  for (const entry of meta.images || []) {
    if (!entry || !/^[a-z0-9-]+$/i.test(entry.id)) throw new Error("An image reference in the project file is malformed.");
    const bytes = entries[entry.file];
    if (!bytes) throw new Error('The project file is missing one of its images.');
    const blob = new Blob([bytes], { type: entry.type || extType(entry.file) });
    if (checks.imageSize) await checks.imageSize(blob).catch(() => { throw new Error('An image inside the project file can\'t be opened.'); });
    putImage.push({ id: entry.id, blob });
  }
  const putAsset = [];
  for (const entry of meta.fonts || []) {
    const bytes = entries[entry.file];
    if (!bytes) continue;
    putAsset.push({ id: uid(), key: entry.key, name: entry.name || 'Imported font', blob: new Blob([bytes], { type: entry.type || 'font' }) });
  }
  return { design, putImage, putAsset };
}

// ── Backups ──────────────────────────────────────────────────────────────

export async function writeBackup(db) {
  const designs = await db.getAll('designs');
  const images = await db.getAll('images');
  const assets = await db.getAll('assets');
  const components = await db.getAll('components');
  const favorites = [...(await db.get('prefs', 'favorites') || [])];
  const files = {};
  const slimImages = [];
  for (const row of images) {
    const bytes = new Uint8Array(await row.blob.arrayBuffer());
    const file = `images/${row.id}`;
    files[file] = bytes;
    slimImages.push({ id: row.id, file, type: row.blob.type || 'image/png' });
  }
  const slimAssets = [];
  for (const a of assets) {
    const out = { ...a };
    if (a.blob) {
      const bytes = new Uint8Array(await a.blob.arrayBuffer());
      out.file = `assets/${a.id}`;
      out.type = a.blob.type || 'application/octet-stream';
      delete out.blob;
      files[out.file] = bytes;
    }
    slimAssets.push(out);
  }
  const meta = {
    format: BACKUP_FORMAT,
    version: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    designs, images: slimImages, assets: slimAssets, components, favorites,
  };
  files['backup.json'] = strToU8(JSON.stringify(meta));
  return new Blob([zipSync(files)], { type: 'application/octet-stream' });
}

// Restore only adds: nothing on the device is replaced or deleted. A design
// already here unchanged is skipped; one that differs comes in as
// "Name (restored)". Resolves how many of each came in.
export async function restoreBackup(db, file) {
  if (file.size > FILE_IN_MAX) throw new Error('That backup file is larger than 500 MB.');
  let entries;
  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter: (f) => {
        if (f.originalSize > IMAGE_MAX_BYTES) throw new Error('A file inside the backup is too large.');
        return true;
      },
    });
  } catch (err) {
    if (/too large/.test(err.message)) throw err;
    throw new Error("That file isn't a Home Studio backup.");
  }
  const json = entries['backup.json'];
  if (!json) throw new Error("That file isn't a Home Studio backup.");
  let meta;
  try { meta = JSON.parse(strFromU8(json)); } catch { throw new Error("The backup's contents can't be read."); }
  if (meta.format !== BACKUP_FORMAT) throw new Error("That file isn't a Home Studio backup.");
  if (meta.version > FORMAT_VERSION) throw new Error('That backup was made by a newer Home Studio. Update the app, then try again.');

  const added = { designs: 0, restored: 0, assets: 0, components: 0 };
  for (const image of meta.images || []) {
    const bytes = entries[image.file];
    if (!bytes) continue;
    await db.put('images', { id: image.id, blob: new Blob([bytes], { type: image.type || 'image/png' }) });
  }
  for (const a of meta.assets || []) {
    const out = { ...a };
    if (out.file) {
      const bytes = entries[out.file];
      if (!bytes) continue;
      out.blob = new Blob([bytes], { type: out.type });
      delete out.file;
      delete out.type;
    }
    const existing = await db.get('assets', out.id);
    if (existing) continue; // never replaced
    await db.put('assets', out);
    added.assets += 1;
  }
  for (const c of meta.components || []) {
    const existing = await db.get('components', c.id);
    if (existing) continue;
    await db.put('components', c);
    added.components += 1;
  }
  for (const d of meta.designs || []) {
    const design = normalizeDesign(d);
    const existing = await db.get('designs', design.id);
    if (existing) {
      if (existing.updatedAt === design.updatedAt) continue; // already here, unchanged
      design.id = uid();
      design.name = `${design.name} (restored)`;
      added.restored += 1;
    } else {
      added.designs += 1;
    }
    design.updatedAt = Date.now();
    await db.put('designs', design);
  }
  const favs = new Set(await db.get('prefs', 'favorites') || []);
  for (const f of meta.favorites || []) favs.add(f);
  await db.put('prefs', [...favs], 'favorites');
  return added;
}