// The visible viewport: the part of the window a phone actually shows,
// which shrinks when the on-screen keyboard opens and grows again when the
// browser's bars slide away. CSS reads --vvh (its height) and --vv-top (a
// pixel offset from the top of the layout viewport) to size the dialogs;
// keepCentre and revealDelta are the plain maths the canvas and text
// editing use, kept free of the DOM so they can be tested on their own.

import { useEffect } from 'react';

// The view a resize keeps the same point of: the page point under the
// middle of the canvas stays under it when the canvas's width changes.
export function keepCentre(view, prev, next) {
  return {
    x: view.x + (next.w - prev.w) / 2,
    y: view.y + (next.h - prev.h) / 2,
  };
}

// How far to scroll (positive scrolls the page down) to put `rect` inside
// the visible band `[top + margin, bottom - margin]`. The rect's bottom is
// preferred, since that is the line the caret is on while typing. Returns
// 0 when the rect is already inside.
export function revealDelta(rect, visible, margin = 16) {
  const top = visible.top + margin;
  const bottom = visible.bottom - margin;
  if (rect.bottom > bottom) return rect.bottom - bottom;
  if (rect.top < top) return rect.top - top;
  return 0;
}

// Publish the visual viewport's height and top offset as CSS custom
// properties. Browsers without visualViewport do nothing, and the
// stylesheet's own fallbacks apply.
export function useVisualViewport() {
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!vv) return undefined;
    const root = document.documentElement;
    let frame = 0;
    const apply = () => {
      frame = 0;
      root.style.setProperty('--vvh', vv.height + 'px');
      root.style.setProperty('--vv-top', vv.offsetTop + 'px');
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };
    apply();
    vv.addEventListener('resize', schedule);
    vv.addEventListener('scroll', schedule);
    return () => {
      vv.removeEventListener('resize', schedule);
      vv.removeEventListener('scroll', schedule);
      if (frame) cancelAnimationFrame(frame);
      root.style.removeProperty('--vvh');
      root.style.removeProperty('--vv-top');
    };
  }, []);
}
