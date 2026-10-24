// The editor's side of the background remover: one worker per dialog,
// started on the first run and ended with terminate() when the dialog
// closes, so its memory is given back. A cancelled run ends the worker
// too; the next run starts a new one, and the files come from the cache.

import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';

// Served from this app's own origin (public/models/), checked against its
// SHA-256 before use. A new model gets a new file name and a new hash: the
// service worker keeps a cached file for good.
export const MODEL_URL = '/models/u2netp-uint8.onnx';
export const MODEL_SHA256 = 'ea350edb3cfd97c36bb37ff1318e819c3199630ba5f5a71260a71f58c6fd5876';

export function createRemover() {
  let worker = null;
  let pending = null;

  const stop = () => {
    if (worker) worker.terminate();
    worker = null;
    if (pending) pending.reject(Object.assign(new Error('Cancelled'), { cancelled: true }));
    pending = null;
  };

  // Resolves { blob, w, h, kept }; rejects with err.stage 'download' or 'run'.
  // onEvent gets { type: 'progress', loaded, total } and { type: 'working' }.
  const run = (blob, onEvent = () => {}) => {
    stop();
    return new Promise((resolve, reject) => {
      pending = { resolve, reject };
      try {
        worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      } catch (err) {
        pending = null;
        reject(Object.assign(new Error(String(err && err.message || err)), { stage: 'run' }));
        return;
      }
      let heard = false;
      worker.onmessage = (e) => {
        heard = true;
        const msg = e.data || {};
        if (msg.type === 'done') { pending = null; resolve(msg); }
        else if (msg.type === 'error') { pending = null; reject(Object.assign(new Error(msg.message), { stage: msg.stage })); }
        else onEvent(msg);
      };
      // A worker whose script didn't load (offline the first time) never
      // says anything; one that crashed later (out of memory) stops talking.
      worker.onerror = (e) => {
        const p = pending;
        pending = null;
        if (p) p.reject(Object.assign(new Error(e.message || 'The worker stopped.'), { stage: heard ? 'run' : 'download' }));
      };
      worker.postMessage({ type: 'run', blob, wasmUrl, modelUrl: MODEL_URL, modelSha256: MODEL_SHA256 });
    });
  };

  return { run, stop };
}
