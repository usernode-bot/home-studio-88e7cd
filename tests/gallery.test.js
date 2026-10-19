// The community gallery: the item envelope round-trips through build and
// parse with its metadata cleaned and capped, a listing row is untrusted
// and cleaned, sources are kept on this device, and publishing goes only
// where a person aimed it. Ends with the demo gallery source, which is
// built as real gallery bytes and opened back through the same parser.

import 'fake-indexeddb/auto';
import { describe, it, expect, vi } from 'vitest';
import {
  buildGalleryItem, parseGalleryItem, cleanMeta, GALLERY_LICENCES,
} from '../web/src/io/gallery.js';
import { fetchIndex, fetchItem } from '../web/src/gallery/api.js';
import { addSource, removeSource, loadSources, builtInSources, DEMO_SOURCE_ID } from '../web/src/gallery/sources.js';
import { publishToNode, publishToIpfs, itemBytesFor } from '../web/src/gallery/publish.js';
import { buildDemoGallerySource } from '../web/src/demo.js';
import { newDesign, newElement } from '../web/src/doc/model.js';
import { openDesignsDb } from '../web/src/persist/db.js';

let n = 0;
const freshDb = () => openDesignsDb(false, 'test-gal-' + n++);

const meta = { id: 'g-test-1', title: 'Poster', author: 'Sam', licence: 'CC0-1.0', tags: ['poster'], description: 'A poster.' };

function sampleDesign() {
  const d = newDesign('Poster', 1080, 1350);
  d.pages[0].elements = [newElement('rect', { x: 0, y: 0, w: 1080, h: 200 })];
  return d;
}

describe('gallery item metadata', () => {
  it('trims, caps and defaults; tags are lowercased and capped', () => {
    const m = cleanMeta({
      title: 'T'.repeat(130),
      author: 'x'.repeat(120),
      licence: 'CC-BY-4.0',
      tags: ['A', 'b', '', 'c'.repeat(40), ...Array.from({ length: 15 }, (_, i) => 't' + i)],
      description: 'd'.repeat(700),
    });
    expect(m.title).toHaveLength(120);
    expect(m.author).toHaveLength(80);
    expect(m.licence).toBe('CC-BY-4.0');
    expect(m.tags[0]).toBe('a');
    expect(m.tags).toHaveLength(10);
    expect(m.description).toHaveLength(600);
  });

  it('demands a title and a licence it knows', () => {
    expect(() => cleanMeta({ licence: 'CC0-1.0' })).toThrow(/title/);
    expect(() => cleanMeta({ title: 'X', licence: 'All rights reserved' })).toThrow(/licence/i);
    expect(() => cleanMeta('nope')).toThrow();
    expect(cleanMeta({ title: 'X', licence: 'CC0-1.0' }).author).toBe('Anonymous');
    expect(GALLERY_LICENCES).toEqual(['CC0-1.0', 'CC-BY-4.0', 'CC-BY-SA-4.0']);
  });
});

describe('the item envelope', () => {
  it('builds and parses back to the same design and metadata', () => {
    const design = sampleDesign();
    const bytes = buildGalleryItem({ design, images: [], fonts: [], item: meta });
    const out = parseGalleryItem(bytes);
    expect(out.item).toEqual(cleanMeta(meta));
    expect(out.design.name).toBe('Poster');
    expect(out.design.pages).toHaveLength(1);
    expect(out.design.pages[0].elements[0].type).toBe('rect');
    expect(out.images).toEqual([]);
    expect(out.warnings).toEqual([]);
  });

  it('carries an optional credit untouched when present', () => {
    const design = sampleDesign();
    design.credit = 'Remixed from "Poster" by Sam';
    const out = parseGalleryItem(buildGalleryItem({ design, images: [], fonts: [], item: meta }));
    expect(out.design.credit).toBe('Remixed from "Poster" by Sam');
  });

  it('rejects bytes that are not a gallery item', () => {
    const project = JSON.stringify({ format: 'home-studio+json', kind: 'project', version: 1, design: sampleDesign() });
    expect(() => parseGalleryItem(project)).toThrow(/gallery item/);
    expect(() => parseGalleryItem('not json')).toThrow();
    expect(() => parseGalleryItem(null)).toThrow();
    const badVersion = JSON.parse(new TextDecoder().decode(buildGalleryItem({ design: sampleDesign(), item: meta })));
    badVersion.version = 99;
    expect(() => parseGalleryItem(JSON.stringify(badVersion))).toThrow(/version/);
    const badItem = JSON.parse(new TextDecoder().decode(buildGalleryItem({ design: sampleDesign(), item: meta })));
    badItem.item.licence = 'MIT';
    expect(() => parseGalleryItem(JSON.stringify(badItem))).toThrow(/licence/i);
  });

  it('gives itemBytesFor the same bytes buildGalleryItem does', () => {
    const design = sampleDesign();
    const a = itemBytesFor({ design, item: meta }, new Date(0));
    const b = buildGalleryItem({ design, item: meta }, new Date(0));
    expect(new TextDecoder().decode(a)).toBe(new TextDecoder().decode(b));
  });
});

