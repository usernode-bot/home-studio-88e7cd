// Home Studio's own files (projects and backups), the database side of
// importing and restoring them, version history, crash recovery, storage
// warnings, the wider image formats and the offline service worker build.

import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import {
  serializeProject, serializeBackup, parseHomeStudioFile, freshCopy, FORMAT_VERSION,
} from '../web/src/io/project.js';
import {
  openDesignsDb, putDesign, getDesign, listDesigns, putImage, getImage, putAsset, listAssets, setFavorite, getFavorites,
  saveComponent, listComponents, deleteDesign, addVersion, listVersions, autoVersionDue, AUTO_VERSION_MS, VERSIONS_AUTO_KEEP,
  collectProject, collectBackup, importProject, restoreBackup, createAutoSaver,
} from '../web/src/persist/db.js';
import { writeJournal, readJournal, clearJournal, recoveryOffer } from '../web/src/persist/recovery.js';
import { quotaLevel, formatBytes, isQuotaError } from '../web/src/persist/storage.js';
import { classifyFile, assetFromFile, needsConversion } from '../web/src/assets/imports.js';
import { sanitizeSvg } from '../web/src/assets/svg.js';
import { pdfPageSize } from '../web/src/import/pdf.js';
import { precacheList, renderServiceWorker, PRECACHE_MAX_BYTES } from '../build/sw-plugin.js';
import { fromUtf8 } from '../web/src/io/binary.js';
import { buildDemoDesigns } from '../web/src/demo.js';
import { newDesign, newElement, walk } from '../web/src/doc/model.js';

let n = 0;
const freshDb = () => openDesignsDb(false, 'project-test-' + n++);
const bytes = (s) => new TextEncoder().encode(s);
const text = (b) => fromUtf8(b);

function designWithImageAndFont() {
  const d = newDesign('Poster', 400, 300);
  d.pages[0].elements.push(
    newElement('image', { x: 10, y: 10, w: 100, h: 80 }, { imageId: 'img-1', crop: { l: 0.1, t: 0, r: 0, b: 0 }, mask: 'circle' }),
    newElement('text', { x: 0, y: 200, w: 300, h: 40 }, { text: 'Hello', font: 'user:font-1' }),
    { ...newElement('group', { x: 200, y: 0, w: 100, h: 100 }), children: [newElement('rect', { x: 0, y: 0, w: 50, h: 50 }, { gradient: { kind: 'radial', angle: 0, to: '#ff0000' } })] },
  );
  return d;
}

