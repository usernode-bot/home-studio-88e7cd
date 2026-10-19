// Project files (.homestudio) and backups: round trips against an in-memory
// IndexedDB, refusals of bad or newer files, and the restore rules.

import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import {
  writeProject, readProject, writeBackup, restoreBackup, FORMAT_VERSION,
} from '../web/src/project/format.js';
import { openDesignsDb, putDesign, putImage, getImage, getDesign, putAsset, listDesigns, getFavorites } from '../web/src/persist/db.js';
import { newDesign, newElement, walk } from '../web/src/doc/model.js';
import { iconSvg } from '../web/src/assets/svg.js';
import { unzipSync, strFromU8 } from 'fflate';

let n = 0;
const freshDb = () => openDesignsDb(false, 'proj-' + n++);
const checks = { imageSize: async () => {} };

function richDesign() {
  const d = newDesign('Rich', 400, 300);
  const el = newElement('text', { x: 10, y: 10, w: 200, h: 40 });
  Object.assign(el, {
    gradient: { kind: 'linear', angle: 90, to: '#ffffff' }, shadow: { x: 1, y: 2, blur: 3, color: '#000000', alpha: 0.3 },
    strokeStyle: 'dashed', outline: { color: '#000000', width: 2 }, highlight: '#fde047', italic: true,
    underline: true, strike: false, lineHeight: 1.4, letterSpacing: 2, textCase: 'upper',
  });
  const svgEl = newElement('svg', { x: 0, y: 0, w: 50, h: 50 }, { svg: iconSvg([['path', { d: 'M0 0L1 1' }]]), color: '#123456' });
  const img = newElement('image', { x: 0, y: 0, w: 80, h: 80 }, { imageId: 'img-1' });
  const group = { ...newElement('group', { x: 0, y: 0, w: 120, h: 120 }), children: [newElement('ellipse', { x: 0, y: 0, w: 30, h: 30 }), img] };
  d.pages[0].elements.push(el, svgEl, group);
  d.pages.push({ ...structuredClone(d.pages[0]), id: 'p2', name: 'Page 2' });
  return d;
}

