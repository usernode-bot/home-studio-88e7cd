// Exports, reopened: every file the exporters write is read back with an
// independent reader (an XML parser for SVG, pdf.js for PDF, zlib's own
// CRC and inflate for PNG and ZIP) and checked against the design.

import { describe, it, expect } from 'vitest';
import zlib from 'node:zlib';
import { DOMParser } from '@xmldom/xmldom';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { pageToSvg, layoutText, linearGradientPoints, maskGeometry, scalePath, adjustPrimitives } from '../web/src/export/svg.js';
import { buildPdf, jpegInfo, pageBoxes, pdfText, PT_PER_PX, MM_TO_PT } from '../web/src/export/pdf.js';
import { pngInfo, pngChunks, setPngDpi, setJpegDpi, jpegDpi } from '../web/src/export/imagemeta.js';
import { capScale, exportSettings, pageFileName, MAX_AREA, MAX_SIDE } from '../web/src/export/options.js';
import { zipFiles } from '../web/src/io/zip.js';
import { bytesToBase64, base64ToBytes, crc32, utf8, fromUtf8 } from '../web/src/io/binary.js';
import { serializeProject, parseHomeStudioFile } from '../web/src/io/project.js';
import { buildDemoDesigns } from '../web/src/demo.js';
import { newDesign, newElement } from '../web/src/doc/model.js';

// Fixed-width text measuring: half the font size per character.
const measure = (el) => ({ width: (s) => [...s].length * el.size * 0.5, ascent: el.size * 0.8, descent: el.size * 0.2 });
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

function parseXml(text) {
  const errors = [];
  const doc = new DOMParser({ onError: (level, msg) => { if (level !== 'warning') errors.push(msg); } }).parseFromString(text, 'image/svg+xml');
  expect(errors).toEqual([]);
  return doc;
}
const all = (doc, tag) => [...Array.from(doc.getElementsByTagName(tag))];

// A small but real PNG: 3 × 2 RGBA, built with zlib.
function makePng(w = 3, h = 2) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h, 0x7f);
  for (let y = 0; y < h; y++) raw[y * (w * 4 + 1)] = 0;
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

