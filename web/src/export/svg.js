// A page drawn as standalone SVG markup: the one renderer every export goes
// through. SVG export downloads it as it is; PNG, JPEG and PDF draw it onto
// a canvas at the size asked for. It follows the editor's own drawing
// (ElementView.jsx and doc/style.js) element by element, so an export looks
// like the page on screen.
//
// Pure: text measuring is passed in (`measure`), images arrive as data URLs
// and fonts as ready @font-face CSS, so this runs and is tested in Node.

import { fontStack } from '../assets/fonts.js';
import { normalizeCrop, MASKS, SHAPES, ADJUST_DEFAULTS, dashArray } from '../doc/style.js';
import { svgDataUrl } from '../assets/svg.js';

export const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const num = (n) => {
  const v = Math.round((Number(n) || 0) * 1000) / 1000;
  return Object.is(v, -0) ? '0' : String(v);
};

const CASE = {
  upper: (s) => s.toUpperCase(),
  lower: (s) => s.toLowerCase(),
  title: (s) => s.replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toUpperCase()),
};

// ── Text layout ────────────────────────────────────────────────────────
// Wraps like the editor's text box (white-space: pre-wrap, break-word):
// breaks at spaces, keeps a word whole unless it is wider than the box on
// its own, and lets trailing spaces hang. `width(s)` measures a string
// without letter spacing.

export function layoutText(el, width) {
  const spacing = el.letterSpacing || 0;
  const w = (s) => width(s) + spacing * [...s].length;
  const text = (CASE[el.textCase] || ((s) => s))(String(el.text ?? ''));
  const max = Math.max(1, el.w);
  const lines = [];
  for (const para of text.split('\n')) {
    const tokens = para.split(/( +)/);
    let line = '';
    const push = (s, last) => lines.push({ text: s.replace(/ +$/, ''), last });
    for (let i = 0; i < tokens.length; i += 2) {
      const word = tokens[i];
      const space = i > 0 ? tokens[i - 1] : '';
      const next = line + space + word;
      if (line.trim() && w(next.replace(/ +$/, '')) > max) {
        push(line, false);
        line = word;
      } else {
        line = next;
      }
      // A word wider than the box on its own breaks between characters.
      while (w(line) > max && [...line].length > 1) {
        const chars = [...line];
        let n = 1;
        while (n < chars.length && w(chars.slice(0, n + 1).join('')) <= max) n++;
        push(chars.slice(0, n).join(''), false);
        line = chars.slice(n).join('');
      }
    }
    push(line, true);
  }
  for (const ln of lines) ln.width = ln.text ? w(ln.text) : 0;
  return lines;
}

// ── Paint helpers ──────────────────────────────────────────────────────

// CSS linear-gradient(angle) over a w × h box, as SVG user-space points.
export function linearGradientPoints(angle, w, h) {
  const a = ((angle ?? 90) * Math.PI) / 180;
  const dx = Math.sin(a);
  const dy = -Math.cos(a);
  const len = Math.abs(w * dx) + Math.abs(h * dy);
  return { x1: w / 2 - (dx * len) / 2, y1: h / 2 - (dy * len) / 2, x2: w / 2 + (dx * len) / 2, y2: h / 2 + (dy * len) / 2 };
}

function gradientDef(id, from, g, w, h) {
  const stops = `<stop offset="0" stop-color="${esc(from)}"/><stop offset="1" stop-color="${esc(g.to)}"/>`;
  if (g.kind === 'radial') {
    return `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${num(w / 2)}" cy="${num(h / 2)}" r="${num(Math.hypot(w / 2, h / 2))}">${stops}</radialGradient>`;
  }
  const p = linearGradientPoints(g.angle, w, h);
  return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${num(p.x1)}" y1="${num(p.y1)}" x2="${num(p.x2)}" y2="${num(p.y2)}">${stops}</linearGradient>`;
}

// The 100 × 100 shape paths stretched to w × h (so strokes keep their own
// width at any size, as vector-effect does in the editor).
export function scalePath(d, sx, sy) {
  let i = 0;
  return d.replace(/-?\d*\.?\d+/g, (n) => num(parseFloat(n) * (i++ % 2 === 0 ? sx : sy)));
}

