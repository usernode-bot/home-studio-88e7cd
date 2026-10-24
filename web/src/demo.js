// Staging demo designs, built in memory and seeded into the separate
// `home-studio-demo` database the first time ?demo=1 is opened on staging.
// Every control works on them; they are kept apart from a viewer's own.

import { Sparkles } from 'lucide';
import { newDesign, newPage } from './doc/model.js';
import { iconSvg } from './assets/svg.js';
import { buildGalleryItem } from './io/gallery.js';

const HOUR = 3600 * 1000;

function seedPage1() {
  const page = newPage('Poster', 1080, 1350);
  page.background = '#fdf6ec';
  page.elements = [
    { id: 'd-sky', type: 'rect', name: 'Yellow sky', x: 0, y: 0, w: 1080, h: 420, rotation: 0, opacity: 1, fill: '#f2c94c', stroke: '', strokeWidth: 0, radius: 0, gradient: { kind: 'linear', angle: 180, to: '#fdf6ec' } },
    { id: 'd-sun', type: 'ellipse', name: 'Red sun', x: 690, y: 60, w: 270, h: 270, rotation: 0, opacity: 1, fill: '#e4572e', stroke: '', strokeWidth: 0 },
    { id: 'd-block', type: 'rect', name: 'Green block', x: 82, y: 620, w: 430, h: 230, rotation: -4, opacity: 1, fill: '#1f6f5c', stroke: '', strokeWidth: 0, radius: 24, shadow: { x: 0, y: 16, blur: 30, color: '#000000', alpha: 0.25 } },
    { id: 'd-star', type: 'shape', shape: 'star', name: 'Star', x: 560, y: 560, w: 150, h: 150, rotation: 12, opacity: 1, fill: '#e4572e', stroke: '#fdf6ec', strokeWidth: 4, strokeStyle: 'dashed' },
    { id: 'd-icon', type: 'svg', name: 'Sparkles icon', x: 820, y: 640, w: 140, h: 140, rotation: 0, opacity: 1, svg: iconSvg(Sparkles), color: '#1f6f5c' },
    { id: 'd-title', type: 'text', name: 'Garden supper', x: 82, y: 900, w: 880, h: 140, rotation: 0, opacity: 1, text: 'Garden supper', font: 'serif', size: 96, weight: 700, align: 'left', color: '#1c1917' },
    { id: 'd-date', type: 'text', name: 'Date', x: 82, y: 1120, w: 620, h: 70, rotation: 0, opacity: 1, text: 'Saturday 14 June, 6 pm\nBring a dish to share', font: 'sans', size: 44, weight: 400, align: 'left', color: '#44403c' },
    { id: 'd-leaf', type: 'ellipse', name: 'Leaf', x: 770, y: 1010, w: 200, h: 100, rotation: 18, opacity: 1, fill: '#1f6f5c', stroke: '', strokeWidth: 0 },
    { id: 'd-line', type: 'line', name: 'Divider', x: 82, y: 1240, w: 700, h: 0, rotation: 0, opacity: 1, stroke: '#78716c', strokeWidth: 3 },
  ];
  return page;
}

// ── The demo photo ───────────────────────────────────────────────────────
// A drawing, not a real photo: a mug on a table against a teal wall, drawn
// on a canvas when the demo is seeded (Home Studio's own, CC0), so Remove
// background has something to work on. It has a design of its own.
const DEMO_PHOTO_ID = 'd-photo-img';
const DEMO_PHOTO = { w: 760, h: 520 };

function mugSticker() {
  const design = newDesign('Staging demo photo', 1000, 1000);
  design.createdAt = Date.now() - 4 * HOUR;
  design.updatedAt = Date.now() - 3 * HOUR;
  const page = design.pages[0];
  page.background = '#ffffff';
  page.elements = [
    { id: 'm-photo', type: 'image', name: 'Staging demo photo', x: 120, y: 160, w: 760, h: 520, rotation: 0, opacity: 1, imageId: DEMO_PHOTO_ID, natW: DEMO_PHOTO.w, natH: DEMO_PHOTO.h },
    { id: 'm-title', type: 'text', name: 'Title', x: 120, y: 760, w: 760, h: 90, rotation: 0, opacity: 1, text: 'Mug sticker', font: 'rounded', size: 72, weight: 700, align: 'center', color: '#1c1917' },
  ];
  return design;
}

