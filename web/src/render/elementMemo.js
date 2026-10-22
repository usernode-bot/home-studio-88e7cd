// Whether a memoised element view may skip a re-render. `rev` repeats
// after undo and when a copy arrives whole from the room, so equal
// revisions also require the edit time `touch()` stamps on every change:
// two different elements that both say rev 3 are two different drawings.

export function sameElementView(a, b) {
  return a === b || (a.rev === b.rev && a.updatedAt === b.updatedAt);
}