// One serialiser feeds every export: the page model as a standalone SVG
// string. Pure — no DOM — so tests can parse the output with xmldom.
// PNG, JPEG and PDF rasterise this; SVG downloads it directly.

import { SHAPES, dashArray, normalizeCrop, MASKS, hexToRgba } from '../doc/style.js';
import { fontStack } from '../assets/fonts.js';
import { svgDataUrl } from '../assets/svg.js';
import { wrapLines } from './textLayout.js';

const n = (v) => Math.round((Number(v) || 0) * 100) / 100;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const attr = (k, v) => ` ${k}="${esc(v)}"`;

// The @font-face CSS for the families this design uses, embedded in the file.
function styleTag(fontCss) {
  return fontCss ? `<style>${fontCss}</style>` : '';
}

function gradientDef(id, el, fromAttr) {
  const g = el.gradient;
  if (!g) return '';
  const from = el[fromAttr];
  const to = g.to || from;
  if (g.kind === 'radial') {
    return `<radialGradient id="${id}"><stop offset="0" stop-color="${esc(from)}"/><stop offset="1" stop-color="${esc(to)}"/></radialGradient>`;
  }
  const a = ((g.angle ?? 90) - 90) * (Math.PI / 180);
  const x2 = n(0.5 + Math.cos(a) / 2), y2 = n(0.5 + Math.sin(a) / 2);
  return `<linearGradient id="${id}" x1="${n(1 - x2)}" y1="${n(1 - y2)}" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="${esc(from)}"/><stop offset="1" stop-color="${esc(to)}"/></linearGradient>`;
}

function shadowDef(id, shadow) {
  if (!shadow) return '';
  const color = hexToRgba(shadow.color, shadow.alpha ?? 0.35);
  return `<filter id="${id}" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="${n(shadow.x || 0)}" dy="${n(shadow.y || 0)}" stdDeviation="${n((shadow.blur || 0) / 2)}" flood-color="${esc(color)}"/></filter>`;
}

// The colour adjustments an image element carries, as an SVG filter.
function adjustDef(id, adjust) {
  if (!adjust) return '';
  const a = adjust;
  const parts = [];
  if (a.brightness != null && a.brightness !== 100) {
    parts.push(`<feComponentTransfer><feFuncR type="linear" slope="${n(a.brightness / 100)}"/><feFuncG type="linear" slope="${n(a.brightness / 100)}"/><feFuncB type="linear" slope="${n(a.brightness / 100)}"/></feComponentTransfer>`);
  }
  if (a.contrast != null && a.contrast !== 100) {
    const i = n(a.contrast / 100);
    parts.push(`<feComponentTransfer><feFuncR type="linear" slope="${i}" intercept="${n(0.5 - 0.5 * i)}"/><feFuncG type="linear" slope="${i}" intercept="${n(0.5 - 0.5 * i)}"/><feFuncB type="linear" slope="${i}" intercept="${n(0.5 - 0.5 * i)}"/></feComponentTransfer>`);
  }
  if (a.saturate != null && a.saturate !== 100) parts.push(`<feColorMatrix type="saturate" values="${n(a.saturate / 100)}"/>`);
  if (a.hue) parts.push(`<feColorMatrix type="hueRotate" values="${n(a.hue)}"/>`);
  if (a.grayscale) parts.push(`<feColorMatrix type="saturate" values="0"/>`);
  if (a.sepia) parts.push(`<feColorMatrix type="matrix" values="${sepiaMatrix(a.sepia / 100)}"/>`);
  if (a.blur) parts.push(`<feGaussianBlur stdDeviation="${n(a.blur)}"/>`);
  return parts.length ? `<filter id="${id}">${parts.join('')}</filter>` : '';
}

function sepiaMatrix(t) {
  const mix = (r, g, b) => n(r * (1 - t) + 0.393 * t) + ' ' + n(g * (1 - t) + 0.769 * t) + ' ' + n(b * (1 - t) + 0.189 * t) + ' 0 0';
  return [mix(1, 0, 0), mix(0, 1, 0), mix(0, 0, 1), '0 0 0 1 0'].join(' ');
}

