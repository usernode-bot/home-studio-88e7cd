// The bundled asset library: icons, shapes, illustrations, backgrounds and
// fonts, each with its licence and attribution, plus the search the
// Library uses. Only assets under licences that allow free reuse are
// bundled; LICENSES lists them, and a test checks every item against it.

import {
  Heart, Star, Sun, Moon, Cloud, Leaf, Flower2, TreePine, Mountain, Waves, Umbrella, Snowflake,
  Flame, Zap, Sparkles, Coffee, Cake, Apple, Utensils, Gift, PartyPopper, Music, Mic, Play, Camera,
  Palette, Pencil, Book, GraduationCap, Lightbulb, Rocket, Trophy, Award, Megaphone, Bell, Tag,
  Ticket, ShoppingBag, Briefcase, Calendar, Clock, MapPin, Phone, Mail, Globe, House, Users, Smile,
  PawPrint, Bike, Plane, Anchor, Feather, Quote, Check, ArrowRight,
} from 'lucide';
import { iconSvg } from './svg.js';
import { SHAPES } from '../doc/style.js';
import { BUNDLED_FONTS } from './fonts.js';

export const LICENSES = {
  'CC0-1.0': { name: 'CC0 1.0 (public domain)', url: 'https://creativecommons.org/publicdomain/zero/1.0/' },
  ISC: { name: 'ISC License', url: 'https://opensource.org/license/isc-license-txt' },
  'OFL-1.1': { name: 'SIL Open Font License 1.1', url: 'https://openfontlicense.org' },
};

// Who made what. Home Studio's own drawings are dedicated to the public domain.
export const SOURCES = {
  homestudio: { name: 'Home Studio contributors', license: 'CC0-1.0', url: '' },
  lucide: { name: 'Lucide Icons and Contributors', license: 'ISC', url: 'https://lucide.dev' },
};

export const KIND_LABELS = {
  template: 'Templates',
  icon: 'Icons',
  shape: 'Shapes',
  illustration: 'Illustrations',
  background: 'Backgrounds',
  font: 'Fonts',
};

// ── Icons (Lucide, ISC) ───────────────────────────────────────────────────
// Named imports only, so the build bundles these icons and no others.
const ICON_NODES = {
  Heart, Star, Sun, Moon, Cloud, Leaf, Flower2, TreePine, Mountain, Waves, Umbrella, Snowflake,
  Flame, Zap, Sparkles, Coffee, Cake, Apple, Utensils, Gift, PartyPopper, Music, Mic, Play, Camera,
  Palette, Pencil, Book, GraduationCap, Lightbulb, Rocket, Trophy, Award, Megaphone, Bell, Tag,
  Ticket, ShoppingBag, Briefcase, Calendar, Clock, MapPin, Phone, Mail, Globe, House, Users, Smile,
  PawPrint, Bike, Plane, Anchor, Feather, Quote, Check, ArrowRight,
};
const ICONS = [
  ['Heart', 'love valentine like'], ['Star', 'rating favourite'], ['Sun', 'summer weather'], ['Moon', 'night sleep'],
  ['Cloud', 'weather sky'], ['Leaf', 'nature plant eco'], ['Flower2', 'garden spring'], ['TreePine', 'forest christmas'],
  ['Mountain', 'outdoors hike'], ['Waves', 'sea beach water'], ['Umbrella', 'rain beach'], ['Snowflake', 'winter cold'],
  ['Flame', 'fire hot'], ['Zap', 'energy power fast'], ['Sparkles', 'magic new shine'], ['Coffee', 'cafe drink'],
  ['Cake', 'birthday party bakery'], ['Apple', 'fruit food school'], ['Utensils', 'food restaurant menu'], ['Gift', 'present birthday'],
  ['PartyPopper', 'celebration party'], ['Music', 'song concert'], ['Mic', 'podcast talk'], ['Play', 'video start'],
  ['Camera', 'photo photography'], ['Palette', 'art paint design'], ['Pencil', 'write edit'], ['Book', 'read study'],
  ['GraduationCap', 'school graduation'], ['Lightbulb', 'idea tip'], ['Rocket', 'launch startup'], ['Trophy', 'winner award'],
  ['Award', 'badge prize'], ['Megaphone', 'announcement sale'], ['Bell', 'notification reminder'], ['Tag', 'price sale'],
  ['Ticket', 'event admission'], ['ShoppingBag', 'shop store'], ['Briefcase', 'work business'], ['Calendar', 'date event'],
  ['Clock', 'time hours'], ['MapPin', 'location place'], ['Phone', 'call contact'], ['Mail', 'email contact'],
  ['Globe', 'web world'], ['House', 'home house'], ['Users', 'people team'], ['Smile', 'happy face'],
  ['PawPrint', 'pet dog cat'], ['Bike', 'cycling sport'], ['Plane', 'travel flight'], ['Anchor', 'boat sea'],
  ['Feather', 'light write'], ['Quote', 'quotation testimonial'], ['Check', 'done tick'], ['ArrowRight', 'next direction'],
];

