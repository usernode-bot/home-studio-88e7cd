// The arithmetic around the background-removal model, kept free of the
// browser and the model so it can be tested: what goes in (the photo at the
// model's square size, normalised the way U²-Net was trained), what comes
// out (its mask, stretched back to the photo's size as an alpha channel),
// and the check that the model file is the one we shipped.

export const MODEL_SIZE = 320;
// ImageNet's per-channel mean and standard deviation, as U²-Net expects.
export const MEAN = [0.485, 0.456, 0.406];
export const STD = [0.229, 0.224, 0.225];
// Below this share of kept pixels the preview says not much was found.
export const LOW_KEPT = 0.02;
// The longest side of a cut-out; larger photos are made smaller first, so a
// huge photo can't run the device out of memory.
export const MAX_SIDE = 4096;

// The cut-out's size: the photo's own, or scaled down to MAX_SIDE with its
// aspect ratio kept.
export function cutoutSize(w, h, max = MAX_SIDE) {
  const k = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

// RGBA pixels of a size x size square to the model's input: float32, NCHW
// (all red, then green, then blue), each channel divided by the brightest
// value in the image, then normalised by the channel's mean and std.
export function toModelInput(rgba, size = MODEL_SIZE, mean = MEAN, std = STD) {
  const n = size * size;
  let max = 0;
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    if (rgba[p] > max) max = rgba[p];
    if (rgba[p + 1] > max) max = rgba[p + 1];
    if (rgba[p + 2] > max) max = rgba[p + 2];
  }
  const k = 1 / (max || 1);
  const out = new Float32Array(3 * n);
  for (let c = 0; c < 3; c++) {
    const m = mean[c];
    const s = 1 / std[c];
    for (let i = 0; i < n; i++) out[c * n + i] = (rgba[i * 4 + c] * k - m) * s;
  }
  return out;
}

// The model's size x size mask to a w x h alpha channel: stretched to 0..1
// between its own lowest and highest value, then sampled bilinearly.
export function maskToAlpha(mask, size, w, h) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] < lo) lo = mask[i];
    if (mask[i] > hi) hi = mask[i];
  }
  const range = hi - lo;
  const scale = range > 0 ? 255 / range : 0;
  const out = new Uint8ClampedArray(w * h);
  const sx = size / w;
  const sy = size / h;
  for (let y = 0; y < h; y++) {
    const fy = Math.min(size - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(size - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(size - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(size - 1, x0 + 1);
      const tx = fx - x0;
      const top = mask[y0 * size + x0] * (1 - tx) + mask[y0 * size + x1] * tx;
      const bottom = mask[y1 * size + x0] * (1 - tx) + mask[y1 * size + x1] * tx;
      out[y * w + x] = (top * (1 - ty) + bottom * ty - lo) * scale;
    }
  }
  return out;
}

// Puts the alpha channel on the pixels in place. RGB stays; a pixel that
// was already see-through stays at least that see-through.
export function applyAlpha(rgba, alpha) {
  for (let i = 0; i < alpha.length; i++) {
    const p = i * 4 + 3;
    if (alpha[i] < rgba[p]) rgba[p] = alpha[i];
  }
  return rgba;
}

// The share of pixels the cut-out keeps (at least half opaque).
export function keptShare(alpha) {
  if (!alpha.length) return 0;
  let kept = 0;
  for (let i = 0; i < alpha.length; i++) if (alpha[i] >= 128) kept++;
  return kept / alpha.length;
}

// Whether downloaded bytes are the file we shipped: their SHA-256, in hex,
// against the one written down beside the model's URL.
export async function sameSha256(bytes, expectedHex) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const hex = [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex === String(expectedHex).toLowerCase();
}