// A JPEG's headers (start, JFIF, a baseline frame of w × h, end): all a PDF
// needs to place it.
function makeJpeg(w, h, { jfif = true } = {}) {
  const sof = [0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  const app0 = [0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  return new Uint8Array([0xff, 0xd8, ...(jfif ? app0 : []), ...sof, 0xff, 0xd9]);
}

describe('text layout for export', () => {
  const el = { text: 'one two three four', size: 10, w: 50, letterSpacing: 0 };
  it('wraps at spaces like the text box', () => {
    expect(layoutText(el, measure(el).width).map((l) => l.text)).toEqual(['one two', 'three four']);
  });
  it('keeps hard line breaks and breaks a word wider than the box', () => {
    const e = { ...el, text: 'abcdefghijklmn\nx' };
    expect(layoutText(e, measure(e).width).map((l) => l.text)).toEqual(['abcdefghij', 'klmn', 'x']);
  });
  it('applies letter case and spacing before measuring', () => {
    const e = { ...el, w: 100, text: 'hi there', textCase: 'title', letterSpacing: 2 };
    const lines = layoutText(e, measure(e).width);
    expect(lines.map((l) => l.text)).toEqual(['Hi There']);
    expect(lines[0].width).toBe(8 * 5 + 8 * 2);
  });
});

describe('SVG export', () => {
  const [poster] = buildDemoDesigns();
  const page = poster.pages[0];

  it('reopens as well-formed SVG with every element of the page', () => {
    const { svg, width, height, missingImages } = pageToSvg(page, { measure });
    const doc = parseXml(svg);
    const root = doc.documentElement;
    expect(root.tagName).toBe('svg');
    expect([root.getAttribute('width'), root.getAttribute('height')]).toEqual(['1080', '1350']);
    expect([width, height]).toEqual([1080, 1350]);
    expect(root.getAttribute('viewBox')).toBe('0 0 1080 1350');
    // background colour first, then one group per element
    const clip = all(doc, 'g').find((g) => g.getAttribute('clip-path') && g.parentNode === root);
    const kids = Array.from(clip.childNodes).filter((n) => n.nodeType === 1);
    expect(kids[0].tagName).toBe('rect');
    expect(kids[0].getAttribute('fill')).toBe('#fdf6ec');
    expect(kids.filter((k) => k.tagName === 'g').length).toBe(page.elements.length);
    expect(all(doc, 'text').map((t) => t.textContent)).toEqual(['Garden supper', 'Saturday 14 June, 6 pmBring a dish to share']);
    expect(all(doc, 'tspan').length).toBe(3);
    expect(all(doc, 'linearGradient').length).toBe(1); // the yellow sky
    expect(all(doc, 'feDropShadow').length).toBe(1); // the green block's shadow
    expect(all(doc, 'image')[0].getAttribute('href')).toMatch(/^data:image\/svg\+xml/); // the icon
    expect(all(doc, 'path').length).toBe(1); // the star, its 100-unit path scaled to 150
    expect(all(doc, 'path')[0].getAttribute('d')).toMatch(/^M75 3 L91.5 55.5/);
    expect(all(doc, 'path')[0].getAttribute('stroke-dasharray')).toBe('12 8');
    expect(missingImages).toBe(0);
    expect(svg).not.toMatch(/<script|foreignObject|vector-effect/);
  });

  it('places rotation, opacity and text baselines in page coordinates', () => {
    const p = { width: 200, height: 100, background: '#ffffff', elements: [
      newElement('rect', { x: 10, y: 20, w: 40, h: 30 }, { rotation: 15, opacity: 0.5 }),
      newElement('text', { x: 0, y: 0, w: 200, h: 40 }, { text: 'Hi', size: 20, lineHeight: 1.5, align: 'center' }),
    ] };
    const doc = parseXml(pageToSvg(p, { measure }).svg);
    const groups = all(doc, 'g').filter((g) => g.getAttribute('transform'));
    expect(groups[0].getAttribute('transform')).toBe('translate(10 20) rotate(15 20 15)');
    expect(groups[0].getAttribute('opacity')).toBe('0.5');
    const tspan = all(doc, 'tspan')[0];
    // line box 30, content 20, half-leading 5, ascent 16: baseline 21
    expect(tspan.getAttribute('y')).toBe('21');
    expect(tspan.getAttribute('x')).toBe('90'); // (200 - 20) / 2
  });

  it('leaves the background out when transparent, and draws past the edge for bleed', () => {
    const plain = parseXml(pageToSvg(page, { measure, transparent: true }).svg);
    expect(all(plain, 'rect').some((r) => r.getAttribute('fill') === '#fdf6ec')).toBe(false);
    const bled = pageToSvg(page, { measure, bleed: 10, scale: 2 });
    const doc = parseXml(bled.svg);
    expect(doc.documentElement.getAttribute('viewBox')).toBe('-10 -10 1100 1370');
    expect([bled.width, bled.height]).toEqual([2200, 2740]);
    expect(all(doc, 'rect')[1].getAttribute('x')).toBe('-10'); // background into the bleed
  });

  it('draws images with their crop, mask, flip and adjustments, and counts missing ones', () => {
    const p = { width: 100, height: 100, background: '#ffffff', elements: [
      newElement('image', { x: 0, y: 0, w: 50, h: 50 }, { imageId: 'a', crop: { l: 0.5 }, mask: 'circle', flipX: true, adjust: { grayscale: 100, brightness: 120 } }),
      newElement('image', { x: 50, y: 0, w: 50, h: 50 }, { imageId: 'gone' }),
    ] };
    const r = pageToSvg(p, { measure, images: { a: PIXEL } });
    const doc = parseXml(r.svg);
    const img = all(doc, 'image')[0];
    expect(img.getAttribute('href')).toBe(PIXEL);
    expect([img.getAttribute('x'), img.getAttribute('width'), img.getAttribute('height')]).toEqual(['-50', '100', '50']);
    expect(img.getAttribute('transform')).toContain('scale(-1 1)');
    expect(all(doc, 'clipPath').some((c) => c.getElementsByTagName('ellipse').length)).toBe(true);
    expect(all(doc, 'feComponentTransfer').length).toBe(1);
    expect(all(doc, 'feColorMatrix').length).toBe(1);
    expect(r.missingImages).toBe(1);
  });

  it('escapes text so a design can never inject markup', () => {
    const p = { width: 100, height: 100, background: '#fff', elements: [newElement('text', { w: 2000, h: 40 }, { text: '<script>alert(1)</script> & "q"' })] };
    const doc = parseXml(pageToSvg(p, { measure }).svg);
    expect(all(doc, 'script').length).toBe(0);
    expect(all(doc, 'text')[0].textContent).toContain('<script>alert(1)</script> & "q"');
  });

  it('matches the CSS geometry of gradients, masks and shapes', () => {
    const across = linearGradientPoints(90, 200, 100);
    expect([across.x1, across.y1, across.x2, across.y2].map((v) => Math.round(v) + 0)).toEqual([0, 50, 200, 50]);
    const down = linearGradientPoints(180, 200, 100);
    expect([down.x1, down.y1, down.x2, down.y2].map((v) => Math.round(v) + 0)).toEqual([100, 0, 100, 100]);
    expect(maskGeometry('triangle', 200, 100)).toBe('<polygon points="100,0 200,100 0,100"/>');
    expect(maskGeometry('none', 10, 10)).toBe('');
    expect(scalePath('M50 2 L98 98', 2, 0.5)).toBe('M100 1 L196 49');
    expect(adjustPrimitives({ blur: 3 })).toBe('<feGaussianBlur stdDeviation="3"/>');
    expect(adjustPrimitives({})).toBe('');
  });
});

// Every xref offset must land on its object, and startxref on the table.
function checkXref(bytes) {
  const text = Buffer.from(bytes).toString('latin1');
  const start = Number(text.match(/startxref\n(\d+)\n%%EOF\n$/)[1]);
  expect(text.slice(start, start + 4)).toBe('xref');
  const [, count] = text.slice(start).match(/^xref\n0 (\d+)\n/);
  const rows = text.slice(start).split('\n').slice(2, 2 + Number(count));
  expect(rows[0]).toBe('0000000000 65535 f ');
  rows.slice(1).forEach((row, i) => {
    const off = Number(row.slice(0, 10));
    expect(text.slice(off, off + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
  });
  return text;
}

describe('PDF export', () => {
  const [poster] = buildDemoDesigns();

  it('reopens in pdf.js with one page per design page at the design size', async () => {
    const pages = poster.pages.map((p) => ({ jpeg: makeJpeg(p.width, p.height), widthPx: p.width, heightPx: p.height }));
    const bytes = buildPdf(pages, { title: 'Garden supper – poster' });
    checkXref(bytes);
    const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 });
    const doc = await task.promise;
    expect(doc.numPages).toBe(3);
    for (let n = 1; n <= 3; n++) {
      const pg = await doc.getPage(n);
      expect(pg.view).toEqual([0, 0, 1080 * PT_PER_PX, 1350 * PT_PER_PX]);
    }
    const meta = await doc.getMetadata();
    expect(meta.info.Title).toBe('Garden supper – poster');
    expect(meta.info.Producer).toBe('Home Studio');
    expect(await doc.getAttachments()).toBe(null); // no editable copy asked for
    await task.destroy();
  });

  it('makes print-ready pages: bleed, trim box and crop marks outside the bleed', async () => {
    const bytes = buildPdf([{ jpeg: makeJpeg(100, 100), widthPx: 960, heightPx: 480 }], { bleedMm: 3, marks: true });
    const text = checkXref(bytes);
    const bx = pageBoxes(960, 480, { bleedMm: 3, marks: true });
    const b = 3 * MM_TO_PT;
    expect(bx.trim[2] - bx.trim[0]).toBeCloseTo(720); // 960 px = 10 in = 720 pt
    expect(bx.bleed[0]).toBeCloseTo(bx.trim[0] - b);
    const box = (name) => text.match(new RegExp(`/${name} \\[([^\\]]+)\\]`))[1].split(' ').map(Number);
    box('TrimBox').forEach((v, i) => expect(v).toBeCloseTo(bx.trim[i], 2));
    box('BleedBox').forEach((v, i) => expect(v).toBeCloseTo(bx.bleed[i], 2));
    // eight crop-mark strokes, none inside the bleed box
    const marks = [...text.matchAll(/([\d.]+) ([\d.]+) m ([\d.]+) ([\d.]+) l S/g)].map((m) => m.slice(1).map(Number));
    expect(marks.length).toBe(8);
    for (const [x1, y1, x2, y2] of marks) {
      const inside = (x, y) => x > bx.bleed[0] && x < bx.bleed[2] && y > bx.bleed[1] && y < bx.bleed[3];
      expect(inside(x1, y1) || inside(x2, y2)).toBe(false);
    }
    const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 });
    const doc = await task.promise;
    const pg = await doc.getPage(1);
    pg.view.forEach((v, i) => expect(v).toBeCloseTo(bx.media[i], 2));
    await task.destroy();
  });

  it('carries the editable design inside, and it reopens as the same design', async () => {
    const design = newDesign('Café menu', 400, 300);
    design.pages[0].elements.push(newElement('image', { x: 1, y: 2, w: 30, h: 30 }, { imageId: 'img1' }));
    const project = serializeProject({ design, images: [{ id: 'img1', type: 'image/png', bytes: makePng() }] });
    const bytes = buildPdf([{ jpeg: makeJpeg(400, 300), widthPx: 400, heightPx: 300 }], {
      attachment: { name: 'Café menu.homestudio.json', mime: 'application/json', bytes: project },
    });
    checkXref(bytes);
    const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 });
    const doc = await task.promise;
    const att = [...(await doc.getAttachments()).entries()];
    expect(att.map(([, a]) => a.filename)).toEqual(['Café menu.homestudio.json']);
    const parsed = parseHomeStudioFile(fromUtf8(await doc.getAttachmentContent(att[0][0])));
    expect(parsed.kind).toBe('project');
    expect(parsed.design.pages).toEqual(design.pages);
    expect(Buffer.from(parsed.images[0].bytes)).toEqual(Buffer.from(makePng()));
    await task.destroy();
  });

  it('reads JPEG frame sizes and writes text any reader can show', () => {
    expect(jpegInfo(makeJpeg(640, 480))).toEqual({ width: 640, height: 480, components: 3 });
    expect(() => jpegInfo(new Uint8Array([1, 2, 3]))).toThrow();
    expect(pdfText('A€')).toBe('<FEFF004120AC>');
    expect(() => buildPdf([])).toThrow();
  });
});

