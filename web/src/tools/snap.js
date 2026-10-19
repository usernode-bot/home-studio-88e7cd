// Pure snapping math: while a drag moves one or more elements, find the
// nearby edge/centre/guide lines that an edge or centre of the moving
// bounding box lines up with. All positions are page coordinates.
// The threshold is given in screen pixels and divided by the zoom,
// so the same finger distance means the same snap at any zoom.

export const SNAP_SCREEN_PX = 6;

export function snapMove(page, moving, others, zoom, free) {
  const threshold = SNAP_SCREEN_PX / (zoom || 1);
  const movingBox = moving; // {x,y,w,h} — rotated bounding box of the selection

  const xs = []; // candidate vertical lines {pos, label}
  const ys = [];
  const push = (list, pos, label) => {
    if (Number.isFinite(pos)) list.push({ pos, label });
  };

  // The page itself: edges and centre.
  push(xs, 0, '0');
  push(xs, page.width / 2, Math.round(page.width / 2));
  push(xs, page.width, String(page.width));
  push(ys, 0, '0');
  push(ys, page.height / 2, Math.round(page.height / 2));
  push(ys, page.height, String(page.height));

  // Standing guides.
  for (const g of page.guides || []) {
    if (g.axis === 'v') push(xs, g.pos, Math.round(g.pos));
    else push(ys, g.pos, Math.round(g.pos));
  }

  // Other elements' rotated bounding boxes: edges and centre.
  for (const o of others) {
    push(xs, o.x, Math.round(o.x));
    push(xs, o.x + o.w / 2, Math.round(o.x + o.w / 2));
    push(xs, o.x + o.w, Math.round(o.x + o.w));
    push(ys, o.y, Math.round(o.y));
    push(ys, o.y + o.h / 2, Math.round(o.y + o.h / 2));
    push(ys, o.y + o.h, Math.round(o.y + o.h));
  }

  const result = { dx: 0, dy: 0, lines: [] };
  if (free) return result; // Alt held: drag freely, no snapping.

  const movingXs = [movingBox.x, movingBox.x + movingBox.w / 2, movingBox.x + movingBox.w];
  const movingYs = [movingBox.y, movingBox.y + movingBox.h / 2, movingBox.y + movingBox.h];

  let bestX = null;
  let bestY = null;
  for (const mx of movingXs) {
    for (const c of xs) {
      const d = Math.abs(mx + result.dx - c.pos); // keep the best found so far in the race
      if (d <= threshold && (!bestX || d < bestX.d)) bestX = { d, mx, c };
    }
  }
  for (const my of movingYs) {
    for (const c of ys) {
      const d = Math.abs(my + result.dy - c.pos);
      if (d <= threshold && (!bestY || d < bestY.d)) bestY = { d, my, c };
    }
  }
  if (bestX) {
    result.dx = bestX.c.pos - bestX.mx;
    result.lines.push({ axis: 'v', pos: bestX.c.pos, label: 'X ' + bestX.c.label });
  }
  if (bestY) {
    result.dy = bestY.c.pos - bestY.my;
    result.lines.push({ axis: 'h', pos: bestY.c.pos, label: 'Y ' + bestY.c.label });
  }
  return result;
}
