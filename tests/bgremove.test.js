// Remove background: the arithmetic around the model, the model file's
// integrity and size, swapping the picture in as one history step, and how
// its files are served and cached.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import {
  MODEL_SIZE, MEAN, STD, MAX_SIDE, LOW_KEPT, cutoutSize, toModelInput, maskToAlpha, applyAlpha, keptShare, sameSha256,
} from '../web/src/bgremove/cutout.js';
import { newDesign, newElement, findElement } from '../web/src/doc/model.js';
import { initialDocState, docReducer, addElements, groupSelection, imageStillShown, replaceImage } from '../web/src/doc/store.js';
import { precacheList } from '../build/sw-plugin.js';

const clientSource = () => fs.readFileSync('web/src/bgremove/client.js', 'utf8');
const modelPath = () => path.join('public', clientSource().match(/MODEL_URL = '([^']+)'/)[1]);
const modelHash = () => clientSource().match(/MODEL_SHA256 = '([0-9a-f]{64})'/)[1];

describe('the model input', () => {
  it('is float32 NCHW, divided by the brightest value, then by channel mean and std', () => {
    // 2 x 2: red, green, blue, grey 100. The brightest value is 200.
    const rgba = new Uint8ClampedArray([200, 0, 0, 255, 0, 200, 0, 255, 0, 0, 200, 255, 100, 100, 100, 255]);
    const t = toModelInput(rgba, 2, [0.5, 0.5, 0.5], [1, 1, 1]);
    expect(t).toBeInstanceOf(Float32Array);
    expect(t).toHaveLength(3 * 4);
    expect([...t.slice(0, 4)]).toEqual([0.5, -0.5, -0.5, 0]); // all red first
    expect([...t.slice(4, 8)]).toEqual([-0.5, 0.5, -0.5, 0]); // then green
    expect([...t.slice(8, 12)]).toEqual([-0.5, -0.5, 0.5, 0]); // then blue
  });

  it("uses ImageNet's mean and std by default, as U²-Net expects", () => {
    const t = toModelInput(new Uint8ClampedArray([255, 255, 255, 255]), 1);
    for (let c = 0; c < 3; c++) expect(t[c]).toBeCloseTo((1 - MEAN[c]) / STD[c], 5);
  });

  it('copes with an all-black picture', () => {
    const t = toModelInput(new Uint8ClampedArray(4 * 4), 2, [0.5, 0.5, 0.5], [1, 1, 1]);
    expect([...t].every((v) => v === -0.5)).toBe(true);
  });

  it('is the 320 square U²-Net expects', () => {
    expect(MODEL_SIZE).toBe(320);
  });
});

describe('the mask', () => {
  it('stretches between its own lowest and highest value', () => {
    const a = maskToAlpha(new Float32Array([0.25, 0.75, 0.5, 0.25]), 2, 2, 2);
    expect([...a]).toEqual([0, 255, 128, 0]);
  });

  it('is sampled bilinearly up to the photo size', () => {
    // A 2 x 2 mask, left column off, right column on, to 4 x 1.
    const a = maskToAlpha(new Float32Array([0, 1, 0, 1]), 2, 4, 1);
    expect([...a]).toEqual([0, 64, 191, 255]);
  });

  it('keeps nothing when the model is flat', () => {
    const a = maskToAlpha(new Float32Array([0.7, 0.7, 0.7, 0.7]), 2, 3, 3);
    expect([...a].every((v) => v === 0)).toBe(true);
  });

  it('goes on the pixels as alpha, RGB untouched, never less transparent than before', () => {
    const rgba = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 100]);
    applyAlpha(rgba, new Uint8ClampedArray([0, 200]));
    expect([...rgba]).toEqual([10, 20, 30, 0, 40, 50, 60, 100]);
  });

  it('measures how much it kept, for the "not much was kept" note', () => {
    expect(keptShare(new Uint8ClampedArray([255, 128, 127, 0]))).toBe(0.5);
    expect(keptShare(new Uint8ClampedArray(100).fill(0).fill(255, 0, 1))).toBeLessThan(LOW_KEPT);
    expect(keptShare(new Uint8ClampedArray(0))).toBe(0);
  });
});

describe('the cut-out size', () => {
  it('keeps the photo size up to the cap, and the aspect ratio past it', () => {
    expect(cutoutSize(800, 600)).toEqual({ w: 800, h: 600 });
    expect(cutoutSize(8000, 4000)).toEqual({ w: MAX_SIDE, h: MAX_SIDE / 2 });
    expect(cutoutSize(3000, 9000)).toEqual({ w: Math.round(3000 * MAX_SIDE / 9000), h: MAX_SIDE });
  });
});

describe('the model file', () => {
  it('is the file whose SHA-256 the worker checks before using it', () => {
    const bytes = fs.readFileSync(modelPath());
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(modelHash());
  });

  it('passes the integrity check, and a damaged copy fails it', async () => {
    const bytes = new Uint8Array(fs.readFileSync(modelPath()));
    expect(await sameSha256(bytes, modelHash())).toBe(true);
    expect(await sameSha256(bytes, modelHash().toUpperCase())).toBe(true);
    const damaged = bytes.slice();
    damaged[damaged.length >> 1] ^= 0xff;
    expect(await sameSha256(damaged, modelHash())).toBe(false);
    expect(await sameSha256(bytes.subarray(0, 1000), modelHash())).toBe(false);
  });

  it('stays small enough to commit: no model over 5 MB', () => {
    for (const name of fs.readdirSync('public/models')) {
      expect(fs.statSync(path.join('public/models', name)).size, name).toBeLessThan(5 * 1024 * 1024);
    }
  });

  it('ships with its licence, credited', () => {
    const notice = fs.readFileSync('public/models/NOTICE.md', 'utf8');
    expect(notice).toMatch(/Apache License 2\.0/);
    expect(notice).toMatch(/xuebinqin\/U-2-Net/);
    expect(notice).toContain(path.basename(modelPath()));
  });
});