describe('PNG and JPEG resolution', () => {
  it('stamps a PNG with its DPI and the file still reopens intact', () => {
    const png = makePng();
    expect(pngInfo(png)).toMatchObject({ width: 3, height: 2, alpha: true, dpi: null });
    const out = setPngDpi(setPngDpi(png, 96), 192);
    const chunks = pngChunks(out); // every CRC checked
    expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'pHYs', 'IDAT', 'IEND']);
    expect(pngInfo(out).dpi).toBe(192);
    const idat = (b) => zlib.inflateSync(Buffer.from(pngChunks(b).find((c) => c.type === 'IDAT').data));
    expect(idat(out)).toEqual(idat(png));
    const broken = out.slice();
    broken[40] ^= 0xff;
    expect(() => pngChunks(broken)).toThrow(/damaged/);
  });

  it('stamps a JPEG with its DPI, with or without a JFIF header', () => {
    expect(jpegDpi(setJpegDpi(makeJpeg(10, 10), 288))).toBe(288);
    const added = setJpegDpi(makeJpeg(10, 10, { jfif: false }), 300);
    expect(jpegDpi(added)).toBe(300);
    expect(jpegInfo(added)).toEqual({ width: 10, height: 10, components: 3 });
  });
});

describe('export settings', () => {
  it('keeps canvases inside what browsers draw', () => {
    expect(capScale(1080, 1350, 2)).toEqual({ scale: 2, capped: false, width: 2160, height: 2700 });
    const big = capScale(10000, 10000, 4);
    expect(big.capped).toBe(true);
    expect(big.width * big.height).toBeLessThanOrEqual(MAX_AREA);
    const tall = capScale(100, 10000, 4);
    expect(tall.height).toBeLessThanOrEqual(MAX_SIDE);
  });

  it('falls back to safe values and ties print-ready to 300 DPI', () => {
    expect(exportSettings({ format: 'gif' }).format).toBe('png');
    expect(exportSettings({ format: 'jpeg', transparent: true }).transparent).toBe(false);
    expect(exportSettings({ format: 'pdf', printReady: true, dpi: 96 })).toMatchObject({ dpi: 300, printReady: true, includeProject: true });
    expect(exportSettings({ format: 'png', quality: 5 }).quality).toBe(1);
  });

  it('names files after the design and its pages', () => {
    const d = { name: 'Bake / sale: "flyer"' };
    expect(pageFileName(d, { name: 'Front' }, 0, 1, 'png')).toBe('Bake sale flyer .png'.replace(' .', '.'));
    expect(pageFileName(d, { name: 'Back' }, 1, 2, 'jpg')).toBe('Bake sale flyer - 02 Back.jpg');
  });
});

