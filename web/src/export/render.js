// Exporting in the browser: measures text, embeds fonts and images, draws
// each page's SVG (export/svg.js) onto a canvas at the size asked for, and
// hands back the finished file. Each file is reopened before it is offered
// (its header read back, its size checked), so a canvas the browser
// silently refused never becomes a blank download.

import { pageToSvg } from './svg.js';
import { buildPdf, BLEED_MM, jpegInfo } from './pdf.js';
import { setPngDpi, setJpegDpi, pngInfo } from './imagemeta.js';
import { capScale, FORMATS, CSS_DPI, BLEED_PX_PER_MM, pageFileName } from './options.js';
import { zipFiles } from '../io/zip.js';
import { blobToBytes, blobToDataUrl, bytesToBase64, utf8, safeFileName } from '../io/binary.js';
import { serializeProject, PROJECT_SUFFIX } from '../io/project.js';
import { fontStack, ensureFont, fontsUsed, BUNDLED_FONTS, userFontFamily } from '../assets/fonts.js';
import { imageIdsIn } from '../doc/model.js';

const fontShorthand = (el) => `${el.italic ? 'italic ' : ''}${el.weight || 400} ${el.size}px ${fontStack(el.font)}`;

function textEls(pages) {
  const out = [];
  const visit = (els) => {
    for (const el of els) {
      if (el.type === 'text') out.push(el);
      if (el.children) visit(el.children);
    }
  };
  for (const p of pages) visit(p.elements);
  return out;
}

// Canvas text metrics for a text element's font: the same font the canvas
// draws, so line breaks match the page on screen.
export function createMeasure() {
  const ctx = document.createElement('canvas').getContext('2d');
  const cache = new Map();
  return (el) => {
    const font = fontShorthand(el);
    if (!cache.has(font)) {
      ctx.font = font;
      const m = ctx.measureText('Hg');
      const ascent = m.fontBoundingBoxAscent ?? el.size * 0.8;
      const descent = m.fontBoundingBoxDescent ?? el.size * 0.2;
      const widths = new Map();
      cache.set(font, {
        ascent,
        descent,
        width: (s) => {
          if (!widths.has(s)) { ctx.font = font; widths.set(s, ctx.measureText(s).width); }
          return widths.get(s);
        },
      });
    }
    return cache.get(font);
  };
}

// Unicode ranges as written in @font-face ("U+0000-00FF, U+0131").
export function inUnicodeRange(range, cp) {
  if (!range) return true;
  return range.split(',').some((part) => {
    const m = part.trim().match(/^U\+([0-9a-f?]+)(?:-([0-9a-f]+))?$/i);
    if (!m) return false;
    if (m[1].includes('?')) {
      return cp >= parseInt(m[1].replace(/\?/g, '0'), 16) && cp <= parseInt(m[1].replace(/\?/g, 'f'), 16);
    }
    const lo = parseInt(m[1], 16);
    const hi = m[2] ? parseInt(m[2], 16) : lo;
    return cp >= lo && cp <= hi;
  });
}

// @font-face rules embedding the bundled and imported fonts these pages
// use, as data URLs: an SVG drawn as an image can't reach the page's fonts.
async function embeddedFontCss(pages, getFontBlob) {
  const keys = fontsUsed(pages);
  await Promise.all(keys.map(ensureFont));
  const els = textEls(pages);
  await Promise.all(els.map((el) => document.fonts.load(fontShorthand(el), el.text || 'A').catch(() => [])));
  const chars = new Set();
  for (const el of els) for (const ch of String(el.text || '')) chars.add(ch.codePointAt(0));
  for (const ch of 'AZaz') chars.add(ch.codePointAt(0));
  const css = [];
  const families = new Set(keys.filter((k) => BUNDLED_FONTS[k]).map((k) => BUNDLED_FONTS[k].family));
  for (const sheet of [...document.styleSheets]) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const rule of rules || []) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      const family = rule.style.getPropertyValue('font-family').replace(/["']/g, '').trim();
      if (!families.has(family)) continue;
      const range = rule.style.getPropertyValue('unicode-range');
      if (![...chars].some((cp) => inUnicodeRange(range, cp))) continue;
      const m = rule.style.getPropertyValue('src').match(/url\(\s*["']?([^"')]+\.woff2)["']?\s*\)/i)
        || rule.style.getPropertyValue('src').match(/url\(\s*["']?([^"')]+)["']?\s*\)/i);
      if (!m) continue;
      try {
        const res = await fetch(new URL(m[1], sheet.href || window.location.href));
        if (!res.ok) continue;
        const data = await blobToDataUrl(await res.blob());
        css.push(`@font-face{font-family:"${family}";font-style:${rule.style.getPropertyValue('font-style') || 'normal'};font-weight:${rule.style.getPropertyValue('font-weight') || '400'};src:url(${data});${range ? `unicode-range:${range};` : ''}}`);
      } catch { /* the font's fallback draws instead */ }
    }
  }
  for (const key of keys.filter((k) => k.startsWith('user:'))) {
    const blob = await getFontBlob(key.slice(5));
    if (blob) css.push(`@font-face{font-family:"${userFontFamily(key.slice(5))}";src:url(data:font/ttf;base64,${bytesToBase64(await blobToBytes(blob))});}`);
  }
  return css.join('\n');
}

