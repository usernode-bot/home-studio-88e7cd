// Validation for anything that comes off this device from outside: a project
// file, a backup, or a stored design opened after something went wrong.
// Copies only known fields, clamps what can be clamped, and throws a
// message naming the problem. Unknown fields are dropped, so a file from an
// older Home Studio round-trips cleanly.

import { uid, PAGE_MIN, PAGE_MAX, pageIsValid } from './model.js';
import { sanitizeSvg } from '../assets/svg.js';

const HEX = /^#[0-9a-fA-F]{3,8}$/;
const num = (v, lo, hi, what) => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`A ${what} value in the file isn't a number.`);
  return Math.min(hi, Math.max(lo, n));
};
const int = (v, lo, hi, what) => Math.round(num(v, lo, hi, what));
const str = (v, max, what) => {
  if (v == null) return undefined;
  if (typeof v !== 'string') throw new Error(`The file's ${what} isn't text.`);
  if (v.length > max) throw new Error(`The file's ${what} is too long.`);
  return v;
};
const colour = (v, what) => {
  if (v == null || v === '') return undefined;
  if (typeof v !== 'string' || !HEX.test(v)) throw new Error(`A ${what} in the file isn't a colour Home Studio can use.`);
  return v;
};

const STYLE_KEYS = ['gradient', 'shadow', 'strokeStyle', 'outline', 'hollow', 'highlight', 'italic', 'underline',
  'strike', 'lineHeight', 'letterSpacing', 'textCase', 'crop', 'mask', 'adjust', 'flipX', 'flipY', 'natW', 'natH'];

function cleanObject(v, what, maxDepth = 2) {
  if (v == null) return undefined;
  if (typeof v !== 'object' || Array.isArray(v)) throw new Error(`The file's ${what} is malformed.`);
  if (maxDepth <= 0) return undefined;
  return v;
}

function cleanElement(raw, depth) {
  if (!raw || typeof raw !== 'object') throw new Error('An element in the file is malformed.');
  if (depth > 8) throw new Error('The file nests groups too deeply (more than 8).');
  const el = {
    id: typeof raw.id === 'string' && raw.id.length <= 64 ? raw.id : uid(),
    type: raw.type,
    name: str(raw.name, 200, 'element name') || 'Element',
    x: num(raw.x, -1e6, 1e6, 'position'),
    y: num(raw.y, -1e6, 1e6, 'position'),
    w: num(raw.w, 0, 1e6, 'size'),
    h: num(raw.h, 0, 1e6, 'size'),
    rotation: num(raw.rotation, -3600, 3600, 'rotation'),
    opacity: num(raw.opacity ?? 1, 0, 1, 'opacity'),
  };
  if (el.type === 'text') {
    el.text = str(raw.text, 100000, 'text') ?? '';
    el.font = str(raw.font, 100, 'font') || 'sans';
    el.size = num(raw.size, 1, 5000, 'font size');
    el.weight = int(raw.weight ?? 400, 100, 900, 'font weight');
    el.align = ['left', 'center', 'right', 'justify'].includes(raw.align) ? raw.align : 'left';
    el.color = colour(raw.color, 'text colour') || '#1c1917';
  }
  if (el.type === 'rect' || el.type === 'ellipse' || el.type === 'shape') {
    el.fill = colour(raw.fill, 'fill colour') || '#6b7280';
    el.stroke = colour(raw.stroke, 'border colour') ?? '';
    el.strokeWidth = num(raw.strokeWidth ?? 0, 0, 1000, 'border width');
  }
  if (el.type === 'rect') el.radius = num(raw.radius ?? 0, 0, 1e5, 'corner radius');
  if (el.type === 'line') {
    el.stroke = colour(raw.stroke, 'line colour') || '#6b7280';
    el.strokeWidth = num(raw.strokeWidth ?? 2, 0, 1000, 'line width');
  }
  if (el.type === 'shape') {
    if (typeof raw.shape !== 'string' || raw.shape.length > 50) throw new Error("The file's shape name is malformed.");
    el.shape = raw.shape;
  }
  if (el.type === 'image') {
    if (typeof raw.imageId !== 'string' || !raw.imageId) throw new Error('An image in the file is missing its file reference.');
    el.imageId = raw.imageId;
  }
  if (el.type === 'svg') {
    if (typeof raw.svg !== 'string') throw new Error("The file's graphic isn't SVG text.");
    el.svg = sanitizeSvg(raw.svg); // re-cleans anything active out
    el.color = colour(raw.color, 'graphic colour') ?? '';
  }
  for (const k of STYLE_KEYS) {
    if (raw[k] === undefined || raw[k] === null) continue;
    if (k === 'gradient' || k === 'shadow' || k === 'outline' || k === 'crop' || k === 'adjust') {
      const v = cleanObject(raw[k], k);
      if (v !== undefined) el[k] = v;
    } else {
      el[k] = raw[k];
    }
  }
  if (raw.children != null) {
    if (!Array.isArray(raw.children) || raw.children.length > 5000) throw new Error('A group in the file holds too many elements.');
    if (raw.type === 'group') el.children = raw.children.map((c) => cleanElement(c, depth + 1));
  }
  return el;
}

// A whole design as read from a file (or the store). Throws a message for
// the dialog when the content can't be used.
export function normalizeDesign(raw) {
  if (!raw || typeof raw !== 'object') throw new Error("That file isn't a Home Studio design.");
  if (!Array.isArray(raw.pages) || raw.pages.length < 1) throw new Error("The file holds no pages.");
  if (raw.pages.length > 200) throw new Error("The file holds more than 200 pages.");
  const design = {
    id: typeof raw.id === 'string' && raw.id.length <= 64 ? raw.id : uid(),
    name: str(raw.name, 200, 'design name') || 'Imported design',
    createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now(),
    pages: [],
  };
  for (const p of raw.pages) {
    if (!p || typeof p !== 'object') throw new Error('A page in the file is malformed.');
    const width = int(p.width, PAGE_MIN, PAGE_MAX, 'page width');
    const height = int(p.height, PAGE_MIN, PAGE_MAX, 'page height');
    if (!pageIsValid(width, height)) throw new Error(`A page size in the file (${p.width} × ${p.height}) is outside what Home Studio allows.`);
    if (!Array.isArray(p.elements) || p.elements.length > 5000) throw new Error('A page in the file holds too many elements.');
    const page = {
      id: typeof p.id === 'string' && p.id.length <= 64 ? p.id : uid(),
      name: str(p.name, 200, 'page name') || 'Page',
      width, height,
      background: colour(p.background, 'page background') || '#ffffff',
      elements: p.elements.map((e) => cleanElement(e, 0)),
      guides: Array.isArray(p.guides) ? p.guides.slice(0, 500) : [],
    };
    if (p.gradient) page.gradient = cleanObject(p.gradient, 'page gradient');
    if (p.pattern && typeof p.pattern === 'object' && typeof p.pattern.svg === 'string') {
      page.pattern = { ...p.pattern, svg: sanitizeSvg(p.pattern.svg) };
    }
    design.pages.push(page);
  }
  return design;
}