function drawDemoPhoto(ctx, w, h) {
  const wall = ctx.createLinearGradient(0, 0, w, h);
  wall.addColorStop(0, '#2f7f78');
  wall.addColorStop(1, '#4fa89a');
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#c9a27a';
  ctx.fillRect(0, h * 0.72, w, h * 0.28);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
  ctx.beginPath();
  ctx.ellipse(w * 0.5, h * 0.8, 150, 22, 0, 0, Math.PI * 2);
  ctx.fill();
  // The handle, then the body over it, then the coffee.
  ctx.strokeStyle = '#efe8da';
  ctx.lineWidth = 30;
  ctx.beginPath();
  ctx.ellipse(w * 0.5 + 125, h * 0.5, 62, 78, 0, -Math.PI / 2, Math.PI / 2);
  ctx.stroke();
  ctx.fillStyle = '#f4efe4';
  ctx.beginPath();
  ctx.roundRect(w * 0.5 - 130, h * 0.22, 260, h * 0.58, [12, 12, 48, 48]);
  ctx.fill();
  ctx.fillStyle = '#e4ddcf';
  ctx.fillRect(w * 0.5 - 130, h * 0.42, 260, 26);
  ctx.fillStyle = '#5b3a24';
  ctx.beginPath();
  ctx.ellipse(w * 0.5, h * 0.22 + 4, 118, 16, 0, 0, Math.PI * 2);
  ctx.fill();
}

// The demo's pictures as [{ id, blob }], for the images store. Browser only.
export async function buildDemoImages() {
  const c = document.createElement('canvas');
  c.width = DEMO_PHOTO.w;
  c.height = DEMO_PHOTO.h;
  drawDemoPhoto(c.getContext('2d'), c.width, c.height);
  const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'));
  return blob ? [{ id: DEMO_PHOTO_ID, blob }] : [];
}

function seedPage2() {
  const page = newPage('Menu', 1080, 1350);
  page.background = '#fafaf9';
  page.elements = [
    { id: 'd-menu-title', type: 'text', name: 'Menu', x: 82, y: 100, w: 500, h: 130, rotation: 0, opacity: 1, text: 'Menu', font: 'serif', size: 100, weight: 700, align: 'left', color: '#1c1917' },
    { id: 'd-menu-1', type: 'text', name: 'Starters', x: 82, y: 320, w: 700, h: 150, rotation: 0, opacity: 1, text: 'Roast tomato soup\nGrilled corn, lime butter', font: 'sans', size: 44, weight: 400, align: 'left', color: '#292524' },
    { id: 'd-menu-2', type: 'text', name: 'Mains', x: 82, y: 580, w: 700, h: 150, rotation: 0, opacity: 1, text: 'Aubergine bake\nSpring greens tart', font: 'sans', size: 44, weight: 400, align: 'left', color: '#292524' },
    { id: 'd-menu-3', type: 'text', name: 'Pudding', x: 82, y: 840, w: 700, h: 110, rotation: 0, opacity: 1, text: 'Plum crumble\nLemon posset', font: 'sans', size: 44, weight: 400, align: 'left', color: '#292524' },
    { id: 'd-menu-line', type: 'line', name: 'Divider', x: 82, y: 1080, w: 916, h: 0, rotation: 0, opacity: 1, stroke: '#d6d3d1', strokeWidth: 3 },
    { id: 'd-menu-note', type: 'text', name: 'Note', x: 82, y: 1150, w: 700, h: 60, rotation: 0, opacity: 1, text: 'Glasses provided, bring a plate if you can', font: 'sans', size: 32, weight: 400, align: 'left', color: '#78716c' },
  ];
  return page;
}

function seedPage3() {
  const page = newPage('Thank you', 1080, 1350);
  page.background = '#ffffff';
  page.elements = [
    { id: 'd-thanks', type: 'text', name: 'Thank you', x: 82, y: 480, w: 900, h: 140, rotation: 0, opacity: 1, text: 'Thank you', font: 'serif', size: 120, weight: 700, align: 'left', color: '#1c1917' },
    { id: 'd-thanks-body', type: 'text', name: 'Note', x: 82, y: 700, w: 760, h: 200, rotation: 0, opacity: 1, text: 'for coming, for the dishes,\nand for the garden.', font: 'sans', size: 48, weight: 400, align: 'left', color: '#44403c' },
    { id: 'd-thanks-sun', type: 'ellipse', name: 'Small sun', x: 82, y: 220, w: 140, h: 140, rotation: 0, opacity: 1, fill: '#f2c94c', stroke: '', strokeWidth: 0 },
  ];
  return page;
}

