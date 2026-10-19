// Document model, store transforms and history.

import { describe, it, expect } from 'vitest';
import {
  newDesign, newElement, boundsOfElement, unionBoxes, topLevelOf, walk, pageIsValid,
} from '../web/src/doc/model.js';
import {
  initialDocState, docReducer, addElements, updateElements, moveElements, removeElements,
  reorderElement, groupSelection, ungroupSelection, duplicateSelection, pageAdd, pageDelete,
} from '../web/src/doc/store.js';
import { undo as undoStep, redo as redoStep, snapshot } from '../web/src/doc/history.js';
import { sameElementView } from '../web/src/render/elementMemo.js';

const rect = (x, y, w, h, extra = {}) => newElement('rect', { x, y, w, h }, extra);

describe('model', () => {
  it('creates a design with one page of the requested size', () => {
    const d = newDesign('Test', 1080, 1350);
    expect(d.name).toBe('Test');
    expect(d.pages).toHaveLength(1);
    expect(d.pages[0].width).toBe(1080);
    expect(d.pages[0].height).toBe(1350);
    expect(d.pages[0].elements).toEqual([]);
  });

  it('new elements carry type-specific defaults', () => {
    const t = newElement('text', { x: 0, y: 0, w: 100, h: 40 });
    expect(t.type).toBe('text');
    expect(t.text).toBe('Text');
    expect(t.size).toBe(32);
    const r = newElement('rect', {});
    expect(r.fill).toBeTruthy();
    expect(r.radius).toBe(0);
  });

  it('computes a rotated bounding box', () => {
    const b = boundsOfElement({ x: 0, y: 0, w: 100, h: 20, rotation: 90 });
    expect(Math.round(b.w)).toBe(20);
    expect(Math.round(b.h)).toBe(100);
  });

  it('page size validation bounds', () => {
    expect(pageIsValid(16, 10000)).toBe(true);
    expect(pageIsValid(15, 100)).toBe(false);
    expect(pageIsValid(100, 10001)).toBe(false);
    expect(pageIsValid(100.5, 100)).toBe(false);
    expect(pageIsValid(800, 800)).toBe(true);
  });

  it('walks nested groups and finds the owning top-level element', () => {
    const child = rect(0, 0, 10, 10);
    const group = { id: 'g', type: 'group', name: 'Group', x: 0, y: 0, w: 10, h: 10, rotation: 0, opacity: 1, children: [child] };
    const els = [group, rect(5, 5, 5, 5)];
    expect([...walk(els)]).toHaveLength(3);
    expect(topLevelOf(els, child.id).id).toBe('g');
    expect(topLevelOf(els, 'g').id).toBe('g');
  });
});

describe('store transforms', () => {
  it("'load' with a null doc clears the editor without throwing", () => {
    let state = initialDocState();
    state = docReducer(state, { type: 'load', doc: newDesign('Solo', 400, 400) });
    state = docReducer(state, { type: 'select', ids: ['x'] });
    state = docReducer(state, { type: 'load', doc: null });
    expect(state.doc).toBe(null);
    expect(state.pageId).toBe(null);
    expect(state.selection).toEqual([]);
    expect(state.past).toEqual([]);
    expect(state.future).toEqual([]);
    expect(state.editingId).toBe(null);
  });

  it('sameElementView needs equal updatedAt when rev repeats', () => {
    const el = { ...rect(0, 0, 10, 10), rev: 3, updatedAt: 100 };
    expect(sameElementView(el, el)).toBe(true);
    expect(sameElementView(el, { ...el })).toBe(true);
    expect(sameElementView(el, { ...el, updatedAt: 200 })).toBe(false);
    expect(sameElementView(el, { ...el, rev: 4 })).toBe(false);
  });

  const makeDoc = () => {
    const d = newDesign('Test', 1000, 1000);
    addElements(d, d.pages[0].id, [rect(0, 0, 100, 100), rect(200, 200, 50, 50)]);
    return d;
  };

  it('adds and removes elements', () => {
    const d = makeDoc();
    const page = d.pages[0];
    expect(page.elements).toHaveLength(2);
    removeElements(d, page.id, [page.elements[0].id]);
    expect(page.elements).toHaveLength(1);
  });

  it('updates an element nested in a group', () => {
    const d = makeDoc();
    const page = d.pages[0];
    const [a] = page.elements;
    const doc2 = groupSelection(structuredClone(d), page.id, page.elements.map((e) => e.id));
    const group = doc2.pages[0].elements[0];
    expect(group.type).toBe('group');
    updateElements(doc2, page.id, [a.id], { fill: '#ff0000' });
    expect(doc2.pages[0].elements[0].children[0].fill).toBe('#ff0000');
  });

  it('groups into one bounding group with relative children', () => {
    const d = makeDoc();
    const page = d.pages[0];
    const doc2 = groupSelection(structuredClone(d), page.id, page.elements.map((e) => e.id));
    const [group] = doc2.pages[0].elements;
    expect(group.w).toBe(250);
    expect(group.h).toBe(250);
    expect(group.children[0].x).toBe(0);
    expect(group.children[1].x).toBe(200);
  });

  it('ungroups back to absolute positions', () => {
    const d = makeDoc();
    const page = d.pages[0];
    const ids = page.elements.map((e) => e.id);
    const doc2 = groupSelection(structuredClone(d), page.id, ids);
    const gid = doc2.pages[0].elements[0].id;
    moveElements(doc2, page.id, [gid], 100, 50);
    const { doc: doc3, freedIds } = ungroupSelection(doc2, page.id, [gid]);
    expect(doc3.pages[0].elements).toHaveLength(2);
    expect(freedIds).toHaveLength(2);
    expect(doc3.pages[0].elements[0].x).toBe(100);
    expect(doc3.pages[0].elements[0].y).toBe(50);
  });

  it('duplicates with fresh ids and an offset', () => {
    const d = makeDoc();
    const page = d.pages[0];
    const r = duplicateSelection(structuredClone(d), page.id, [page.elements[0].id]);
    expect(r.newIds).toHaveLength(1);
    expect(r.newIds[0]).not.toBe(page.elements[0].id);
    const copy = r.doc.pages[0].elements[2];
    expect(copy.x).toBe(16);
  });

  it('reorders within the element array', () => {
    const d = makeDoc();
    const page = d.pages[0];
    reorderElement(d, page.id, page.elements[1].id, 0);
    expect(page.elements[0].y).toBe(200);
  });

  it('adds a page the same size and refuses to delete the last page', () => {
    const d = makeDoc();
    pageAdd(d, d.pages[0].id);
    expect(d.pages).toHaveLength(2);
    expect(d.pages[1].width).toBe(1000);
    pageDelete(d, d.pages[0].id);
    expect(d.pages).toHaveLength(1);
    pageDelete(d, d.pages[0].id);
    expect(d.pages).toHaveLength(1); // last page stays
  });
});