describe('applying a cut-out', () => {
  const setup = () => {
    const d = newDesign('Photo', 800, 600);
    const pageId = d.pages[0].id;
    const photo = newElement('image', { x: 10, y: 20, w: 300, h: 200 }, { imageId: 'img-old', natW: 600, natH: 400, crop: { l: 0.1, r: 0, t: 0, b: 0 }, mask: 'circle' });
    let st = docReducer(initialDocState(), { type: 'load', doc: d });
    st = docReducer(st, { type: 'apply', fn: (doc) => addElements(doc, pageId, [photo]), history: true });
    return { st, pageId, id: photo.id };
  };
  const cutout = { imageId: 'img-new', natW: 600, natH: 400 };

  it('swaps the picture as one history step, keeping place, size, crop and mask; undo brings it back', () => {
    let { st, pageId, id } = setup();
    const before = st.past.length;
    st = docReducer(st, { type: 'apply', fn: (doc) => replaceImage(doc, pageId, id, 'img-old', cutout), history: true });
    const el = findElement(st.doc.pages[0].elements, id);
    expect(el).toMatchObject({ imageId: 'img-new', x: 10, y: 20, w: 300, h: 200, mask: 'circle', crop: { l: 0.1 } });
    expect(st.past.length).toBe(before + 1);
    st = docReducer(st, { type: 'undo' });
    expect(findElement(st.doc.pages[0].elements, id).imageId).toBe('img-old');
  });

  it('works on a photo inside a group', () => {
    let { st, pageId, id } = setup();
    const other = newElement('rect', { x: 400, y: 20, w: 50, h: 50 });
    st = docReducer(st, { type: 'apply', fn: (doc) => addElements(doc, pageId, [other]), history: true });
    st = docReducer(st, { type: 'apply', fn: (doc) => groupSelection(doc, pageId, [id, other.id]), history: true });
    expect(st.doc.pages[0].elements.some((e) => e.id === id)).toBe(false); // it is in the group now
    expect(imageStillShown(st.doc, pageId, id, 'img-old')).toBe(true);
    st = docReducer(st, { type: 'apply', fn: (doc) => replaceImage(doc, pageId, id, 'img-old', cutout), history: true });
    expect(findElement(st.doc.pages[0].elements, id).imageId).toBe('img-new');
  });

  it('does nothing when the photo was deleted or changed meanwhile', () => {
    const { st, pageId, id } = setup();
    expect(imageStillShown(st.doc, pageId, id, 'img-other')).toBe(false);
    expect(imageStillShown(st.doc, pageId, 'gone', 'img-old')).toBe(false);
    expect(imageStillShown(st.doc, 'no-page', id, 'img-old')).toBe(false);
    const doc = structuredClone(st.doc);
    replaceImage(doc, pageId, id, 'img-other', cutout);
    expect(findElement(doc.pages[0].elements, id).imageId).toBe('img-old');
  });
});

describe('the helper files', () => {
  it('are never cached on install, however small', () => {
    const urls = precacheList([
      { name: 'index.html', size: 500 },
      { name: 'assets/ort-wasm-simd-threaded-abc.wasm', size: 14_000_000 },
      { name: 'assets/worker-abc.js', size: 70_000 },
    ]);
    expect(urls).not.toContain('/assets/ort-wasm-simd-threaded-abc.wasm');
    expect(urls.some((u) => u.startsWith('/models/'))).toBe(false);
  });

  it('are served from this app, never another origin', () => {
    expect(clientSource()).toMatch(/MODEL_URL = '\/models\/[\w.-]+\.onnx'/);
    for (const f of ['web/src/bgremove/client.js', 'web/src/bgremove/worker.js']) {
      expect(fs.readFileSync(f, 'utf8'), f).not.toMatch(/https?:\/\//);
    }
  });

  it('are cached on first use in a cache a new version keeps', () => {
    const sw = fs.readFileSync('web/sw.js', 'utf8');
    expect(sw).toMatch(/startsWith\('\/models\/'\)[^\n]*\.wasm[^\n]*\n\s*event\.respondWith\(cacheFirst\(req, HELPER\)\)/);
    expect(sw).toMatch(/k !== CACHE && k !== HELPER/);
    expect(sw).toMatch(/const HELPER = 'home-studio-helper'/);
    expect(fs.readFileSync('web/src/bgremove/worker.js', 'utf8')).toMatch(/const HELPER_CACHE = 'home-studio-helper'/);
  });

  it('can compile the runtime: the CSP allows WebAssembly, not JavaScript eval', () => {
    const server = fs.readFileSync('server.js', 'utf8');
    expect(server).toMatch(/"script-src 'self' 'wasm-unsafe-eval'"/);
    expect(server).not.toMatch(/'unsafe-eval'/);
  });

  it('stay out of the editor bundle: only the lazy dialog loads the remover', () => {
    const app = fs.readFileSync('web/src/ui/App.jsx', 'utf8');
    expect(app).toMatch(/retryable\(\(\) => import\('\.\/RemoveBackgroundDialog\.jsx'\)\)/);
    for (const f of ['web/src/ui/App.jsx', 'web/src/ui/panels.jsx', 'web/src/ui/styleControls.jsx']) {
      expect(fs.readFileSync(f, 'utf8'), f).not.toMatch(/onnxruntime|bgremove\/(client|worker|cutout)/);
    }
  });
});
