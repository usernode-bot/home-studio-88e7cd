// Home Studio's own file format: a design (a "project") or everything on a
// device (a "backup") as one JSON file, its images and imported fonts
// carried inside as base64. Versioned, and checked field by field on the
// way in: a file from anywhere is untrusted, so only known fields of known
// shapes come through, SVG is cleaned again, and anything unusable is left
// out with a warning rather than stopping the whole import.
//
// File shape (version 1):
//   { format: 'home-studio', kind: 'project' | 'backup', version: 1,
//     app: { name, url? }, exportedAt,
//     project: design, images: [{ id, type, data }], fonts: [{ id, name, type, data }]
//     backup:  designs, images, assets, components, favorites, versions }
// Pure: bytes in, plain objects out. The database side is persist/db.js.

import { uid, PAGE_MIN, PAGE_MAX } from '../doc/model.js';
import { normalizeCrop, MASKS, SHAPES, ADJUST_DEFAULTS } from '../doc/style.js';
import { sanitizeSvg } from '../assets/svg.js';
import { bytesToBase64, base64ToBytes, utf8 } from './binary.js';

export const FORMAT = 'home-studio';
export const FORMAT_VERSION = 1;
export const PROJECT_SUFFIX = '.homestudio.json';
export const BACKUP_SUFFIX = '.homestudio-backup.json';
export const IMAGE_MIME = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
export const FONT_MIME = ['font/ttf', 'font/otf', 'font/woff', 'font/woff2', 'application/octet-stream', ''];
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_FONT_BYTES = 12 * 1024 * 1024;
const MAX_PAGES = 500;
const MAX_ELEMENTS = 5000;
const MAX_DEPTH = 8;

// ── Writing ────────────────────────────────────────────────────────────

const header = (kind, date) => ({
  format: FORMAT, kind, version: FORMAT_VERSION, app: { name: 'Home Studio' }, exportedAt: date.toISOString(),
});
const encodeFile = (f) => ({ id: f.id, type: f.type || '', data: bytesToBase64(f.bytes) });

// design: as stored; images: [{ id, type, bytes }]; fonts: [{ id, name, type, bytes }].
export function serializeProject({ design, images = [], fonts = [] }, date = new Date()) {
  return utf8(JSON.stringify({
    ...header('project', date),
    design,
    images: images.map(encodeFile),
    fonts: fonts.map((f) => ({ ...encodeFile(f), name: f.name })),
  }));
}

// assets: [{ id, kind, name, createdAt, w?, h?, svg?, type?, bytes? }].
export function serializeBackup({ designs = [], images = [], assets = [], components = [], favorites = [], versions = [] }, date = new Date()) {
  return utf8(JSON.stringify({
    ...header('backup', date),
    designs,
    images: images.map(encodeFile),
    assets: assets.map(({ bytes, blob, ...a }) => (bytes ? { ...a, data: bytesToBase64(bytes) } : a)),
    components,
    favorites,
    versions,
  }));
}

// ── Reading ────────────────────────────────────────────────────────────

const fail = (msg) => { throw new Error(msg); };
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const SAFE_ID = /^[A-Za-z0-9_:.-]{1,80}$/;
const COLOR = /^(#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\)|[a-zA-Z]{3,24})$/;

const str = (v, max = 200, dflt = '') => (typeof v === 'string' ? v.slice(0, max) : dflt);
const fin = (v, dflt = 0, lo = -1e6, hi = 1e6) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt);
const color = (v, dflt = '') => (typeof v === 'string' && (v === '' || COLOR.test(v.trim())) ? v.trim() : dflt);
const oneOf = (v, list, dflt) => (list.includes(v) ? v : dflt);
const id = (v) => (typeof v === 'string' && SAFE_ID.test(v) ? v : uid());
const time = (v) => fin(v, Date.now(), 0, 8.64e15);

function gradient(g) {
  if (!isObj(g)) return null;
  return { kind: oneOf(g.kind, ['linear', 'radial'], 'linear'), angle: fin(g.angle, 90, -3600, 3600), to: color(g.to, '#ffffff') || '#ffffff' };
}

function shadow(s) {
  if (!isObj(s)) return null;
  const out = { x: fin(s.x, 0, -2000, 2000), y: fin(s.y, 0, -2000, 2000), blur: fin(s.blur, 0, 0, 2000), color: color(s.color, '#000000') || '#000000', alpha: fin(s.alpha, 0.35, 0, 1) };
  if (s.glow === true) out.glow = true;
  return out;
}

