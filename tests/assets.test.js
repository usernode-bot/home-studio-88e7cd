// The asset library: licences and attribution, search, templates, SVG
// cleaning, imports and inserting library items.

import { describe, it, expect } from 'vitest';
import { ASSETS, LICENSES, SOURCES, searchLibrary, attributionOf, categoriesOf } from '../web/src/assets/catalog.js';
import { TEMPLATES, TEMPLATE_CATEGORIES, instantiateTemplate } from '../web/src/assets/templates.js';
import { BUNDLED_FONTS, fontStack, fontsUsed } from '../web/src/assets/fonts.js';
import { sanitizeSvg, svgSize, svgDataUrl, isRecolorable, iconSvg } from '../web/src/assets/svg.js';
import { classifyFile, assetFromFile, elementForItem, applyBackground, placeOnPage } from '../web/src/assets/imports.js';
import { SIZE_PRESETS } from '../web/src/assets/presets.js';
import { walk, pageIsValid } from '../web/src/doc/model.js';
import pkg from '../package.json';

const file = (name, type, body = '', size) => ({ name, type, size: size ?? body.length, text: async () => body });
const page = { width: 1000, height: 500, background: '#ffffff', elements: [] };

describe('licences and attribution', () => {
  const all = [...ASSETS, ...TEMPLATES];

  it('bundles only assets under an allowed free licence, each credited', () => {
    expect(all.length).toBeGreaterThan(100);
    for (const item of all) {
      expect(Object.keys(LICENSES), item.id).toContain(item.license);
      expect(attributionOf(item), item.id).toBeTruthy();
    }
  });

  it('records the licence the font packages themselves declare', async () => {
    for (const [key, f] of Object.entries(BUNDLED_FONTS)) {
      expect(f.license, key).toBe('OFL-1.1');
      expect(f.source, key).toMatch(/^https:\/\//);
      expect(f.attribution).toMatch(/^Copyright \d{4} The .+ Authors$/);
    }
    // Each font's package declares OFL in its own package.json.
    const fs = await import('node:fs');
    for (const dep of Object.keys(pkg.dependencies).filter((d) => d.startsWith('@fontsource/'))) {
      const meta = JSON.parse(fs.readFileSync(`node_modules/${dep}/package.json`, 'utf8'));
      expect(meta.license, dep).toBe('OFL-1.1');
    }
    const lucide = JSON.parse(fs.readFileSync('node_modules/lucide/package.json', 'utf8'));
    expect(lucide.license).toBe(SOURCES.lucide.license);
  });

  it('gives every item a unique id', () => {
    const ids = all.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('search', () => {
  it('matches names, tags and categories, every word', () => {
    expect(searchLibrary(ASSETS, { query: 'coffee' }).map((i) => i.id)).toEqual(
      expect.arrayContaining(['icon:Coffee', 'illustration:coffee-cup']),
    );
    expect(searchLibrary(ASSETS, { query: 'party celebration' }).every((i) => /party|celebration/.test([i.name, ...i.tags].join(' ').toLowerCase()))).toBe(true);
    expect(searchLibrary(ASSETS, { query: 'zzzz-nothing' })).toEqual([]);
  });

  it('narrows by kind, category and favourites', () => {
    const icons = searchLibrary(ASSETS, { kind: 'icon' });
    expect(icons.length).toBeGreaterThan(40);
    expect(icons.every((i) => i.kind === 'icon')).toBe(true);
    const patterns = searchLibrary(ASSETS, { category: 'Patterns' });
    expect(patterns.length).toBeGreaterThan(2);
    const favs = new Set(['icon:Heart', 'shape:star']);
    expect(searchLibrary(ASSETS, { favorites: favs }).map((i) => i.id).sort()).toEqual(['icon:Heart', 'shape:star']);
    expect(categoriesOf(ASSETS, 'background')).toEqual(['Colours', 'Gradients', 'Patterns']);
  });
});

describe('templates', () => {
  it('covers every category', () => {
    for (const c of TEMPLATE_CATEGORIES) expect(TEMPLATES.some((t) => t.category === c), c).toBe(true);
  });

  it('opens as a normal design with fresh ids, every time', () => {
    for (const tpl of TEMPLATES) {
      const a = instantiateTemplate(tpl);
      const b = instantiateTemplate(tpl);
      expect(a.name).toBe(tpl.name);
      expect(a.id).not.toBe(b.id);
      expect(pageIsValid(a.pages[0].width, a.pages[0].height)).toBe(true);
      const idsA = a.pages.flatMap((p) => [...walk(p.elements)].map((e) => e.id));
      const idsB = b.pages.flatMap((p) => [...walk(p.elements)].map((e) => e.id));
      expect(idsA.length).toBeGreaterThan(0);
      expect(new Set(idsA).size).toBe(idsA.length);
      expect(idsA.some((id) => idsB.includes(id))).toBe(false);
      for (const p of a.pages) {
        expect(p.guides).toEqual([]);
        for (const el of walk(p.elements)) if (el.type === 'svg') expect(el.svg).toMatch(/^<svg/);
      }
    }
  });

  it('editing a used template leaves the template untouched', () => {
    const tpl = TEMPLATES[0];
    const d = instantiateTemplate(tpl);
    d.pages[0].elements[0].x = 9999;
    expect(instantiateTemplate(tpl).pages[0].elements[0].x).not.toBe(9999);
  });

  it('uses bundled fonts the library can load', () => {
    for (const tpl of TEMPLATES) {
      for (const key of fontsUsed(instantiateTemplate(tpl).pages)) {
        expect(fontStack(key), key).not.toBe(fontStack('nonsense'));
      }
    }
  });

  it('size presets are valid page sizes', () => {
    for (const p of SIZE_PRESETS) expect(pageIsValid(p.w, p.h), p.label).toBe(true);
  });
});

describe('SVG handling', () => {
  it('strips scripts, handlers, external links and embedded HTML', () => {
    const dirty = '<?xml version="1.0"?><!-- hi --><svg viewBox="0 0 10 20" onload="alert(1)">' +
      '<script>alert(1)</script><a href="javascript:alert(1)"><rect width="5" height="5" onclick="x()"/></a>' +
      '<foreignObject><div>hi</div></foreignObject><image href="https://example.com/x.png"/>' +
      '<use href="#a"/><rect style="fill:url(https://example.com/a)"/></svg>';
    const clean = sanitizeSvg(dirty);
    expect(clean).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    expect(clean).not.toMatch(/script|onload|onclick|javascript|foreignObject|example\.com/i);
    expect(clean).toContain('href="#a"');
    expect(clean.endsWith('</svg>')).toBe(true);
  });

  it('refuses what is not an SVG', () => {
    expect(() => sanitizeSvg('<html></html>')).toThrow("isn't an SVG");
    expect(() => sanitizeSvg('')).toThrow('empty');
    expect(() => sanitizeSvg('<svg>' + 'x'.repeat(600 * 1024) + '</svg>')).toThrow('512 KB');
  });

  it('reads the size from width/height or the viewBox', () => {
    expect(svgSize('<svg width="40px" height="20">')).toEqual({ w: 40, h: 20 });
    expect(svgSize('<svg viewBox="0 0 300 150">')).toEqual({ w: 300, h: 150 });
    expect(svgSize('<svg width="100%" viewBox="0,0,8,4">')).toEqual({ w: 8, h: 4 });
    expect(svgSize('<svg>')).toEqual({ w: 100, h: 100 });
  });

  it('recolours icons through currentColor', () => {
    const svg = iconSvg([['path', { d: 'M0 0L1 1' }]]);
    expect(isRecolorable(svg)).toBe(true);
    expect(decodeURIComponent(svgDataUrl(svg, '#ff0000'))).toContain('stroke="#ff0000"');
    expect(decodeURIComponent(svgDataUrl(svg))).toContain('currentColor');
  });
});

describe('imports', () => {
  const checks = {
    imageSize: async (f) => { if (f.name.includes('broken')) throw new Error('decode'); return { w: 800, h: 600 }; },
    font: async (a) => { if (a.name.includes('broken')) throw new Error('bad font'); },
  };

  it('sorts files into images, SVGs and fonts', () => {
    expect(classifyFile(file('a.png', 'image/png'))).toBe('image');
    expect(classifyFile(file('a.svg', ''))).toBe('svg');
    expect(classifyFile(file('a.woff2', ''))).toBe('font');
    expect(classifyFile(file('a.OTF', 'font/otf'))).toBe('font');
    expect(classifyFile(file('a.pdf', 'application/pdf'))).toBe(null);
  });

  it('turns each kind into a library asset', async () => {
    const img = await assetFromFile(file('Holiday photo.jpg', 'image/jpeg', 'xx'), checks);
    expect(img).toMatchObject({ kind: 'image', name: 'Holiday photo', w: 800, h: 600 });
    expect(img.blob).toBeTruthy();
    const svg = await assetFromFile(file('logo.svg', 'image/svg+xml', '<svg viewBox="0 0 50 25"><script>x</script><rect/></svg>'), checks);
    expect(svg).toMatchObject({ kind: 'svg', name: 'logo', w: 50, h: 25 });
    expect(svg.svg).not.toContain('script');
    const font = await assetFromFile(file('My Hand.ttf', 'font/ttf', 'xx'), checks);
    expect(font).toMatchObject({ kind: 'font', name: 'My Hand' });
  });

  it('says what went wrong with a bad file', async () => {
    await expect(assetFromFile(file('broken.png', 'image/png', 'x'), checks)).rejects.toThrow("isn't an image this browser can open");
    await expect(assetFromFile(file('broken.ttf', 'font/ttf', 'x'), checks)).rejects.toThrow("isn't a font");
    await expect(assetFromFile(file('notes.pdf', 'application/pdf'), checks)).rejects.toThrow("isn't an image, SVG or font");
    await expect(assetFromFile(file('huge.png', 'image/png', '', 30 * 1024 * 1024), checks)).rejects.toThrow('20 MB');
  });
});

describe('inserting library items', () => {
  it('places shapes, icons and illustrations centred on the page', () => {
    const star = elementForItem(ASSETS.find((a) => a.id === 'shape:star'), page);
    expect(star).toMatchObject({ type: 'shape', shape: 'star', w: 150, h: 150, x: 425, y: 175 });
    const rounded = elementForItem(ASSETS.find((a) => a.id === 'shape:rounded'), page);
    expect(rounded).toMatchObject({ type: 'rect', radius: 32 });
    const icon = elementForItem(ASSETS.find((a) => a.id === 'icon:Heart'), page);
    expect(icon).toMatchObject({ type: 'svg', color: '#1c1917', w: 125, h: 125 });
    const ill = elementForItem(ASSETS.find((a) => a.id === 'illustration:wave'), page);
    expect(ill.type).toBe('svg');
    expect(ill.color).toBe(''); // multi-colour artwork keeps its colours
    expect(ill.w / ill.h).toBeCloseTo(3, 1);
  });

  it('applies a background with its gradient or pattern, and clears the others', () => {
    const p = { ...page, gradient: { kind: 'linear', angle: 0, to: '#000000' }, pattern: null };
    applyBackground(p, ASSETS.find((a) => a.id === 'background:dots').fill);
    expect(p.pattern.svg).toContain('<circle');
    expect(p.gradient).toBe(null);
    applyBackground(p, ASSETS.find((a) => a.id === 'background:cream').fill);
    expect(p).toMatchObject({ background: '#fdf6ec', gradient: null, pattern: null });
  });

  it('fits imports inside the page', () => {
    expect(placeOnPage(page, 4000, 1000, 0.5)).toEqual({ x: 250, y: 188, w: 500, h: 125 });
  });
});
