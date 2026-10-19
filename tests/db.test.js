// Storage on this device, against an in-memory IndexedDB: the version-2
// upgrade, imports, favourites, components and duplicating designs.

import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { openDB } from 'idb';
import {
  openDesignsDb, putDesign, getDesign, listDesigns, putImage, getImage, duplicateDesign, putAsset, listAssets,
  deleteAsset, getFavorites, setFavorite, saveComponent, listComponents, componentElements, deleteComponent,
} from '../web/src/persist/db.js';
import { newDesign, newElement, walk } from '../web/src/doc/model.js';
import { instantiateTemplate, TEMPLATES } from '../web/src/assets/templates.js';

let n = 0;
const freshDb = () => openDesignsDb(false, 'test-' + n++);
const blob = (text) => new Blob([text], { type: 'image/png' });

function designWithImage() {
  const d = newDesign('Poster', 400, 400);
  const img = newElement('image', { x: 10, y: 10, w: 100, h: 100 }, { imageId: 'img-1' });
  const group = { ...newElement('group', { x: 0, y: 0, w: 200, h: 200 }), children: [newElement('image', { x: 0, y: 0, w: 50, h: 50 }, { imageId: 'img-2' })] };
  d.pages[0].elements.push(img, group);
  return d;
}

describe('database', () => {
  it('upgrades a version-1 database without losing designs', async () => {
    const name = 'upgrade-' + n++;
    const v1 = await openDB(name, 1, { upgrade(db) { db.createObjectStore('designs', { keyPath: 'id' }); db.createObjectStore('images', { keyPath: 'id' }); } });
    await v1.put('designs', newDesign('Old', 100, 100));
    v1.close();
    const db = await openDesignsDb(false, name);
    expect((await listDesigns(db)).map((d) => d.name)).toEqual(['Old']);
    expect([...db.objectStoreNames].sort()).toEqual(['assets', 'components', 'designs', 'images', 'prefs', 'versions']);
  });

  it('duplicates a design with new ids and its own image copies', async () => {
    const db = await freshDb();
    const d = designWithImage();
    await putDesign(db, d);
    await putImage(db, 'img-1', blob('one'));
    await putImage(db, 'img-2', blob('two'));
    const copy = await duplicateDesign(db, d.id);
    expect(copy.name).toBe('Poster copy');
    expect(copy.id).not.toBe(d.id);
    const els = [...walk(copy.pages[0].elements)];
    const origIds = [...walk(d.pages[0].elements)].map((e) => e.id);
    expect(els.some((e) => origIds.includes(e.id))).toBe(false);
    const imageIds = els.filter((e) => e.type === 'image').map((e) => e.imageId);
    expect(imageIds).toHaveLength(2);
    expect(imageIds).not.toContain('img-1');
    expect(await (await getImage(db, imageIds[0])).text()).toBe('one');
    expect(await (await getImage(db, imageIds[1])).text()).toBe('two');
    expect(await getDesign(db, copy.id)).toBeTruthy();
    expect((await listDesigns(db))).toHaveLength(2);
  });

  it('saves a used template as a normal, editable design', async () => {
    const db = await freshDb();
    const d = instantiateTemplate(TEMPLATES.find((t) => t.category === 'Presentations'));
    await putDesign(db, d);
    const back = await getDesign(db, d.id);
    expect(back.pages.length).toBe(3);
    back.pages[0].elements[0].x = 77;
    await putDesign(db, back);
    expect((await getDesign(db, d.id)).pages[0].elements[0].x).toBe(77);
  });

  it('keeps imports, newest first, and removes them', async () => {
    const db = await freshDb();
    await putAsset(db, { id: 'a', kind: 'image', name: 'Photo', createdAt: 1, blob: blob('x'), w: 2, h: 2 });
    await putAsset(db, { id: 'b', kind: 'svg', name: 'Logo', createdAt: 2, svg: '<svg/>' });
    await putAsset(db, { id: 'c', kind: 'font', name: 'Hand', createdAt: 3, blob: blob('f') });
    expect((await listAssets(db)).map((a) => a.id)).toEqual(['c', 'b', 'a']);
    expect((await listAssets(db, 'svg')).map((a) => a.id)).toEqual(['b']);
    await deleteAsset(db, 'b');
    expect((await listAssets(db)).map((a) => a.id)).toEqual(['c', 'a']);
  });

  it('remembers favourites', async () => {
    const db = await freshDb();
    expect([...(await getFavorites(db))]).toEqual([]);
    await setFavorite(db, 'icon:Heart', true);
    await setFavorite(db, 'tpl:quote-post', true);
    await setFavorite(db, 'icon:Heart', false);
    expect([...(await getFavorites(db))]).toEqual(['tpl:quote-post']);
  });

  it('saves a component that outlives its design, and inserts fresh copies', async () => {
    const db = await freshDb();
    await putImage(db, 'img-1', blob('one'));
    const els = [
      newElement('rect', { x: 100, y: 50, w: 40, h: 40 }),
      newElement('image', { x: 150, y: 60, w: 20, h: 20 }, { imageId: 'img-1' }),
    ];
    const comp = await saveComponent(db, 'Badge', els, { x: 100, y: 50, w: 70, h: 40 });
    expect(comp.elements.map((e) => [e.x, e.y])).toEqual([[0, 0], [50, 10]]);
    const savedImage = comp.elements[1].imageId;
    expect(savedImage).not.toBe('img-1');
    await db.delete('images', 'img-1'); // the design that held the original is gone
    expect((await listComponents(db)).map((c) => c.name)).toEqual(['Badge']);

    const placed = await componentElements(db, comp, 10, 20);
    expect(placed.map((e) => [e.x, e.y])).toEqual([[10, 20], [60, 30]]);
    expect(placed.map((e) => e.id)).not.toContain(comp.elements[0].id);
    expect(await (await getImage(db, placed[1].imageId)).text()).toBe('one');
    expect(placed[1].imageId).not.toBe(savedImage);

    await deleteComponent(db, comp.id);
    expect(await listComponents(db)).toEqual([]);
    expect(await getImage(db, savedImage)).toBe(null);
    expect(await getImage(db, placed[1].imageId)).toBeTruthy(); // placed copies stay
  });
});
