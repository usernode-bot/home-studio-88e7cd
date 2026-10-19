// Templates: starting designs in every category, drawn for this app and
// dedicated to the public domain (CC0). Using one copies it into a normal
// design with fresh ids, which the person then edits like any other.

import { uid, newDesign, reidElement } from '../doc/model.js';
import { ASSETS } from './catalog.js';

export const TEMPLATE_CATEGORIES = [
  'Social media', 'Posters', 'Flyers', 'Presentations', 'Thumbnails', 'Invitations', 'Logos', 'Documents',
];

// ── Element builders (ids are replaced when a template is used) ──────────
const base = (type, name, x, y, w, h, extra) => ({ id: uid(), type, name, x, y, w, h, rotation: 0, opacity: 1, ...extra });
const lines = (text) => text.split('\n').length;
const T = (name, text, x, y, w, size, o = {}) =>
  base('text', name, x, y, w, Math.round(size * (o.lineHeight || 1.25) * lines(text)) + 8, {
    text, font: 'sans', size, weight: 400, align: 'left', color: '#1c1917', lineHeight: 1.25, letterSpacing: 0, ...o,
  });
const R = (name, x, y, w, h, fill, o = {}) => base('rect', name, x, y, w, h, { fill, stroke: '', strokeWidth: 0, radius: 0, ...o });
const E = (name, x, y, w, h, fill, o = {}) => base('ellipse', name, x, y, w, h, { fill, stroke: '', strokeWidth: 0, ...o });
const S = (shape, name, x, y, w, h, fill, o = {}) => base('shape', name, x, y, w, h, { shape, fill, stroke: '', strokeWidth: 0, ...o });
const L = (name, x, y, w, stroke, strokeWidth = 3, o = {}) => base('line', name, x, y, w, 0, { stroke, strokeWidth, ...o });
const asset = (id) => ASSETS.find((a) => a.id === id);
const G = (assetId, name, x, y, w, h, color) => base('svg', name, x, y, w, h, { svg: asset(assetId).svg, color: color || '' });
const page = (name, background, elements, extra = {}) => ({ name, background, elements, ...extra });
const sunset = { kind: 'linear', angle: 160, to: '#e4572e' };

