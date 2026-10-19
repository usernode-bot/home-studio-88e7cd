// Fonts: the four system stacks, the bundled free fonts (Fontsource
// packages, each under the SIL Open Font License 1.1) and fonts a person
// imports from their own device. Bundled font files load lazily: a font's
// stylesheet is only fetched the first time something uses it.

export const SYSTEM_FONTS = {
  sans: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  rounded: 'ui-rounded, "Hiragino Maru Gothic ProN", Quicksand, system-ui, sans-serif',
};
export const SYSTEM_LABELS = { sans: 'Sans', serif: 'Serif', mono: 'Mono', rounded: 'Rounded' };

const OFL = 'OFL-1.1';

// key -> { family, fallback, weights, italic, category, tags, license, attribution, source, load }.
// Each `load` imports whole literal paths so the build can split them.
export const BUNDLED_FONTS = {
  inter: {
    family: 'Inter', fallback: 'sans-serif', category: 'Sans serif', tags: ['clean', 'ui', 'modern'], weights: [400, 700], italic: true,
    attribution: 'Copyright 2016 The Inter Project Authors', source: 'https://github.com/rsms/inter',
    load: () => Promise.all([import('@fontsource/inter/400.css'), import('@fontsource/inter/700.css'), import('@fontsource/inter/400-italic.css')]),
  },
  montserrat: {
    family: 'Montserrat', fallback: 'sans-serif', category: 'Sans serif', tags: ['geometric', 'bold', 'heading'], weights: [400, 700, 900], italic: true,
    attribution: 'Copyright 2011 The Montserrat Project Authors', source: 'https://github.com/JulietaUla/Montserrat',
    load: () => Promise.all([import('@fontsource/montserrat/400.css'), import('@fontsource/montserrat/700.css'), import('@fontsource/montserrat/900.css'), import('@fontsource/montserrat/400-italic.css')]),
  },
  playfair: {
    family: 'Playfair Display', fallback: 'serif', category: 'Serif', tags: ['elegant', 'display', 'wedding'], weights: [400, 700], italic: true,
    attribution: 'Copyright 2017 The Playfair Display Project Authors', source: 'https://github.com/clauseggers/Playfair-Display',
    load: () => Promise.all([import('@fontsource/playfair-display/400.css'), import('@fontsource/playfair-display/700.css'), import('@fontsource/playfair-display/400-italic.css')]),
  },
  merriweather: {
    family: 'Merriweather', fallback: 'serif', category: 'Serif', tags: ['reading', 'document', 'body'], weights: [400, 700], italic: true,
    attribution: 'Copyright 2024 The Merriweather Project Authors', source: 'https://github.com/EbenSorkin/Merriweather4',
    load: () => Promise.all([import('@fontsource/merriweather/400.css'), import('@fontsource/merriweather/700.css'), import('@fontsource/merriweather/400-italic.css')]),
  },
  oswald: {
    family: 'Oswald', fallback: 'sans-serif', category: 'Display', tags: ['condensed', 'poster', 'heading'], weights: [400, 700], italic: false,
    attribution: 'Copyright 2016 The Oswald Project Authors', source: 'https://github.com/googlefonts/OswaldFont',
    load: () => Promise.all([import('@fontsource/oswald/400.css'), import('@fontsource/oswald/700.css')]),
  },
  bebas: {
    family: 'Bebas Neue', fallback: 'sans-serif', category: 'Display', tags: ['caps', 'poster', 'thumbnail'], weights: [400], italic: false,
    attribution: 'Copyright 2019 The Bebas Neue Project Authors', source: 'https://github.com/dharmatype/Bebas-Neue',
    load: () => import('@fontsource/bebas-neue/400.css'),
  },
  lobster: {
    family: 'Lobster', fallback: 'cursive', category: 'Script', tags: ['retro', 'logo', 'friendly'], weights: [400], italic: false,
    attribution: 'Copyright 2010 The Lobster Project Authors', source: 'https://github.com/impallari/The-Lobster-Font',
    load: () => import('@fontsource/lobster/400.css'),
  },
  pacifico: {
    family: 'Pacifico', fallback: 'cursive', category: 'Script', tags: ['brush', 'surf', 'invitation'], weights: [400], italic: false,
    attribution: 'Copyright 2018 The Pacifico Project Authors', source: 'https://github.com/googlefonts/Pacifico',
    load: () => import('@fontsource/pacifico/400.css'),
  },
  caveat: {
    family: 'Caveat', fallback: 'cursive', category: 'Handwriting', tags: ['handwritten', 'note', 'casual'], weights: [400, 700], italic: false,
    attribution: 'Copyright 2014 The Caveat Project Authors', source: 'https://github.com/googlefonts/caveat',
    load: () => Promise.all([import('@fontsource/caveat/400.css'), import('@fontsource/caveat/700.css')]),
  },
  spacemono: {
    family: 'Space Mono', fallback: 'monospace', category: 'Monospace', tags: ['code', 'tech', 'typewriter'], weights: [400, 700], italic: true,
    attribution: 'Copyright 2016 The Space Mono Project Authors', source: 'https://github.com/googlefonts/spacemono',
    load: () => Promise.all([import('@fontsource/space-mono/400.css'), import('@fontsource/space-mono/700.css'), import('@fontsource/space-mono/400-italic.css')]),
  },
};
for (const f of Object.values(BUNDLED_FONTS)) f.license = OFL;

