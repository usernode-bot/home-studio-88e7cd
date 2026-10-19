// The export pipeline: the SVG serialiser, the wrap rule it shares with the
// editor, scale limits, file naming, and the byte-level verify checks.

import { describe, it, expect } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';
import { pageToSvg } from '../web/src/export/svgPage.js';
import { wrapLines } from '../web/src/export/textLayout.js';
import { fitScale } from '../web/src/export/raster.js';
import { pngSize, jpegSize } from '../web/src/export/verify.js';
import { safeName } from '../web/src/export/index.js';
import { newDesign, newPage, newElement, walk } from '../web/src/doc/model.js';
import { instantiateTemplate, TEMPLATES } from '../web/src/assets/templates.js';
import { buildDemoDesigns } from '../web/src/demo.js';

// A stub measure: 6 px per character, so wrapping is deterministic.
const measure = (el, s) => s.length * 6;

const parse = (svg) => new DOMParser().parseFromString(svg, 'image/svg+xml');

describe('pageToSvg', () => {
  it('draws every element of every template and demo design, with the right size', () => {
    const designs = [...TEMPLATES.map(instantiateTemplate), ...buildDemoDesigns()];
    for (const design of designs) {
      for (const page of design.pages) {
        const images = {};
        for (const el of walk(page.elements)) if (el.imageId) images[el.imageId] = 'data:image/png;base64,AAAA';
        const svg = pageToSvg(page, { scale: 2, measure, images });
        const doc = parse(svg);
        expect(doc.documentElement.tagName, design.name).toBe('svg');
        expect(doc.documentElement.getAttribute('width')).toBe(String(page.width * 2));
        expect(doc.documentElement.getAttribute('height')).toBe(String(page.height * 2));
        expect(doc.documentElement.getAttribute('viewBox')).toBe(`0 0 ${page.width} ${page.height}`);
        // One drawn node per element that isn't an empty image reference, plus the
// page's own background rect.
        const drawn = page.elements.filter((el) => el.type !== 'image' || el.imageId).length;
        const count = [...doc.documentElement.childNodes].filter(
          (nd) => nd.nodeType === 1 && !['defs', 'style'].includes(nd.tagName),
        ).length;
        expect(count, design.name).toBe(drawn + 1);
        expect(svg).not.toMatch(/<script/i);
        expect(svg).not.toMatch(/href="https?:/i);
      }
    }
  });

  it('draws each element kind with the shapes the model asks for', () => {
    const page = newPage('P', 400, 300);
    page.background = '#ffffff';
    page.elements = [
      newElement('rect', { x: 10, y: 10, w: 100, h: 50, fill: '#ff0000', radius: 8 }),
      newElement('ellipse', { x: 130, y: 10, w: 60, h: 40, fill: '#00ff00' }),
      newElement('line', { x: 0, y: 0, w: 200, h: 0, stroke: '#000000', strokeWidth: 3 }),
      { ...newElement('rect', { x: 0, y: 0, w: 50, h: 50 }), type: 'shape', shape: 'star' },
      { ...newElement('text', { x: 20, y: 100, w: 300, h: 40, size: 32 }), text: 'Hello world', color: '#111111' },
      { ...newElement('rect', { x: 0, y: 0, w: 10, h: 10, fill: '#123456' }), type: 'svg', svg: '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>' },
      { ...newElement('group', { x: 5, y: 5, w: 100, h: 100 }), children: [newElement('rect', { x: 0, y: 0, w: 40, h: 40 })] },
      { ...newElement('rect', { x: 0, y: 0, w: 20, h: 20 }), shadow: { x: 2, y: 3, blur: 6, color: '#000000', alpha: 0.4 } },
    ];
    const svg = pageToSvg(page, { measure });
    const doc = parse(svg);
    const html = svg;
    expect(doc.getElementsByTagName('ellipse').length).toBeGreaterThanOrEqual(1);
    expect(doc.getElementsByTagName('line').length).toBe(1);
    expect(html).toContain('viewBox="0 0 100 100"'); // the star shape
    expect(html).toContain('Hello world');
    expect(html).toContain('data:image/svg+xml'); // the svg graphic element
    expect(html).toContain('<feDropShadow');
    expect(doc.getElementsByTagName('clipPath').length).toBe(0); // no mask, no crop
  });

  it('carries gradients, text wrapping and opacity through', () => {
    const page = newPage('P', 400, 300);
    page.background = '#f2c94c';
    page.gradient = { kind: 'linear', angle: 180, to: '#e4572e' };
    const text = newElement('text', { x: 0, y: 0, w: 60, size: 20 });
    text.text = 'wrap this text';
    text.opacity = 0.5;
    page.elements = [text];
    const svg = pageToSvg(page, { measure });
    expect(svg).toContain('linearGradient');
    expect(svg).toContain('opacity="0.5"');
    // 14 chars at 6 px = 84 > 60 wide, so the words wrap onto several lines.
    expect(svg.split('<text').length - 1).toBeGreaterThan(1);
  });

  it('leaves the background out when transparent is asked', () => {
    const page = newPage('P', 100, 100);
    page.background = '#ffffff';
    page.elements = [newElement('rect', { x: 0, y: 0, w: 10, h: 10 })];
    const svg = pageToSvg(page, { measure, transparent: true });
    expect(svg).not.toContain('#ffffff');
    expect(pageToSvg(page, { measure })).toContain('#ffffff');
  });
});

describe('wrapLines and the editor agree', () => {
  it('wraps like measureTextHeight counts', () => {
    const el = { text: 'wrap this text now', w: 60, size: 20, lineHeight: 1.25, letterSpacing: 0 };
    const lines = wrapLines(el, measure).flat();
    expect(lines.length).toBe(2); // 'wrap this' fits 60 px at 6 px a char; the rest wraps
    expect(lines[0]).toBe('wrap this');
  });
});

describe('fitScale', () => {
  it('keeps the output inside what browsers can draw', () => {
    expect(fitScale(1080, 1350, 1)).toBe(1);
    expect(fitScale(1080, 1350, 2)).toBe(2);
    expect(fitScale(10000, 10000, 4)).toBeLessThan(1.3); // area ceiling
    expect(fitScale(10000, 10000, 4) * 10000).toBeLessThanOrEqual(16777216 + 20000);
    expect(fitScale(10000, 100, 4)).toBeLessThanOrEqual(16384 / 10000);
  });
});

describe('safeName', () => {
  it('strips unsafe characters and numbers duplicates', () => {
    const taken = new Set();
    expect(safeName('Poster: "final" v1?', taken)).toBe('Poster final v1');
    expect(safeName('Poster', taken)).toBe('Poster');
    expect(safeName('Poster', taken)).toBe('Poster 2');
    expect(safeName('poster', taken)).toBe('poster 3');
    expect(safeName('', taken)).toBe('page');
  });
});

describe('byte-level verify', () => {
  const png = (w, h) => {
    const bytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52];
    for (const v of [w, h]) { bytes.push((v >> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255); }
    return new Uint8Array([...bytes, 8, 6, 0, 0, 0]);
  };
  const jpeg = (w, h) => new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, (h >> 8) & 255, h & 255, (w >> 8) & 255, w & 255, 3, 0, 0, 0, 0, 0, 0, 0]);

  it('reads PNG and JPEG sizes and rejects broken files', () => {
    expect(pngSize(png(2160, 2700))).toEqual({ w: 2160, h: 2700 });
    expect(jpegSize(jpeg(200, 300))).toEqual({ w: 200, h: 300 });
    expect(() => pngSize(new Uint8Array([1, 2, 3]))).toThrow(/incomplete/);
    expect(() => pngSize(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1]))).toThrow(/isn't a PNG/);
    expect(() => jpegSize(new Uint8Array([0, 1, 2]))).toThrow(/isn't a JPEG/);
    expect(() => jpegSize(new Uint8Array([0xff, 0xd8, 0x00, 0x01]))).toThrow(/incomplete/);
    expect(() => pngSize(png(9999, 9999).slice(0, 20))).toThrow(/missing its header|incomplete/);
  });
});