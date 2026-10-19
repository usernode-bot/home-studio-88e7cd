// The collaboration protocol: the messages peers send each other, and the
// pure layer that turns them into document transforms and back. Everything
// that crosses the network goes through validateMessage(): a whitelist of
// known shapes with hard size caps, because a peer is untrusted — a
// malformed or oversized message is dropped, never applied.

import { uid, PAGE_MIN, PAGE_MAX } from '../doc/model.js';
import {
  addElements, removeElements, updateElements, moveElements, reorderElement,
  pageAdd, pageDelete, pageUpdate,
} from '../doc/store.js';

// ── Caps ─────────────────────────────────────────────────────────────────

export const CAPS = {
  frameBytes: 1024 * 1024, // one wire frame, ops and state snapshots alike
  opBytes: 512 * 1024, // one op message
  presenceBytes: 4 * 1024,
  elementsPerOp: 200,
  nameChars: 200,
  textChars: 20000,
};

// ── Ops: the ten transforms, minus the two identity-shaped ones ──────────
// t: 'add' | 'del' | 'set' | 'move' | 'ord' | 'pageAdd' | 'pageDel' | 'pageSet' | 'docSet'
// add: { els }  del: { ids }  set: { ids, patch }  move: { ids, dx, dy }
// ord: { ids } (the page's top-level order)  pageAdd: { page }
// pageDel: { pageId }  pageSet: { pageId, patch }  docSet: { patch }

export const OP_TYPES = ['add', 'del', 'set', 'move', 'ord', 'pageAdd', 'pageDel', 'pageSet', 'docSet'];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isIdList = (v) => Array.isArray(v) && v.length > 0 && v.length <= CAPS.elementsPerOp && v.every((x) => typeof x === 'string' && x.length <= 80);
const fin = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// One element from a peer: the same fields an opened file's elements can
// carry, checked loosely here (the reducer's transforms are the boundary
// that matters; structured data of unknown shape is dropped wholesale).
export function cleanElement(raw, depth = 0) {
  if (!isObj(raw) || typeof raw.type !== 'string' || raw.type.length > 20) return null;
  if (typeof raw.id !== 'string' || !raw.id || raw.id.length > 80) return null;
  const keep = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined) continue;
    const t = typeof v;
    if (t === 'string' && v.length > (k === 'text' ? CAPS.textChars : CAPS.nameChars)) return null;
    if (t === 'number' && !Number.isFinite(v)) return null;
    if (t === 'object' && depth > 4) return null;
    keep[k] = t === 'object' && v !== null ? JSON.parse(JSON.stringify(v)) : v;
  }
  if (Array.isArray(keep.children)) {
    keep.children = keep.children.map((c) => cleanElement(c, depth + 1)).filter(Boolean);
    if (!keep.children.length) return null;
  }
  return keep;
}

export function cleanPatch(patch) {
  if (!isObj(patch) || !Object.keys(patch).length || Object.keys(patch).length > 40) return null;
  const out = {};
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'id') continue;
    if (typeof v === 'string') { if (v.length > (k === 'text' ? CAPS.textChars : CAPS.nameChars)) return null; out[k] = v; }
    else if (typeof v === 'number') { if (!Number.isFinite(v)) return null; out[k] = v; }
    else if (v === true || v === false || v === null) out[k] = v;
    else if (isObj(v)) {
      const el = cleanElement({ ...v, id: 'x', type: 'x' });
      if (!el) return null;
      const { id, type, ...rest } = el;
      out[k] = rest;
    } else if (Array.isArray(v)) {
      const els = v.map((e) => cleanElement(e));
      if (els.some((e) => !e) || !els.length) return null;
      out[k] = els;
    } else return null;
  }
  return out;
}

// One page from a peer, for pageAdd: pages have no `type`, so
// cleanElement refuses them wholesale — that is why a page added in a live
// session never reached anyone. Everything a peer could smuggle in beyond
// a page's own fields (a pattern's drawings, stray keys) is dropped.
const clampPageSize = (v) => {
  const n = fin(v);
  return Math.min(PAGE_MAX, Math.max(PAGE_MIN, n === null ? 1080 : Math.round(n)));
};

const cleanGuide = (g) => {
  if (!isObj(g) || typeof g.id !== 'string' || !g.id || g.id.length > 80) return null;
  if (g.axis !== 'h' && g.axis !== 'v') return null;
  const pos = fin(g.pos);
  if (pos === null) return null;
  return { id: g.id, axis: g.axis, pos };
};

