// Persistence: IndexedDB on this device, no server tables. Designs live in
// the `designs` store (keyPath id), uploaded image files as Blobs in
// `images`. The staging demo writes to its own database, `home-studio-demo`,
// so demo designs never mix with a viewer's own.

import { openDB } from 'idb';

function upgrade(db) {
  if (!db.objectStoreNames.contains('designs')) db.createObjectStore('designs', { keyPath: 'id' });
  if (!db.objectStoreNames.contains('images')) db.createObjectStore('images', { keyPath: 'id' });
}

export async function openDesignsDb(demo) {
  return openDB(demo ? 'home-studio-demo' : 'home-studio', 1, { upgrade });
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
