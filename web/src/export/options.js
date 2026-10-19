// Export choices and the arithmetic behind them: output sizes, the limits
// browsers put on a canvas, and file names. Pure.

import { safeFileName } from '../io/binary.js';

export const FORMATS = {
  png: { label: 'PNG', ext: 'png', mime: 'image/png', hint: 'Sharp edges and text, and a transparent background if you want one.' },
  jpeg: { label: 'JPEG', ext: 'jpg', mime: 'image/jpeg', hint: 'Smaller files, best for photos.' },
  svg: { label: 'SVG', ext: 'svg', mime: 'image/svg+xml', hint: 'Scales to any size, and opens in other design apps.' },
  pdf: { label: 'PDF', ext: 'pdf', mime: 'application/pdf', hint: 'For printing and sharing documents.' },
};
export const SCALES = [0.5, 1, 2, 3, 4];
export const PDF_DPI = [
  [96, 'Screen, 96 DPI'],
  [150, 'Standard, 150 DPI'],
  [300, 'Print, 300 DPI'],
];
export const CSS_DPI = 96;

// The largest canvas every current browser draws: 16384 px a side and,
// on iPhone and iPad, 16.7 million pixels.
export const MAX_SIDE = 16384;
export const MAX_AREA = 16777216;

// The scale actually used for a w × h page (px) at `scale`, so the canvas
// stays inside the limits. `capped` says it had to be lowered.
export function capScale(w, h, scale) {
  const byArea = Math.sqrt(MAX_AREA / (w * h));
  const bySide = MAX_SIDE / Math.max(w, h);
  const s = Math.min(scale, byArea, bySide);
  return { scale: s, capped: s < scale - 1e-9, width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}

export const BLEED_PX_PER_MM = CSS_DPI / 25.4;

// One export's settings, with defaults; unknown values fall back.
export function exportSettings(raw = {}) {
  const format = FORMATS[raw.format] ? raw.format : 'png';
  const printReady = format === 'pdf' && raw.printReady === true;
  return {
    format,
    scale: SCALES.includes(raw.scale) ? raw.scale : 1,
    quality: Math.min(1, Math.max(0.5, Number(raw.quality) || 0.92)),
    transparent: (format === 'png' || format === 'svg') && raw.transparent === true,
    dpi: printReady ? 300 : PDF_DPI.some(([d]) => d === raw.dpi) ? raw.dpi : 150,
    printReady,
    includeProject: format === 'pdf' && raw.includeProject !== false,
  };
}

// File names: one page "Design.png", several "Design - Page name.png",
// bundled as "Design.zip".
export function pageFileName(design, page, index, count, ext) {
  const base = safeFileName(design.name);
  if (count === 1) return `${base}.${ext}`;
  return `${base} - ${String(index + 1).padStart(2, '0')} ${safeFileName(page.name, 'Page')}.${ext}`;
}
