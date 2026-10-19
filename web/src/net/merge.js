// The reconnect merge: what happens when a peer comes back after a drop.
// While away, it kept editing its own copy; the session kept going. The
// session remembers which element ids each side deleted since the drop
// (tombstones), and the merge follows one rule: a deletion beats an edit,
// and everything else is unioned. Pure, so it is testable without a network.

// mine / theirs: { doc, tombstones: Set of element ids }
// Returns a merged doc (a new object) and what changed.
export function mergeDocs(mine, theirs) {
  const doc = structuredClone(mine.doc);
  const tombstones = new Set([...(mine.tombstones || []), ...(theirs.tombstones || [])]);
  const changed = [];
  const theirPages = new Map(theirs.doc.pages.map((p) => [p.id, p]));
  for (const page of doc.pages) {
    const tp = theirPages.get(page.id);
    if (!tp) continue; // a page only this side has: kept
    const here = page.elements.filter((e) => !tombstones.has(e.id));
    const there = tp.elements.filter((e) => !tombstones.has(e.id) && !here.some((h) => h.id === e.id));
    for (const th of there) changed.push({ id: th.id, from: 'theirs' });
    const byId = new Map(here.map((e) => [e.id, e]));
    for (const e of tp.elements) {
      if (tombstones.has(e.id)) continue;
      const h = byId.get(e.id);
      if (!h) continue;
      if (JSON.stringify(h) !== JSON.stringify(e)) {
        // Edited on both sides: the doc updated most recently wins, per
        // element, and we say so — no silent loss in either direction.
        if ((theirs.doc.updatedAt || 0) > (mine.doc.updatedAt || 0)) {
          byId.set(e.id, structuredClone(e));
          changed.push({ id: e.id, from: 'theirs' });
        } else {
          changed.push({ id: e.id, from: 'mine' });
        }
      }
    }
    page.elements = [...byId.values(), ...there];
  }
  for (const tp of theirs.doc.pages) {
    if (!doc.pages.some((p) => p.id === tp.id)) {
      doc.pages.push(structureCloneSafe(tp));
      changed.push({ id: tp.id, from: 'theirs', page: true });
    }
  }
  doc.updatedAt = Date.now();
  return { doc, changed };
}

const structureCloneSafe = (v) => JSON.parse(JSON.stringify(v));