describe('project files', () => {
  it('round-trips a design with its pages, layers, images and fonts', () => {
    const [poster] = buildDemoDesigns();
    const file = serializeProject({ design: poster, images: [{ id: 'x', type: 'image/png', bytes: bytes('PNGDATA') }], fonts: [{ id: 'f', name: 'Hand', type: 'font/woff2', bytes: bytes('FONT') }] });
    const raw = JSON.parse(text(file));
    expect(raw).toMatchObject({ format: 'home-studio', kind: 'project', version: FORMAT_VERSION, app: { name: 'Home Studio' } });
    const parsed = parseHomeStudioFile(text(file));
    expect(parsed.design).toEqual(poster);
    expect(text(parsed.images[0].bytes)).toBe('PNGDATA');
    expect(parsed.fonts[0]).toMatchObject({ id: 'f', name: 'Hand', type: 'font/woff2' });
    expect(parsed.warnings).toEqual([]);
  });

  it('refuses files that are not Home Studio files, damaged, or from a newer version', () => {
    expect(() => parseHomeStudioFile('not json')).toThrow(/isn't a Home Studio file/);
    expect(() => parseHomeStudioFile('{"format":"other"}')).toThrow(/isn't a Home Studio file/);
    expect(() => parseHomeStudioFile(JSON.stringify({ format: 'home-studio', kind: 'project', version: 99 }))).toThrow(/newer version/);
    expect(() => parseHomeStudioFile(JSON.stringify({ format: 'home-studio', kind: 'project', version: 1, design: { pages: [] } }))).toThrow(/doesn't contain a design/);
    expect(() => parseHomeStudioFile(JSON.stringify({ format: 'home-studio', kind: 'thing', version: 1 }))).toThrow(/kind/);
  });

  it('cleans what comes in: active SVG, unsafe colours, unknown items, sizes out of range', () => {
    const evil = {
      format: 'home-studio', kind: 'project', version: 1,
      design: {
        name: 'Imported', pages: [{
          width: 99999, height: 3, background: 'url(https://tracker.example/x)',
          elements: [
            { type: 'svg', x: 0, y: 0, w: 10, h: 10, svg: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect onclick="x()" width="5" height="5"/></svg>' },
            { type: 'rect', x: 'NaN', y: Infinity, w: 10, h: 10, fill: 'red;background:url(x)', extra: 'dropped' },
            { type: 'iframe', src: 'https://example.com' },
            { type: 'image', x: 0, y: 0, w: 10, h: 10, imageId: 'missing' },
            { type: 'text', text: 'Hi', size: 1e9, weight: 1234, align: 'sideways' },
          ],
        }],
      },
      images: [{ id: 'bad', type: 'text/html', data: 'PGgxPg==' }],
    };
    const parsed = parseHomeStudioFile(JSON.stringify(evil));
    const page = parsed.design.pages[0];
    expect([page.width, page.height, page.background]).toEqual([10000, 16, '#ffffff']);
    expect(page.elements.map((e) => e.type)).toEqual(['svg', 'rect', 'image', 'text']);
    expect(page.elements[0].svg).not.toMatch(/script|onclick/);
    expect(page.elements[1]).toMatchObject({ x: 0, y: 0, fill: '#6b7280' });
    expect(page.elements[1].extra).toBeUndefined();
    expect(page.elements[3]).toMatchObject({ size: 2000, weight: 900, align: 'left' });
    expect(parsed.images).toEqual([]);
    expect(parsed.warnings.join(' ')).toMatch(/1 item couldn't be read/);
    expect(parsed.warnings.join(' ')).toMatch(/1 embedded file wasn't usable/);
    expect(parsed.warnings.join(' ')).toMatch(/1 image is missing/);
  });

  it('becomes a fresh design with its own image ids', () => {
    const d = designWithImageAndFont();
    const parsed = parseHomeStudioFile(text(serializeProject({ design: d, images: [{ id: 'img-1', type: 'image/png', bytes: bytes('a') }] })));
    const copy = freshCopy(parsed);
    expect(copy.design.id).not.toBe(d.id);
    const img = copy.design.pages[0].elements[0];
    expect(img.imageId).not.toBe('img-1');
    expect(copy.images.map((i) => i.id)).toEqual([img.imageId]);
    expect(parsed.design.pages[0].elements[0].imageId).toBe('img-1'); // the parsed file is untouched
  });
});

describe('projects and backups on this device', () => {
  it('collects a project with its images and imported font, and imports it as a new design', async () => {
    const db = await freshDb();
    const d = designWithImageAndFont();
    await putDesign(db, d);
    await putImage(db, 'img-1', new Blob(['pixels'], { type: 'image/png' }));
    await putAsset(db, { id: 'font-1', kind: 'font', name: 'Hand', createdAt: 1, blob: new Blob(['fontdata'], { type: 'font/ttf' }) });
    const data = await collectProject(d, { getImage: (id) => getImage(db, id), getAsset: (id) => db.get('assets', id) });
    expect(data.images.map((i) => i.id)).toEqual(['img-1']);
    expect(data.fonts.map((f) => f.name)).toEqual(['Hand']);

    const other = await freshDb();
    const saved = await importProject(other, parseHomeStudioFile(text(serializeProject(data))));
    expect(saved.name).toBe('Poster');
    const back = await getDesign(other, saved.id);
    const imageId = back.pages[0].elements[0].imageId;
    expect(await (await getImage(other, imageId)).text()).toBe('pixels');
    expect((await listAssets(other, 'font')).map((a) => a.name)).toEqual(['Hand']);
    expect(back.pages[0].elements[1].font).toBe('user:font-1');
  });

  it('backs up everything and restores it on another device', async () => {
    const db = await freshDb();
    const d = designWithImageAndFont();
    await putDesign(db, d);
    await putImage(db, 'img-1', new Blob(['pixels'], { type: 'image/png' }));
    await putAsset(db, { id: 'svg-1', kind: 'svg', name: 'Logo', createdAt: 2, svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>', w: 10, h: 10 });
    await putAsset(db, { id: 'img-a', kind: 'image', name: 'Photo', createdAt: 3, blob: new Blob(['photo'], { type: 'image/jpeg' }), w: 4, h: 3 });
    await saveComponent(db, 'Badge', [newElement('rect', { x: 5, y: 5, w: 10, h: 10 })], { x: 5, y: 5, w: 10, h: 10 });
    await setFavorite(db, 'icon:Heart', true);
    await addVersion(db, d, 'First draft');

    const file = serializeBackup(await collectBackup(db));
    const parsed = parseHomeStudioFile(text(file));
    expect(parsed.kind).toBe('backup');
    const other = await freshDb();
    const r = await restoreBackup(other, parsed);
    expect(r).toMatchObject({ added: 1, replaced: 0, kept: 0, library: 2, components: 1, versions: 1 });
    expect((await getDesign(other, d.id)).pages).toEqual(d.pages);
    expect(await (await getImage(other, 'img-1')).text()).toBe('pixels');
    expect((await listAssets(other)).map((a) => a.name).sort()).toEqual(['Logo', 'Photo']);
    expect(await (await listAssets(other, 'image'))[0].blob.text()).toBe('photo');
    expect((await listComponents(other)).map((c) => c.name)).toEqual(['Badge']);
    expect([...(await getFavorites(other))]).toEqual(['icon:Heart']);
    expect((await listVersions(other, d.id)).map((v) => v.label)).toEqual(['First draft']);
  });

  it('keeps the newer copy when a design is on both sides', async () => {
    const db = await freshDb();
    const older = { ...newDesign('Older here', 100, 100), updatedAt: 1000 };
    const newer = { ...newDesign('Newer here', 100, 100), updatedAt: 9000 };
    await putDesign(db, older);
    await putDesign(db, newer);
    const backup = parseHomeStudioFile(text(serializeBackup({
      designs: [{ ...older, name: 'From backup A', updatedAt: 5000 }, { ...newer, name: 'From backup B', updatedAt: 5000 }],
    })));
    const r = await restoreBackup(db, backup);
    expect(r).toMatchObject({ added: 0, replaced: 1, kept: 1 });
    expect((await listDesigns(db)).map((d) => d.name).sort()).toEqual(['From backup A', 'Newer here']);
  });

  it('refuses an empty backup', () => {
    expect(() => parseHomeStudioFile(text(serializeBackup({})))).toThrow(/empty/);
  });
});

describe('version history', () => {
  it('lists versions newest first, prunes old automatic ones and goes with the design', async () => {
    const db = await freshDb();
    const d = newDesign('Poster', 100, 100);
    await putDesign(db, d);
    const mine = await addVersion(db, d, 'Before colours');
    for (let i = 0; i < VERSIONS_AUTO_KEEP + 3; i++) await addVersion(db, d, 'Autosaved', true);
    const list = await listVersions(db, d.id);
    expect(list.filter((v) => v.auto).length).toBe(VERSIONS_AUTO_KEEP);
    expect(list.some((v) => v.id === mine.id)).toBe(true); // saved by hand: kept
    expect(list[0].createdAt).toBeGreaterThanOrEqual(list[list.length - 1].createdAt);
    await deleteDesign(db, d.id);
    expect(await listVersions(db, d.id)).toEqual([]);
  });

  it('saves an automatic version only after changes and ten minutes', () => {
    const d = newDesign('Poster', 100, 100);
    const now = 10 * AUTO_VERSION_MS;
    expect(autoVersionDue(d, null, now)).toBe(true);
    const last = { createdAt: now - AUTO_VERSION_MS - 1, design: structuredClone(d) };
    expect(autoVersionDue(d, last, now)).toBe(false); // unchanged
    const changed = structuredClone(d);
    changed.pages[0].background = '#000000';
    expect(autoVersionDue(changed, last, now)).toBe(true);
    expect(autoVersionDue(changed, { ...last, createdAt: now - 1000 }, now)).toBe(false); // too soon
  });

  it('flushes a pending autosave at once', async () => {
    const saved = [];
    const saver = createAutoSaver(async (doc) => { saved.push(doc); });
    saver.schedule({ id: 'a' });
    await saver.flush();
    expect(saved).toEqual([{ id: 'a' }]);
    await saver.flush(); // nothing waiting
    expect(saved.length).toBe(1);
  });
});

describe('crash recovery', () => {
  const memoryStorage = (limit = Infinity) => {
    const m = new Map();
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => { if (v.length > limit) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; } m.set(k, v); },
      removeItem: (k) => m.delete(k),
    };
  };

  it('offers back changes newer than the stored design, and clears once saved', () => {
    const s = memoryStorage();
    const stored = { ...newDesign('Poster', 100, 100), updatedAt: 100 };
    const edited = { ...structuredClone(stored), updatedAt: 200, name: 'Poster, edited' };
    expect(writeJournal(s, 'home-studio', edited)).toBe(true);
    const j = readJournal(s, 'home-studio');
    expect(recoveryOffer(j, stored)).toEqual(edited);
    expect(recoveryOffer(j, null)).toEqual(edited); // never saved at all
    expect(recoveryOffer(j, { ...stored, updatedAt: 200 })).toBe(null);
    clearJournal(s, 'home-studio', stored); // an older save leaves the copy
    expect(readJournal(s, 'home-studio')).not.toBe(null);
    clearJournal(s, 'home-studio', edited);
    expect(readJournal(s, 'home-studio')).toBe(null);
    expect(readJournal(s, 'home-studio-demo')).toBe(null);
  });

  it('says so when there is no room, and ignores damaged copies', () => {
    expect(writeJournal(memoryStorage(10), 'home-studio', newDesign('Poster', 100, 100))).toBe(false);
    const s = memoryStorage();
    s.setItem('home-studio:unsaved:home-studio', '{not json');
    expect(readJournal(s, 'home-studio')).toBe(null);
  });
});

describe('storage warnings', () => {
  it('warns when space is low or full', () => {
    expect(quotaLevel(10, 100)).toBe('ok');
    expect(quotaLevel(80, 100)).toBe('low');
    expect(quotaLevel(96, 100)).toBe('full');
    expect(quotaLevel(5, 0)).toBe('ok');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024 * 1024)).toBe('5 GB');
    expect(isQuotaError({ name: 'QuotaExceededError' })).toBe(true);
    expect(isQuotaError({ inner: { code: 22 } })).toBe(true);
    expect(isQuotaError(new Error('other'))).toBe(false);
  });
});

describe('opening more kinds of file', () => {
  const file = (name, type, size = 10) => ({ name, type, size, text: async () => '' });

  it('takes AVIF, BMP, HEIC and TIFF images and turns them into PNG', async () => {
    expect(classifyFile(file('a.avif', 'image/avif'))).toBe('image');
    expect(classifyFile(file('scan.BMP', ''))).toBe('image');
    expect(classifyFile(file('photo.heic', 'image/heic'))).toBe('image');
    expect(needsConversion(file('a.png', 'image/png'))).toBe(false);
    expect(needsConversion(file('a.tif', 'image/tiff'))).toBe(true);
    const png = { blob: new Blob(['png'], { type: 'image/png' }), w: 8, h: 6 };
    const asset = await assetFromFile(file('scan.bmp', 'image/bmp'), { toPng: async () => png, imageSize: async () => { throw new Error('not used'); } });
    expect(asset).toMatchObject({ kind: 'image', name: 'scan', blob: png.blob, w: 8, h: 6 });
    await expect(assetFromFile(file('photo.heic', 'image/heic'), { toPng: async () => { throw new Error('decode'); } })).rejects.toThrow(/Save it as PNG or JPEG/);
  });

  it('cleans SVG animations that rewrite links and style sheets that pull others in', () => {
    const out = sanitizeSvg('<svg><style>@import "https://x.example/a.css"; rect{fill:red}</style><a><set attributeName="href" to="javascript:alert(1)"/><animate attributeName="xlink:href" values="javascript:x"/></a></svg>');
    expect(out).not.toMatch(/@import|<set|<animate|javascript/);
    expect(out).toMatch(/rect\{fill:red\}/);
  });

  it('sizes PDF pages like the design sizes (an A4 page is 794 × 1123 px)', () => {
    expect(pdfPageSize(595.28, 841.89)).toEqual({ width: 794, height: 1123 });
    const huge = pdfPageSize(14400, 14400);
    expect(Math.max(huge.width, huge.height)).toBe(10000);
  });
});

describe('offline service worker', () => {
  it('caches the app shell, its code and Latin fonts, leaving out other fonts, maps and large files', () => {
    const urls = precacheList([
      { name: 'assets/index-abc.js', size: 1000 },
      { name: 'index.html', size: 500 },
      { name: 'assets/index-abc.js.map', size: 10 },
      { name: 'assets/inter-latin-ext-400-normal-Bx1.woff2', size: 20 },
      { name: 'assets/inter-latin-400-normal-Cq2.woff2', size: 20 },
      { name: 'assets/pdf.worker.min-x.mjs', size: PRECACHE_MAX_BYTES + 1 },
      { name: 'screens.css', size: 100 },
      { name: 'sw.js', size: 10 },
    ]);
    expect(urls).toEqual(['/index.html', '/assets/index-abc.js', '/assets/inter-latin-400-normal-Cq2.woff2', '/screens.css']);
    const sw = renderServiceWorker('/* body */', urls);
    expect(sw).toMatch(/^self\.__HS_VERSION__ = "[0-9a-f]{12}";/);
    expect(sw).toContain(JSON.stringify(urls));
    expect(renderServiceWorker('/* body */', [...urls, '/x.js'])).not.toBe(sw); // a new build, a new cache
  });

  it('never answers /api/ requests from the cache', () => {
    const source = fs.readFileSync('web/sw.js', 'utf8');
    expect(source).toMatch(/if \(url\.pathname\.startsWith\('\/api\/'\)[^\n]*return;/);
    expect(source).toMatch(/skipWaiting\(\)/);
    expect(source).toMatch(/clients\.claim\(\)/);
  });

  it('is part of every build', () => {
    expect(fs.readFileSync('vite.config.js', 'utf8')).toMatch(/serviceWorker\(/);
    expect(fs.readFileSync('Dockerfile', 'utf8')).toMatch(/COPY build \.\/build/);
    expect(fs.readFileSync('web/src/main.jsx', 'utf8')).toMatch(/serviceWorker\.register\('\/sw\.js'\)/);
  });
});

describe('the demo designs survive a project round trip', () => {
  it('every element of every demo design reads back the same', () => {
    for (const d of buildDemoDesigns()) {
      const parsed = parseHomeStudioFile(text(serializeProject({ design: d })));
      expect([...walk(parsed.design.pages.flatMap((p) => p.elements))]).toEqual([...walk(d.pages.flatMap((p) => p.elements))]);
    }
  });
});