// Imported fonts: key `user:<assetId>`, registered under a family of their own.
const userFonts = new Map(); // key -> { name, family }
export const userFontFamily = (assetId) => 'HS-' + assetId;

export function fontStack(key) {
  if (SYSTEM_FONTS[key]) return SYSTEM_FONTS[key];
  const b = BUNDLED_FONTS[key];
  if (b) return `"${b.family}", ${b.fallback}`;
  if (typeof key === 'string' && key.startsWith('user:')) return `"${userFontFamily(key.slice(5))}", system-ui, sans-serif`;
  return SYSTEM_FONTS.sans;
}

export function fontLabel(key) {
  if (SYSTEM_LABELS[key]) return SYSTEM_LABELS[key];
  if (BUNDLED_FONTS[key]) return BUNDLED_FONTS[key].family;
  if (userFonts.has(key)) return userFonts.get(key).name;
  return 'Imported font';
}

export const listUserFonts = () => [...userFonts.entries()].map(([key, f]) => ({ key, ...f }));

// Load a bundled font the first time it is needed. Resolves once its
// stylesheet is in; never rejects (a font that fails keeps its fallback).
const loading = new Map();
export function ensureFont(key) {
  const b = BUNDLED_FONTS[key];
  if (!b) return Promise.resolve(false);
  if (!loading.has(key)) loading.set(key, b.load().then(() => true, () => false));
  return loading.get(key);
}

// Fonts every text element on these pages uses, groups included.
export function fontsUsed(pages) {
  const keys = new Set();
  const visit = (els) => {
    for (const el of els) {
      if (el.type === 'text' && el.font) keys.add(el.font);
      if (el.children) visit(el.children);
    }
  };
  for (const p of pages) visit(p.elements);
  return [...keys];
}

// A font file from this device: checked by the browser's own font loader,
// then registered for this session. Rejects when the file isn't a font.
export const FONT_FILE = /\.(ttf|otf|woff2?)$/i;
export async function registerUserFont(asset) {
  const key = 'user:' + asset.id;
  if (userFonts.has(key)) return key;
  const data = await asset.blob.arrayBuffer();
  const face = new FontFace(userFontFamily(asset.id), data);
  await face.load();
  document.fonts.add(face);
  userFonts.set(key, { name: asset.name, family: userFontFamily(asset.id) });
  return key;
}
export function forgetUserFont(assetId) {
  userFonts.delete('user:' + assetId);
}