export function cleanPage(raw) {
  if (!isObj(raw) || typeof raw.id !== 'string' || !raw.id || raw.id.length > 80) return null;
  if (typeof raw.name !== 'string' || raw.name.length > 120) return null;
  const out = {
    id: raw.id,
    name: raw.name,
    width: clampPageSize(raw.width),
    height: clampPageSize(raw.height),
    background: typeof raw.background === 'string' && raw.background.length <= 200 ? raw.background : '#ffffff',
    guides: [],
    elements: [],
  };
  const gradient = cleanPatch({ gradient: raw.gradient });
  if (gradient) out.gradient = gradient.gradient;
  if (Array.isArray(raw.guides)) {
    out.guides = raw.guides.slice(0, 200).map(cleanGuide).filter(Boolean);
  }
  if (Array.isArray(raw.elements)) {
    out.elements = raw.elements.slice(0, CAPS.elementsPerOp * 25).map((e) => cleanElement(e)).filter(Boolean);
  }
  return out;
}

// What a patch may change on an existing page or the doc, and in what
// shape: without this a peer's pageSet or docSet could set any key
// (elements, createdAt, whole new fields) and push any page size.
const pagePatchKeys = { name: 1, background: 1, width: 1, height: 1, gradient: 1, pattern: 1 };

function cleanScopedPatch(t, patch) {
  if (!patch) return null;
  const out = {};
  if (t === 'docSet') {
    if (typeof patch.name === 'string') out.name = patch.name;
  } else {
    for (const [k, v] of Object.entries(patch)) {
      if (!pagePatchKeys[k]) continue;
      if (k === 'width' || k === 'height') { if (fin(v) !== null) out[k] = clampPageSize(v); }
      else if (k === 'pattern') { if (v === null) out[k] = null; } // a pattern is shared only when removed
      else out[k] = v;
    }
  }
  return Object.keys(out).length ? out : null;
}

// Validate one message. Returns a normalized copy, or null when it is
// not something this protocol speaks. kind: 'op' | 'presence' | 'hello' | 'state'.
export function validateMessage(m, kind) {
  if (!isObj(m)) return null;
  if (kind === 'presence') return cleanPresence(m);
  if (kind === 'hello') {
    const name = typeof m.name === 'string' ? m.name.slice(0, 40) : '';
    if (!name.trim()) return null;
    const lamport = fin(m.lamport);
    return { name: name.trim(), lamport: lamport === null ? 0 : lamport };
  }
  if (kind === 'state') {
    if (!Array.isArray(m.pages) || !m.pages.length || m.pages.length > 500) return null;
    const pages = m.pages.map((p) => {
      if (!isObj(p) || typeof p.id !== 'string' || !Array.isArray(p.elements)) return null;
      const els = p.elements.slice(0, CAPS.elementsPerOp * 25).map((e) => cleanElement(e));
      if (els.some((e) => !e)) return null;
      return { id: p.id, elements: els };
    });
    if (pages.some((p) => !p)) return null;
    const out = { pages };
    // Element ids the sender knows were deleted, so a rejoining peer's
    // merge does not resurrect them.
    if (Array.isArray(m.tombstones)) {
      const ids = m.tombstones
        .filter((x) => typeof x === 'string' && x && x.length <= 80)
        .slice(0, CAPS.elementsPerOp * 25);
      if (ids.length) out.tombstones = ids;
    }
    return out;
  }
  // op
  if (!OP_TYPES.includes(m.t)) return null;
  const op = { t: m.t, pageId: typeof m.pageId === 'string' ? m.pageId : null };
  if (m.t === 'add' || m.t === 'set') {
    if (m.t === 'add') {
      if (!Array.isArray(m.els) || !m.els.length || m.els.length > CAPS.elementsPerOp) return null;
      const els = m.els.map((e) => cleanElement(e));
      if (els.some((e) => !e)) return null;
      op.els = els;
    } else {
      if (!isIdList(m.ids)) return null;
      const patch = cleanPatch(m.patch);
      if (!patch) return null;
      op.ids = m.ids;
      op.patch = patch;
    }
  } else if (m.t === 'del') {
    if (!isIdList(m.ids)) return null;
    op.ids = m.ids;
  } else if (m.t === 'move') {
    if (!isIdList(m.ids) || fin(m.dx) === null || fin(m.dy) === null) return null;
    op.ids = m.ids;
    op.dx = m.dx;
    op.dy = m.dy;
  } else if (m.t === 'ord') {
    if (!isIdList(m.ids)) return null;
    op.ids = m.ids;
  } else if (m.t === 'pageAdd') {
    const page = cleanPage(m.page);
    if (!page) return null;
    op.page = page;
  } else if (m.t === 'pageDel') {
    if (typeof m.pageId !== 'string' || !m.pageId) return null;
    op.pageId = m.pageId;
  } else if (m.t === 'pageSet' || m.t === 'docSet') {
    const patch = cleanScopedPatch(m.t, cleanPatch(m.patch));
    if (!patch) return null;
    op.patch = patch;
    if (m.t === 'pageSet' && (typeof m.pageId !== 'string' || !m.pageId)) return null;
    if (m.t === 'pageSet') op.pageId = m.pageId;
  }
  return op;
}

// ── Presence ─────────────────────────────────────────────────────────────

