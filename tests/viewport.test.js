// The keyboard/visible-band helpers the canvas uses to keep a text element
// being edited above the on-screen keyboard. Pure arithmetic: a duck-typed
// VisualViewport (height, offsetTop) and the layout viewport height in.

import { describe, it, expect } from 'vitest';
import { keyboardInset, visibleBand, bandOverflow } from '../web/src/ui/viewport.js';

describe('keyboardInset', () => {
  it('is 0 without a visual viewport (older browsers)', () => {
    expect(keyboardInset(null, 800)).toBe(0);
    expect(keyboardInset(undefined, 800)).toBe(0);
  });

  it('is 0 with no keyboard showing', () => {
    expect(keyboardInset({ height: 800, offsetTop: 0 }, 800)).toBe(0);
  });

  it('is the keyboard height when the visual viewport shrinks', () => {
    expect(keyboardInset({ height: 500, offsetTop: 0 }, 800)).toBe(300);
  });

  it('counts a panned-up visual viewport as fully visible, not keyboard', () => {
    // The user scrolled to the very bottom: the band bottom reaches the
    // layout viewport bottom, so nothing is counted as covered.
    expect(keyboardInset({ height: 500, offsetTop: 300 }, 800)).toBe(0);
    // Part-way panned: only the part below the band bottom counts.
    expect(keyboardInset({ height: 500, offsetTop: 100 }, 800)).toBe(200);
  });

  it('never reports a negative inset', () => {
    expect(keyboardInset({ height: 900, offsetTop: 0 }, 800)).toBe(0);
  });
});

describe('visibleBand', () => {
  it('is the whole layout viewport without a visual viewport', () => {
    expect(visibleBand(null, 800)).toEqual({ top: 0, bottom: 800 });
  });

  it('follows the visual viewport, panned or not', () => {
    expect(visibleBand({ height: 500, offsetTop: 0 }, 800)).toEqual({ top: 0, bottom: 500 });
    expect(visibleBand({ height: 500, offsetTop: 300 }, 800)).toEqual({ top: 300, bottom: 800 });
  });

  it('agrees with keyboardInset about what the keyboard leaves', () => {
    // No keyboard: the band fills the layout viewport.
    const full = { height: 800, offsetTop: 0 };
    expect(keyboardInset(full, 800)).toBe(0);
    expect(visibleBand(full, 800)).toEqual({ top: 0, bottom: 800 });
    // Keyboard up: the band is what it leaves, and the gap below it is
    // exactly the inset.
    const withKb = { height: 500, offsetTop: 0 };
    const band = visibleBand(withKb, 800);
    expect(keyboardInset(withKb, 800)).toBe(300);
    expect(band).toEqual({ top: 0, bottom: 500 });
    expect(800 - band.bottom).toBe(300);
  });
});

describe('bandOverflow', () => {
  const band = { top: 100, bottom: 500 };

  it('is 0 for a box already inside the band', () => {
    expect(bandOverflow({ top: 150, bottom: 300 }, band)).toBe(0);
    expect(bandOverflow(null, band)).toBe(0);
  });

  it('is positive by the overshoot when the box hangs under the band', () => {
    // 20px of the box below the band's bottom edge, minus the 8px margin.
    expect(bandOverflow({ top: 400, bottom: 528 }, band)).toBe(36);
  });

  it('is negative by the overshoot when the box sits above the band', () => {
    // The box top is 48px above the band's top edge plus its 8px margin.
    expect(bandOverflow({ top: 60, bottom: 200 }, band)).toBe(-48);
  });

  it('is 0 for an empty box', () => {
    expect(bandOverflow({ top: 300, bottom: 300 }, band)).toBe(0);
  });
});
