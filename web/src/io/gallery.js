// The gallery-item envelope: a design and its images, packaged the way a
// project file is, plus the metadata a gallery listing shows. Everything
// from a gallery is untrusted and goes through the same field-by-field
// cleaning a project file does; the metadata has its own small whitelist
// and caps. Pure: bytes in, plain objects out.

import {
  FORMAT, FORMAT_VERSION, serializeProject, parseHomeStudioFile,
} from './project.js';
import { utf8, fromUtf8 } from './binary.js';

export const GALLERY_KIND = 'gallery-item';
export const GALLERY_VERSION = 1;

// Only licences a remix can credit properly. Anything else is refused.
export const GALLERY_LICENCES = ['CC0-1.0', 'CC-BY-4.0', 'CC-BY-SA-4.0'];

export const GALLERY_TITLE_CHARS = 120;
export const GALLERY_AUTHOR_CHARS = 80;
export const GALLERY_TAGS_MAX = 10;
export const GALLERY_TAG_CHARS = 24;
export const GALLERY_DESC_CHARS = 600;
export const GALLERY_MAX_BYTES = 25 * 1024 * 1024;

const fail = (msg) => { throw new Error(msg); };
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Metadata as published: trimmed, capped, defaulted. Throws on a bad
// licence (the one field a person must get right) and on no title.
export function cleanMeta(raw) {
  if (!isObj(raw)) fail('A gallery item needs its metadata.');
  const title = String(raw.title || '').trim().slice(0, GALLERY_TITLE_CHARS);
  if (!title) fail('A gallery item needs a title.');
  const tags = (Array.isArray(raw.tags) ? raw.tags : [])
    .map((t) => String(t || '').trim().toLowerCase().slice(0, GALLERY_TAG_CHARS))
    .filter(Boolean)
    .slice(0, GALLERY_TAGS_MAX);
  const licence = GALLERY_LICENCES.includes(raw.licence) ? raw.licence : null;
  if (!licence) fail(`Pick a licence for publishing: one of ${GALLERY_LICENCES.join(', ')}.`);
  return {
    title,
    author: String(raw.author || '').trim().slice(0, GALLERY_AUTHOR_CHARS) || 'Anonymous',
    licence,
    tags,
    description: String(raw.description || '').trim().slice(0, GALLERY_DESC_CHARS),
    id: typeof raw.id === 'string' && /^[A-Za-z0-9_:.-]{1,80}$/.test(raw.id) ? raw.id : null,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : null,
  };
}

// Build the item bytes. The design part is written exactly like a project
// file, so opening one reuses the whole project-file reader.
export function buildGalleryItem({ design, images = [], fonts = [], item }, date = new Date()) {
  const meta = cleanMeta(item);
  const project = JSON.parse(fromUtf8(serializeProject({ design, images, fonts }, date)));
  return utf8(JSON.stringify({
    format: FORMAT, kind: GALLERY_KIND, version: GALLERY_VERSION,
    app: { name: 'Home Studio' }, exportedAt: date.toISOString(),
    item: meta,
    project: { format: project.format, kind: project.kind, version: project.version, design: project.design, images: project.images, fonts: project.fonts },
  }));
}

// Read item bytes. Resolves { item, design, images, fonts, warnings } or
// throws an Error whose message a person can act on. The design part is
// read by the project-file reader (kind 'project'), so nothing new is
// trusted here.
export function parseGalleryItem(bytes) {
  const text = typeof bytes === 'string' ? bytes : fromUtf8(bytes);
  if (text.length > GALLERY_MAX_BYTES) fail('This gallery item is too large to open.');
  let data;
  try { data = JSON.parse(text); } catch { fail("This isn't a Home Studio gallery item, or it is damaged."); }
  if (!isObj(data) || data.format !== FORMAT || data.kind !== GALLERY_KIND) fail("This isn't a Home Studio gallery item.");
  if (!Number.isInteger(data.version) || data.version < 1 || data.version > GALLERY_VERSION) {
    fail('This gallery item was made by a different version of Home Studio.');
  }
  const meta = cleanMeta(data.item);
  const parsed = parseHomeStudioFile(JSON.stringify({
    format: FORMAT, kind: 'project', version: data.project && data.project.version ? data.project.version : 1,
    exportedAt: data.exportedAt,
    design: data.project ? data.project.design : undefined,
    images: data.project ? data.project.images : undefined,
    fonts: data.project ? data.project.fonts : undefined,
  }));
  return { item: meta, design: parsed.design, images: parsed.images, fonts: parsed.fonts, warnings: parsed.warnings };
}