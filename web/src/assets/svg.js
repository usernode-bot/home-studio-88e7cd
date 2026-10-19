// SVG handling: building SVG markup from icon data, cleaning SVG files a
// person imports, reading their size, and turning markup into an image
// URL. SVG graphics render through <img>, where the browser never runs
// their scripts; cleaning still keeps stored designs free of active content.

export const SVG_MAX_BYTES = 512 * 1024;

const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// A Lucide icon node ([[tag, attrs], ...]) as standalone SVG markup, stroked
// in currentColor so the element's colour can recolour it.
export function iconSvg(node) {
  const inner = node
    .map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(' ')}/>`)
    .join('');
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>'
  );
}

export const isRecolorable = (svg) => /currentColor/.test(svg || '');

// Clean imported SVG text. Returns the cleaned markup, or throws an Error
// whose message says what was wrong, in words a person can act on.
export function sanitizeSvg(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('That SVG file is empty.');
  if (text.length > SVG_MAX_BYTES) throw new Error('That SVG is larger than 512 KB.');
  let s = text.replace(/^﻿/, '');
  s = s.replace(/<\?xml[\s\S]*?\?>/gi, '').replace(/<!DOCTYPE[\s\S]*?>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  const start = s.search(/<svg[\s>]/i);
  const end = s.toLowerCase().lastIndexOf('</svg>');
  if (start === -1 || end === -1 || end < start) throw new Error("That file isn't an SVG image.");
  s = s.slice(start, end + 6);
  // Active and external content: scripts, embedded HTML, event handlers,
  // javascript: links, and references to anything outside the file itself.
  s = s.replace(/<(script|foreignObject|iframe|object|embed|audio|video)[\s\S]*?<\/\1\s*>/gi, '');
  s = s.replace(/<(script|foreignObject|iframe|object|embed|audio|video)\b[^>]*\/?>/gi, '');
  s = s.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  s = s.replace(/\s+(xlink:href|href)\s*=\s*("([^"]*)"|'([^']*)')/gi, (m, attr, _q, a, b) => {
    const v = (a ?? b ?? '').trim();
    return v.startsWith('#') || /^data:image\/(png|jpe?g|gif|webp);/i.test(v) ? m : '';
  });
  s = s.replace(/url\(\s*['"]?\s*(?!#)[^)]*\)/gi, 'none');
  if (!/^<svg[^>]*\sxmlns=/i.test(s)) s = s.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  return s;
}

// The SVG's own width and height: from width/height when both are plain
// numbers or px, else from the viewBox, else a square.
export function svgSize(svg) {
  const open = (svg.match(/<svg[^>]*>/i) || [''])[0];
  const attr = (name) => {
    const m = open.match(new RegExp(`\\s${name}\\s*=\\s*["']\\s*([\\d.]+)(px)?\\s*["']`, 'i'));
    return m ? parseFloat(m[1]) : null;
  };
  const w = attr('width');
  const h = attr('height');
  if (w && h) return { w, h };
  const vb = open.match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/i);
  if (vb && parseFloat(vb[1]) > 0 && parseFloat(vb[2]) > 0) return { w: parseFloat(vb[1]), h: parseFloat(vb[2]) };
  return { w: 100, h: 100 };
}

export function svgDataUrl(svg, color) {
  const markup = color ? svg.replace(/currentColor/g, color) : svg;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup);
}