const words = (name) => name.replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/2$/, '').trim();

const iconItems = ICONS.map(([name, tags]) => ({
  id: 'icon:' + name,
  kind: 'icon',
  category: 'Icons',
  name: words(name),
  tags: tags.split(' '),
  source: 'lucide',
  license: 'ISC',
  svg: iconSvg(ICON_NODES[name]),
}));

// ── Shapes (Home Studio, CC0) ─────────────────────────────────────────────
const shapeItems = [
  { id: 'shape:rect', name: 'Rectangle', insert: { type: 'rect' }, tags: ['square', 'box'] },
  { id: 'shape:rounded', name: 'Rounded rectangle', insert: { type: 'rect', radius: 32 }, tags: ['button', 'pill'] },
  { id: 'shape:ellipse', name: 'Circle', insert: { type: 'ellipse' }, tags: ['round', 'oval', 'dot'] },
  { id: 'shape:line', name: 'Line', insert: { type: 'line' }, tags: ['divider', 'rule'] },
  ...Object.entries(SHAPES).map(([key, s]) => ({ id: 'shape:' + key, name: s.label, insert: { type: 'shape', shape: key }, tags: [key] })),
].map((s) => ({ ...s, kind: 'shape', category: 'Shapes', source: 'homestudio', license: 'CC0-1.0' }));

