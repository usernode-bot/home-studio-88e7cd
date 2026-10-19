// Alignment and distribution math, on axis-aligned bounding boxes
// (rotated elements included through their bounds).

export const ALIGN_MODES = ['left', 'hcenter', 'right', 'top', 'vmiddle', 'bottom'];

// mode on a set of boxes: with one box it lines that item up against
// `page`; with several it lines the selection's own edges up.
export function alignBoxes(boxes, page, mode) {
  const out = boxes.map((b) => ({ ...b }));
  if (out.length === 0) return out;
  if (out.length === 1) return alignToPage(out, page, mode);
  const first = out[0];
  const bounds = out.reduce(
    (acc, b) => ({
      x: Math.min(acc.x, b.x),
      y: Math.min(acc.y, b.y),
      r: Math.max(acc.r, b.x + b.w),
      b: Math.max(acc.b, b.y + b.h),
    }),
    { x: first.x, y: first.y, r: first.x + first.w, b: first.y + first.h }
  );
  for (const b of out) {
    if (mode === 'left') b.x = bounds.x;
    if (mode === 'hcenter') b.x = (bounds.x + bounds.r) / 2 - b.w / 2;
    if (mode === 'right') b.x = bounds.r - b.w;
    if (mode === 'top') b.y = bounds.y;
    if (mode === 'vmiddle') b.y = (bounds.y + bounds.b) / 2 - b.h / 2;
    if (mode === 'bottom') b.y = bounds.b - b.h;
  }
  return out;
}

export function alignToPage(boxes, page, mode) {
  const out = boxes.map((b) => ({ ...b }));
  for (const b of out) {
    if (mode === 'left') b.x = 0;
    if (mode === 'hcenter') b.x = page.width / 2 - b.w / 2;
    if (mode === 'right') b.x = page.width - b.w;
    if (mode === 'top') b.y = 0;
    if (mode === 'vmiddle') b.y = page.height / 2 - b.h / 2;
    if (mode === 'bottom') b.y = page.height - b.h;
  }
  return out;
}

// Equal gaps between the boxes along one axis. The first and last box stay
// where they are; the ones between are spaced evenly.
export function distributeBoxes(boxes, axis) {
  const out = boxes.map((b) => ({ ...b }));
  if (out.length < 3) return out;
  const key = axis === 'x' ? 'x' : 'y';
  const size = axis === 'x' ? 'w' : 'h';
  out.sort((a, b) => a[key] - b[key]);
  const first = out[0];
  const last = out[out.length - 1];
  const span = last[key] + last[size] - first[key];
  const totalSize = out.reduce((sum, b) => sum + b[size], 0);
  const gap = (span - totalSize) / (out.length - 1);
  let cursor = first[key];
  for (const b of out) {
    b[key] = cursor;
    cursor += b[size] + gap;
  }
  return out;
}