describe('project files', () => {
  it('round-trips a design with groups, styles and images, ids rewritten', async () => {
    const db = await freshDb();
    const d = richDesign();
    await putDesign(db, d);
    await putImage(db, 'img-1', new Blob(['fakepng'], { type: 'image/png' }));
    await putImage(db, 'img-orphan', new Blob(['unused'], { type: 'image/png' }));
    const blob = await writeProject(db, d);
    const file = new File([blob], 'rich.homestudio');
    const zip = unzipSync(new Uint8Array(await file.arrayBuffer()));
    const meta = JSON.parse(strFromU8(zip['project.json']));
    expect(meta.format).toBe('home-studio-project');
    expect(meta.version).toBe(FORMAT_VERSION);
    expect(meta.images).toHaveLength(1); // the orphan image is left out

    const back = await readProject(file, checks);
    expect(back.design.name).toBe('Rich');
    expect(back.design.pages).toHaveLength(2);
    expect(back.design.id).not.toBe(d.id);
    expect(back.putImage).toHaveLength(1);
    // every element id is fresh
    const oldIds = [...walk(d.pages[0].elements)].map((e) => e.id);
    for (const el of walk(back.design.pages[0].elements)) expect(oldIds.includes(el.id)).toBe(false);
    // styles survived
    const text = back.design.pages[0].elements[0];
    expect(text.gradient).toEqual(d.pages[0].elements[0].gradient);
    expect(text.shadow).toEqual(d.pages[0].elements[0].shadow);
    expect(text.textCase).toBe('upper');
    // the group's image reference survived
    const grp = back.design.pages[0].elements.find((e) => e.type === 'group');
    expect(grp.children.some((c) => c.type === 'image')).toBe(true);
    // the svg graphic is still clean markup
    expect(back.design.pages[0].elements.find((e) => e.type === 'svg').svg).toContain('<svg');
  });

  it('refuses what is not a project file, and anything newer', async () => {
    const notZip = new File(['hello'], 'x.homestudio');
    await expect(readProject(notZip, checks)).rejects.toThrow(/isn't a Home Studio project/);
    // a real ZIP with a too-new version
    const { zipSync, strToU8 } = await import('fflate');
    const newer = new Blob([zipSync({ 'project.json': strToU8(JSON.stringify({ format: 'home-studio-project', version: 99 })) })], { type: 'application/octet-stream' });
    await expect(readProject(newer, checks)).rejects.toThrow(/newer Home Studio/);
    const wrongFormat = new Blob([zipSync({ 'project.json': strToU8(JSON.stringify({ format: 'other', version: 1 })) })], { type: 'application/octet-stream' });
    await expect(readProject(wrongFormat, checks)).rejects.toThrow(/isn't a Home Studio project/);
    const empty = new Blob([zipSync({ 'other.json': strToU8('{}') })], { type: 'application/octet-stream' });
    await expect(readProject(empty, checks)).rejects.toThrow(/isn't a Home Studio project/);
  });

  it('stores a reimported design as a usable, editable design', async () => {
    const db = await freshDb();
    const d = richDesign();
    await putDesign(db, d);
    await putImage(db, 'img-1', new Blob(['fakepng'], { type: 'image/png' }));
    const file = new File([await writeProject(db, d)], 'rich.homestudio');
    const back = await readProject(file, checks);
    for (const i of back.putImage) await putImage(db, i.id, i.blob);
    await putDesign(db, back.design);
    const stored = await getDesign(db, back.design.id);
    expect(stored.pages).toHaveLength(2);
    const ids = [...walk(stored.pages[0].elements)].map((e) => e.id);
    for (const el of walk(stored.pages[0].elements)) if (el.type === 'image') expect(await getImage(db, el.imageId)).toBeTruthy();
    expect(ids.length).toBeGreaterThan(0);
  });
});

describe('backups', () => {
  it('restores everything into an empty database', async () => {
    const src = await freshDb();
    const d = richDesign();
    await putDesign(src, d);
    await putImage(src, 'img-1', new Blob(['fakepng'], { type: 'image/png' }));
    await putAsset(src, { id: 'font-1', kind: 'font', name: 'Hand', createdAt: 1, blob: new Blob(['f'], { type: 'font' }) });
    const backup = await writeBackup(src);
    const zip = unzipSync(new Uint8Array(await backup.arrayBuffer()));
    expect(JSON.parse(strFromU8(zip['backup.json'])).format).toBe('home-studio-backup');

    const dst = await freshDb();
    const added = await restoreBackup(dst, new File([backup], 'b.homestudio-backup'));
    expect(added.designs).toBe(1);
    expect((await listDesigns(dst)).map((x) => x.name)).toEqual(['Rich']);
    const img = await dst.get('images', 'img-1');
    expect(await img.blob.text()).toBe('fakepng');
    expect(await dst.get('assets', 'font-1')).toBeTruthy();
    await restoreBackup(dst, new File([backup], 'b.homestudio-backup'));
  });

  it('skips identical designs, copies changed ones as "(restored)", deletes nothing', async () => {
    const src = await freshDb();
    const d = richDesign();
    await putDesign(src, d);
    const backup = await writeBackup(src);
    const dst = await freshDb();
    await putDesign(dst, structuredClone(d)); // same id, same updatedAt
    let added = await restoreBackup(dst, new File([backup], 'b'));
    expect(added.designs).toBe(0);
    expect(added.restored).toBe(0);
    expect(await listDesigns(dst)).toHaveLength(1);

    const changed = structuredClone(d);
    changed.updatedAt = d.updatedAt + 1;
    changed.pages[0].elements[0].x = 999; // differs -> comes in as a copy
    await putDesign(dst, changed);
    added = await restoreBackup(dst, new File([backup], 'b'));
    expect(added.restored).toBe(1);
    const list = await listDesigns(dst);
    expect(list).toHaveLength(2);
    expect(list.map((x) => x.name).sort()).toEqual(['Rich', 'Rich (restored)']);
    // the device's own copy is untouched
    expect((await getDesign(dst, d.id)).pages[0].elements[0].x).toBe(999);
  });

  it('refuses a backup from a newer Home Studio', async () => {
    const { zipSync, strToU8 } = await import('fflate');
    const newer = new Blob([zipSync({ 'backup.json': strToU8(JSON.stringify({ format: 'home-studio-backup', version: 99 })) })]);
    await expect(restoreBackup(await freshDb(), new File([newer], 'b'))).rejects.toThrow(/newer Home Studio/);
  });
});