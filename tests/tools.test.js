// Snapping, alignment, distribution and shortcut mapping.

import { describe, it, expect } from 'vitest';
import { snapMove } from '../web/src/tools/snap.js';
import { alignBoxes, alignToPage, distributeBoxes } from '../web/src/tools/align.js';
import { shortcutFor, arrowDelta } from '../web/src/tools/shortcuts.js';

const page = { width: 1000, height: 1000, guides: [{ id: 'g1', axis: 'v', pos: 400 }] };

describe('snap', () => {
  it('snaps an edge to the page edge within the threshold', () => {
    // 8 doc px off the left edge at zoom 1 (threshold 6) -> no snap;
    // 4 px off -> snap to 0.
    const far = snapMove(page, { x: 8, y: 0, w: 100, h: 50 }, [], 1, false);
    expect(far.dx).toBe(0);
    const near = snapMove(page, { x: 4, y: 0, w: 100, h: 50 }, [], 1, false);
    expect(near.dx).toBe(-4);
    expect(near.lines.some((l) => l.axis === 'v' && l.pos === 0)).toBe(true);
  });

  it('snaps to another element edge and to a guide', () => {
    const other = { x: 300, y: 200, w: 100, h: 100 };
    const r = snapMove(page, { x: 306, y: 0, w: 50, h: 50 }, [other], 1, false);
    expect(r.dx).toBe(-6); // moving left edge lands on other's left edge
    const toGuide = snapMove(page, { x: 396, y: 0, w: 50, h: 50 }, [], 1, false);
    expect(toGuide.dx).toBe(4);
    expect(toGuide.lines[0].pos).toBe(400);
  });

  it('keeps the threshold in screen pixels: higher zoom, smaller doc distance', () => {
    const atZoom10 = snapMove(page, { x: 5, y: 0, w: 100, h: 50 }, [], 10, false);
    expect(atZoom10.dx).toBe(0); // 5 doc px = 50 screen px at zoom 10: beyond 6 -> no snap
    const atZoom1 = snapMove(page, { x: 5, y: 0, w: 100, h: 50 }, [], 1, false);
    expect(atZoom1.dx).toBe(-5); // 5 screen px: within threshold
  });

  it('does not snap when free (Alt held)', () => {
    const r = snapMove(page, { x: 4, y: 4, w: 100, h: 50 }, [], 1, true);
    expect(r.dx).toBe(0);
    expect(r.lines).toEqual([]);
  });
});

describe('align', () => {
  it('aligns one element to the page', () => {
    const [out] = alignToPage([{ x: 10, y: 10, w: 100, h: 50 }], page, 'hcenter');
    expect(out.x).toBe(450);
    const [out2] = alignBoxes([{ x: 10, y: 10, w: 100, h: 50 }], page, 'bottom');
    expect(out2.y).toBe(950);
  });

  it('aligns several elements to the selection bounds', () => {
    const out = alignBoxes(
      [{ x: 0, y: 0, w: 50, h: 50 }, { x: 200, y: 300, w: 50, h: 50 }],
      page,
      'left'
    );
    expect(out[0].x).toBe(0);
    expect(out[1].x).toBe(0);
    expect(out[1].y).toBe(300); // vertical position untouched
  });

  it('distributes the boxes between with equal gaps', () => {
    const out = distributeBoxes(
      [{ x: 0, y: 0, w: 50, h: 50 }, { x: 200, y: 0, w: 50, h: 50 }, { x: 700, y: 0, w: 50, h: 50 }],
      'x'
    );
    expect(out[0].x).toBe(0);
    expect(out[2].x).toBe(700);
    // 750 total span, 150 of box sizes, two gaps of 300
    expect(out[1].x).toBe(350);
  });
});

describe('shortcuts', () => {
  const ev = (props) => ({ ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, key: '', ...props });
  const mod = (key, extra = {}) => ev({ ctrlKey: true, key, ...extra });

  it('maps the tool keys', () => {
    expect(shortcutFor(ev({ key: 'v' }))).toBe('tool:select');
    expect(shortcutFor(ev({ key: 't' }))).toBe('tool:text');
    expect(shortcutFor(ev({ key: 'r' }))).toBe('tool:rect');
    expect(shortcutFor(ev({ key: 'e' }))).toBe('tool:ellipse');
    expect(shortcutFor(ev({ key: 'l' }))).toBe('tool:line');
  });

  it('maps undo, redo, duplicate, group and select-all', () => {
    expect(shortcutFor(mod('z'))).toBe('undo');
    expect(shortcutFor(mod('z', { shiftKey: true }))).toBe('redo');
    expect(shortcutFor(mod('y'))).toBe('redo');
    expect(shortcutFor(mod('d'))).toBe('duplicate');
    expect(shortcutFor(mod('g'))).toBe('group');
    expect(shortcutFor(mod('g', { shiftKey: true }))).toBe('ungroup');
    expect(shortcutFor(mod('a'))).toBe('select-all');
  });

  it('maps zoom, delete, escape and arrows', () => {
    expect(shortcutFor(mod('+'))).toBe('zoom-in');
    expect(shortcutFor(mod('-'))).toBe('zoom-out');
    expect(shortcutFor(mod('0'))).toBe('zoom-reset');
    expect(shortcutFor(ev({ key: 'Delete' }))).toBe('delete');
    expect(shortcutFor(ev({ key: 'Escape' }))).toBe('escape');
    expect(arrowDelta(ev({ key: 'ArrowLeft' }))).toEqual({ dx: -1, dy: 0 });
    expect(arrowDelta(ev({ key: 'ArrowUp', shiftKey: true }))).toEqual({ dx: 0, dy: -10 });
  });
});
