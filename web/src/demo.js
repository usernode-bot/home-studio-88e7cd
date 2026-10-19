// Staging demo designs, built in memory and seeded into the separate
// `home-studio-demo` database the first time ?demo=1 is opened on staging.
// Every control works on them; they are kept apart from a viewer's own.

import { newDesign, newPage } from './doc/model.js';

const HOUR = 3600 * 1000;

function seedPage1() {
  const page = newPage('Poster', 1080, 1350);
  page.background = '#fdf6ec';
  page.elements = [
    { id: 'd-sky', type: 'rect', name: 'Yellow sky', x: 0, y: 0, w: 1080, h: 420, rotation: 0, opacity: 1, fill: '#f2c94c', stroke: '', strokeWidth: 0, radius: 0 },
    { id: 'd-sun', type: 'ellipse', name: 'Red sun', x: 690, y: 60, w: 270, h: 270, rotation: 0, opacity: 1, fill: '#e4572e', stroke: '', strokeWidth: 0 },
    { id: 'd-block', type: 'rect', name: 'Green block', x: 82, y: 620, w: 430, h: 230, rotation: -4, opacity: 1, fill: '#1f6f5c', stroke: '', strokeWidth: 0, radius: 0 },
    { id: 'd-title', type: 'text', name: 'Garden supper', x: 82, y: 900, w: 880, h: 140, rotation: 0, opacity: 1, text: 'Garden supper', font: 'serif', size: 96, weight: 700, align: 'left', color: '#1c1917' },
    { id: 'd-date', type: 'text', name: 'Date', x: 82, y: 1120, w: 620, h: 70, rotation: 0, opacity: 1, text: 'Saturday 14 June, 6 pm\nBring a dish to share', font: 'sans', size: 44, weight: 400, align: 'left', color: '#44403c' },
    { id: 'd-leaf', type: 'ellipse', name: 'Leaf', x: 770, y: 1010, w: 200, h: 100, rotation: 18, opacity: 1, fill: '#1f6f5c', stroke: '', strokeWidth: 0 },
    { id: 'd-line', type: 'line', name: 'Divider', x: 82, y: 1240, w: 700, h: 0, rotation: 0, opacity: 1, stroke: '#78716c', strokeWidth: 3 },
  ];
  return page;
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
  return [poster, bakeSaleFlyer(), plantSwapSign()];
}