function bakeSaleFlyer() {
  const design = newDesign('Bake sale flyer', 1200, 1600);
  design.createdAt = Date.now() - 26 * HOUR;
  design.updatedAt = Date.now() - 5 * HOUR;
  const page = design.pages[0];
  page.background = '#fff7ed';
  page.elements = [
    { id: 'b-band', type: 'rect', name: 'Top band', x: 0, y: 0, w: 1200, h: 300, rotation: 0, opacity: 1, fill: '#c2410c', stroke: '', strokeWidth: 0, radius: 0 },
    { id: 'b-title', type: 'text', name: 'Title', x: 82, y: 90, w: 1000, h: 130, rotation: 0, opacity: 1, text: 'Bake sale', font: 'serif', size: 110, weight: 700, align: 'left', color: '#fff7ed' },
    { id: 'b-cake', type: 'ellipse', name: 'Cake', x: 420, y: 480, w: 360, h: 360, rotation: 0, opacity: 1, fill: '#f2c94c', stroke: '#c2410c', strokeWidth: 6 },
    { id: 'b-when', type: 'text', name: 'When', x: 82, y: 1000, w: 900, h: 120, rotation: 0, opacity: 1, text: 'Saturday 21 June, 10 am\nVillage hall forecourt', font: 'sans', size: 52, weight: 400, align: 'left', color: '#292524' },
    { id: 'b-note', type: 'text', name: 'Note', x: 82, y: 1250, w: 900, h: 60, rotation: 0, opacity: 1, text: 'All proceeds to the school garden', font: 'sans', size: 36, weight: 400, align: 'left', color: '#78716c' },
  ];
  return design;
}

function plantSwapSign() {
  const design = newDesign('Plant swap sign', 800, 800);
  design.createdAt = Date.now() - 3 * 24 * HOUR;
  design.updatedAt = Date.now() - 30 * HOUR;
  const page = design.pages[0];
  page.background = '#f0fdf4';
  page.elements = [
    { id: 'p-ring', type: 'ellipse', name: 'Ring', x: 200, y: 120, w: 400, h: 400, rotation: 0, opacity: 1, fill: '#bbf7d0', stroke: '', strokeWidth: 0 },
    { id: 'p-title', type: 'text', name: 'Title', x: 82, y: 560, w: 640, h: 100, rotation: 0, opacity: 1, text: 'Plant swap', font: 'rounded', size: 90, weight: 700, align: 'center', color: '#14532d' },
    { id: 'p-when', type: 'text', name: 'When', x: 82, y: 680, w: 640, h: 60, rotation: 0, opacity: 1, text: 'Sunday 30 June, 11 am, the allotment', font: 'sans', size: 34, weight: 400, align: 'center', color: '#166534' },
  ];
  return design;
}

export function buildDemoDesigns() {
  const poster = newDesign('Garden supper poster', 1080, 1350);
  poster.createdAt = Date.now() - 2 * HOUR;
  poster.updatedAt = Date.now() - HOUR;
  poster.pages = [seedPage1(), seedPage2(), seedPage3()];
  return [poster, bakeSaleFlyer(), mugSticker(), plantSwapSign()];
}

// ── The demo gallery source ──────────────────────────────────────────────
// Six items by "Demo Person", built in memory as real gallery envelopes
// (the same bytes a node would serve), so the gallery screen can be seen
// without any server and any item can be opened and remixed. Available
// only when the app is opened with ?demo=1 (the caller gates that, the
// same way the seeded designs are gated).

function coffeeMorningPost() {
  const design = newDesign('Coffee morning post', 1080, 1080);
  const page = design.pages[0];
  page.background = '#fef3c7';
  page.elements = [
    { id: 'c-cup', type: 'shape', shape: 'heart', name: 'Cup heart', x: 340, y: 180, w: 400, h: 400, rotation: 0, opacity: 1, fill: '#92400e', stroke: '', strokeWidth: 0 },
    { id: 'c-title', type: 'text', name: 'Title', x: 90, y: 660, w: 900, h: 120, rotation: 0, opacity: 1, text: 'Coffee morning', font: 'rounded', size: 96, weight: 700, align: 'center', color: '#78350f' },
    { id: 'c-when', type: 'text', name: 'When', x: 90, y: 820, w: 900, h: 60, rotation: 0, opacity: 1, text: 'Every Friday, 10 am, the library', font: 'sans', size: 40, weight: 400, align: 'center', color: '#92400e' },
  ];
  return design;
}