describe('history', () => {
  it('undoes and redoes whole-document snapshots', () => {
    let st = initialDocState();
    const d = newDesign('Test', 100, 100);
    st = docReducer(st, { type: 'load', doc: d });
    st = docReducer(st, { type: 'apply', fn: (doc) => addElements(doc, doc.pages[0].id, [rect(0, 0, 10, 10)]), history: true });
    expect(st.doc.pages[0].elements).toHaveLength(1);
    st = docReducer(st, { type: 'apply', fn: (doc) => addElements(doc, doc.pages[0].id, [rect(5, 5, 10, 10)]), history: true });
    expect(st.doc.pages[0].elements).toHaveLength(2);
    st = docReducer(st, { type: 'undo' });
    expect(st.doc.pages[0].elements).toHaveLength(1);
    st = docReducer(st, { type: 'undo' });
    expect(st.doc.pages[0].elements).toHaveLength(0);
    expect(st.past).toHaveLength(0);
    st = docReducer(st, { type: 'redo' });
    expect(st.doc.pages[0].elements).toHaveLength(1);
    st = docReducer(st, { type: 'redo' });
    expect(st.doc.pages[0].elements).toHaveLength(2);
  });

  it('records one entry per gesture via push-before, not per move', () => {
    let st = initialDocState();
    const d = newDesign('Test', 100, 100);
    st = docReducer(st, { type: 'load', doc: d });
    const el = rect(0, 0, 10, 10);
    st = docReducer(st, { type: 'apply', fn: (doc) => addElements(doc, doc.pages[0].id, [el]), history: true });
    // three preview moves, one push-before at the end; the snapshot is the
    // document as it stood when the gesture started
    const before = snapshot(st.doc);
    st = docReducer(st, { type: 'apply', fn: (doc) => moveElements(doc, doc.pages[0].id, [el.id], 5, 0), history: false });
    st = docReducer(st, { type: 'apply', fn: (doc) => moveElements(doc, doc.pages[0].id, [el.id], 10, 0), history: false });
    st = docReducer(st, { type: 'push-before', before });
    st = docReducer(st, { type: 'undo' });
    expect(st.doc.pages[0].elements[0].x).toBe(0);
  });

  it('prunes selection when an apply removes elements', () => {
    let st = initialDocState();
    const d = newDesign('Test', 100, 100);
    st = docReducer(st, { type: 'load', doc: d });
    const el = rect(0, 0, 10, 10);
    st = docReducer(st, { type: 'apply', fn: (doc) => addElements(doc, doc.pages[0].id, [el]), history: true });
    st = docReducer(st, { type: 'select', ids: [el.id] });
    st = docReducer(st, { type: 'apply', fn: (doc) => removeElements(doc, doc.pages[0].id, [el.id]), history: true });
    expect(st.selection).toEqual([]);
    st = docReducer(st, { type: 'undo' });
    expect(st.doc.pages[0].elements).toHaveLength(1); // the element is back
  });
});