// A mask from doc/style.js MASKS as SVG geometry on a w × h box.
export function maskGeometry(mask, w, h) {
  if (mask === 'circle') return `<ellipse cx="${num(w / 2)}" cy="${num(h / 2)}" rx="${num(w / 2)}" ry="${num(h / 2)}"/>`;
  if (mask === 'rounded') return `<rect width="${num(w)}" height="${num(h)}" rx="${num(w * 0.12)}" ry="${num(h * 0.12)}"/>`;
  if (mask === 'arch') {
    return `<path d="M0 ${num(h)} L0 ${num(h / 2)} A${num(w / 2)} ${num(h / 2)} 0 0 1 ${num(w / 2)} 0 A${num(w / 2)} ${num(h / 2)} 0 0 1 ${num(w)} ${num(h / 2)} L${num(w)} ${num(h)} Z"/>`;
  }
  const clip = MASKS[mask] && MASKS[mask].clip;
  const m = clip && clip.match(/^polygon\((.*)\)$/);
  if (!m) return '';
  const pts = m[1].split(',').map((pair) => {
    const [x, y] = pair.trim().split(/\s+/).map((v) => parseFloat(v) / 100);
    return `${num(x * w)},${num(y * h)}`;
  });
  return `<polygon points="${pts.join(' ')}"/>`;
}

// The CSS filter functions doc/style.js adjustFilter() uses, as the SVG
// filter primitives the Filter Effects spec defines them by.
export function adjustPrimitives(adjust) {
  if (!adjust) return '';
  const a = { ...ADJUST_DEFAULTS, ...adjust };
  const out = [];
  const linear = (slope, intercept) => ['R', 'G', 'B']
    .map((c) => `<feFunc${c} type="linear" slope="${num(slope)}" intercept="${num(intercept)}"/>`).join('');
  if (a.brightness !== 100) out.push(`<feComponentTransfer>${linear(a.brightness / 100, 0)}</feComponentTransfer>`);
  if (a.contrast !== 100) {
    const c = a.contrast / 100;
    out.push(`<feComponentTransfer>${linear(c, 0.5 - 0.5 * c)}</feComponentTransfer>`);
  }
  if (a.saturate !== 100) out.push(`<feColorMatrix type="saturate" values="${num(a.saturate / 100)}"/>`);
  if (a.sepia) {
    const s = 1 - Math.min(1, a.sepia / 100);
    const m = [0.393 + 0.607 * s, 0.769 - 0.769 * s, 0.189 - 0.189 * s, 0, 0,
      0.349 - 0.349 * s, 0.686 + 0.314 * s, 0.168 - 0.168 * s, 0, 0,
      0.272 - 0.272 * s, 0.534 - 0.534 * s, 0.131 + 0.869 * s, 0, 0, 0, 0, 0, 1, 0];
    out.push(`<feColorMatrix type="matrix" values="${m.map(num).join(' ')}"/>`);
  }
  if (a.grayscale) {
    const s = 1 - Math.min(1, a.grayscale / 100);
    const m = [0.2126 + 0.7874 * s, 0.7152 - 0.7152 * s, 0.0722 - 0.0722 * s, 0, 0,
      0.2126 - 0.2126 * s, 0.7152 + 0.2848 * s, 0.0722 - 0.0722 * s, 0, 0,
      0.2126 - 0.2126 * s, 0.7152 - 0.7152 * s, 0.0722 + 0.9278 * s, 0, 0, 0, 0, 0, 1, 0];
    out.push(`<feColorMatrix type="matrix" values="${m.map(num).join(' ')}"/>`);
  }
  if (a.hue) out.push(`<feColorMatrix type="hueRotate" values="${num(a.hue)}"/>`);
  if (a.blur) out.push(`<feGaussianBlur stdDeviation="${num(a.blur)}"/>`);
  return out.join('');
}

// ── The page ───────────────────────────────────────────────────────────