// ── Illustrations (Home Studio, CC0): drawn for this app ─────────────────
const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
const ILLUSTRATIONS = [
  ['sunrise-hills', 'Sunrise over hills', 'landscape morning nature', svg(200, 120,
    '<circle cx="100" cy="70" r="34" fill="#f2c94c"/><path d="M0 120 C40 70 70 70 110 100 C140 80 170 76 200 96 L200 120 Z" fill="#1f6f5c"/><path d="M0 120 C50 92 110 96 200 120 Z" fill="#2f8f6f"/>')],
  ['potted-plant', 'Potted plant', 'plant home garden', svg(120, 160,
    '<path d="M60 96 C40 70 30 40 46 14 C60 40 62 70 60 96 Z" fill="#2f8f6f"/><path d="M60 96 C70 66 92 50 112 52 C102 76 84 92 60 96 Z" fill="#1f6f5c"/><path d="M60 96 C48 80 26 74 8 80 C20 96 40 102 60 96 Z" fill="#3fa37f"/><path d="M28 96 L92 96 L84 156 L36 156 Z" fill="#e4572e"/><rect x="24" y="92" width="72" height="12" rx="4" fill="#c2410c"/>')],
  ['coffee-cup', 'Coffee cup', 'cafe drink morning', svg(160, 140,
    '<path d="M60 30 C54 20 66 14 60 4 M84 30 C78 20 90 14 84 4" stroke="#a8a29e" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M24 40 L120 40 L112 118 Q110 132 96 132 L48 132 Q34 132 32 118 Z" fill="#fdf6ec" stroke="#78350f" stroke-width="5"/><path d="M118 56 Q150 56 146 82 Q142 104 114 102" fill="none" stroke="#78350f" stroke-width="8"/><rect x="30" y="56" width="84" height="14" fill="#c2410c"/>')],
  ['balloons', 'Balloons', 'party birthday celebration', svg(160, 200,
    '<path d="M50 96 Q46 140 70 196 M110 86 Q114 140 80 196 M80 70 Q80 140 76 196" stroke="#78716c" stroke-width="2" fill="none"/><ellipse cx="50" cy="60" rx="34" ry="40" fill="#e4572e"/><ellipse cx="110" cy="52" rx="34" ry="40" fill="#2554d6"/><ellipse cx="80" cy="38" rx="30" ry="36" fill="#f2c94c"/>')],
  ['mountains', 'Mountain range', 'outdoors travel adventure', svg(240, 120,
    '<path d="M0 120 L70 30 L120 90 L160 50 L240 120 Z" fill="#475569"/><path d="M70 30 L86 50 L74 46 L62 54 Z M160 50 L172 62 L162 60 L152 66 Z" fill="#ffffff"/><path d="M0 120 L50 80 L100 120 Z" fill="#334155"/>')],
  ['wave', 'Wave', 'sea water summer', svg(240, 80,
    '<path d="M0 40 C30 10 60 10 90 40 C120 70 150 70 180 40 C200 22 220 18 240 24 L240 80 L0 80 Z" fill="#2554d6"/><path d="M0 56 C30 36 60 36 90 56 C120 76 150 76 180 56 C200 44 220 40 240 44 L240 80 L0 80 Z" fill="#7da0ff"/>')],
  ['confetti', 'Confetti', 'party celebration fun', svg(200, 140,
    '<rect x="20" y="20" width="14" height="6" rx="2" fill="#e4572e" transform="rotate(30 27 23)"/><rect x="160" y="30" width="14" height="6" rx="2" fill="#2554d6" transform="rotate(-20 167 33)"/><circle cx="90" cy="24" r="5" fill="#f2c94c"/><rect x="120" y="90" width="14" height="6" rx="2" fill="#1f6f5c" transform="rotate(60 127 93)"/><circle cx="40" cy="100" r="6" fill="#db2777"/><path d="M70 70 l10 -8 l6 12 z" fill="#2554d6"/><circle cx="170" cy="110" r="5" fill="#e4572e"/><rect x="96" y="120" width="12" height="5" rx="2" fill="#f2c94c" transform="rotate(-35 102 122)"/>')],
  ['layer-cake', 'Layer cake', 'birthday bakery dessert', svg(160, 160,
    '<rect x="78" y="10" width="4" height="22" fill="#2554d6"/><path d="M80 0 C86 6 84 10 80 12 C76 10 74 6 80 0 Z" fill="#f2c94c"/><rect x="30" y="32" width="100" height="40" rx="8" fill="#fbcfe8"/><path d="M30 46 Q42 56 55 46 Q68 56 80 46 Q92 56 105 46 Q118 56 130 46 L130 40 L30 40 Z" fill="#ffffff"/><rect x="18" y="72" width="124" height="54" rx="8" fill="#e4572e"/><rect x="18" y="92" width="124" height="10" fill="#fdf6ec"/><rect x="8" y="126" width="144" height="10" rx="5" fill="#a8a29e"/>')],
  ['open-book', 'Open book', 'reading school study', svg(200, 120,
    '<path d="M100 26 C76 10 40 10 10 18 L10 110 C40 102 76 102 100 116 Z" fill="#fdf6ec" stroke="#44403c" stroke-width="4"/><path d="M100 26 C124 10 160 10 190 18 L190 110 C160 102 124 102 100 116 Z" fill="#ffffff" stroke="#44403c" stroke-width="4"/><path d="M28 40 L80 36 M28 56 L80 52 M28 72 L80 68 M120 36 L172 40 M120 52 L172 56 M120 68 L172 72" stroke="#a8a29e" stroke-width="4" stroke-linecap="round"/>')],
  ['rocket', 'Rocket', 'launch startup space', svg(140, 180,
    '<path d="M70 4 C100 30 108 80 96 124 L44 124 C32 80 40 30 70 4 Z" fill="#f5f5f4" stroke="#44403c" stroke-width="4"/><circle cx="70" cy="62" r="14" fill="#2554d6" stroke="#44403c" stroke-width="4"/><path d="M44 96 L18 128 L42 128 Z M96 96 L122 128 L98 128 Z" fill="#e4572e"/><path d="M54 128 Q70 176 86 128 Z" fill="#f2c94c"/>')],
];
const illustrationItems = ILLUSTRATIONS.map(([key, name, tags, markup]) => ({
  id: 'illustration:' + key, kind: 'illustration', category: 'Illustrations', name, tags: tags.split(' '),
  source: 'homestudio', license: 'CC0-1.0', svg: markup,
}));

