// Persistence: IndexedDB on this device, no server tables. Designs live in
// the `designs` store (keyPath id), uploaded image files as Blobs in
// `images`. Version 2 adds the library's own stores: `assets` (images, SVGs
// and fonts a person imported), `components` (saved reusable pieces) and
// `prefs` (favourites). Version 3 adds `versions`, each design's earlier
// versions (indexed by designId). Version 4 adds `outbox`, the changes
// waiting to go to a remote store (persist/adapters/queue.js). The
// staging demo writes to its own
// database, `home-studio-demo`, so demo designs never mix with a viewer's own.

import { openDB } from 'idb';
import { uid, imageIdsIn, reidElement } from '../doc/model.js';
import { blobToBytes } from '../io/binary.js';
import { freshCopy } from '../io/project.js';

function upgrade(db, _oldVersion, _newVersion, tx) {
  for (const name of ['designs', 'images', 'assets', 'components']) {
    if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
  }
  if (!db.objectStoreNames.contains('prefs')) db.createObjectStore('prefs');
  if (!db.objectStoreNames.contains('outbox')) {
    db.createObjectStore('outbox', { keyPath: 'id' }).createIndex('designId', 'designId');
  } else if (!tx.objectStore('outbox').indexNames.contains('designId')) {
    tx.objectStore('outbox').createIndex('designId', 'designId');
  }
  if (!db.objectStoreNames.contains('versions')) {
    db.createObjectStore('versions', { keyPath: 'id' }).createIndex('designId', 'designId');
  } else if (!tx.objectStore('versions').indexNames.contains('designId')) {
    tx.objectStore('versions').createIndex('designId', 'designId');
  }
}

export const DB_VERSION = 4;
export async function openDesignsDb(demo, name) {
  return openDB(name || (demo ? 'home-studio-demo' : 'home-studio'), DB_VERSION, { upgrade });
}

export async function listDesigns(db) {
  if (!db) return [];
  const all = await db.getAll('designs');
  return all.sort((a, b) => b.updatedAt - a.updatedAt); // newest first
}

export async function putDesign(db, design) {
  await db.put('designs', structuredClone(design));
}

export async function getDesign(db, id) {
  return db.get('designs', id);
}

export async function deleteDesign(db, id) {
  // Read the design before it is gone: its elements decide which image
  // blobs go with it. Deleting first left every blob orphaned.
  const design = await getDesign(db, id);
  await db.delete('designs', id);
  for (const v of await listVersions(db, id)) await db.delete('versions', v.id);
  if (!design) return;
  const imageIds = new Set();
  for (const page of design.pages) for (const imageId of imageIdsIn(page.elements)) imageIds.add(imageId);
  for (const imageId of imageIds) await db.delete('images', imageId);
}

export async function putImage(db, id, blob) {
  await db.put('images', { id, blob });
}

export async function getImage(db, id) {
  const row = await db.get('images', id);
  return row ? row.blob : null;
}

// A copy of an image blob under a new id, so whatever holds the copy keeps
// it when the original's design is deleted. Resolves the new id, or null.
export async function copyImage(db, fromId) {
  const blob = await getImage(db, fromId);
  if (!blob) return null;
  const id = uid();
  await putImage(db, id, blob);
  return id;
}

// Point every image element at its own copy of its blob.
async function copyImagesIn(db, elements) {
  const map = new Map();
  for (const id of imageIdsIn(elements)) map.set(id, await copyImage(db, id));
  const visit = (els) => {
    for (const el of els) {
      if (el.type === 'image' && map.get(el.imageId)) el.imageId = map.get(el.imageId);
      if (el.children) visit(el.children);
    }
  };
  visit(elements);
  return elements;
}

// Duplicate a design: new ids for it, its pages and elements, and its own
// copies of its images. Resolves the saved copy.
export async function duplicateDesign(db, id) {
  const src = await getDesign(db, id);
  if (!src) return null;
  const copy = structuredClone(src);
  copy.id = uid();
  copy.name = src.name + ' copy';
  copy.createdAt = Date.now();
  copy.updatedAt = Date.now();
  for (const page of copy.pages) {
    page.id = uid();
    page.elements.forEach(reidElement);
    for (const g of page.guides || []) g.id = uid();
    await copyImagesIn(db, page.elements);
  }
  await putDesign(db, copy);
  return copy;
}

// ── Library: imports, components, favourites ─────────────────────────────
// An asset: { id, kind: 'image'|'svg'|'font', name, createdAt, blob?, svg?, w?, h? }