// opts:
//   images       { [imageId]: dataUrl }
//   measure(el)  -> { width(s), ascent, descent } for a text element's font
//   fontCss      @font-face rules embedding the fonts the page uses
//   transparent  leave the page background out
//   bleed        extra px drawn past each edge (print), background included
//   scale        output pixels per design px (the drawing stays vector)
// Returns { svg, width, height, missingImages }.
export function pageToSvg(page, opts = {}) {
  const { images = {}, measure, fontCss = '', transparent = false, bleed = 0, scale = 1 } = opts;
  const defs = [];
  let n = 0;
  const id = (p) => `${p}${++n}`;
  let missingImages = 0;

  const shadowFilter = (s, w, h, extra = 0) => {
    const fid = id('f');
    const pad = Math.abs(s.x || 0) + Math.abs(s.y || 0) + (s.blur || 0) * 3 + extra + Math.max(w, h) * 0.25 + 8;
    const color = esc(s.color || '#000000');
    const alpha = num(s.alpha ?? (s.glow ? 0.9 : 0.35));
    const prims = s.glow
      ? `<feDropShadow dx="0" dy="0" stdDeviation="${num(s.blur / 6)}" flood-color="${color}" flood-opacity="${alpha}" result="a"/>`
        + `<feDropShadow dx="0" dy="0" stdDeviation="${num(s.blur / 2)}" flood-color="${color}" flood-opacity="${alpha}"/>`
      : `<feDropShadow dx="${num(s.x || 0)}" dy="${num(s.y || 0)}" stdDeviation="${num((s.blur || 0) / 2)}" flood-color="${color}" flood-opacity="${alpha}"/>`;
    defs.push(`<filter id="${fid}" filterUnits="userSpaceOnUse" x="${num(-pad)}" y="${num(-pad)}" width="${num(w + pad * 2)}" height="${num(h + pad * 2)}" color-interpolation-filters="sRGB">${prims}</filter>`);
    return fid;
  };

  const fillOf = (from, g, w, h) => {
    if (!g) return esc(from || 'none');
    const gid = id('g');
    defs.push(gradientDef(gid, from, g, w, h));
    return `url(#${gid})`;
  };

  const strokeAttrs = (el) => {
    if (!el.stroke || !el.strokeWidth) return ' stroke="none"';
    const dash = dashArray(el.strokeStyle, el.strokeWidth);
    return ` stroke="${esc(el.stroke)}" stroke-width="${num(el.strokeWidth)}"${dash ? ` stroke-dasharray="${dash}"` : ''}`
      + (el.strokeStyle === 'dotted' ? ' stroke-linecap="round"' : '');
  };

  function body(el) {
    const w = el.w;
    const h = el.h;
    switch (el.type) {
      case 'group':
        return el.children.map(drawElement).join('');
      case 'rect':
      case 'ellipse': {
        const sw = el.stroke && el.strokeWidth ? el.strokeWidth : 0;
        const fill = fillOf(el.fill, el.gradient, w, h);
        const parts = [];
        if (el.type === 'ellipse') {
          parts.push(`<ellipse cx="${num(w / 2)}" cy="${num(h / 2)}" rx="${num(w / 2)}" ry="${num(h / 2)}" fill="${fill}"/>`);
          if (sw) parts.push(`<ellipse cx="${num(w / 2)}" cy="${num(h / 2)}" rx="${num(Math.max(0, w / 2 - sw / 2))}" ry="${num(Math.max(0, h / 2 - sw / 2))}" fill="none"${strokeAttrs(el)}/>`);
        } else {
          const r = Math.min(el.radius || 0, w / 2, h / 2);
          parts.push(`<rect width="${num(w)}" height="${num(h)}"${r ? ` rx="${num(r)}"` : ''} fill="${fill}"/>`);
          if (sw) parts.push(`<rect x="${num(sw / 2)}" y="${num(sw / 2)}" width="${num(Math.max(0, w - sw))}" height="${num(Math.max(0, h - sw))}"${r ? ` rx="${num(Math.max(0, r - sw / 2))}"` : ''} fill="none"${strokeAttrs(el)}/>`);
        }
        return parts.join('');
      }
      case 'shape': {
        const d = scalePath((SHAPES[el.shape] || SHAPES.star).d, w / 100, h / 100);
        return `<path d="${d}" fill="${fillOf(el.fill, el.gradient, w, h)}"${strokeAttrs(el)} stroke-linejoin="round"/>`;
      }
      case 'line': {
        // Width 0 draws nothing, as the editor does — not a 1 px fallback.
        if (!(el.strokeWidth > 0)) return '';
        const dash = dashArray(el.strokeStyle, el.strokeWidth);
        return `<line x1="0" y1="0" x2="${num(w)}" y2="${num(h)}" stroke="${esc(el.stroke || '#000000')}" stroke-width="${num(el.strokeWidth)}"${dash ? ` stroke-dasharray="${dash}"` : ''} stroke-linecap="round"/>`;
      }
      case 'svg':
        if (!el.svg) return '';
        return `<image width="${num(w)}" height="${num(h)}" preserveAspectRatio="none" href="${esc(svgDataUrl(el.svg, el.color))}"/>`;
      case 'image':
        return imageBody(el);
      case 'text':
        return textBody(el);
      default:
        return '';
    }
  }

  function imageBody(el) {
    const w = el.w;
    const h = el.h;
    const src = images[el.imageId];
    const out = [];
    const mask = maskGeometry(el.mask, w, h);
    const boxId = id('c');
    const r = Math.min(el.radius || 0, w / 2, h / 2);
    defs.push(`<clipPath id="${boxId}"><rect width="${num(w)}" height="${num(h)}"${r ? ` rx="${num(r)}"` : ''}/></clipPath>`);
    if (src) {
      const c = normalizeCrop(el.crop);
      const vw = 1 - c.l - c.r;
      const vh = 1 - c.t - c.b;
      const iw = w / vw;
      const ih = h / vh;
      const ix = (-c.l / vw) * w;
      const iy = (-c.t / vh) * h;
      let attrs = '';
      if (el.flipX || el.flipY) {
        const cx = ix + iw / 2;
        const cy = iy + ih / 2;
        attrs += ` transform="translate(${num(cx)} ${num(cy)}) scale(${el.flipX ? -1 : 1} ${el.flipY ? -1 : 1}) translate(${num(-cx)} ${num(-cy)})"`;
      }
      const prims = adjustPrimitives(el.adjust);
      if (prims) {
        const fid = id('f');
        defs.push(`<filter id="${fid}" filterUnits="userSpaceOnUse" x="${num(ix)}" y="${num(iy)}" width="${num(iw)}" height="${num(ih)}" color-interpolation-filters="sRGB">${prims}</filter>`);
        attrs += ` filter="url(#${fid})"`;
      }
      out.push(`<g clip-path="url(#${boxId})"><image x="${num(ix)}" y="${num(iy)}" width="${num(iw)}" height="${num(ih)}" preserveAspectRatio="none" href="${esc(src)}"${attrs}/></g>`);
    } else {
      missingImages += 1;
    }
    const sw = el.stroke && el.strokeWidth ? el.strokeWidth : 0;
    if (sw) out.push(`<rect x="${num(sw / 2)}" y="${num(sw / 2)}" width="${num(Math.max(0, w - sw))}" height="${num(Math.max(0, h - sw))}"${r ? ` rx="${num(Math.max(0, r - sw / 2))}"` : ''} fill="none"${strokeAttrs(el)}/>`);
    if (!mask) return out.join('');
    const maskId = id('c');
    defs.push(`<clipPath id="${maskId}">${mask}</clipPath>`);
    return `<g clip-path="url(#${maskId})">${out.join('')}</g>`;
  }

  function textBody(el) {
    const m = measure ? measure(el) : { width: (s) => s.length * el.size * 0.5, ascent: el.size * 0.8, descent: el.size * 0.2 };
    const lines = layoutText(el, m.width);
    const size = el.size;
    const lh = (el.lineHeight || 1.25) * size;
    const half = (lh - (m.ascent + m.descent)) / 2;
    const pad = el.highlight && !el.gradient ? size * 0.12 : 0;
    const fill = el.gradient ? fillOf(el.color, el.gradient, el.w, el.h)
      : el.hollow ? 'none' : esc(el.color || '#000000');
    const outline = el.outline || (el.hollow ? { color: el.color, width: Math.max(1, Math.round(size / 30)) } : null);
    let stroke = '';
    if (outline && outline.width) {
      stroke = ` stroke="${esc(el.hollow ? el.color : outline.color)}" stroke-width="${num(outline.width)}" stroke-linejoin="round" paint-order="stroke fill"`;
    }
    const style = [
      `font-family:${fontStack(el.font)}`,
      `font-size:${num(size)}px`,
      `font-weight:${el.weight || 400}`,
      `font-style:${el.italic ? 'italic' : 'normal'}`,
      el.letterSpacing ? `letter-spacing:${num(el.letterSpacing)}px` : '',
      'white-space:pre',
    ].filter(Boolean).join(';');
    const marks = [];
    const runs = [];
    lines.forEach((ln, i) => {
      if (!ln.text) return;
      const top = i * lh;
      const base = top + half + m.ascent;
      const lw = ln.width + pad * 2;
      let x0 = 0;
      if (el.align === 'center') x0 = (el.w - lw) / 2;
      else if (el.align === 'right') x0 = el.w - lw;
      if (pad) marks.push(`<rect x="${num(x0)}" y="${num(base - m.ascent)}" width="${num(lw)}" height="${num(m.ascent + m.descent)}" fill="${esc(el.highlight)}"/>`);
      const decoW = el.align === 'justify' && !ln.last ? el.w - pad * 2 : ln.width;
      const thick = Math.max(1, size / 15);
      if (el.underline) marks.push(`<rect x="${num(x0 + pad)}" y="${num(base + size * 0.08)}" width="${num(decoW)}" height="${num(thick)}" fill="${fill}"/>`);
      if (el.strike) marks.push(`<rect x="${num(x0 + pad)}" y="${num(base - size * 0.3)}" width="${num(decoW)}" height="${num(thick)}" fill="${fill}"/>`);
      if (el.align === 'justify' && !ln.last && ln.text.includes(' ')) {
        const words = ln.text.split(/ +/);
        const spacing = el.letterSpacing || 0;
        const widths = words.map((wd) => m.width(wd) + spacing * [...wd].length);
        const gap = (el.w - widths.reduce((a, b) => a + b, 0)) / (words.length - 1);
        let x = x0 + pad; // the runs start where the glyphs do, inside the highlight pad
        words.forEach((wd, j) => {
          runs.push(`<tspan x="${num(x)}" y="${num(base)}">${esc(wd)}</tspan>`);
          x += widths[j] + gap;
        });
      } else {
        runs.push(`<tspan x="${num(x0 + pad)}" y="${num(base)}">${esc(ln.text)}</tspan>`);
      }
    });
    if (!runs.length) return marks.join('');
    let text = `<text style="${esc(style)}" fill="${fill}"${stroke}>${runs.join('')}</text>`;
    if (el.shadow) {
      const fid = shadowFilter(el.shadow, el.w, Math.max(el.h, lines.length * lh), size);
      text = `<g filter="url(#${fid})">${text}</g>`;
    }
    return marks.join('') + text;
  }

  function drawElement(el) {
    const parts = [`translate(${num(el.x)} ${num(el.y)})`];
    if (el.rotation) parts.push(`rotate(${num(el.rotation)} ${num(el.w / 2)} ${num(el.h / 2)})`);
    let attrs = ` transform="${parts.join(' ')}"`;
    if (el.opacity != null && el.opacity < 1) attrs += ` opacity="${num(Math.max(0, el.opacity))}"`;
    if (el.shadow && el.type !== 'text') attrs += ` filter="url(#${shadowFilter(el.shadow, el.w, el.h, el.strokeWidth || 0)})"`;
    return `<g${attrs}>${body(el)}</g>`;
  }

  // Background: colour, gradient and pattern, carried into the bleed.
  const W = page.width;
  const H = page.height;
  const bg = [];
  if (!transparent) {
    const box = `x="${num(-bleed)}" y="${num(-bleed)}" width="${num(W + bleed * 2)}" height="${num(H + bleed * 2)}"`;
    bg.push(`<rect ${box} fill="${esc(page.background || '#ffffff')}"/>`);
    if (page.gradient) bg.push(`<rect ${box} fill="${fillOf(page.background, page.gradient, W, H)}"/>`);
    if (page.pattern && page.pattern.svg) {
      const pid = id('p');
      const s = page.pattern.size || 40;
      defs.push(`<pattern id="${pid}" patternUnits="userSpaceOnUse" width="${num(s)}" height="${num(s)}"><image width="${num(s)}" height="${num(s)}" preserveAspectRatio="none" href="${esc(svgDataUrl(page.pattern.svg))}"/></pattern>`);
      bg.push(`<rect ${box} fill="url(#${pid})"/>`);
    }
  }
  const content = page.elements.map(drawElement).join('');
  const clipId = id('c');
  defs.unshift(`<clipPath id="${clipId}"><rect x="${num(-bleed)}" y="${num(-bleed)}" width="${num(W + bleed * 2)}" height="${num(H + bleed * 2)}"/></clipPath>`);
  const outW = (W + bleed * 2) * scale;
  const outH = (H + bleed * 2) * scale;
  const style = fontCss ? `<style><![CDATA[${fontCss.replace(/]]>/g, '')}]]></style>` : '';
  const svg = '<?xml version="1.0" encoding="UTF-8"?>\n'
    + `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${num(outW)}" height="${num(outH)}" viewBox="${num(-bleed)} ${num(-bleed)} ${num(W + bleed * 2)} ${num(H + bleed * 2)}">`
    + `<title>${esc(page.name || 'Page')}</title>`
    + `<defs>${style}${defs.join('')}</defs>`
    + `<g clip-path="url(#${clipId})">${bg.join('')}${content}</g></svg>`;
  return { svg, width: outW, height: outH, missingImages };
}