function maskClip(id, maskKey, radius) {
  if (!maskKey || maskKey === 'none') return '';
  if (maskKey === 'rounded' && radius) {
    return `<clipPath id="${id}"><rect x="0" y="0" width="100" height="100" rx="${n(radius / 10)}"/></clipPath>`;
  }
  const clip = MASKS[maskKey] && MASKS[maskKey].clip;
  if (!clip) return '';
  if (maskKey === 'circle') return `<clipPath id="${id}"><ellipse cx="50" cy="50" rx="50" ry="50"/></clipPath>`;
  if (maskKey === 'rounded') return `<clipPath id="${id}"><rect x="0" y="0" width="100" height="100" rx="12"/></clipPath>`;
  if (maskKey === 'arch') return `<clipPath id="${id}"><path d="M0 0 H100 V100 H0 Z M0 50 A50 50 0 0 1 100 50 V100 H0 Z"/></clipPath>`;
  const d = clip.replace(/polygon\(|\)/g, '').trim();
  return `<clipPath id="${id}" clipPathUnits="objectBoundingBox"><polygon points="${d}"/></clipPath>`;
}

// One element as SVG. `defs` collects gradient/clip/filter definitions;
// `pid` prefixes every id so elements never collide.
function elementSvg(el, pid, defs, images, measure, transparentPage) {
  if (el.type === 'group') {
    const rot = el.rotation ? ` rotate(${n(el.rotation)} ${n(el.w / 2)} ${n(el.h / 2)})` : '';
    const inner = el.children.map((c, i) => elementSvg(c, pid + 'c' + i, defs, images, measure, transparentPage)).join('');
    return `<g transform="translate(${n(el.x)} ${n(el.y)})${rot}"${el.opacity != null && el.opacity < 1 ? attr('opacity', el.opacity) : ''}>${inner}</g>`;
  }
  const at = [];
  if (el.opacity != null && el.opacity < 1) at.push(attr('opacity', el.opacity));
  if (el.rotation) at.push(` transform="rotate(${n(el.rotation)} ${n(el.x + el.w / 2)} ${n(el.y + el.h / 2)})"`);
  const shadowId = el.shadow ? `${pid}-sh` : '';
  if (el.shadow) { defs.push(shadowDef(`${pid}-sh`, el.shadow)); at.push(` filter="url(#${pid}-sh)"`); }

  if (el.type === 'rect') {
    let fill = el.fill || 'none';
    if (el.gradient) { defs.push(gradientDef(`${pid}-g`, el, 'fill')); fill = `url(#${pid}-g)`; }
    const stroke = el.stroke && el.strokeWidth
      ? ` stroke="${esc(el.stroke)}" stroke-width="${n(el.strokeWidth)}"${dashArray(el.strokeStyle, el.strokeWidth) ? ` stroke-dasharray="${dashArray(el.strokeStyle, el.strokeWidth)}"` : ''}`
      : '';
    return `<rect x="${n(el.x)}" y="${n(el.y)}" width="${n(el.w)}" height="${n(el.h)}" rx="${n(el.radius || 0)}" fill="${esc(fill)}"${stroke}${at.join('')}/>`;
  }
  if (el.type === 'ellipse') {
    let fill = el.fill || 'none';
    if (el.gradient) { defs.push(gradientDef(`${pid}-g`, el, 'fill')); fill = `url(#${pid}-g)`; }
    const stroke = el.stroke && el.strokeWidth
      ? ` stroke="${esc(el.stroke)}" stroke-width="${n(el.strokeWidth)}"${dashArray(el.strokeStyle, el.strokeWidth) ? ` stroke-dasharray="${dashArray(el.strokeStyle, el.strokeWidth)}"` : ''}`
      : '';
    return `<ellipse cx="${n(el.x + el.w / 2)}" cy="${n(el.y + el.h / 2)}" rx="${n(el.w / 2)}" ry="${n(el.h / 2)}" fill="${esc(fill)}"${stroke}${at.join('')}/>`;
  }
  if (el.type === 'line') {
    return `<line x1="${n(el.x)}" y1="${n(el.y)}" x2="${n(el.x + el.w)}" y2="${n(el.y + el.h)}" stroke="${esc(el.stroke)}" stroke-width="${n(el.strokeWidth || 2)}" stroke-linecap="round"${at.join('')}/>`;
  }
  if (el.type === 'shape') {
    const d = SHAPES[el.shape] ? SHAPES[el.shape].d : SHAPES.star.d;
    let fill = el.fill || 'none';
    if (el.gradient) { defs.push(gradientDef(`${pid}-g`, el, 'fill')); fill = `url(#${pid}-g)`; }
    const stroke = el.stroke && el.strokeWidth
      ? ` stroke="${esc(el.stroke)}" stroke-width="${n(el.strokeWidth)}"${dashArray(el.strokeStyle, el.strokeWidth) ? ` stroke-dasharray="${dashArray(el.strokeStyle, el.strokeWidth)}"` : ''}`
      : '';
    return `<svg x="${n(el.x)}" y="${n(el.y)}" width="${n(el.w)}" height="${n(el.h)}" viewBox="0 0 100 100" preserveAspectRatio="none"><path d="${d}" fill="${esc(fill)}"${stroke} vector-effect="non-scaling-stroke"/></svg>`;
  }
  if (el.type === 'svg') {
    return `<image x="${n(el.x)}" y="${n(el.y)}" width="${n(el.w)}" height="${n(el.h)}" href="${esc(svgDataUrl(el.svg, el.color))}" preserveAspectRatio="none"${at.join('')}/>`;
  }
  if (el.type === 'image') {
    const href = images && images[el.imageId] ? images[el.imageId] : '';
    if (!href) return '';
    const c = normalizeCrop(el.crop);
    const vw = 1 - c.l - c.r, vh = 1 - c.t - c.b;
    const iw = n(el.w / vw), ih = n(el.h / vh);
    const ix = n(el.x - c.l * iw), iy = n(el.y - c.t * ih);
    const flip = (el.flipX ? ' scale(-1,1)' : '') + (el.flipY ? ' scale(1,-1)' : '');
    const flipOrigin = flip ? ` transform="translate(${n(el.x + (el.flipX ? el.w : 0))} ${n(el.y + (el.flipY ? el.h : 0))})${flip} translate(${n(-(el.x + (el.flipX ? el.w : 0)))} ${n(-(el.y + (el.flipY ? el.h : 0)))})"` : '';
    let img = `<image href="${esc(href)}" x="${ix}" y="${iy}" width="${iw}" height="${ih}" preserveAspectRatio="none"${flipOrigin}/>`;
    if (el.mask && el.mask !== 'none') {
      defs.push(maskClip(`${pid}-m`, el.mask, el.radius));
      img = `<g clip-path="url(#${pid}-m)">${img}</g>`;
    } else if (el.radius) {
      const r = Math.min(el.radius, el.w / 2, el.h / 2);
      img = `<g clip-path="url(#${pid}-r)">${img}</g>`;
      defs.push(`<clipPath id="${pid}-r"><rect x="${n(el.x)}" y="${n(el.y)}" width="${n(el.w)}" height="${n(el.h)}" rx="${n(r)}"/></clipPath>`);
    }
    if (el.adjust) {
      defs.push(adjustDef(`${pid}-a`, el.adjust));
      img = `<g filter="url(#${pid}-a)">${img}</g>`;
    }
    const border = el.stroke && el.strokeWidth
      ? `<rect x="${n(el.x + el.strokeWidth / 2)}" y="${n(el.y + el.strokeWidth / 2)}" width="${n(Math.max(0, el.w - el.strokeWidth))}" height="${n(Math.max(0, el.h - el.strokeWidth))}" rx="${n(el.radius || 0)}" fill="none" stroke="${esc(el.stroke)}" stroke-width="${n(el.strokeWidth)}"${dashArray(el.strokeStyle, el.strokeWidth) ? ` stroke-dasharray="${dashArray(el.strokeStyle, el.strokeWidth)}"` : ''}/>`
      : '';
    return `<g${at.join('')}>${img}${border}</g>`;
  }
  if (el.type === 'text') {
    const lh = el.lineHeight || 1.25;
    const size = el.size;
    const families = fontStack(el.font);
    const caseText = (s) => (el.textCase === 'upper' ? s.toUpperCase() : el.textCase === 'lower' ? s.toLowerCase() : el.textCase === 'title'
      ? s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()) : s);
    const paragraphs = wrapLines({ ...el, _fontStack: families }, measure);
    const anchor = el.align === 'center' ? 'middle' : el.align === 'right' ? 'end' : 'start';
    const tx = el.align === 'center' ? el.x + el.w / 2 : el.align === 'right' ? el.x + el.w : el.x;
    const parts = [];
    let lineNo = 0;
    for (const lines of paragraphs) {
      for (const line of lines) {
        const baseY = el.y + size * lh * lineNo + size * 0.8;
        if (el.highlight) {
          parts.push(`<rect x="${n(el.x)}" y="${n(el.y + size * lh * lineNo + (lh - 1) * size * 0.15)}" width="${n(el.w)}" height="${n(size * lh)}" fill="${esc(el.highlight)}"/>`);
        }
        let fill = el.hollow ? 'none' : el.color;
        if (el.gradient) { defs.push(gradientDef(`${pid}-g`, { gradient: el.gradient, color: el.color }, 'color')); fill = `url(#${pid}-g)`; }
        const outline = el.outline || (el.hollow ? { color: el.color, width: Math.max(1, Math.round(size / 30)) } : null);
        const strokeAttr = outline && outline.width
          ? ` stroke="${esc(el.hollow ? el.color : outline.color)}" stroke-width="${n(outline.width * 2)}" paint-order="stroke fill" stroke-linejoin="round"`
          : '';
        const deco = el.underline || el.strike
          ? ` text-decoration="${el.underline && el.strike ? 'underline line-through' : el.underline ? 'underline' : 'line-through'}"`
          : '';
        const spacing = el.letterSpacing ? ` letter-spacing="${n(el.letterSpacing)}"` : '';
        const just = el.align === 'justify' && lineNo < paragraphs.reduce((a, p) => a + p.length, 0) - 1
          ? ` textLength="${n(el.w)}" lengthAdjust="spacingAndGlyphs"` : '';
        parts.push(`<text x="${n(tx)}" y="${n(baseY)}" fill="${esc(fill)}" font-family="${esc(families)}" font-size="${n(size)}" font-weight="${n(el.weight || 400)}"${el.italic ? ' font-style="italic"' : ''} text-anchor="${anchor}"${deco}${spacing}${strokeAttr}${just}>${esc(caseText(line))}</text>`);
        lineNo += 1;
      }
    }
    return `<g${at.join('')}>${parts.join('')}</g>`;
  }
  return '';
}