// ── Backgrounds (Home Studio, CC0): colours, gradients, patterns ─────────
const tile = (size, body) => ({ size, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${body}</svg>` });
const BACKGROUNDS = [
  ['cream', 'Cream', 'Colours', { background: '#fdf6ec' }],
  ['mint', 'Mint', 'Colours', { background: '#e7f6ee' }],
  ['sky', 'Sky', 'Colours', { background: '#e0ecff' }],
  ['blush', 'Blush', 'Colours', { background: '#fde7ef' }],
  ['ink', 'Ink', 'Colours', { background: '#1c1917' }],
  ['sunset', 'Sunset', 'Gradients', { background: '#f2c94c', gradient: { kind: 'linear', angle: 160, to: '#e4572e' } }],
  ['ocean', 'Ocean', 'Gradients', { background: '#7da0ff', gradient: { kind: 'linear', angle: 180, to: '#1e3a8a' } }],
  ['meadow', 'Meadow', 'Gradients', { background: '#d9f99d', gradient: { kind: 'linear', angle: 135, to: '#1f6f5c' } }],
  ['dusk', 'Dusk', 'Gradients', { background: '#fbcfe8', gradient: { kind: 'linear', angle: 135, to: '#4c1d95' } }],
  ['glow', 'Soft glow', 'Gradients', { background: '#ffffff', gradient: { kind: 'radial', to: '#e0ecff' } }],
  ['dots', 'Polka dots', 'Patterns', { background: '#fdf6ec', pattern: tile(40, '<circle cx="20" cy="20" r="5" fill="#f2c94c"/>') }],
  ['grid', 'Grid paper', 'Patterns', { background: '#ffffff', pattern: tile(32, '<path d="M32 0 L0 0 0 32" fill="none" stroke="#dbe4f5" stroke-width="2"/>') }],
  ['stripes', 'Stripes', 'Patterns', { background: '#e7f6ee', pattern: tile(40, '<rect width="20" height="40" fill="#cdeedd"/>') }],
  ['checks', 'Gingham', 'Patterns', { background: '#ffffff', pattern: tile(48, '<rect width="24" height="24" fill="#fde7ef"/><rect x="24" y="24" width="24" height="24" fill="#fde7ef"/><rect x="24" width="24" height="24" fill="#fbcfe8" opacity=".5"/>') }],
  ['zigzag', 'Zigzag', 'Patterns', { background: '#e0ecff', pattern: tile(40, '<path d="M0 30 L10 20 L20 30 L30 20 L40 30" fill="none" stroke="#7da0ff" stroke-width="3"/>') }],
];
const backgroundItems = BACKGROUNDS.map(([key, name, group, fill]) => ({
  id: 'background:' + key, kind: 'background', category: group, name, tags: [group.toLowerCase()],
  source: 'homestudio', license: 'CC0-1.0', fill,
}));

// ── Fonts (Fontsource, OFL) ──────────────────────────────────────────────
const fontItems = Object.entries(BUNDLED_FONTS).map(([key, f]) => ({
  id: 'font:' + key, kind: 'font', category: f.category, name: f.family, tags: f.tags,
  license: f.license, attribution: f.attribution, url: f.source, fontKey: key,
}));

export const ASSETS = [...iconItems, ...shapeItems, ...illustrationItems, ...backgroundItems, ...fontItems];

// Who to credit for an item, in one line.
export function attributionOf(item) {
  if (item.attribution) return item.attribution;
  const src = SOURCES[item.source];
  return src ? src.name : '';
}

// ── Search ────────────────────────────────────────────────────────────────
// Matches every word of the query against the name, tags and category.
// `kind` narrows to one kind, `category` to one category within it, and
// `favorites` (a Set of ids) to starred items only.
export function searchLibrary(items, { query = '', kind, category, favorites } = {}) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((it) => {
    if (kind && it.kind !== kind) return false;
    if (category && it.category !== category) return false;
    if (favorites && !favorites.has(it.id)) return false;
    if (!terms.length) return true;
    const hay = [it.name, it.category, ...(it.tags || [])].join(' ').toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

export function categoriesOf(items, kind) {
  return [...new Set(items.filter((it) => it.kind === kind).map((it) => it.category))];
}
