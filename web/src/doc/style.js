// Styling: the pure functions that turn an element's style fields into CSS,
// and the presets the inspector offers. No DOM, no React.
//
// Style fields (all optional, so phase-1 designs render unchanged):
//   gradient  { kind: 'linear'|'radial', angle, to }   fill (or text colour) -> to
//   stroke, strokeWidth, strokeStyle 'solid'|'dashed'|'dotted'
//   shadow    { x, y, blur, color, alpha }
//   text:  italic, underline, strike, lineHeight, letterSpacing,
//          textCase 'none'|'upper'|'lower'|'title', outline { color, width },
//          hollow, highlight (a colour)
//   image: crop { l, t, r, b } (fractions trimmed off each edge), mask,
//          adjust { brightness, contrast, saturate, blur, grayscale, sepia, hue },
//          flipX, flipY, natW, natH

const HEX = /^#[0-9a-fA-F]{6}$/;
const HEX3 = /^#[0-9a-fA-F]{3}$/;

export function hexToRgba(hex, alpha = 1) {
  let h = hex || '';
  if (HEX3.test(h)) h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  if (!HEX.test(h)) return `rgba(0,0,0,${alpha})`;
  const n = parseInt(h.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export function gradientCss(from, g) {
  if (!g) return from;
  if (g.kind === 'radial') return `radial-gradient(circle at center, ${from}, ${g.to})`;
  return `linear-gradient(${g.angle ?? 90}deg, ${from}, ${g.to})`;
}

export const fillCss = (el) => gradientCss(el.fill, el.gradient);

export function borderCss(el) {
  if (!el.stroke || !el.strokeWidth) return undefined;
  return `${el.strokeWidth}px ${el.strokeStyle || 'solid'} ${el.stroke}`;
}

// SVG dash pattern for a stroke style at a width.
export function dashArray(style, width) {
  const w = Math.max(1, width || 1);
  if (style === 'dashed') return `${w * 3} ${w * 2}`;
  if (style === 'dotted') return `0 ${w * 2}`;
  return undefined;
}

export function shadowCss(s) {
  if (!s) return '';
  return `${s.x || 0}px ${s.y || 0}px ${s.blur || 0}px ${hexToRgba(s.color, s.alpha ?? 0.35)}`;
}

// ── Images ──────────────────────────────────────────────────────────────

export const ADJUST_DEFAULTS = { brightness: 100, contrast: 100, saturate: 100, blur: 0, grayscale: 0, sepia: 0, hue: 0 };
export const ADJUSTMENTS = [
  ['brightness', 'Brightness', 0, 200, '%'],
  ['contrast', 'Contrast', 0, 200, '%'],
  ['saturate', 'Saturation', 0, 200, '%'],
  ['sepia', 'Warmth', 0, 100, '%'],
  ['grayscale', 'Greyscale', 0, 100, '%'],
  ['hue', 'Hue', -180, 180, '°'],
  ['blur', 'Blur', 0, 20, 'px'],
];

export const FILTER_PRESETS = {
  original: { label: 'Original', adjust: {} },
  mono: { label: 'Mono', adjust: { grayscale: 100, contrast: 110 } },
  warm: { label: 'Warm', adjust: { sepia: 30, saturate: 120, brightness: 103 } },
  cool: { label: 'Cool', adjust: { hue: 12, saturate: 90, brightness: 104 } },
  vintage: { label: 'Vintage', adjust: { sepia: 45, contrast: 90, brightness: 106, saturate: 80 } },
  vivid: { label: 'Vivid', adjust: { saturate: 160, contrast: 115 } },
  fade: { label: 'Fade', adjust: { contrast: 80, brightness: 112, saturate: 70 } },
};

export function adjustFilter(adjust) {
  if (!adjust) return '';
  const a = { ...ADJUST_DEFAULTS, ...adjust };
  const parts = [];
  if (a.brightness !== 100) parts.push(`brightness(${a.brightness}%)`);
  if (a.contrast !== 100) parts.push(`contrast(${a.contrast}%)`);
  if (a.saturate !== 100) parts.push(`saturate(${a.saturate}%)`);
  if (a.sepia) parts.push(`sepia(${a.sepia}%)`);
  if (a.grayscale) parts.push(`grayscale(${a.grayscale}%)`);
  if (a.hue) parts.push(`hue-rotate(${a.hue}deg)`);
  if (a.blur) parts.push(`blur(${a.blur}px)`);
  return parts.join(' ');
}

export const CROP_MAX = 0.9; // at least a tenth of the image stays visible each way
export function normalizeCrop(crop) {
  const c = { l: 0, t: 0, r: 0, b: 0, ...(crop || {}) };
  for (const k of ['l', 't', 'r', 'b']) c[k] = Math.min(CROP_MAX, Math.max(0, Number(c[k]) || 0));
  if (c.l + c.r > CROP_MAX) c.r = CROP_MAX - c.l;
  if (c.t + c.b > CROP_MAX) c.b = CROP_MAX - c.t;
  return c;
}

// Where the whole image sits inside the element box so that only the
// cropped region shows (percentages of the box).
export function cropLayout(crop) {
  const c = normalizeCrop(crop);
  const vw = 1 - c.l - c.r;
  const vh = 1 - c.t - c.b;
  const pct = (n) => Math.round(n * 1e4) / 100 + '%';
  return { width: pct(1 / vw), height: pct(1 / vh), left: pct(-c.l / vw), top: pct(-c.t / vh) };
}

// The element height that keeps the cropped region undistorted at width w.
export function croppedHeight(el, crop) {
  if (!el.natW || !el.natH) return el.h;
  const c = normalizeCrop(crop);
  const visW = (1 - c.l - c.r) * el.natW;
  const visH = (1 - c.t - c.b) * el.natH;
  return Math.max(1, Math.round((el.w * visH) / visW));
}

export const MASKS = {
  none: { label: 'None', clip: undefined },
  circle: { label: 'Circle', clip: 'ellipse(50% 50% at 50% 50%)' },
  rounded: { label: 'Rounded', clip: 'inset(0 round 12%)' },
  arch: { label: 'Arch', clip: 'inset(0 round 50% 50% 0 0)' },
  triangle: { label: 'Triangle', clip: 'polygon(50% 0, 100% 100%, 0 100%)' },
  diamond: { label: 'Diamond', clip: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)' },
  hexagon: { label: 'Hexagon', clip: 'polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%)' },
  star: { label: 'Star', clip: 'polygon(50% 0, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)' },
};

// ── Shapes (drawn in a 100 × 100 box, stretched to the element) ─────────

export const SHAPES = {
  triangle: { label: 'Triangle', d: 'M50 2 L98 98 L2 98 Z' },
  'right-triangle': { label: 'Right triangle', d: 'M2 2 L98 98 L2 98 Z' },
  diamond: { label: 'Diamond', d: 'M50 2 L98 50 L50 98 L2 50 Z' },
  pentagon: { label: 'Pentagon', d: 'M50 2 L98 38 L80 98 L20 98 L2 38 Z' },
  hexagon: { label: 'Hexagon', d: 'M25 2 L75 2 L98 50 L75 98 L25 98 L2 50 Z' },
  star: { label: 'Star', d: 'M50 2 L61 37 L98 37 L68 59 L79 96 L50 73 L21 96 L32 59 L2 37 L39 37 Z' },
  heart: { label: 'Heart', d: 'M50 92 C20 70 2 52 2 30 C2 14 14 4 28 4 C38 4 46 10 50 18 C54 10 62 4 72 4 C86 4 98 14 98 30 C98 52 80 70 50 92 Z' },
  arrow: { label: 'Arrow', d: 'M2 35 L60 35 L60 10 L98 50 L60 90 L60 65 L2 65 Z' },
  plus: { label: 'Plus', d: 'M35 2 L65 2 L65 35 L98 35 L98 65 L65 65 L65 98 L35 98 L35 65 L2 65 L2 35 L35 35 Z' },
  bubble: { label: 'Speech bubble', d: 'M12 4 L88 4 Q98 4 98 14 L98 62 Q98 72 88 72 L42 72 L22 96 L26 72 L12 72 Q2 72 2 62 L2 14 Q2 4 12 4 Z' },
  badge: { label: 'Badge', d: 'M50 2 L62 12 L78 10 L82 26 L96 34 L90 50 L96 66 L82 74 L78 90 L62 88 L50 98 L38 88 L22 90 L18 74 L4 66 L10 50 L4 34 L18 26 L22 10 L38 12 Z' },
  blob: { label: 'Blob', d: 'M52 4 C76 2 98 18 96 46 C94 72 78 98 48 96 C20 94 2 76 4 50 C6 24 26 6 52 4 Z' },
};

// ── Text ────────────────────────────────────────────────────────────────

const CASE = { upper: 'uppercase', lower: 'lowercase', title: 'capitalize' };

export function textDecoration(el) {
  const parts = [];
  if (el.underline) parts.push('underline');
  if (el.strike) parts.push('line-through');
  return parts.length ? parts.join(' ') : 'none';
}

// Box styles for a text element (the outer box) and its inner span,
// where the colour, gradient, highlight and outline live.
export function textStyles(el, family) {
  const box = {
    fontFamily: family,
    fontSize: el.size,
    fontWeight: el.weight,
    fontStyle: el.italic ? 'italic' : 'normal',
    lineHeight: el.lineHeight || 1.25,
    letterSpacing: el.letterSpacing ? el.letterSpacing + 'px' : undefined,
    textAlign: el.align,
    textTransform: CASE[el.textCase] || 'none',
    textDecoration: textDecoration(el),
    color: el.color,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  };
  const span = {};
  if (el.gradient) {
    span.backgroundImage = gradientCss(el.color, el.gradient);
    span.WebkitBackgroundClip = 'text';
    span.backgroundClip = 'text';
    span.color = 'transparent';
  } else {
    span.color = el.hollow ? 'transparent' : el.color;
    if (el.highlight) {
      span.backgroundColor = el.highlight;
      span.boxDecorationBreak = 'clone';
      span.WebkitBoxDecorationBreak = 'clone';
      span.padding = '0 0.12em';
    }
  }
  const outline = el.outline || (el.hollow ? { color: el.color, width: Math.max(1, Math.round(el.size / 30)) } : null);
  if (outline && outline.width) {
    span.WebkitTextStroke = `${outline.width}px ${el.hollow ? el.color : outline.color}`;
    span.paintOrder = 'stroke fill';
  }
  if (el.shadow) span.textShadow = el.shadow.glow ? glowCss(el.shadow) : shadowCss(el.shadow);
  return { box, span };
}

function glowCss(s) {
  const blur = Math.max(0, s.blur || 0);
  const c = hexToRgba(s.color, s.alpha ?? 0.9);
  return `0 0 ${Math.round(blur / 3)}px ${c}, 0 0 ${blur}px ${c}`;
}

// One-tap text effects: each sets the effect fields it owns and clears
// the rest, so switching effects never leaves a stray outline behind.
const CLEAR = { shadow: null, outline: null, hollow: false, highlight: '' };
export const TEXT_EFFECTS = {
  none: { label: 'None', patch: () => ({ ...CLEAR }) },
  shadow: { label: 'Shadow', patch: () => ({ ...CLEAR, shadow: { x: 4, y: 4, blur: 0, color: '#000000', alpha: 0.35 } }) },
  lift: { label: 'Lift', patch: () => ({ ...CLEAR, shadow: { x: 0, y: 6, blur: 18, color: '#000000', alpha: 0.3 } }) },
  neon: { label: 'Neon', patch: (el) => ({ ...CLEAR, shadow: { x: 0, y: 0, blur: 24, color: el.color, alpha: 0.9, glow: true } }) },
  outline: { label: 'Outline', patch: () => ({ ...CLEAR, outline: { color: '#1c1917', width: 3 } }) },
  hollow: { label: 'Hollow', patch: () => ({ ...CLEAR, hollow: true }) },
  highlight: { label: 'Highlight', patch: () => ({ ...CLEAR, highlight: '#fde047' }) },
};

export function textEffectOf(el) {
  if (el.hollow) return 'hollow';
  if (el.highlight) return 'highlight';
  if (el.outline) return 'outline';
  if (el.shadow) return el.shadow.glow ? 'neon' : el.shadow.blur > 4 ? 'lift' : 'shadow';
  return 'none';
}

// Practical text styles: one tap sets a consistent size and weight.
export const TEXT_PRESETS = {
  heading: { label: 'Heading', patch: { size: 96, weight: 700, lineHeight: 1.1, letterSpacing: -1 } },
  subheading: { label: 'Subheading', patch: { size: 56, weight: 600, lineHeight: 1.2, letterSpacing: 0 } },
  body: { label: 'Body', patch: { size: 32, weight: 400, lineHeight: 1.45, letterSpacing: 0 } },
  caption: { label: 'Caption', patch: { size: 22, weight: 400, lineHeight: 1.35, letterSpacing: 0.5 } },
  label: { label: 'Label', patch: { size: 24, weight: 700, lineHeight: 1.2, letterSpacing: 3, textCase: 'upper' } },
};

export const FONT_WEIGHTS = [
  [100, 'Thin'], [300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold'], [900, 'Black'],
];

// The page's background: a colour, optionally a gradient and a pattern tile.
export function pageBackgroundStyle(page) {
  const layers = [];
  if (page.pattern && page.pattern.svg) {
    layers.push(`url("data:image/svg+xml,${encodeURIComponent(page.pattern.svg)}")`);
  }
  if (page.gradient) layers.push(gradientCss(page.background, page.gradient));
  const style = { backgroundColor: page.background };
  if (layers.length) {
    style.backgroundImage = layers.join(', ');
    if (page.pattern) style.backgroundSize = `${page.pattern.size}px ${page.pattern.size}px${page.gradient ? ', 100% 100%' : ''}`;
  }
  return style;
}