describe('reading a source', () => {
  it('the demo source needs its index and cleans its rows', async () => {
    await expect(fetchIndex({ kind: 'demo' })).rejects.toThrow(/demo=1/);
    const rows = await fetchIndex({ kind: 'demo' }, { demoIndex: [meta, { id: 'x', title: 'T', licence: 'CC0-1.0', tags: Array(30).fill('tag') }] });
    expect(rows).toHaveLength(2);
    expect(rows[1].tags).toHaveLength(10);
  });

  it('a node source is fetched over http and unreadable rows are skipped', async () => {
    const payload = { items: [meta, null, { title: 'no id' }, { id: 'ok2', title: 'Second', licence: 'CC-BY-4.0', width: 1080.7 }] };
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => payload }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const rows = await fetchIndex({ kind: 'node', url: 'https://node.example.com' });
      expect(rows.map((r) => r.id)).toEqual(['g-test-1', 'ok2']);
      expect(rows[1].width).toBe(1081);
      expect(fetchMock.mock.calls[0][0]).toBe('https://node.example.com/api/gallery');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a failed node answer throws with its status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));
    try {
      await expect(fetchIndex({ kind: 'node', url: 'https://node.example.com' })).rejects.toThrow(/500/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('fetchItem parses the demo bytes; an unknown id refuses', async () => {
    const source = buildDemoGallerySource();
    const out = await fetchItem({ kind: 'demo' }, 'g-demo-2', { demoItem: source.itemBytes });
    expect(out.item.title).toBe('Bake sale flyer');
    expect(out.design.pages.length).toBeGreaterThan(0);
    await expect(fetchItem({ kind: 'demo' }, 'g-demo-99', { demoItem: source.itemBytes })).rejects.toThrow(/not in the demo gallery/);
  });
});

describe('gallery sources on this device', () => {
  it('keeps the demo source built in and node sources in the pref', async () => {
    const db = await freshDb();
    expect((await loadSources(db)).map((s) => s.id)).toEqual([DEMO_SOURCE_ID]);
    const added = await addSource(db, { url: 'https://studio.example.com/', name: 'Our node' });
    expect(added.url).toBe('https://studio.example.com');
    let sources = await loadSources(db);
    expect(sources.map((s) => s.kind)).toEqual(['demo', 'node']);
    expect(sources[1].name).toBe('Our node');
    await expect(addSource(db, { url: 'https://studio.example.com' })).rejects.toThrow(/already/);
    await expect(addSource(db, { url: 'ftp://nope' })).rejects.toThrow(/http/);
    await removeSource(db, added.id);
    expect((await loadSources(db)).map((s) => s.id)).toEqual([DEMO_SOURCE_ID]);
    await removeSource(db, 'never-there'); // removing an unknown id is quiet
    expect((await loadSources(db))).toHaveLength(1);
  });
});

describe('publishing', () => {
  it('goes to a node with the admin key and reads its answer', async () => {
    const bytes = buildGalleryItem({ design: sampleDesign(), item: meta });
    const fetchMock = vi.fn(async (url, opts) => {
      expect(opts.headers['x-home-studio-admin']).toBe('secret');
      return { ok: true, json: async () => ({ id: 'published-1' }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const out = await publishToNode({ url: 'https://node.example.com/', adminKey: 'secret', itemBytes: bytes });
      expect(out.id).toBe('published-1');
      expect(out.url).toBe('https://node.example.com');
      expect(fetchMock.mock.calls[0][0]).toBe('https://node.example.com/api/gallery');
    } finally {
      vi.unstubAllGlobals();
    }
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401 })));
    try {
      await expect(publishToNode({ url: 'https://node.example.com', adminKey: 'wrong', itemBytes: bytes })).rejects.toThrow(/admin key/i);
    } finally {
      vi.unstubAllGlobals();
    }
    await expect(publishToNode({ url: 'https://node.example.com', adminKey: '', itemBytes: bytes })).rejects.toThrow(/admin key/i);
    await expect(publishToNode({ url: 'nope', adminKey: 'k', itemBytes: bytes })).rejects.toThrow(/http/);
  });

  it('goes to an IPFS-compatible store this device is connected to', async () => {
    const ipfs = {
      describe: () => ({ kind: 'ipfs' }),
      putBlob: async (cfg, bytes) => ({ cid: 'bafkrei' + 'a'.repeat(52) }),
    };
    const out = await publishToIpfs({ adapter: ipfs, cfg: {}, design: sampleDesign(), item: meta });
    expect(out.cid.startsWith('bafkrei')).toBe(true);
    expect(parseGalleryItem(out.bytes).item.title).toBe('Poster');
    await expect(publishToIpfs({ adapter: { describe: () => ({ kind: 'node' }) }, cfg: {}, design: sampleDesign(), item: meta }))
      .rejects.toThrow(/Remote storage/);
  });
});

describe('the demo gallery source', () => {
  it('is six real gallery items that parse back through the front door', async () => {
    const source = buildDemoGallerySource();
    expect(source.kind).toBe('demo');
    expect(source.items).toHaveLength(6);
    expect(source.items.map((i) => i.id)).toEqual([
      'g-demo-1', 'g-demo-2', 'g-demo-3', 'g-demo-4', 'g-demo-5', 'g-demo-6',
    ]);
    for (const row of source.items) {
      expect(row.author).toBe('Demo Person');
      expect(GALLERY_LICENCES).toContain(row.licence);
      const out = await fetchItem({ kind: 'demo' }, row.id, { demoItem: source.itemBytes });
      expect(out.item.title).toBe(row.title);
      expect(out.design.pages[0].elements.length).toBeGreaterThan(0);
      expect(out.warnings).toEqual([]);
    }
  });
});