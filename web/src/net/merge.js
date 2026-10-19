// The reconnect merge: what happens when a peer comes back after a drop.
// While away, it kept editing its own copy; the session kept going. The
// session remembers which element ids each side deleted since the drop
// (tombstones), and the merge follows one rule: a deletion beats an edit,
// and everything else is unioned. When both sides edited the same
// element, the one edited most recently wins, per element. Pure, so it is
// testable without a network.

// mine / theirs: { doc, tombstones: Set of element ids }
// Returns a merged doc (a new object) and what changed. `conflicts` lists
// only the both-sides edits, so the app can say when a merge discards
// someone's work without also counting plain additions.
export function mergeDocs(mine, theirs) {
  const doc = structuredClone(mine.doc);
  const tombstones = new Set([...(mine.tombstones || []), ...(theirs.tombstones || [])]);
  const changed = [];
  const conflicts = [];
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
      if (contentOf(h) !== contentOf(e)) {
        // Edited on both sides: the element edited most recently wins, per
        // element, and we say so — no silent loss in either direction.
        const mineAt = h.updatedAt ?? mine.doc.updatedAt ?? 0;
        const theirsAt = e.updatedAt ?? theirs.doc.updatedAt ?? 0;
        if (theirsAt > mineAt) {
          byId.set(e.id, structuredClone(e));
          changed.push({ id: e.id, from: 'theirs' });
          conflicts.push({ id: e.id, from: 'theirs' });
        } else {
          changed.push({ id: e.id, from: 'mine' });
          conflicts.push({ id: e.id, from: 'mine' });
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
  return { doc, changed, conflicts };
}

const structureCloneSafe = (v) => JSON.parse(JSON.stringify(v));

// Two copies of one element differ as content or only as bookkeeping:
// `rev` is each device's render counter and `updatedAt` is the tie-breaker
// itself, so neither says anything about what the element looks like.
function contentOf(el) {
  const { rev, updatedAt, ...rest } = el;
  if (Array.isArray(rest.children)) rest.children = rest.children.map(contentOf);
  return JSON.stringify(rest);
}