export async function putAsset(db, asset) {
  await db.put('assets', asset);
}

export async function listAssets(db, kind) {
  if (!db) return [];
  const all = await db.getAll('assets');
  return all.filter((a) => !kind || a.kind === kind).sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteAsset(db, id) {
  await db.delete('assets', id);
}

// A component: { id, name, w, h, elements (relative to its own 0,0), createdAt }.
// Its image blobs are its own copies, made when it was saved.
export async function saveComponent(db, name, elements, box) {
  const els = structuredClone(elements).map((el) => ({ ...el, x: el.x - box.x, y: el.y - box.y }));
  await copyImagesIn(db, els);
  const comp = { id: uid(), name, w: box.w, h: box.h, elements: els, createdAt: Date.now() };
  await db.put('components', comp);
  return comp;
}

export async function listComponents(db) {
  if (!db) return [];
  return (await db.getAll('components')).sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteComponent(db, id) {
  const comp = await db.get('components', id);
  await db.delete('components', id);
  if (comp) for (const imageId of imageIdsIn(comp.elements)) await db.delete('images', imageId);
}

// A component's elements placed at (x, y) on a page, with fresh ids and
// their own image copies.
export async function componentElements(db, comp, x, y) {
  const els = structuredClone(comp.elements).map((el) => reidElement({ ...el, x: el.x + x, y: el.y + y }));
  return copyImagesIn(db, els);
}

export async function getFavorites(db) {
  if (!db) return new Set();
  return new Set((await db.get('prefs', 'favorites')) || []);
}

export async function setFavorite(db, id, on) {
  const favs = await getFavorites(db);
  if (on) favs.add(id);
  else favs.delete(id);
  await db.put('prefs', [...favs], 'favorites');
  return favs;
}

// The 800 ms debounced autosave. Returns a { schedule, cancel, flush } object
// that owns its own timer; the app feeds it each new document state.
export function createAutoSaver(save) {
  let timer = null;
  let pending = null;
  const run = async () => {
    timer = null;
    const doc = pending;
    pending = null;
    if (!doc) return;
    try {
      await save(doc);
    } catch {
      // Quota exceeded or store closed: report, keep editing.
      throw new Error('not-saved');
    }
  };
  return {
    schedule(doc) {
      pending = doc;
      if (!timer) timer = setTimeout(run, 800);
    },
    // Save what is waiting now (the page is being hidden or closed).
    flush() {
      if (!timer) return Promise.resolve();
      clearTimeout(timer);
      return run();
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}

// ── Version history ──────────────────────────────────────────────────────
// A version: { id, designId, createdAt, label, auto, design (a full copy,
// images by id: their blobs stay in `images` with the design) }. Automatic
// versions are kept to the newest VERSIONS_AUTO_KEEP per design; versions
// a person saved are kept until the design is deleted.

export const VERSIONS_AUTO_KEEP = 30;
export const AUTO_VERSION_MS = 10 * 60 * 1000;

export async function listVersions(db, designId) {
  if (!db) return [];
  const all = await db.getAllFromIndex('versions', 'designId', designId);
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function addVersion(db, design, label, auto = false) {
  const v = { id: uid(), designId: design.id, createdAt: Date.now(), label, auto, design: structuredClone(design) };
  await db.put('versions', v);
  if (auto) {
    const autos = (await listVersions(db, design.id)).filter((x) => x.auto);
    for (const old of autos.slice(VERSIONS_AUTO_KEEP)) await db.delete('versions', old.id);
  }
  return v;
}

export async function deleteVersion(db, id) {
  await db.delete('versions', id);
}

// Whether an automatic version is due: the design changed since the last
// version, and the last one is older than AUTO_VERSION_MS.
export function autoVersionDue(design, last, now = Date.now()) {
  if (!design) return false;
  if (!last) return true;
  if (now - last.createdAt < AUTO_VERSION_MS) return false;
  return JSON.stringify(last.design.pages) !== JSON.stringify(design.pages) || last.design.name !== design.name;
}

// ── Project files and backups ────────────────────────────────────────────

async function imageFiles(getImageBlob, ids) {
  const out = [];
  for (const id of ids) {
    const blob = await getImageBlob(id);
    if (blob) out.push({ id, type: blob.type || 'image/png', bytes: await blobToBytes(blob) });
  }
  return out;
}

function fontKeysIn(pagesList) {
  const keys = new Set();
  const visit = (els) => {
    for (const el of els) {
      if (el.type === 'text' && typeof el.font === 'string' && el.font.startsWith('user:')) keys.add(el.font.slice(5));
      if (el.children) visit(el.children);
    }
  };
  for (const p of pagesList) visit(p.elements);
  return keys;
}

// What a project file holds: the design, its images and the imported fonts
// its text uses. `getImage(id)` and `getAsset(id)` read them (from this
// database, or from what the open design holds when storage is broken).
export async function collectProject(design, { getImage: getImageBlob, getAsset }) {
  const ids = new Set();
  for (const p of design.pages) for (const id of imageIdsIn(p.elements)) ids.add(id);
  const fonts = [];
  for (const fid of fontKeysIn(design.pages)) {
    const a = await getAsset(fid);
    if (a && a.blob) fonts.push({ id: a.id, name: a.name, type: a.blob.type || '', bytes: await blobToBytes(a.blob) });
  }
  return { design: structuredClone(design), images: await imageFiles(getImageBlob, ids), fonts };
}

// Everything on this device, for a backup file.
export async function collectBackup(db) {
  const designs = await listDesigns(db);
  const versions = await db.getAll('versions');
  const components = await listComponents(db);
  const ids = new Set();
  for (const d of [...designs, ...versions.map((v) => v.design)]) for (const p of d.pages) for (const id of imageIdsIn(p.elements)) ids.add(id);
  for (const c of components) for (const id of imageIdsIn(c.elements)) ids.add(id);
  const assets = [];
  for (const a of await listAssets(db)) {
    const { blob, ...rest } = a;
    assets.push(blob ? { ...rest, type: blob.type || '', bytes: await blobToBytes(blob) } : rest);
  }
  return { designs, versions, components, assets, images: await imageFiles((id) => getImage(db, id), ids), favorites: [...(await getFavorites(db))] };
}

// A parsed project file saved as a new design on this device (its own image
// copies, its imported fonts added to the library if they are new).
// Resolves the saved design.
export async function importProject(db, parsed) {
  const { design, images } = freshCopy(parsed);
  for (const img of images) await putImage(db, img.id, new Blob([img.bytes], { type: img.type }));
  for (const f of parsed.fonts || []) {
    if (await db.get('assets', f.id)) continue;
    await putAsset(db, { id: f.id, kind: 'font', name: f.name, createdAt: Date.now(), blob: new Blob([f.bytes], { type: f.type }) });
  }
  await putDesign(db, design);
  return design;
}

// Restore a parsed backup. A design already here is replaced only when the
// backup's copy is newer; images, library files, components and versions
// are added when missing. Resolves counts for the summary.
export async function restoreBackup(db, parsed) {
  const out = { added: 0, replaced: 0, kept: 0, library: 0, components: 0, versions: 0 };
  for (const img of parsed.images) {
    if (!(await db.get('images', img.id))) await putImage(db, img.id, new Blob([img.bytes], { type: img.type }));
  }
  for (const d of parsed.designs) {
    const here = await getDesign(db, d.id);
    if (!here) { await putDesign(db, d); out.added += 1; }
    else if (d.updatedAt > here.updatedAt) { await putDesign(db, d); out.replaced += 1; }
    else out.kept += 1;
  }
  for (const v of parsed.versions) {
    if (!(await db.get('versions', v.id))) { await db.put('versions', { ...v, auto: false, restored: true }); out.versions += 1; }
  }
  // Restored versions are kept, not automatic, so nothing prunes them:
  // restoring backup after backup would grow the store without end. They
  // are capped the same way autos are, per design; versions a person
  // saved are never touched.
  for (const designId of new Set(parsed.versions.map((v) => v.designId))) {
    const kept = (await listVersions(db, designId)).filter((v) => v.restored);
    for (const old of kept.slice(VERSIONS_AUTO_KEEP)) await db.delete('versions', old.id);
  }
  for (const a of parsed.assets) {
    if (await db.get('assets', a.id)) continue;
    const { bytes, type, ...rest } = a;
    await putAsset(db, bytes ? { ...rest, blob: new Blob([bytes], { type }) } : rest);
    out.library += 1;
  }
  for (const c of parsed.components) {
    if (!(await db.get('components', c.id))) { await db.put('components', c); out.components += 1; }
  }
  const favs = await getFavorites(db);
  for (const f of parsed.favorites) favs.add(f);
  await db.put('prefs', [...favs], 'favorites');
  return out;
}

export async function getPref(db, key) {
  return db ? db.get('prefs', key) : undefined;
}

export async function setPref(db, key, value) {
  await db.put('prefs', value, key);
}
