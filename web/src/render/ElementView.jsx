// One element drawn on the page: shapes, lines, text, images, SVG graphics
// and groups, with their fills, gradients, borders, shadows, text effects,
// crops, masks and filters. Used by the canvas and by the page previews in
// the library. Memoised on the element's content, so an edit to one
// element re-renders that element only.

import React, { memo, useMemo } from 'react';
import { fontStack } from '../assets/fonts.js';
import {
  fillCss, borderCss, dashArray, shadowCss, adjustFilter, cropLayout, MASKS, SHAPES, textStyles,
} from '../doc/style.js';
import { svgDataUrl } from '../assets/svg.js';

const dropShadow = (s) => (s ? `drop-shadow(${shadowCss(s)})` : undefined);

function ShapeSvg({ el }) {
  const gid = 'g-' + el.id;
  const g = el.gradient;
  return (
    <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ display: 'block', overflow: 'visible' }}>
      {g && (
        <defs>
          {g.kind === 'radial' ? (
            <radialGradient id={gid}><stop offset="0" stopColor={el.fill} /><stop offset="1" stopColor={g.to} /></radialGradient>
          ) : (
            <linearGradient id={gid} gradientTransform={`rotate(${(g.angle ?? 90) - 90} 0.5 0.5)`}>
              <stop offset="0" stopColor={el.fill} /><stop offset="1" stopColor={g.to} />
            </linearGradient>
          )}
        </defs>
      )}
      <path d={(SHAPES[el.shape] || SHAPES.star).d} fill={g ? `url(#${gid})` : el.fill || 'none'}
        stroke={el.stroke && el.strokeWidth ? el.stroke : 'none'} strokeWidth={el.strokeWidth || 0}
        strokeDasharray={dashArray(el.strokeStyle, el.strokeWidth)} strokeLinejoin="round" strokeLinecap="round"
        vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function ElementViewInner({ el, images, onPointerDown, onDoubleClick }) {
  const down = onPointerDown ? (e) => onPointerDown(e, el) : undefined;
  const dbl = onDoubleClick ? () => onDoubleClick(el) : undefined;
  const svgUrl = useMemo(() => (el.type === 'svg' && el.svg ? svgDataUrl(el.svg, el.color) : ''), [el.type, el.svg, el.color]);

  const base = {
    position: 'absolute',
    left: el.x,
    top: el.y,
    width: el.w,
    height: el.h,
    opacity: el.opacity,
    transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
    touchAction: 'none',
  };
  const common = { className: 'el', 'data-el': el.id, onPointerDown: down };

  if (el.type === 'group') {
    return (
      <div {...common} style={{ ...base, filter: dropShadow(el.shadow) }}>
        {el.children.map((c) => (
          <ElementView key={c.id} el={c} images={images} onPointerDown={onPointerDown} onDoubleClick={onDoubleClick} />
        ))}
      </div>
    );
  }
  if (el.type === 'rect' || el.type === 'ellipse') {
    return (
      <div {...common} style={{
        ...base, background: fillCss(el), border: borderCss(el), boxSizing: 'border-box',
        borderRadius: el.type === 'ellipse' ? '50%' : el.radius || 0, filter: dropShadow(el.shadow),
      }} />
    );
  }
  if (el.type === 'shape') {
    return <div {...common} style={{ ...base, filter: dropShadow(el.shadow) }}><ShapeSvg el={el} /></div>;
  }
  if (el.type === 'line') {
    return (
      <svg {...common} style={{ ...base, overflow: 'visible', filter: dropShadow(el.shadow) }}>
        <line x1={0} y1={0} x2={el.w} y2={el.h} stroke={el.stroke} strokeWidth={el.strokeWidth}
          strokeDasharray={dashArray(el.strokeStyle, el.strokeWidth)} strokeLinecap="round" />
      </svg>
    );
  }
  if (el.type === 'svg') {
    return (
      <div {...common} style={{ ...base, filter: dropShadow(el.shadow) }}>
        {svgUrl && <img src={svgUrl} alt="" draggable={false} decoding="async" style={{ display: 'block', width: '100%', height: '100%', pointerEvents: 'none' }} />}
      </div>
    );
  }
  if (el.type === 'image') {
    // Outer box: position, rotation, shadow. Inner box: mask, border, crop
    // window. The image itself: crop placement, flips and adjustments.
    const src = images ? images[el.imageId] : '';
    const crop = cropLayout(el.crop);
    const flip = el.flipX || el.flipY ? `scale(${el.flipX ? -1 : 1}, ${el.flipY ? -1 : 1})` : undefined;
    return (
      <div {...common} style={{ ...base, filter: dropShadow(el.shadow) }}>
        <div style={{
          position: 'absolute', inset: 0, overflow: 'hidden', clipPath: MASKS[el.mask]?.clip,
          border: borderCss(el), boxSizing: 'border-box', borderRadius: el.radius || 0, background: src ? undefined : 'rgb(var(--raised))',
        }}>
          {src && (
            <img src={src} alt={el.name} draggable={false} decoding="async" style={{
              position: 'absolute', maxWidth: 'none', ...crop, objectFit: 'fill', transform: flip,
              filter: adjustFilter(el.adjust) || undefined, pointerEvents: 'none',
            }} />
          )}
        </div>
      </div>
    );
  }
  // text
  const { box, span } = textStyles(el, fontStack(el.font));
  return (
    <div {...common} style={{ ...base, ...box }} onDoubleClick={dbl}>
      <span style={span}>{el.text}</span>
    </div>
  );
}

// Re-render only when what the element draws changes: the canvas clones
// the document on every edit, so identity alone says nothing.
const ElementView = memo(ElementViewInner, (a, b) =>
  a.onPointerDown === b.onPointerDown &&
  a.onDoubleClick === b.onDoubleClick &&
  (a.el === b.el || JSON.stringify(a.el) === JSON.stringify(b.el)) &&
  (a.images === b.images || !usesImages(a.el) || sameImages(a.el, a.images, b.images)));

function usesImages(el) {
  return el.type === 'image' || (el.type === 'group' && JSON.stringify(el.children).includes('"imageId"'));
}
function sameImages(el, x, y) {
  if (el.type === 'image') return (x || {})[el.imageId] === (y || {})[el.imageId];
  return x === y;
}

export default ElementView;
