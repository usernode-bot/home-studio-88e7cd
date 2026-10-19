// The document model: factories, ids, bounds, geometry.
// Pure data and pure functions — no DOM, no React, no storage.

export const uid = () =>
  Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const PAGE_MIN = 16;
export const PAGE_MAX = 10000;

// The four text fonts, keyed as stored on the element.
export const FONT_FAMILIES = {
  sans: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  rounded: 'ui-rounded, "Hiragino Maru Gothic ProN", Quicksand, system-ui, sans-serif',
};

export const FONT_LABELS = { sans: 'Sans', serif: 'Serif', mono: 'Mono', rounded: 'Rounded' };

export const TYPE_LABELS = {
  text: 'Text',
  rect: 'Shape',
  ellipse: 'Shape',
  line: 'Line',
  image: 'Image',
  group: 'Group',
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
    name: TYPE_LABELS[type] === 'Shape' ? (type === 'ellipse' ? 'Ellipse' : 'Rectangle') : TYPE_LABELS[type],
    x: box.x ?? 0,
    y: box.y ?? 0,
    w: Math.max(1, box.w ?? 100),
    h: Math.max(1, box.h ?? 100),
    rotation: 0,
    opacity: 1,
  };
  if (type === 'rect' || type === 'ellipse') {
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
  }
  if (type === 'image') el.imageId = null;
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
// element's font. Runs in the browser only (needs a measuring context).
export function measureTextHeight(el) {
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = `${el.weight} ${el.size}px ${FONT_FAMILIES[el.font] || FONT_FAMILIES.sans}`;
  let lines = 0;
  for (const para of String(el.text).split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const next = line ? line + ' ' + word : word;
      if (line && ctx.measureText(next).width > el.w) {
        lines += 1;
        line = word;
      } else {
        line = next;
      }
    }
    lines += 1;
  }
  return Math.max(el.size * 1.25, lines * el.size * 1.25 + 8);
}