export function cleanPresence(m) {
  const x = fin(m.x);
  const y = fin(m.y);
  if (x === null || y === null) return null;
  const out = {
    x: Math.round(x), y: Math.round(y),
    pageId: typeof m.pageId === 'string' ? m.pageId.slice(0, 80) : null,
    selection: Array.isArray(m.selection) ? m.selection.filter((s) => typeof s === 'string' && s.length <= 80).slice(0, 50) : [],
  };
  if (m.done === true) out.done = true;
  return out;
}

// Presence is high-frequency: outside the reducer, throttled (see
// session.js) to 10 updates a second per peer.
export const PRESENCE_HZ = 10;

// ── Diff: local edits -> ops ─────────────────────────────────────────────
// The app does not wrap every tool in a collab-aware call: after each
// change, diffPage(lastSent, current) says what changed, as ops a peer
// can replay with the same transforms. Undo, redo, restores and every
// panel and gesture produce the same op stream.

export function elementsChanged(a, b) {
  return JSON.stringify(a) !== JSON.stringify(b);
}

export function diffElements(before, after) {
  const ops = [];
  const beforeById = new Map(before.map((e) => [e.id, e]));
  const afterIds = new Set(after.map((e) => e.id));
  const added = after.filter((e) => !beforeById.has(e.id));
  if (added.length) ops.push({ t: 'add', els: structuredClone(added) });
  const removed = before.filter((e) => !afterIds.has(e.id)).map((e) => e.id);
  if (removed.length) ops.push({ t: 'del', ids: removed });
  // Changed top-level elements. A pure move (only x and y differ) maps to
  // the move transform, grouped by delta; anything else goes as a whole
  // element patch (group children ride along; they are relative to the
  // group, so this stays correct).
  const moves = new Map(); // "dx,dy" -> ids
  const sets = [];
  for (const e of after) {
    const b = beforeById.get(e.id);
    if (!b || !elementsChanged(b, e)) continue;
    const bMoved = { ...b, x: e.x, y: e.y };
    if (!elementsChanged(bMoved, e)) {
      const key = `${e.x - b.x},${e.y - b.y}`;
      if (!moves.has(key)) moves.set(key, []);
      moves.get(key).push(e.id);
    } else {
      const { id, ...patch } = structuredClone(e);
      sets.push({ id, patch });
    }
  }
  for (const [key, ids] of moves) {
    const [dx, dy] = key.split(',').map(Number);
    ops.push({ t: 'move', ids, dx, dy });
  }
  for (const { id, patch } of sets) ops.push({ t: 'set', ids: [id], patch });
  // Order changed without any content change: replay the reorder.
  const orderSame = before.length === after.length && before.every((e, i) => e.id === after[i].id);
  if (!orderSame && !added.length && !removed.length && !sets.length) {
    ops.push({ t: 'ord', ids: after.map((e) => e.id) });
  }
  return ops;
}

// Apply ops to an element list (pure): what a peer's page looks like after
// its ops. Used to preview remote ops and to test the diff/apply roundtrip.
// rev and updatedAt are each device's own bookkeeping (the memo's render
// counter and the merge's tie-breaker), not what the ops carry: the result
// is compared element for element, so it comes back without them.
function withoutBookkeeping(el) {
  const { rev, updatedAt, ...rest } = el;
  if (Array.isArray(rest.children)) rest.children = rest.children.map(withoutBookkeeping);
  return rest;
}

export function applyOpsToElements(els, ops) {
  const doc = { pages: [{ id: 'p', elements: structuredClone(els) }] };
  for (const op of ops) {
    if (op.t === 'add') addElements(doc, 'p', structuredClone(op.els));
    else if (op.t === 'del') removeElements(doc, 'p', op.ids);
    else if (op.t === 'set') updateElements(doc, 'p', op.ids, structuredClone(op.patch));
    else if (op.t === 'move') moveElements(doc, 'p', op.ids, op.dx, op.dy);
    else if (op.t === 'ord') {
      for (let i = 0; i < op.ids.length; i++) reorderElement(doc, 'p', op.ids[i], i);
    }
  }
  return doc.pages[0].elements.map(withoutBookkeeping);
}

// A full page snapshot as an op list (the state a newcomer or a
// rejoining peer needs): one add op per page.
export function pageStateOps(doc) {
  return doc.pages.map((p) => ({ t: 'pageAdd', page: structuredClone(p) }));
}

// ── Lamport clock ────────────────────────────────────────────────────────
// Ties are broken by peer id, so two peers always agree on order.

export const clockKey = (lamport, peerId) => `${lamport}|${peerId}`;
export function clockAfter(lamport, otherLamport, myPeerId, otherPeerId) {
  if (lamport !== otherLamport) return lamport > otherLamport;
  return myPeerId > otherPeerId;
}

// A short, colision-safe peer id for one session.
export const newPeerId = () => uid();