const TYPES = ['text', 'rect', 'ellipse', 'line', 'image', 'group', 'shape', 'svg'];
const ADJUST_KEYS = Object.keys(ADJUST_DEFAULTS);

// One element, cleaned. `ctx` gathers warnings and the image ids in use.
function element(raw, ctx, depth) {
  if (!isObj(raw) || !TYPES.includes(raw.type)) { ctx.dropped += 1; return null; }
  if (++ctx.count > MAX_ELEMENTS) { ctx.dropped += 1; return null; }
  const t = raw.type;
  const el = {
    id: id(raw.id), type: t, name: str(raw.name, 200, t),
    x: fin(raw.x), y: fin(raw.y), w: fin(raw.w, 100, 0, 1e5), h: fin(raw.h, 100, 0, 1e5),
    rotation: fin(raw.rotation, 0, -3600, 3600), opacity: fin(raw.opacity, 1, 0, 1),
  };
  if (raw.shadow) { const s = shadow(raw.shadow); if (s) el.shadow = s; }
  // Fields every element of its type has are always written; optional
  // ones only when the file has them, so a design reads back unchanged.
  const shapeLike = ['rect', 'ellipse', 'shape'].includes(t);
  if (shapeLike || t === 'line' || raw.stroke !== undefined) el.stroke = color(raw.stroke, t === 'line' ? '#6b7280' : '');
  if (shapeLike || t === 'line' || raw.strokeWidth !== undefined) el.strokeWidth = fin(raw.strokeWidth, t === 'line' ? 2 : 0, 0, 1000);
  if (raw.strokeStyle) el.strokeStyle = oneOf(raw.strokeStyle, ['solid', 'dashed', 'dotted'], 'solid');
  if (shapeLike) el.fill = color(raw.fill, '#6b7280');
  if (shapeLike && raw.gradient) el.gradient = gradient(raw.gradient);
  if (t === 'rect' || raw.radius !== undefined) el.radius = fin(raw.radius, 0, 0, 1e5);
  if (t === 'shape') el.shape = oneOf(raw.shape, Object.keys(SHAPES), 'star');
  if (t === 'text') {
    Object.assign(el, {
      text: str(raw.text, 20000, ''), font: typeof raw.font === 'string' && SAFE_ID.test(raw.font) ? raw.font : 'sans',
      size: fin(raw.size, 32, 1, 2000), weight: Math.round(fin(raw.weight, 400, 100, 900) / 100) * 100,
      align: oneOf(raw.align, ['left', 'center', 'right', 'justify'], 'left'), color: color(raw.color, '#1c1917') || '#1c1917',
    });
    if (raw.lineHeight !== undefined) el.lineHeight = fin(raw.lineHeight, 1.25, 0.5, 5);
    if (raw.letterSpacing !== undefined) el.letterSpacing = fin(raw.letterSpacing, 0, -100, 500);
    for (const k of ['italic', 'underline', 'strike', 'hollow']) if (raw[k] === true) el[k] = true;
    if (raw.textCase) el.textCase = oneOf(raw.textCase, ['none', 'upper', 'lower', 'title'], 'none');
    if (raw.highlight) el.highlight = color(raw.highlight);
    if (raw.gradient) el.gradient = gradient(raw.gradient);
    if (isObj(raw.outline)) el.outline = { color: color(raw.outline.color, '#1c1917') || '#1c1917', width: fin(raw.outline.width, 2, 0, 200) };
  }
  if (t === 'svg') {
    try {
      el.svg = sanitizeSvg(raw.svg);
    } catch {
      ctx.dropped += 1;
      return null;
    }
    el.color = color(raw.color);
  }
  if (t === 'image') {
    el.imageId = typeof raw.imageId === 'string' && SAFE_ID.test(raw.imageId) ? raw.imageId : null;
    if (el.imageId) ctx.imageIds.add(el.imageId);
    if (raw.crop) el.crop = normalizeCrop(isObj(raw.crop) ? raw.crop : {});
    if (raw.mask) el.mask = oneOf(raw.mask, Object.keys(MASKS), 'none');
    if (isObj(raw.adjust)) {
      el.adjust = {};
      for (const k of ADJUST_KEYS) if (typeof raw.adjust[k] === 'number') el.adjust[k] = fin(raw.adjust[k], ADJUST_DEFAULTS[k], -360, 400);
    }
    if (raw.flipX === true) el.flipX = true;
    if (raw.flipY === true) el.flipY = true;
    if (raw.natW) el.natW = fin(raw.natW, 0, 0, 1e5);
    if (raw.natH) el.natH = fin(raw.natH, 0, 0, 1e5);
  }
  if (t === 'group') {
    const kids = depth < MAX_DEPTH && Array.isArray(raw.children) ? raw.children : [];
    el.children = kids.map((c) => element(c, ctx, depth + 1)).filter(Boolean);
    if (!el.children.length) { ctx.dropped += 1; return null; }
  }
  return el;
}

