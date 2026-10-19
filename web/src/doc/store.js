// The document store: a reducer over { doc, pageId, selection, tool,
// editingId, past, future }, plus the pure document transforms every tool
// and panel dispatches through. History entries are pushed once per
// finished gesture (see history.js); live drag previews go through the
// same 'apply' action with history off.

import { uid, newPage, boundsOfElement, unionBoxes, findElement, selectionBounds } from './model.js';
import { snapshot, pushPast, undo as undoHistory, redo as redoHistory } from './history.js';

export function initialDocState() {
  return { doc: null, pageId: null, selection: [], tool: 'select', editingId: null, past: [], future: [] };
}

export function pageOf(state) {
  if (!state.doc) return null;
  return state.doc.pages.find((p) => p.id === state.pageId) || state.doc.pages[0] || null;
}

export function topElements(state) {
  const page = pageOf(state);
  return page ? page.elements : [];
}

function idsPresent(elements, ids) {
  const present = new Set(elements.map((el) => el.id));
  return ids.filter((id) => present.has(id));
}

export function docReducer(state, action) {
  switch (action.type) {
    case 'load': {
      const doc = action.doc;
      const pageId = doc.pages.find((p) => p.id === action.pageId) ? action.pageId : doc.pages[0]?.id || null;
      return { ...state, doc, pageId, selection: action.selection || [], past: [], future: [], editingId: null };
    }
    case 'tool':
      return { ...state, tool: action.tool, editingId: null };
    case 'set-page':
      return { ...state, pageId: action.pageId, selection: [], editingId: null };
    case 'select':
      return { ...state, selection: action.ids, editingId: action.ids.length === 1 ? state.editingId : null };
    case 'editing':
      return { ...state, editingId: action.id };
    case 'apply': {
      if (!state.doc) return state;
      const draft = structuredClone(state.doc);
      const next = action.fn(draft) || draft;
      const page = next.pages.find((p) => p.id === state.pageId) || next.pages[0];
      const selection = action.keepSelection ? state.selection : idsPresent(page ? page.elements : [], state.selection);
      return {
        ...state,
        doc: next,
        pageId: page ? page.id : null,
        selection,
        past: action.history ? pushPast(state.past, snapshot(state.doc)) : state.past,
        future: action.history ? [] : state.future,
      };
    }
    case 'push-before': // a gesture just ended: record where it started
      return { ...state, past: pushPast(state.past, action.before), future: [] };
    case 'undo': {
      const step = undoHistory(state);
      if (!step) return state;
      const page = step.doc.pages.find((p) => p.id === state.pageId) || step.doc.pages[0];
      return {
        ...state,
        ...step,
        pageId: page ? page.id : null,
        selection: idsPresent(page ? page.elements : [], state.selection),
        editingId: null,
      };
    }
    case 'redo': {
      const step = redoHistory(state);
      if (!step) return state;
      const page = step.doc.pages.find((p) => p.id === state.pageId) || step.doc.pages[0];
      return {
        ...state,
        ...step,
        pageId: page ? page.id : null,
        selection: idsPresent(page ? page.elements : [], state.selection),
        editingId: null,
      };
    }
    default:
      return state;
  }
}

// ── Document transforms (pure, tested) ───────────────────────────────────

export function addElements(doc, pageId, els) {
  const page = doc.pages.find((p) => p.id === pageId);
  if (!page) return doc;
  page.elements.push(...els);
  doc.updatedAt = Date.now();
  return doc;
}

// Deep update: works on group children too.
export function updateElements(doc, pageId, ids, patch) {
  const page = doc.pages.find((p) => p.id === pageId);
  if (!page) return doc;
  const apply = (els) => {
    for (const el of els) {
      if (ids.includes(el.id)) Object.assign(el, patch);
      if (el.type === 'group') apply(el.children);
    }
  };
  apply(page.elements);
  doc.updatedAt = Date.now();
  return doc;
}

// Move top-level elements by dx, dy. A group moves as one: its own x/y
// change, its children (relative to the group) come along.
export function moveElements(doc, pageId, ids, dx, dy) {
  const page = doc.pages.find((p) => p.id === pageId);
  if (!page) return doc;
  for (const el of page.elements) {
    if (ids.includes(el.id)) {
      el.x += dx;
      el.y += dy;
    }
  }
  doc.updatedAt = Date.now();
  return doc;
}

export function removeElements(doc, pageId, ids) {
  const page = doc.pages.find((p) => p.id === pageId);
  if (!page) return doc;
  page.elements = page.elements.filter((el) => !ids.includes(el.id));
  doc.updatedAt = Date.now();
  return doc;
}