export const TEMPLATES = [
  {
    id: 'tpl:quote-post', name: 'Quote post', category: 'Social media', tags: ['instagram', 'square', 'quote'], width: 1080, height: 1080,
    pages: () => [page('Quote', '#f2c94c', [
      G('icon:Quote', 'Quote mark', 470, 150, 140, 140, '#fdf6ec'),
      T('Quote', 'Make something small\nevery single day.', 110, 360, 860, 76, { font: 'playfair', italic: true, align: 'center', color: '#ffffff', lineHeight: 1.2 }),
      L('Rule', 440, 640, 200, '#fdf6ec', 4),
      T('Author', 'Home Studio', 110, 690, 860, 34, { font: 'inter', align: 'center', color: '#fdf6ec', letterSpacing: 4, textCase: 'upper', weight: 700 }),
    ], { gradient: sunset })],
  },
  {
    id: 'tpl:story-sale', name: 'Story announcement', category: 'Social media', tags: ['instagram', 'story', 'vertical', 'sale'], width: 1080, height: 1920,
    pages: () => [page('Story', '#7da0ff', [
      T('Label', 'New in store', 100, 260, 880, 40, { font: 'inter', weight: 700, letterSpacing: 6, textCase: 'upper', color: '#e0ecff', align: 'center' }),
      T('Headline', 'Summer\ncollection', 100, 360, 880, 220, { font: 'bebas', color: '#ffffff', align: 'center', lineHeight: 0.95, shadow: { x: 0, y: 8, blur: 24, color: '#000000', alpha: 0.25 } }),
      S('badge', 'Badge', 370, 900, 340, 340, '#f2c94c'),
      T('Offer', '20%\noff', 370, 965, 340, 96, { font: 'montserrat', weight: 900, align: 'center', color: '#1c1917', lineHeight: 1 }),
      T('Note', 'This week only, in all our shops', 100, 1440, 880, 40, { font: 'inter', align: 'center', color: '#ffffff' }),
    ], { gradient: { kind: 'linear', angle: 180, to: '#1e3a8a' } })],
  },
  {
    id: 'tpl:market-square', name: 'Market day post', category: 'Social media', tags: ['square', 'event', 'market'], width: 1080, height: 1080,
    pages: () => [page('Post', '#fdf6ec', [
      S('blob', 'Blob', 140, 160, 800, 760, '#1f6f5c'),
      T('Title', 'Market\nday', 200, 330, 680, 140, { font: 'lobster', align: 'center', color: '#fdf6ec', lineHeight: 1 }),
      T('When', 'Every Saturday, 9 am to 1 pm', 200, 680, 680, 38, { font: 'inter', align: 'center', color: '#fdf6ec' }),
    ], { pattern: asset('background:dots').fill.pattern })],
  },
  {
    id: 'tpl:concert-poster', name: 'Concert poster', category: 'Posters', tags: ['music', 'gig', 'night', 'neon'], width: 1080, height: 1528,
    pages: () => [page('Poster', '#1c1917', [
      G('illustration:wave', 'Wave', 0, 1160, 1080, 368),
      T('Kicker', 'Live at the community hall', 90, 150, 900, 38, { font: 'spacemono', color: '#7da0ff', letterSpacing: 2 }),
      T('Band', 'Night\nOwls', 90, 240, 900, 230, { font: 'bebas', color: '#f472b6', lineHeight: 0.92, shadow: { x: 0, y: 0, blur: 30, color: '#f472b6', alpha: 0.9, glow: true } }),
      T('Date', 'Friday 12 September\nDoors 7 pm', 90, 820, 900, 56, { font: 'inter', weight: 700, color: '#fdf6ec', lineHeight: 1.3 }),
      T('Tickets', 'Tickets at the door', 90, 1000, 900, 36, { font: 'inter', color: '#a8a29e' }),
    ])],
  },
  {
    id: 'tpl:exhibition-poster', name: 'Exhibition poster', category: 'Posters', tags: ['art', 'gallery', 'minimal'], width: 1080, height: 1350,
    pages: () => [page('Poster', '#fdf6ec', [
      E('Big circle', 480, 120, 520, 520, '#e4572e'),
      E('Small circle', 330, 470, 260, 260, '#2554d6', { opacity: 0.85 }),
      T('Title', 'Shapes\n& Colour', 82, 820, 900, 120, { font: 'playfair', weight: 700, lineHeight: 1.05 }),
      T('Details', 'A small show of new work\n3 to 24 May, The Old Library', 82, 1130, 900, 36, { font: 'inter', color: '#57534e', lineHeight: 1.4 }),
    ])],
  },
  {
    id: 'tpl:bake-sale', name: 'Bake sale flyer', category: 'Flyers', tags: ['bake', 'school', 'charity', 'a5'], width: 1240, height: 1754,
    pages: () => [page('Flyer', '#fde7ef', [
      T('Title', 'Bake sale', 100, 140, 1040, 170, { font: 'pacifico', align: 'center', color: '#c2410c' }),
      G('illustration:layer-cake', 'Cake', 400, 460, 440, 440),
      T('When', 'Saturday 21 June, 10 am', 100, 1000, 1040, 64, { font: 'montserrat', weight: 700, align: 'center', highlight: '#fde047' }),
      T('Where', 'Village hall forecourt', 100, 1110, 1040, 48, { font: 'montserrat', align: 'center', color: '#44403c' }),
      T('Note', 'All proceeds go to the school garden', 100, 1500, 1040, 36, { font: 'inter', align: 'center', color: '#57534e' }),
    ], { pattern: asset('background:checks').fill.pattern })],
  },
  {
    id: 'tpl:yoga-flyer', name: 'Class flyer', category: 'Flyers', tags: ['yoga', 'fitness', 'class', 'wellbeing'], width: 1240, height: 1754,
    pages: () => [page('Flyer', '#e7f6ee', [
      R('Panel', 0, 1180, 1240, 574, '#1f6f5c'),
      G('icon:Leaf', 'Leaf', 520, 180, 200, 200, '#1f6f5c'),
      T('Title', 'Morning\nyoga', 100, 440, 1040, 150, { font: 'montserrat', weight: 900, align: 'center', color: '#14532d', lineHeight: 1 }),
      T('Body', 'Gentle stretches for all levels.\nBring a mat and some water.', 100, 870, 1040, 40, { font: 'inter', align: 'center', color: '#166534', lineHeight: 1.45 }),
      T('When', 'Tuesdays and Thursdays, 7 am', 100, 1300, 1040, 56, { font: 'montserrat', weight: 700, align: 'center', color: '#ffffff' }),
      T('Where', 'The park pavilion', 100, 1400, 1040, 40, { font: 'inter', align: 'center', color: '#d1fae5' }),
    ])],
  },
  {
    id: 'tpl:pitch-deck', name: 'Simple slides', category: 'Presentations', tags: ['slides', 'deck', 'widescreen', '16:9'], width: 1920, height: 1080,
    pages: () => [
      page('Title', '#ffffff', [
        R('Band', 0, 0, 640, 1080, '#2554d6'),
        G('icon:Lightbulb', 'Idea', 220, 400, 200, 200, '#ffffff'),
        T('Title', 'A bright idea', 760, 380, 1060, 120, { font: 'montserrat', weight: 900 }),
        T('Subtitle', 'Your name, the date', 760, 560, 1060, 44, { font: 'inter', color: '#57534e' }),
      ]),
      page('Points', '#ffffff', [
        T('Heading', 'Three things to know', 140, 120, 1640, 80, { font: 'montserrat', weight: 700 }),
        E('Dot 1', 140, 340, 48, 48, '#2554d6'), T('Point 1', 'Start with the problem', 230, 336, 1500, 48, { font: 'inter' }),
        E('Dot 2', 140, 500, 48, 48, '#2554d6'), T('Point 2', 'Show what changes', 230, 496, 1500, 48, { font: 'inter' }),
        E('Dot 3', 140, 660, 48, 48, '#2554d6'), T('Point 3', 'Say what happens next', 230, 656, 1500, 48, { font: 'inter' }),
      ]),
      page('Thanks', '#2554d6', [
        T('Thanks', 'Thank you', 140, 420, 1640, 140, { font: 'montserrat', weight: 900, color: '#ffffff', align: 'center' }),
        T('Contact', 'Questions welcome', 140, 620, 1640, 48, { font: 'inter', color: '#e0ecff', align: 'center' }),
      ]),
    ],
  },
  {
    id: 'tpl:video-thumbnail', name: 'Video thumbnail', category: 'Thumbnails', tags: ['youtube', 'video', '16:9', 'bold'], width: 1280, height: 720,
    pages: () => [page('Thumbnail', '#f2c94c', [
      E('Play button', 870, 190, 300, 300, '#ffffff', { shadow: { x: 0, y: 12, blur: 30, color: '#000000', alpha: 0.3 } }),
      G('icon:Play', 'Play', 950, 270, 150, 150, '#e4572e'),
      T('Headline', '5 easy\nfixes', 70, 120, 760, 210, { font: 'bebas', color: '#ffffff', lineHeight: 0.9, outline: { color: '#1c1917', width: 8 } }),
      T('Tag', 'In 10 minutes', 70, 580, 600, 48, { font: 'montserrat', weight: 900, color: '#1c1917', highlight: '#ffffff' }),
    ], { gradient: sunset })],
  },
  {
    id: 'tpl:garden-party', name: 'Garden party invitation', category: 'Invitations', tags: ['party', 'garden', 'summer', '5x7'], width: 1050, height: 1500,
    pages: () => [page('Invitation', '#fdf6ec', [
      G('illustration:potted-plant', 'Plant', 405, 150, 240, 320),
      T('Kicker', 'You are invited to a', 75, 540, 900, 40, { font: 'inter', align: 'center', color: '#57534e', letterSpacing: 2 }),
      T('Title', 'Garden party', 75, 610, 900, 120, { font: 'playfair', italic: true, align: 'center', color: '#1f6f5c' }),
      L('Rule', 375, 820, 300, '#1f6f5c', 3, { strokeStyle: 'dotted' }),
      T('When', 'Sunday 6 July, from 3 pm\n12 Elm Road', 75, 880, 900, 48, { font: 'inter', align: 'center', lineHeight: 1.4 }),
      T('RSVP', 'Let us know by 1 July', 75, 1260, 900, 34, { font: 'inter', align: 'center', color: '#57534e' }),
    ])],
  },
  {
    id: 'tpl:birthday', name: 'Birthday invitation', category: 'Invitations', tags: ['birthday', 'party', 'kids', 'celebration'], width: 1050, height: 1500,
    pages: () => [page('Invitation', '#e0ecff', [
      G('illustration:confetti', 'Confetti', 0, 0, 1050, 735),
      G('illustration:balloons', 'Balloons', 365, 120, 320, 400),
      T('Title', "It's a party!", 75, 600, 900, 130, { font: 'lobster', align: 'center', color: '#2554d6' }),
      T('Who', 'Sam is turning 7', 75, 790, 900, 56, { font: 'montserrat', weight: 700, align: 'center' }),
      T('When', 'Saturday 9 August, 2 pm to 5 pm\nThe community hall', 75, 900, 900, 42, { font: 'inter', align: 'center', lineHeight: 1.4 }),
    ])],
  },
  {
    id: 'tpl:bakery-logo', name: 'Bakery logo', category: 'Logos', tags: ['badge', 'food', 'round', 'brand'], width: 800, height: 800,
    pages: () => [page('Logo', '#ffffff', [
      E('Badge', 100, 100, 600, 600, '#c2410c'),
      E('Ring', 130, 130, 540, 540, '#c2410c', { stroke: '#fdf6ec', strokeWidth: 6, strokeStyle: 'dashed' }),
      G('icon:Cake', 'Cake', 330, 190, 140, 140, '#fdf6ec'),
      T('Name', 'Crumbs', 140, 340, 520, 120, { font: 'lobster', align: 'center', color: '#fdf6ec' }),
      T('Tagline', 'Bakery since 2026', 140, 500, 520, 32, { font: 'montserrat', weight: 700, align: 'center', color: '#fde7ef', letterSpacing: 3, textCase: 'upper' }),
    ])],
  },
  {
    id: 'tpl:wordmark', name: 'Studio wordmark', category: 'Logos', tags: ['wordmark', 'minimal', 'brand', 'wide'], width: 1000, height: 500,
    pages: () => [page('Logo', '#ffffff', [
      S('diamond', 'Mark', 110, 180, 140, 140, '#2554d6', { gradient: { kind: 'linear', angle: 135, to: '#db2777' } }),
      T('Name', 'NORTHLIGHT', 290, 190, 640, 92, { font: 'montserrat', weight: 900, letterSpacing: 6 }),
      T('Line', 'design studio', 294, 300, 640, 32, { font: 'inter', color: '#57534e', letterSpacing: 4 }),
    ])],
  },
  {
    id: 'tpl:letterhead', name: 'Letterhead', category: 'Documents', tags: ['a4', 'letter', 'business', 'print'], width: 794, height: 1123,
    pages: () => [page('Letter', '#ffffff', [
      R('Band', 0, 0, 794, 16, '#2554d6'),
      T('Name', 'Northlight Studio', 64, 64, 500, 34, { font: 'merriweather', weight: 700 }),
      T('Address', '1 Market Street, Townsville\nhello@example.com', 64, 112, 500, 15, { font: 'inter', color: '#57534e', lineHeight: 1.5 }),
      T('Date', '19 October 2026', 64, 220, 666, 16, { font: 'inter' }),
      T('Body', 'Dear reader,\n\nThis is where your letter goes. Double-tap to edit the text, and keep the heading and footer as they are.\n\nWith best wishes,', 64, 270, 666, 16, { font: 'merriweather', lineHeight: 1.6 }),
      L('Footer rule', 64, 1050, 666, '#dedcd9', 1),
      T('Footer', 'northlight.example', 64, 1064, 666, 12, { font: 'inter', color: '#57534e', align: 'center' }),
    ])],
  },
  {
    id: 'tpl:meeting-notes', name: 'Meeting notes', category: 'Documents', tags: ['a4', 'notes', 'agenda', 'checklist'], width: 794, height: 1123,
    pages: () => [page('Notes', '#ffffff', [
      T('Title', 'Meeting notes', 64, 64, 666, 40, { font: 'merriweather', weight: 700 }),
      T('Meta', 'Date, time and who came', 64, 124, 666, 16, { font: 'inter', color: '#57534e' }),
      T('Agenda label', 'Agenda', 64, 200, 666, 20, { font: 'inter', weight: 700, highlight: '#e0ecff' }),
      T('Agenda', '1. Welcome\n2. Updates\n3. Next steps', 64, 240, 666, 16, { font: 'inter', lineHeight: 1.7 }),
      T('Actions label', 'Actions', 64, 420, 666, 20, { font: 'inter', weight: 700, highlight: '#e7f6ee' }),
      G('icon:Check', 'Tick 1', 64, 462, 22, 22, '#1f6f5c'), T('Action 1', 'Send the summary', 100, 460, 600, 16, { font: 'inter' }),
      G('icon:Check', 'Tick 2', 64, 502, 22, 22, '#1f6f5c'), T('Action 2', 'Book the next meeting', 100, 500, 600, 16, { font: 'inter' }),
    ], { pattern: asset('background:grid').fill.pattern })],
  },
].map((t) => ({ ...t, kind: 'template', source: 'homestudio', license: 'CC0-1.0' }));

// A template as a new design of the person's own: fresh ids throughout.
export function instantiateTemplate(tpl) {
  const design = newDesign(tpl.name, tpl.width, tpl.height);
  design.pages = tpl.pages().map((p) => ({
    id: uid(), width: tpl.width, height: tpl.height, guides: [], ...p,
    elements: p.elements.map((el) => reidElement(structuredClone(el))),
  }));
  return design;
}