function readingClubBookmark() {
  const design = newDesign('Reading club bookmark', 500, 1500);
  const page = design.pages[0];
  page.background = '#eef2ff';
  page.elements = [
    { id: 'r-band', type: 'rect', name: 'Band', x: 0, y: 0, w: 500, h: 300, rotation: 0, opacity: 1, fill: '#4338ca', stroke: '', strokeWidth: 0 },
    { id: 'r-title', type: 'text', name: 'Title', x: 40, y: 80, w: 420, h: 140, rotation: 0, opacity: 1, text: 'Read five,\nget a badge', font: 'serif', size: 64, weight: 700, align: 'left', color: '#eef2ff' },
    { id: 'r-body', type: 'text', name: 'Note', x: 40, y: 420, w: 420, h: 400, rotation: 0, opacity: 1, text: 'Keep this bookmark\nin your book, and\nshow it at the desk.', font: 'sans', size: 36, weight: 400, align: 'left', color: '#312e81' },
    { id: 'r-star', type: 'shape', shape: 'star', name: 'Star', x: 150, y: 1100, w: 200, h: 200, rotation: 10, opacity: 1, fill: '#fbbf24', stroke: '#4338ca', strokeWidth: 4 },
  ];
  return design;
}

function jumbleSaleBanner() {
  const design = newDesign('Jumble sale banner', 1600, 600);
  const page = design.pages[0];
  page.background = '#ecfeff';
  page.elements = [
    { id: 'j-title', type: 'text', name: 'Title', x: 60, y: 160, w: 1100, h: 160, rotation: 0, opacity: 1, text: 'Jumble sale', font: 'serif', size: 140, weight: 700, align: 'left', color: '#155e75' },
    { id: 'j-when', type: 'text', name: 'When', x: 60, y: 380, w: 1100, h: 80, rotation: 0, opacity: 1, text: 'Saturday 12 July, 9 am to noon, the school yard', font: 'sans', size: 52, weight: 400, align: 'left', color: '#0e7490' },
    { id: 'j-dot', type: 'ellipse', name: 'Dot', x: 1300, y: 150, w: 220, h: 220, rotation: 0, opacity: 1, fill: '#06b6d4', stroke: '', strokeWidth: 0 },
    { id: 'j-dot2', type: 'ellipse', name: 'Small dot', x: 1440, y: 330, w: 110, h: 110, rotation: 0, opacity: 1, fill: '#67e8f9', stroke: '', strokeWidth: 0 },
  ];
  return design;
}

export function buildDemoGallerySource() {
  const defs = [
    { id: 'g-demo-1', design: null, title: 'Garden supper poster', licence: 'CC0-1.0', tags: ['poster', 'event', 'garden'], description: 'A three-page invitation for a shared supper: poster, menu and thank-you.' },
    { id: 'g-demo-2', design: bakeSaleFlyer(), title: 'Bake sale flyer', licence: 'CC-BY-4.0', tags: ['flyer', 'event', 'food'], description: 'A one-page flyer for a school bake sale.' },
    { id: 'g-demo-3', design: plantSwapSign(), title: 'Plant swap sign', licence: 'CC0-1.0', tags: ['sign', 'garden', 'simple'], description: 'A square sign for an allotment plant swap.' },
    { id: 'g-demo-4', design: coffeeMorningPost(), title: 'Coffee morning post', licence: 'CC-BY-SA-4.0', tags: ['social', 'event', 'simple'], description: 'A square post announcing a weekly coffee morning.' },
    { id: 'g-demo-5', design: readingClubBookmark(), title: 'Reading club bookmark', licence: 'CC0-1.0', tags: ['print', 'kids', 'reading'], description: 'A tall bookmark for a reading club challenge.' },
    { id: 'g-demo-6', design: jumbleSaleBanner(), title: 'Jumble sale banner', licence: 'CC-BY-4.0', tags: ['banner', 'event'], description: 'A wide banner to print or post for a jumble sale.' },
  ];
  const sourceDesigns = buildDemoDesigns();
  const byName = new Map(sourceDesigns.map((d) => [d.name, d]));
  defs[0].design = byName.get('Garden supper poster');

  const items = [];
  const bytesById = new Map();
  const now = Date.now();
  defs.forEach((def, i) => {
    if (!def.design) return;
    const meta = {
      id: def.id,
      title: def.title,
      author: 'Demo Person',
      licence: def.licence,
      tags: def.tags,
      description: def.description,
      createdAt: now - (defs.length - i) * HOUR,
    };
    const bytes = buildGalleryItem({ design: def.design, images: [], fonts: [], item: meta });
    bytesById.set(def.id, bytes);
    const page = def.design.pages[0];
    items.push({
      id: def.id,
      title: def.title,
      author: 'Demo Person',
      licence: def.licence,
      tags: def.tags,
      width: page.width,
      height: page.height,
      bytes: bytes.length,
      updatedAt: meta.createdAt,
    });
  });
  return {
    id: 'demo',
    kind: 'demo',
    name: 'Demo gallery',
    items,               // the listing rows
    itemBytes: (id) => bytesById.get(id) || null,
  };
}