function page(raw, ctx, i) {
  if (!isObj(raw)) fail(`Page ${i + 1} in this file is damaged.`);
  const size = (v) => Math.round(fin(v, 1080, PAGE_MIN, PAGE_MAX));
  const p = {
    id: id(raw.id), name: str(raw.name, 120, `Page ${i + 1}`) || `Page ${i + 1}`,
    width: size(raw.width), height: size(raw.height), background: color(raw.background, '#ffffff') || '#ffffff',
    elements: (Array.isArray(raw.elements) ? raw.elements : []).map((e) => element(e, ctx, 0)).filter(Boolean),
    guides: (Array.isArray(raw.guides) ? raw.guides : []).filter(isObj).slice(0, 200)
      .map((g) => ({ id: id(g.id), axis: g.axis === 'h' ? 'h' : 'v', pos: fin(g.pos) })),
  };
  if (raw.gradient) p.gradient = gradient(raw.gradient);
  if (isObj(raw.pattern) && typeof raw.pattern.svg === 'string') {
    try {
      p.pattern = { svg: sanitizeSvg(raw.pattern.svg), size: fin(raw.pattern.size, 40, 4, 2000) };
    } catch {
      ctx.warnings.push(`The pattern on ${p.name} couldn't be read and was left out.`);
    }
  }
  return p;
}

// A design from a file, cleaned. Throws when there is no usable design.
export function cleanDesign(raw, ctx) {
  if (!isObj(raw) || !Array.isArray(raw.pages) || !raw.pages.length) fail("This file doesn't contain a design.");
  if (raw.pages.length > MAX_PAGES) fail(`This design has more than ${MAX_PAGES} pages.`);
  return {
    id: id(raw.id), name: str(raw.name, 200, 'Imported design').trim() || 'Imported design',
    createdAt: time(raw.createdAt), updatedAt: time(raw.updatedAt),
    pages: raw.pages.map((p, i) => page(p, ctx, i)),
  };
}

function files(list, mimes, maxBytes, ctx, what) {
  const out = [];
  for (const f of Array.isArray(list) ? list : []) {
    if (!isObj(f) || typeof f.id !== 'string' || !SAFE_ID.test(f.id) || !mimes.includes(f.type || '')) { ctx.badFiles += 1; continue; }
    let bytes;
    try {
      bytes = base64ToBytes(f.data);
    } catch {
      ctx.badFiles += 1;
      continue;
    }
    if (!bytes.length || bytes.length > maxBytes) { ctx.badFiles += 1; continue; }
    out.push({ id: f.id, type: f.type, bytes, ...(what === 'font' ? { name: str(f.name, 120, 'Imported font') } : {}) });
  }
  return out;
}

function finishWarnings(ctx, images) {
  const have = new Set(images.map((i) => i.id));
  const missing = [...ctx.imageIds].filter((i) => !have.has(i)).length;
  if (ctx.dropped) ctx.warnings.push(`${ctx.dropped} item${ctx.dropped === 1 ? '' : 's'} couldn't be read and ${ctx.dropped === 1 ? 'was' : 'were'} left out.`);
  if (ctx.badFiles) ctx.warnings.push(`${ctx.badFiles} embedded file${ctx.badFiles === 1 ? " wasn't" : "s weren't"} usable and ${ctx.badFiles === 1 ? 'was' : 'were'} left out.`);
  if (missing) ctx.warnings.push(`${missing} image${missing === 1 ? ' is' : 's are'} missing from the file.`);
}

