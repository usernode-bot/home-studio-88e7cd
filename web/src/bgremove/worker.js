// The background remover's worker: everything heavy happens here, off the
// editor's thread. It downloads the runtime and the model the first time
// (both from this app's own origin, both cached after that), checks the
// model is the file we shipped, keeps the session for later runs while it
// lives, and turns a photo Blob into a PNG cut-out. The photo never leaves
// the device.
//
// Messages in:  { type: 'run', blob, wasmUrl, modelUrl, modelSha256 }
// Messages out: { type: 'progress', loaded, total }   while downloading
//               { type: 'working' }                   the model is running
//               { type: 'done', blob, w, h, kept }    the PNG cut-out
//               { type: 'error', stage: 'download' | 'run', message }

import * as ort from 'onnxruntime-web/wasm';
import { MODEL_SIZE, cutoutSize, toModelInput, maskToAlpha, applyAlpha, keptShare, sameSha256 } from './cutout.js';

// One thread: the app frame is not cross-origin isolated, so there is no
// SharedArrayBuffer for more. We already are a worker, so no proxy.
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;

// The service worker's cache for these files (web/sw.js).
const HELPER_CACHE = 'home-studio-helper';

let session = null;
let files = null; // the downloaded runtime and model, until the session is made

// Both files at once, with one progress meter across them.
async function download(urls) {
  const responses = await Promise.all(urls.map((u) => fetch(u)));
  for (const res of responses) if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const sizes = responses.map((r) => Number(r.headers.get('content-length')) || 0);
  const total = sizes.every(Boolean) ? sizes.reduce((a, b) => a + b, 0) : 0;
  const got = urls.map(() => 0);
  const report = () => self.postMessage({ type: 'progress', loaded: got.reduce((a, b) => a + b, 0), total });
  report();
  return Promise.all(responses.map(async (res, i) => {
    if (!res.body) {
      const buf = await res.arrayBuffer();
      got[i] = buf.byteLength;
      report();
      return new Uint8Array(buf);
    }
    const reader = res.body.getReader();
    const chunks = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got[i] += value.length;
      report();
    }
    const out = new Uint8Array(got[i]);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
    return out;
  }));
}

// A damaged model is never used, and never kept: the cached copy goes, so
// Retry downloads it again.
async function verifiedDownload(msg) {
  const [wasm, model] = await download([msg.wasmUrl, msg.modelUrl]);
  if (!(await sameSha256(model, msg.modelSha256))) {
    try { if (self.caches) await (await caches.open(HELPER_CACHE)).delete(msg.modelUrl); } catch { /* nothing cached */ }
    throw new Error('The model file failed its integrity check.');
  }
  return [wasm, model];
}

async function makeSession() {
  if (session) return session;
  const [wasm, model] = files;
  ort.env.wasm.wasmBinary = wasm;
  session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  files = null;
  return session;
}

async function cutOut(sess, blob) {
  const bitmap = await createImageBitmap(blob);
  const { w, h } = cutoutSize(bitmap.width, bitmap.height);

  const small = new OffscreenCanvas(MODEL_SIZE, MODEL_SIZE).getContext('2d', { willReadFrequently: true });
  small.drawImage(bitmap, 0, 0, MODEL_SIZE, MODEL_SIZE);
  const input = toModelInput(small.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE).data, MODEL_SIZE);

  const feeds = { [sess.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, MODEL_SIZE, MODEL_SIZE]) };
  const out = await sess.run(feeds);
  const mask = out[sess.outputNames[0]].data;

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const pixels = ctx.getImageData(0, 0, w, h);
  const alpha = maskToAlpha(mask, MODEL_SIZE, w, h);
  applyAlpha(pixels.data, alpha);
  ctx.putImageData(pixels, 0, 0);
  const png = await canvas.convertToBlob({ type: 'image/png' });
  return { blob: png, w, h, kept: keptShare(alpha) };
}

self.onmessage = async (e) => {
  const msg = e.data || {};
  if (msg.type !== 'run') return;
  if (!session && !files) {
    try {
      files = await verifiedDownload(msg);
    } catch (err) {
      self.postMessage({ type: 'error', stage: 'download', message: String(err && err.message || err) });
      return;
    }
  }
  try {
    self.postMessage({ type: 'working' });
    self.postMessage({ type: 'done', ...(await cutOut(await makeSession(), msg.blob)) });
  } catch (err) {
    self.postMessage({ type: 'error', stage: 'run', message: String(err && err.message || err) });
  }
};
