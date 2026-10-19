// Persistence: IndexedDB on this device, no server tables. Designs live in
// the `designs` store (keyPath id), uploaded image files as Blobs in
// `images`. Version 2 adds the library's own stores: `assets` (images, SVGs
// and fonts a person imported), `components` (saved reusable pieces) and
// `prefs` (favourites). The staging demo writes to its own database,
// `home-studio-demo`, so demo designs never mix with a viewer's own.

import { openDB } from 'idb';
import { uid, imageIdsIn, reidElement } from '../doc/model.js';

function upgrade(db) {
  for (const name of ['designs', 'images', 'assets', 'components']) {
    if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
  }
  if (!db.objectStoreNames.contains('prefs')) db.createObjectStore('prefs');
}

export const DB_VERSION = 2;
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
  await db.delete('designs', id);
  // Deleting a design also deletes its images: collect every imageId the
  // design's elements reference, then drop those blobs.
  const design = await getDesign(db, id);
  if (!design) return;
  const imageIds = new Set();
  for (const page of design.pages) {
    for (const el of page.elements) {
      if (el.type === 'image' && el.imageId) imageIds.add(el.imageId);
      for (const c of el.children || []) if (c.type === 'image' && c.imageId) imageIds.add(c.imageId);
    }
  }
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
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}