// Read a Home Studio file's text. Resolves { kind, ...contents, warnings }
// or throws an Error whose message a person can act on.
export function parseHomeStudioFile(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    fail("This isn't a Home Studio file, or it is damaged.");
  }
  if (!isObj(data) || data.format !== FORMAT) fail("This isn't a Home Studio file.");
  if (!Number.isInteger(data.version) || data.version < 1) fail('This Home Studio file is damaged: it has no version.');
  if (data.version > FORMAT_VERSION) fail('This file was made by a newer version of Home Studio. Reload the app to update it, then try again.');
  const ctx = { warnings: [], dropped: 0, badFiles: 0, count: 0, imageIds: new Set() };
  if (data.kind === 'project') {
    const design = cleanDesign(data.design, ctx);
    const images = files(data.images, IMAGE_MIME, MAX_IMAGE_BYTES, ctx, 'image');
    const fonts = files(data.fonts, FONT_MIME, MAX_FONT_BYTES, ctx, 'font');
    finishWarnings(ctx, images);
    return { kind: 'project', design, images, fonts, exportedAt: str(data.exportedAt, 40), warnings: ctx.warnings };
  }
  if (data.kind === 'backup') {
    const designs = [];
    for (const d of Array.isArray(data.designs) ? data.designs : []) {
      try { designs.push(cleanDesign(d, ctx)); } catch { ctx.dropped += 1; }
    }
    const versions = [];
    for (const v of Array.isArray(data.versions) ? data.versions : []) {
      if (!isObj(v) || typeof v.designId !== 'string') continue;
      try {
        versions.push({ id: id(v.id), designId: id(v.designId), createdAt: time(v.createdAt), label: str(v.label, 120, 'Version'), design: cleanDesign(v.design, ctx) });
      } catch { ctx.dropped += 1; }
    }
    const components = [];
    for (const c of Array.isArray(data.components) ? data.components : []) {
      if (!isObj(c) || !Array.isArray(c.elements)) continue;
      const elements = c.elements.map((e) => element(e, ctx, 0)).filter(Boolean);
      if (elements.length) components.push({ id: id(c.id), name: str(c.name, 120, 'Component'), w: fin(c.w, 100, 1, 1e5), h: fin(c.h, 100, 1, 1e5), createdAt: time(c.createdAt), elements });
    }
    const assets = [];
    for (const a of Array.isArray(data.assets) ? data.assets : []) {
      if (!isObj(a) || !['image', 'svg', 'font'].includes(a.kind)) continue;
      const base = { id: id(a.id), kind: a.kind, name: str(a.name, 120, 'Imported file'), createdAt: time(a.createdAt) };
      if (a.kind === 'svg') {
        try { assets.push({ ...base, svg: sanitizeSvg(a.svg), w: fin(a.w, 100, 1, 1e5), h: fin(a.h, 100, 1, 1e5) }); } catch { ctx.badFiles += 1; }
        continue;
      }
      const [file] = files([{ id: base.id, type: a.type || '', data: a.data }], a.kind === 'image' ? IMAGE_MIME : FONT_MIME,
        a.kind === 'image' ? MAX_IMAGE_BYTES : MAX_FONT_BYTES, ctx, a.kind);
      if (file) assets.push({ ...base, type: file.type, bytes: file.bytes, ...(a.kind === 'image' ? { w: fin(a.w, 1, 1, 1e5), h: fin(a.h, 1, 1, 1e5) } : {}) });
    }
    const images = files(data.images, IMAGE_MIME, MAX_IMAGE_BYTES, ctx, 'image');
    const favorites = (Array.isArray(data.favorites) ? data.favorites : []).filter((f) => typeof f === 'string' && f.length < 200);
    finishWarnings(ctx, images);
    if (!designs.length && !assets.length && !components.length) fail('This backup is empty, or none of it could be read.');
    return { kind: 'backup', designs, versions, components, assets, images, favorites, exportedAt: str(data.exportedAt, 40), warnings: ctx.warnings };
  }
  fail("This Home Studio file is of a kind this version can't open.");
}

// A project as a fresh design of this device's own: a new design id, page
// ids kept, and image ids renamed so nothing on the device is overwritten.
// Returns { design, images } with images [{ id (new), type, bytes }].
export function freshCopy(parsed) {
  const design = structuredClone(parsed.design);
  design.id = uid();
  design.createdAt = Date.now();
  design.updatedAt = Date.now();
  const rename = new Map(parsed.images.map((img) => [img.id, uid()]));
  const visit = (els) => {
    for (const el of els) {
      if (el.type === 'image') el.imageId = rename.get(el.imageId) || null;
      if (el.children) visit(el.children);
    }
  };
  for (const p of design.pages) visit(p.elements);
  return { design, images: parsed.images.map((img) => ({ ...img, id: rename.get(img.id) })) };
}