// The whole page as SVG. `scale` scales the canvas (viewBox stays in page
// units); `transparent` leaves the background out; `images` maps imageId to
// a data URL; `fontCss` is the @font-face block to embed;
// `measure(el, text)` returns a text width (canvas in the browser, a stub in
// tests).
export function pageToSvg(page, { scale = 1, transparent = false, images = {}, fontCss = '', measure = () => 0 } = {}) {
  const defs = [];
  const body = [];
  if (!transparent) {
    if (page.pattern && page.pattern.svg) {
      const tileId = 'page-pattern';
      defs.push(`<pattern id="${tileId}" width="${n(page.pattern.size || 40)}" height="${n(page.pattern.size || 40)}" patternUnits="userSpaceOnUse"><image href="${esc(svgDataUrl(page.pattern.svg))}" width="${n(page.pattern.size || 40)}" height="${n(page.pattern.size || 40)}"/></pattern>`);
    }
    let bg = page.background || '#ffffff';
    let extra = '';
    if (page.pattern && page.pattern.svg) extra = ` fill="url(#page-pattern)"`;
    defs.push(gradientDef('page-bg', { gradient: page.gradient, color: bg }, 'color'));
    if (page.gradient) extra = ` fill="url(#page-bg)"${page.pattern ? '' : ''}`;
    if (!page.gradient && !page.pattern) extra = ` fill="${esc(bg)}"`;
    if (page.gradient && page.pattern) {
      // pattern tiles over the gradient: two rects
      body.push(`<rect x="0" y="0" width="${n(page.width)}" height="${n(page.height)}" fill="url(#page-bg)"/>`);
      extra = ` fill="url(#page-pattern)"`;
    }
    body.push(`<rect x="0" y="0" width="${n(page.width)}" height="${n(page.height)}"${extra}/>`);
  }
  page.elements.forEach((el, i) => {
    const s = elementSvg(el, 'e' + i, defs, images, measure, transparent);
    if (s) body.push(s);
  });
  const w = n(page.width * scale);
  const h = n(page.height * scale);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${n(page.width)} ${n(page.height)}">`
    + styleTag(fontCss)
    + (defs.length ? `<defs>${defs.join('')}</defs>` : '')
    + body.join('') + '</svg>';
}