describe('ZIP of several pages', () => {
  // A reader of its own: the central directory, then each file's bytes,
  // checked against zlib's CRC-32.
  function readZip(bytes) {
    const buf = Buffer.from(bytes);
    const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    const count = buf.readUInt16LE(end + 10);
    let p = buf.readUInt32LE(end + 16);
    const files = [];
    for (let i = 0; i < count; i++) {
      expect(buf.readUInt32LE(p)).toBe(0x02014b50);
      const crc = buf.readUInt32LE(p + 16);
      const size = buf.readUInt32LE(p + 24);
      const nameLen = buf.readUInt16LE(p + 28);
      const local = buf.readUInt32LE(p + 42);
      const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
      expect(buf.readUInt32LE(local)).toBe(0x04034b50);
      const dataStart = local + 30 + buf.readUInt16LE(local + 26);
      const data = buf.slice(dataStart, dataStart + size);
      expect(zlib.crc32(data)).toBe(crc);
      files.push({ name, data });
      p += 46 + nameLen;
    }
    return files;
  }

  it('reopens with every file intact and unique names', () => {
    const png = makePng();
    const zip = zipFiles([{ name: 'Poster - 01 Front.png', bytes: png }, { name: 'Ünïcode.png', bytes: utf8('x') }, { name: 'Ünïcode.png', bytes: utf8('y') }]);
    const files = readZip(zip);
    expect(files.map((f) => f.name)).toEqual(['Poster - 01 Front.png', 'Ünïcode.png', 'Ünïcode (2).png']);
    expect(new Uint8Array(files[0].data)).toEqual(png);
    expect(files[2].data.toString()).toBe('y');
  });
});

describe('byte helpers', () => {
  it('round-trips base64 and agrees with zlib on CRC-32', () => {
    for (const n of [0, 1, 2, 3, 4, 100]) {
      const b = new Uint8Array(n).map((_, i) => (i * 37) & 255);
      expect(bytesToBase64(b)).toBe(Buffer.from(b).toString('base64'));
      expect(base64ToBytes(bytesToBase64(b))).toEqual(b);
    }
    expect(() => base64ToBytes('abc')).toThrow();
    expect(() => base64ToBytes('ab$=')).toThrow();
    const data = utf8('Home Studio');
    expect(crc32(data)).toBe(zlib.crc32(Buffer.from(data)));
  });
});
