// Files a person brings in from their device: which kind each one is, and
// turning it into a library asset. The browser-only checks (decoding the
// image, loading the font) are passed in, so the rules here are testable.

import { uid, newElement } from '../doc/model.js';
import { sanitizeSvg, svgSize, isRecolorable } from './svg.js';
import { FONT_FILE } from './fonts.js';

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp'];
export const IMAGE_MAX_BYTES = 20 * 1024 * 1024;
export const FONT_MAX_BYTES = 10 * 1024 * 1024;
export const IMPORT_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml,.svg,.ttf,.otf,.woff,.woff2';

export function classifyFile(file) {
  const name = file.name || '';
  if (/\.homestudio$/i.test(name)) return 'project';
  if (/\.homestudio-backup$/i.test(name)) return 'backup';
  if (/\.pdf$/i.test(name) || file.type === 'application/pdf') return 'pdf';
  if (/\.heic$/i.test(name) || file.type === 'image/heic') return 'heic';
  if (file.type === 'image/svg+xml' || /\.svg$/i.test(name)) return 'svg';
  if (FONT_FILE.test(name) || /^font\//.test(file.type || '')) return 'font';
  if (IMAGE_TYPES.includes(file.type) || /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(name)) return 'image';
  return null;
}

export const baseName = (name) => (name || '').replace(/\.[^.]+$/, '').trim() || 'Untitled';

// Resolves an asset ready to store, or rejects with a message to show.
// `checks.imageSize(file)` resolves { w, h } or rejects; `checks.font(asset)`
// resolves once the browser has loaded the font, or rejects.
export async function assetFromFile(file, checks) {
  const kind = classifyFile(file);
  const name = baseName(file.name);
  const asset = { id: uid(), kind, name, createdAt: Date.now() };
  if (kind === 'svg') {
    asset.svg = sanitizeSvg(await file.text()); // throws with its own message
    Object.assign(asset, svgSize(asset.svg));
    return asset;
  }
  if (kind === 'image') {
    if (file.size > IMAGE_MAX_BYTES) throw new Error(`${file.name} is larger than 20 MB.`);
    let size;
    try {
      size = await checks.imageSize(file);
    } catch {
      throw new Error(`${file.name} isn't an image this browser can open.`);
    }
    return Object.assign(asset, { blob: file, w: size.w, h: size.h });
  }
  if (kind === 'font') {
    if (file.size > FONT_MAX_BYTES) throw new Error(`${file.name} is larger than 10 MB.`);
    asset.blob = file;
    try {
      await checks.font(asset);
    } catch {
      throw new Error(`${file.name} isn't a font this browser can read.`);
    }
    return asset;
  }
  throw new Error(`${file.name} isn't an image, SVG or font file.`);
}

// Fit a w × h item inside a fraction of the page, centred.
export function placeOnPage(page, w, h, fraction = 0.4) {
  const scale = Math.min((page.width * fraction) / w, (page.height * fraction) / h);
  const pw = Math.max(1, Math.round(w * scale));
  const ph = Math.max(1, Math.round(h * scale));
  return { x: Math.round((page.width - pw) / 2), y: Math.round((page.height - ph) / 2), w: pw, h: ph };
}

// A library item as a new element centred on `page`: shapes at a third of
// the page, icons a quarter, illustrations and SVGs half, at their own shape.
export function elementForItem(item, page) {
  if (item.kind === 'shape') {
    const { type, ...rest } = item.insert;
    const side = Math.round(Math.min(page.width, page.height) * 0.3);
    const box = type === 'line'
      ? { x: Math.round(page.width * 0.3), y: Math.round(page.height / 2), w: Math.round(page.width * 0.4), h: 0 }
      : { x: Math.round((page.width - side) / 2), y: Math.round((page.height - side) / 2), w: side, h: side };
    return newElement(type, box, { ...rest, name: item.name });
  }
  const svg = item.svg || (item.asset && item.asset.svg);
  if (!svg) return null;
  const { w, h } = item.kind === 'icon' ? { w: 1, h: 1 } : svgSize(svg);
  return newElement('svg', placeOnPage(page, w, h, item.kind === 'icon' ? 0.25 : 0.5), {
    svg, color: isRecolorable(svg) ? '#1c1917' : '', name: item.name,
  });
}

// A library background on a page: colour, and the gradient and pattern it
// brings (or none).
export function applyBackground(page, fill) {
  page.background = fill.background;
  page.gradient = fill.gradient ? structuredClone(fill.gradient) : null;
  page.pattern = fill.pattern ? structuredClone(fill.pattern) : null;
  return page;
}
