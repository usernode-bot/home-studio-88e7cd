// The on-screen keyboard and the visible band of the screen, for the one
// place the keyboard meets the app: a text element being edited on the
// canvas. On Android Chrome the layout viewport shrinks for the keyboard
// (interactive-widget=resizes-content in the shell) and the fixed app
// shell reflows on its own; on iOS Safari the layout viewport keeps its
// size and only the *visual* viewport does, so the canvas pans instead.
// Everything here is CSS pixels in layout-viewport coordinates: what
// getBoundingClientRect reports.

import { useEffect, useState } from 'react';

// How much of the bottom of the screen the on-screen keyboard covers, or
// 0 when it does not — no keyboard, or a browser without the
// visualViewport API. The keyboard never covers a fixed region of the
// page (the user can scroll under it), so this is only a "is a keyboard
// showing" measure; keeping an element visible means keeping it inside
// the visible band below.
export function keyboardInset(vp, innerHeight) {
  if (!vp || !(vp.height > 0)) return 0;
  return Math.max(0, innerHeight - (vp.height + vp.offsetTop));
}

// The band of the layout viewport the user can actually see — what the
// keyboard and any browser chrome leave of it. An element is on screen
// exactly when it meets this band. Without the visualViewport API the
// whole layout viewport is the band.
export function visibleBand(vp, innerHeight) {
  if (!vp || !(vp.height > 0)) return { top: 0, bottom: innerHeight };
  return { top: vp.offsetTop, bottom: vp.offsetTop + vp.height };
}

// How far the box sits outside the band, and which way: positive keeps
// its bottom at the band's bottom edge, negative raises its top to the
// band's top edge, 0 means it is already inside. The margin keeps a
// little of the box's surroundings on screen.
export function bandOverflow(box, band, margin = 8) {
  if (!box || box.bottom <= box.top) return 0;
  if (box.bottom > band.bottom - margin) return box.bottom - (band.bottom - margin);
  if (box.top < band.top + margin) return box.top - (band.top + margin);
  return 0;
}

// Metrics for the visible band, updated while `active` is true: a duck-
// typed stand-in for the VisualViewport (with the real one when the
// browser has it, and the full layout viewport when it does not), plus
// innerHeight. Listeners attach only while something needs them — the
// canvas while it is editing text — and are dropped otherwise.
export function useViewportMetrics(active) {
  const [metrics, setMetrics] = useState(null);
  useEffect(() => {
    if (!active) return undefined;
    const vv = window.visualViewport || null;
    const read = () => {
      const view = window.visualViewport;
      setMetrics(view
        ? { innerHeight: window.innerHeight, height: view.height, offsetTop: view.offsetTop }
        : { innerHeight: window.innerHeight, height: window.innerHeight, offsetTop: 0 });
    };
    read();
    window.addEventListener('resize', read);
    window.addEventListener('orientationchange', read);
    if (vv) {
      vv.addEventListener('resize', read);
      vv.addEventListener('scroll', read);
    }
    return () => {
      window.removeEventListener('resize', read);
      window.removeEventListener('orientationchange', read);
      if (vv) {
        vv.removeEventListener('resize', read);
        vv.removeEventListener('scroll', read);
      }
    };
  }, [active]);
  return metrics;
}
