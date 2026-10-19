// Undo/redo snapshots: one history entry per finished gesture or discrete
// change, never one per pointer move. Snapshots are deep clones of the
// whole document, so any shape of change undoes cleanly.

export const HISTORY_LIMIT = 100;

export const snapshot = (doc) => (doc ? structuredClone(doc) : null);

export function pushPast(past, before) {
  return [...past, before].slice(-HISTORY_LIMIT);
}

export function undo({ past, future, doc }) {
  if (!past.length) return null;
  const nextPast = past.slice(0, -1);
  return { doc: past[past.length - 1], past: nextPast, future: [doc, ...future].slice(0, HISTORY_LIMIT) };
}

export function redo({ past, future, doc }) {
  if (!future.length) return null;
  const [nextDoc, ...rest] = future;
  return { doc: nextDoc, past: [...past, doc].slice(-HISTORY_LIMIT), future: rest };
}