// Images load a page at a time and are released after it: loading every
// page's images up front held them all as data URLs at once, and a large
// multi-page export ran out of memory before it finished. `uses` counts
// the pages still ahead that need each id, so an image shared across
// pages stays until its last page is done.
function imageUses(pages) {
  const uses = new Map();
  for (const p of pages) for (const id of imageIdsIn(p.elements)) uses.set(id, (uses.get(id) || 0) + 1);
  return uses;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The page could not be drawn.'));
    img.src = url;
  });
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));

// Draw an SVG onto a canvas and encode it. Resolves the file's bytes.
export async function rasterize(svg, width, height, { mime, quality, background }) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  let canvas;
  try {
    const img = await loadImage(url);
    await nextFrame(); // lets the SVG's own fonts settle before it is drawn
    canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This device ran out of memory drawing the page. Try a smaller size.');
    if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, width, height); }
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, quality));
    if (!blob) throw new Error('This device ran out of memory drawing the page. Try a smaller size.');
    const bytes = await blobToBytes(blob);
    const info = mime === 'image/png' ? pngInfo(bytes) : jpegInfo(bytes);
    if (info.width !== width || info.height !== height) throw new Error('The page came out at the wrong size. Try a smaller size.');
    return bytes;
  } finally {
    URL.revokeObjectURL(url);
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}

// Export `pages` of `design` with `settings` (export/options.js
// exportSettings). deps: { getImage(id), getFontBlob(assetId), project() }.
// onProgress(done, total). Resolves { name, blob, missingImages, capped }.
export async function exportDesign(design, pages, settings, deps, onProgress = () => {}) {
  const fmt = FORMATS[settings.format];
  const total = pages.length;
  onProgress(0, total);
  const fontCss = await embeddedFontCss(pages, deps.getFontBlob);
  const uses = imageUses(pages);
  const images = {};
  const loadPageImages = async (page) => {
    for (const id of imageIdsIn(page.elements)) {
      if (images[id]) continue;
      const blob = await deps.getImage(id);
      if (blob) images[id] = await blobToDataUrl(blob);
    }
  };
  const releasePageImages = (page) => {
    for (const id of imageIdsIn(page.elements)) {
      const left = (uses.get(id) || 0) - 1;
      uses.set(id, left);
      if (left <= 0) delete images[id];
    }
  };
  const measure = createMeasure();
  const files = [];
  const pdfPages = [];
  let missingImages = 0;
  let capped = false;
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    await loadPageImages(page);
    if (settings.format === 'svg') {
      const r = pageToSvg(page, { images, measure, fontCss, transparent: settings.transparent });
      missingImages += r.missingImages;
      files.push({ name: pageFileName(design, page, i, total, fmt.ext), bytes: utf8(r.svg) });
    } else if (settings.format === 'pdf') {
      const bleed = settings.printReady ? BLEED_MM * BLEED_PX_PER_MM : 0;
      const plan = capScale(page.width + bleed * 2, page.height + bleed * 2, settings.dpi / CSS_DPI);
      capped = capped || plan.capped;
      const r = pageToSvg(page, { images, measure, fontCss, bleed, scale: plan.scale });
      missingImages += r.missingImages;
      const jpeg = await rasterize(r.svg, plan.width, plan.height, { mime: 'image/jpeg', quality: settings.quality, background: '#ffffff' });
      pdfPages.push({ jpeg, widthPx: page.width, heightPx: page.height });
    } else {
      const plan = capScale(page.width, page.height, settings.scale);
      capped = capped || plan.capped;
      const r = pageToSvg(page, { images, measure, fontCss, scale: plan.scale, transparent: settings.transparent });
      missingImages += r.missingImages;
      const opaque = settings.format === 'jpeg';
      let bytes = await rasterize(r.svg, plan.width, plan.height, { mime: fmt.mime, quality: settings.quality, background: opaque ? '#ffffff' : null });
      const dpi = Math.round(CSS_DPI * plan.scale);
      bytes = opaque ? setJpegDpi(bytes, dpi) : setPngDpi(bytes, dpi);
      files.push({ name: pageFileName(design, page, i, total, fmt.ext), bytes });
    }
    releasePageImages(page);
    onProgress(i + 1, total);
  }
  const base = safeFileName(design.name);
  if (settings.format === 'pdf') {
    let attachment = null;
    if (settings.includeProject) {
      attachment = { name: base + PROJECT_SUFFIX, mime: 'application/json', bytes: serializeProject(await deps.project()) };
    }
    const bytes = buildPdf(pdfPages, { title: design.name, bleedMm: settings.printReady ? BLEED_MM : 0, marks: settings.printReady, attachment });
    return { name: `${base}.pdf`, blob: new Blob([bytes], { type: fmt.mime }), missingImages, capped };
  }
  if (files.length === 1) return { name: files[0].name, blob: new Blob([files[0].bytes], { type: fmt.mime }), missingImages, capped };
  return { name: `${base}.zip`, blob: new Blob([zipFiles(files)], { type: 'application/zip' }), missingImages, capped };
}