// Put `id` at `index` in the page's element array (bottom first).
export function reorderElement(doc, pageId, id, index) {
  const page = doc.pages.find((p) => p.id === pageId);
  if (!page) return doc;
  const from = page.elements.findIndex((el) => el.id === id);
  if (from === -1) return doc;
  const [el] = page.elements.splice(from, 1);
  page.elements.splice(Math.max(0, Math.min(page.elements.length, index)), 0, el);
  doc.updatedAt = Date.now();
  return doc;
}

// Group the selected top-level elements into one new group, placed on top.
export function groupSelection(doc, pageId, ids) {
  const page = doc.pages.find((p) => p.id === pageId);
  if (!page || ids.length < 2) return doc;
  const chosen = page.elements.filter((el) => ids.includes(el.id));
  if (chosen.length < 2) return doc;
  const box = unionBoxes(chosen.map((el) => boundsOfElement(el)));
  const children = chosen.map((el) => ({ ...structuredClone(el), x: el.x - box.x, y: el.y - box.y }));
  const group = {
    id: uid(),
    type: 'group',
    name: 'Group',
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    rotation: 0,
    opacity: 1,
    children,
  };
  page.elements = page.elements.filter((el) => !ids.includes(el.id));
  page.elements.push(group);
  doc.updatedAt = Date.now();
  return doc;
}

// Dissolve groups: children come out at their visual place, keeping order.
export function ungroupSelection(doc, pageId, ids) {
  const page = doc.pages.find((p) => p.id === pageId);
  if (!page) return doc;
  const out = [];
  const freedIds = [];
  for (const el of page.elements) {
    if (ids.includes(el.id) && el.type === 'group') {
      const rad = ((el.rotation || 0) * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      for (const c of el.children) {
        const lc = { x: c.x + c.w / 2 - el.w / 2, y: c.y + c.h / 2 - el.h / 2 };
        const ac = {
          x: el.x + el.w / 2 + lc.x * cos - lc.y * sin,
          y: el.y + el.h / 2 + lc.x * sin + lc.y * cos,
        };
        freedIds.push(c.id);
        out.push({ ...structuredClone(c), x: ac.x - c.w / 2, y: ac.y - c.h / 2, rotation: c.rotation + (el.rotation || 0) });
      }
    } else {
      out.push(el);
    }
  }
  page.elements = out;
  doc.updatedAt = Date.now();
  return { doc, freedIds };
}

export function duplicateSelection(doc, pageId, ids) {
  const page = doc.pages.find((p) => p.id === pageId);
  if (!page) return { doc, newIds: [] };
  const newIds = [];
  const copies = [];
  for (const el of page.elements) {
    if (!ids.includes(el.id)) continue;
    const copy = structuredClone(el);
    const reid = (e) => {
      e.id = uid();
      if (e.children) e.children.forEach(reid);
      return e;
    };
    reid(copy);
    copy.x += 16;
    copy.y += 16;
    newIds.push(copy.id);
    copies.push(copy);
  }
  page.elements.push(...copies);
  doc.updatedAt = Date.now();
  return { doc, newIds };
}

// ── Pages ────────────────────────────────────────────────────────────────

export function pageAdd(doc, likePageId) {
  const like = doc.pages.find((p) => p.id === likePageId);
  const width = like ? like.width : 1080;
  const height = like ? like.height : 1080;
  const page = newPage('Page ' + (doc.pages.length + 1), width, height);
  doc.pages.push(page);
  doc.updatedAt = Date.now();
  return page.id;
}

export function pageDuplicate(doc, pageId) {
  const index = doc.pages.findIndex((p) => p.id === pageId);
  if (index === -1) return null;
  const copy = structuredClone(doc.pages[index]);
  const reid = (page) => {
    page.id = uid();
    for (const el of page.elements) {
      el.id = uid();
      if (el.children) el.children.forEach((c) => (c.id = uid()));
    }
    for (const g of page.guides) g.id = uid();
    return page;
  };
  reid(copy);
  copy.name = copy.name + ' copy';
  doc.pages.splice(index + 1, 0, copy);
  doc.updatedAt = Date.now();
  return copy.id;
}

export function pageDelete(doc, pageId) {
  if (doc.pages.length <= 1) return doc; // the last page cannot be deleted
  doc.pages = doc.pages.filter((p) => p.id !== pageId);
  doc.updatedAt = Date.now();
  return doc;
}

export function pageUpdate(doc, pageId, patch) {
  const page = doc.pages.find((p) => p.id === pageId);
  if (!page) return doc;
  Object.assign(page, patch);
  doc.updatedAt = Date.now();
  return doc;
}

export { findElement, selectionBounds };
