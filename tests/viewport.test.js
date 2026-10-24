// The visible viewport: keeping the canvas centre on a width change, and
// how far to scroll so the text being typed sits above the keyboard.

import { describe, it, expect } from 'vitest';
import { keepCentre, revealDelta } from '../web/src/ui/viewport.js';

describe('keepCentre', () => {
  it('keeps the centred page point centred when the phone turns', () => {
    const view = { x: 40, y: 30 };
    const next = keepCentre(view, { w: 390, h: 430 }, { w: 844, h: 214 });
    expect(next).toEqual({ x: 40 + (844 - 390) / 2, y: 30 + (214 - 430) / 2 });
    // The page point that was in the middle is still in the middle.
    const before = { x: (390 / 2 - view.x), y: (430 / 2 - view.y) };
    const after = { x: (844 / 2 - next.x), y: (214 / 2 - next.y) };
    expect(after).toEqual(before);
  });

  it('leaves the view alone when the size does not change', () => {
    expect(keepCentre({ x: 7, y: -3 }, { w: 390, h: 430 }, { w: 390, h: 430 })).toEqual({ x: 7, y: -3 });
  });
});

describe('revealDelta', () => {
  const visible = { top: 0, bottom: 500 };

  it('asks for no scroll when the rect is already visible', () => {
    expect(revealDelta({ top: 100, bottom: 140 }, visible)).toBe(0);
  });

  it('scrolls down to bring a rect hidden by the keyboard into view', () => {
    expect(revealDelta({ top: 620, bottom: 660 }, visible)).toBe(660 - (500 - 16));
  });

  it('scrolls up for a rect above the visible area', () => {
    expect(revealDelta({ top: -40, bottom: 10 }, visible)).toBe(-40 - (0 + 16));
  });

  it('aligns the bottom of a rect taller than the visible area', () => {
    expect(revealDelta({ top: 10, bottom: 800 }, visible)).toBe(800 - (500 - 16));
  });

  it('respects the margin it is given', () => {
    expect(revealDelta({ top: 10, bottom: 490 }, visible, 24)).toBe(490 - (500 - 24));
  });
});
