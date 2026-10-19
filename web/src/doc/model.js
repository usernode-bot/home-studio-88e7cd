// The document model: factories, ids, bounds, geometry.
// Pure data and pure functions — no DOM, no React, no storage.

import { SYSTEM_FONTS, SYSTEM_LABELS, fontStack } from '../assets/fonts.js';
import { wrapLines } from '../export/textLayout.js';

export const uid = () =>
  Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const PAGE_MIN = 16;
export const PAGE_MAX = 10000;

// The four system text fonts, keyed as stored on the element. Bundled and
// imported fonts are in assets/fonts.js; fontStack() resolves any key.
export const FONT_FAMILIES = SYSTEM_FONTS;
export const FONT_LABELS = SYSTEM_LABELS;

export const TYPE_LABELS = {
  text: 'Text',
  rect: 'Shape',
  ellipse: 'Shape',
  line: 'Line',
  image: 'Image',
  group: 'Group',
  shape: 'Shape',
  svg: 'Graphic',
};

export function newPage(name, width, height) {
  return {
    id: uid(),
    name,
    width,
    height,
    background: '#ffffff',
    elements: [], // bottom first
    guides: [], // { id, axis: 'v' | 'h', pos }
  };
}

export function newDesign(name, width, height) {
  const page = newPage('Page 1', width, height);
  return { id: uid(), name, createdAt: Date.now(), updatedAt: Date.now(), pages: [page] };
}

// A new element of `type`, placed to cover `box` ({x,y,w,h}). Type-specific
// fields get sensible defaults so the element is real the moment it exists.
export function newElement(type, box = {}, extra = {}) {
  const el = {
    id: uid(),
    type,
    name: type === 'rect' ? 'Rectangle' : type === 'ellipse' ? 'Ellipse' : TYPE_LABELS[type],
    x: box.x ?? 0,
    y: box.y ?? 0,
    w: Math.max(1, box.w ?? 100),
    h: Math.max(1, box.h ?? 100),
    rotation: 0,
    opacity: 1,
  };
  if (type === 'rect' || type === 'ellipse' || type === 'shape') {
    el.fill = '#6b7280';
    el.stroke = '';
    el.strokeWidth = 0;
  }
  if (type === 'rect') el.radius = 0;
  if (type === 'line') {
    el.stroke = '#6b7280';
    el.strokeWidth = 2;
  }
  if (type === 'text') {
    el.text = 'Text';
    el.font = 'sans';
    el.size = 32;
    el.weight = 400;
    el.align = 'left';
    el.color = '#1c1917';
    el.lineHeight = 1.25;
    el.letterSpacing = 0;
  }
  if (type === 'shape') el.shape = 'star';
  if (type === 'image') el.imageId = null;
  if (type === 'svg') {
    el.svg = '';
    el.color = '#1c1917';
  }
  return Object.assign(el, extra);
}

// ── Tree walking ─────────────────────────────────────────────────────────
// Elements are a flat, bottom-first array per page; groups nest their
// children (children coordinates are relative to the group's own origin).

export function* walk(elements) {
  for (const el of elements) {
    yield el;
    if (el.type === 'group' && el.children) yield* walk(el.children);
  }
}

export function findElement(elements, id) {
  for (const el of walk(elements)) if (el.id === id) return el;
  return null;
}

// The top-level element that owns `id` (itself, or the group containing it).
export function topLevelOf(elements, id) {
  for (const el of elements) {
    if (el.id === id) return el;
    if (el.type === 'group' && el.children && findElement(el.children, id)) return el;
  }
  return null;
}

// ── Geometry ──────────────────────────────────────────────────────────────

// Axis-aligned bounding box of one element, its rotation accounted for.
export function boundsOfElement(el) {
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  const rad = ((el.rotation || 0) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const rw = (el.w / 2) * cos + (el.h / 2) * sin;
  const rh = (el.w / 2) * sin + (el.h / 2) * cos;
  return { x: cx - rw, y: cy - rh, w: rw * 2, h: rh * 2 };
}

export function unionBoxes(boxes) {
  const x1 = Math.min(...boxes.map((b) => b.x));
  const y1 = Math.min(...boxes.map((b) => b.y));
  const x2 = Math.max(...boxes.map((b) => b.x + b.w));
  const y2 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export function selectionBounds(elements, ids) {
  const boxes = [];
  for (const el of elements) if (ids.includes(el.id)) boxes.push(boundsOfElement(el));
  return boxes.length ? unionBoxes(boxes) : null;
}

export function boxesIntersect(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

// Page-coordinate point -> element-local point (unrotated frame).
export function toLocal(el, px, py) {
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  const rad = ((el.rotation || 0) * Math.PI) / 180;
  const dx = px - cx;
  const dy = py - cy;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: cx + dx * cos + dy * sin, y: cy - dx * sin + dy * cos };
}

export function pageIsValid(w, h) {
  return (
    Number.isInteger(w) && Number.isInteger(h) && w >= PAGE_MIN && w <= PAGE_MAX && h >= PAGE_MIN && h <= PAGE_MAX
  );
}

// Rough text height for a text element: wraps `el.text` to `el.w` at the
// element's font, with the same rule the export serialiser uses. Runs in the
// browser only (needs a measuring context).
export function measureTextHeight(el) {
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = `${el.italic ? 'italic ' : ''}${el.weight} ${el.size}px ${fontStack(el.font)}`;
  const lh = el.lineHeight || 1.25;
  const lines = wrapLines(el, (_e, s) => ctx.measureText(s).width).flat().length;
  return Math.max(el.size * lh, lines * el.size * lh + 8);
}

// Give an element (and a group's children) fresh ids, in place.
export function reidElement(el) {
  el.id = uid();
  if (el.children) el.children.forEach(reidElement);
  return el;
}

// Every image blob id an element list references, groups included.
export function imageIdsIn(elements) {
  const ids = new Set();
  for (const el of walk(elements)) if (el.type === 'image' && el.imageId) ids.add(el.imageId);
  return ids;
}
