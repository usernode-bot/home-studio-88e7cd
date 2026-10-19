// The canvas: the page rendered at the current zoom, the elements on it,
// the selection frame with its square resize handles and round rotation
// handles, the live pink snap guides, the page's own draggable guides,
// the marquee, and every pointer gesture (move, resize, rotate, marquee,
// create, pan, pinch, guide drag, text editing).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  newElement, boundsOfElement, unionBoxes, topLevelOf, measureTextHeight, boxesIntersect,
} from '../doc/model.js';
import { fontStack } from '../assets/fonts.js';
import { pageBackgroundStyle, textStyles } from '../doc/style.js';
import ElementView from './ElementView.jsx';
import { moveElements, updateElements, addElements, removeElements, findElement } from '../doc/store.js';
import { snapMove } from '../tools/snap.js';

const MIN_SIZE = 8;
const ZOOM_MIN = 0.02;
const ZOOM_MAX = 8;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const HANDLE_STYLE = {
  nw: { left: -6, top: -6, cursor: 'nwse-resize' },
  n: { left: '50%', marginLeft: -6, top: -6, cursor: 'ns-resize' },
  ne: { right: -6, top: -6, cursor: 'nesw-resize' },
  e: { right: -6, top: '50%', marginTop: -6, cursor: 'ew-resize' },
  se: { right: -6, bottom: -6, cursor: 'nwse-resize' },
  s: { left: '50%', marginLeft: -6, bottom: -6, cursor: 'ns-resize' },
  sw: { left: -6, bottom: -6, cursor: 'nesw-resize' },
  w: { left: -6, top: '50%', marginTop: -6, cursor: 'ew-resize' },
};
const ROT_STYLE = {
  nw: { left: -22, top: -22, cursor: 'grab' },
  ne: { right: -22, top: -22, cursor: 'grab' },
  se: { right: -22, bottom: -22, cursor: 'grab' },
  sw: { left: -22, bottom: -22, cursor: 'grab' },
};
const CORNERS = new Set(['nw', 'ne', 'se', 'sw']);

// Recompute one element's geometry from its gesture-start snapshot, so
// every pointer move is derived from the same starting state.
function resizeGeometry(el0, handle, p, keepRatio) {
  const rad = ((el0.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = el0.x + el0.w / 2;
  const cy = el0.y + el0.h / 2;
  const dx = p.x - cx;
  const dy = p.y - cy;
  const lp = { x: dx * cos + dy * sin, y: -dx * sin + dy * cos };
  const ow2 = el0.w / 2;
  const oh2 = el0.h / 2;
  let x1 = handle.includes('w') ? Math.min(lp.x, ow2 - MIN_SIZE) : -ow2;
  let x2 = handle.includes('e') ? Math.max(lp.x, -ow2 + MIN_SIZE) : ow2;
  let y1 = handle.includes('n') ? Math.min(lp.y, oh2 - MIN_SIZE) : -oh2;
  let y2 = handle.includes('s') ? Math.max(lp.y, -oh2 + MIN_SIZE) : oh2;
  let w = x2 - x1;
  let h = y2 - y1;
  if (keepRatio && CORNERS.has(handle) && el0.w > 0 && el0.h > 0) {
    const ratio = el0.w / el0.h;
    if (w / h > ratio) h = w / ratio;
    else w = h * ratio;
    if (handle.includes('n')) y1 = y2 - h;
    else y2 = y1 + h;
    if (handle.includes('w')) x1 = x2 - w;
    else x2 = x1 + w;
  }
  // The opposite edge or corner stays put.
  const ax = handle.includes('e') ? -ow2 : handle.includes('w') ? ow2 : 0;
  const ay = handle.includes('s') ? -oh2 : handle.includes('n') ? oh2 : 0;
  const midx = handle.includes('e') ? w / 2 : handle.includes('w') ? -w / 2 : 0;
  const midy = handle.includes('s') ? h / 2 : handle.includes('n') ? -h / 2 : 0;
  const fx = cx + ax * cos - ay * sin;
  const fy = cy + ax * sin + ay * cos;
  const ncx = fx + midx * cos - midy * sin;
  const ncy = fy + midx * sin + midy * cos;
  const out = { x: ncx - w / 2, y: ncy - h / 2, w, h };
  if (el0.type === 'group') {
    const sx = el0.w ? w / el0.w : 1;
    const sy = el0.h ? h / el0.h : 1;
    out.children = el0.children.map((c) => {
      const ctlx = c.x - ow2;
      const ctly = c.y - oh2;
      return {
        ...c,
        x: (ctlx - ax) * sx - midx + w / 2,
        y: (ctly - ay) * sy - midy + h / 2,
        w: c.w * sx,
        h: c.h * sy,
      };
    });
  }
  return out;
}

export default function Canvas({ state, dispatch, apply, page, zoom, setZoom, view, setView, images, onFitReady }) {
  const workRef = useRef(null);
  const live = useRef({});
  live.current = { page, zoom, view, state, dispatch, apply, images };
  const gesture = useRef(null);
  const draftRef = useRef(null);
  const setDraft = (v) => {
    draftRef.current = v;
    setDraftState(v);
  };
  const [draft, setDraftState] = useState(null); // create-tool preview or marquee
  const [snapLines, setSnapLines] = useState([]);
  const [tag, setTag] = useState(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const pointers = useRef(new Map());
  const lastTap = useRef({ t: 0, id: null });

  const selection = state.selection;
  const tool = state.tool;
  const els = page ? page.elements : [];

  // ── View: fit, zoom, pan ───────────────────────────────────────────────
  useEffect(() => {
    const el = workRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    const p = live.current.page;
    if (!p || size.w < 10) return;
    const z = clamp(Math.min((size.w - 64) / p.width, (size.h - 56) / p.height), ZOOM_MIN, 4);
    setZoom(z);
    setView({ x: (size.w - p.width * z) / 2, y: (size.h - p.height * z) / 2 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h]);

  const lastFitPage = useRef(null);
  useEffect(() => {
    if (page && lastFitPage.current !== page.id && size.w > 10) {
      lastFitPage.current = page.id;
      fit();
    }
  }, [page?.id, size.w, size.h]); // eslint-disable-line react-hooks/exhaustive-deps

  const zoomAt = useCallback((factor, cx, cy) => {
    const { zoom: z } = live.current;
    const nz = clamp(z * factor, ZOOM_MIN, ZOOM_MAX);
    if (nz === z) return;
    setView((v) => ({ x: cx - (cx - v.x) * (nz / z), y: cy - (cy - v.y) * (nz / z) }));
    setZoom(nz);
  }, []);

  useEffect(() => {
    const el = workRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        zoomAt(Math.exp(-e.deltaY * 0.002), e.clientX - rect.left, e.clientY - rect.top);
      } else {
        setView((v) => ({ x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt, setView]);

  const pagePoint = useCallback((e) => {
    const rect = workRef.current.getBoundingClientRect();
    const { zoom: z, view: v } = live.current;
    return { x: (e.clientX - rect.left - v.x) / z, y: (e.clientY - rect.top - v.y) / z };
  }, []);

  // Expose fit + zoom stepping to the app shell (keyboard, zoom buttons).
  const api = useRef({ fit: () => {}, zoom: () => {} });
  api.current.fit = fit;
  api.current.zoom = (f) => zoomAt(f, size.w / 2, size.h / 2);
  useEffect(() => {
    if (onFitReady) onFitReady(api.current);
  }, [fit, size.w, size.h, zoomAt, onFitReady]);

  // ── Gesture plumbing ──────────────────────────────────────────────────
  const onGestureMove = useCallback((e) => {
    const g = gesture.current;
    const { page: p, zoom: z, dispatch: d, apply: ap } = live.current;
    if (!g || !p) return;
    // Keep the tracked pointer position fresh: the pinch gesture measures
    // the distance between the two tracked pointers on every move.
    if (pointers.current.has(e.pointerId)) trackPointer(e);
    if (g.kind === 'pan') {
      setView({ x: g.startView.x + (e.clientX - g.startClient.x), y: g.startView.y + (e.clientY - g.startClient.y) });
      return;
    }
    if (g.kind === 'pinch') {
      const a = pointers.current.get(g.p1);
      const b = pointers.current.get(g.p2);
      if (!a || !b) return;
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const rect = workRef.current.getBoundingClientRect();
      const mid = { x: (a.clientX + b.clientX) / 2 - rect.left, y: (a.clientY + b.clientY) / 2 - rect.top };
      zoomAt(dist / g.startDist, mid.x, mid.y);
      return;
    }
    const pt = pagePoint(e);
    if (g.kind === 'move') {
      const dx = pt.x - g.start.x;
      const dy = pt.y - g.start.y;
      const moving = unionBoxes(g.origBounds.map((b) => ({ ...b, x: b.x + dx, y: b.y + dy })));
      const others = p.elements.filter((el) => !g.ids.includes(el.id)).map(boundsOfElement);
      const snap = snapMove(p, moving, others, z, e.altKey);
      // sdx/sdy is the total offset from the gesture start, but
      // moveElements adds to the already-previewed doc, so apply only the
      // step since the last event.
      const sdx = dx + snap.dx;
      const sdy = dy + snap.dy;
      const stepX = sdx - g.applied.x;
      const stepY = sdy - g.applied.y;
      g.applied = { x: sdx, y: sdy };
      if (!g.moved && (Math.abs(stepX) > 0.01 || Math.abs(stepY) > 0.01)) {
        g.moved = true;
        ap((doc) => moveElements(doc, p.id, g.ids, stepX, stepY), true);
      } else if (g.moved && (Math.abs(stepX) > 0.01 || Math.abs(stepY) > 0.01)) {
        ap((doc) => moveElements(doc, p.id, g.ids, stepX, stepY), false);
      }
      setSnapLines(snap.lines);
      setTag(snap.lines.length ? snap.lines[0].label : null);
      return;
    }
    if (g.kind === 'resize') {
      const geom = resizeGeometry(g.el0, g.handle, pt, e.shiftKey);
      if (!g.moved) {
        g.moved = true;
        ap((doc) => {
          updateElements(doc, p.id, [g.id], geom);
        }, true);
      } else {
        ap((doc) => updateElements(doc, p.id, [g.id], geom), false);
      }
      return;
    }
    if (g.kind === 'rotate') {
      const ang = (Math.atan2(pt.y - g.center.y, pt.x - g.center.x) * 180) / Math.PI;
      let rot = g.startRot + (ang - g.startAng);
      if (e.shiftKey) rot = Math.round(rot / 15) * 15;
      if (!g.moved) {
        g.moved = true;
        ap((doc) => updateElements(doc, p.id, [g.id], { rotation: rot }), true);
      } else {
        ap((doc) => updateElements(doc, p.id, [g.id], { rotation: rot }), false);
      }
      return;
    }
    if (g.kind === 'guide') {
      const pos = g.axis === 'v' ? pt.x : pt.y;
      if (!g.moved) {
        g.moved = true;
        ap((doc) => {
          const pg = doc.pages.find((pp) => pp.id === p.id);
          const gd = pg.guides.find((x) => x.id === g.id);
          if (gd) gd.pos = pos;
        }, true);
      } else {
        ap((doc) => {
          const pg = doc.pages.find((pp) => pp.id === p.id);
          const gd = pg.guides.find((x) => x.id === g.id);
          if (gd) gd.pos = pos;
        }, false);
      }
      g.pos = pos;
      return;
    }
    if (g.kind === 'marquee') {
      setDraft({
        kind: 'marquee',
        x: Math.min(g.start.x, pt.x),
        y: Math.min(g.start.y, pt.y),
        w: Math.abs(pt.x - g.start.x),
        h: Math.abs(pt.y - g.start.y),
      });
      g.cur = pt;
      return;
    }
    if (g.kind === 'create') {
      const w = Math.abs(pt.x - g.start.x);
      const h = Math.abs(pt.y - g.start.y);
      setDraft({
        ...g.draft,
        x: Math.min(g.start.x, pt.x),
        y: Math.min(g.start.y, pt.y),
        w: Math.max(1, w),
        h: Math.max(1, h),
      });
      return;
    }
  }, [pagePoint, setView, zoomAt]);

  const finishGesture = useCallback((e) => {
    const g = gesture.current;
    const { page: p, dispatch: d, apply: ap, zoom: z } = live.current;
    gesture.current = null;
    window.removeEventListener('pointermove', onGestureMove);
    window.removeEventListener('pointerup', finishGesture);
    window.removeEventListener('pointercancel', finishGesture);
    if (!g || !p) return;
    pointers.current.delete(e.pointerId);
    if (g.kind === 'guide') {
      const size = g.axis === 'v' ? p.width : p.height;
      if (g.pos === undefined || g.pos < 0 || g.pos > size) {
        ap((doc) => {
          const pg = doc.pages.find((pp) => pp.id === p.id);
          pg.guides = pg.guides.filter((x) => x.id !== g.id);
        }, true);
      }
    }
    if (g.kind === 'marquee' && g.cur) {
      const box = {
        x: Math.min(g.start.x, g.cur.x),
        y: Math.min(g.start.y, g.cur.y),
        w: Math.abs(g.cur.x - g.start.x),
        h: Math.abs(g.cur.y - g.start.y),
      };
      const ids = p.elements.filter((el) => boxesIntersect(boundsOfElement(el), box)).map((el) => el.id);
      d({ type: 'select', ids });
    }
    if (g.kind === 'create' && draftRef.current) {
      const el = draftRef.current;
      const tiny = el.w < 4 && el.h < 4;
      const fallback = {
        text: { w: 320, h: 48 },
        rect: { w: 200, h: 140 },
        ellipse: { w: 160, h: 160 },
        line: { w: 240, h: 0 },
      };
      const fb = tiny ? fallback[el.type] : null;
      const placed = fb ? { ...el, x: el.x, y: el.y, w: fb.w, h: fb.h } : el;
      if (placed.type === 'text') placed.h = measureTextHeight(placed);
      ap((doc) => addElements(doc, p.id, [placed]), true);
      d({ type: 'select', ids: [placed.id] });
      d({ type: 'tool', tool: 'select' });
    }
    setDraft(null);
    setSnapLines([]);
    setTag(null);
  }, [onGestureMove, draft]);

  const begin = useCallback((g) => {
    gesture.current = g;
    window.addEventListener('pointermove', onGestureMove);
    window.addEventListener('pointerup', finishGesture);
    window.addEventListener('pointercancel', finishGesture);
  }, [onGestureMove, finishGesture]);

  useEffect(() => () => {
    window.removeEventListener('pointermove', onGestureMove);
    window.removeEventListener('pointerup', finishGesture);
    window.removeEventListener('pointercancel', finishGesture);
  }, [onGestureMove, finishGesture]);

  // ── Pointer downs ─────────────────────────────────────────────────────
  const trackPointer = (e) => {
    pointers.current.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
  };
  const releasePointer = (e) => pointers.current.delete(e.pointerId);

  const onWorkPointerDown = (e) => {
    if (e.button === 2) return;
    trackPointer(e);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      // A second finger always means a pinch. Whatever gesture was under
      // way ends here: a move keeps the position it reached, a draft
      // (marquee, create) is discarded.
      if (gesture.current && gesture.current.kind !== 'move') setDraft(null);
      setSnapLines([]);
      setTag(null);
      begin({ kind: 'pinch', p1: [...pointers.current.keys()][0], p2: [...pointers.current.keys()][1], startDist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1 });
      return;
    }
    if (e.button === 1 || spaceDown.current || (e.pointerType === 'touch' && pointers.current.size > 1)) {
      begin({ kind: 'pan', startView: view, startClient: { x: e.clientX, y: e.clientY } });
      return;
    }
    const pt = pagePoint(e);
    if (tool !== 'select') {
      const draftEl = newElement(tool, { x: pt.x, y: pt.y, w: 1, h: 1 });
      setDraft(draftEl);
      begin({ kind: 'create', start: pt, draft: draftEl });
      return;
    }
    begin({ kind: 'marquee', start: pt, cur: pt });
    setDraft({ kind: 'marquee', x: pt.x, y: pt.y, w: 0, h: 0 });
  };

  const onElementPointerDown = (e, el) => {
    if (tool !== 'select' || state.editingId) return; // let the create tool see it
    if (e.button === 2) return;
    e.stopPropagation();
    trackPointer(e);
    const { page: p } = live.current;
    const top = topLevelOf(p.elements, el.id);
    if (!top) return;
    let ids;
    if (e.shiftKey) {
      ids = selection.includes(top.id) ? selection.filter((i) => i !== top.id) : [...selection, top.id];
      if (!ids.length) return;
      d2(ids);
    } else if (!selection.includes(top.id)) {
      ids = [top.id];
      d2(ids);
    } else {
      ids = [...selection];
    }
    if (pointers.current.size === 2) {
      // A second finger landing on an element is a pinch too, like a
      // second finger on the empty canvas.
      const [a, b] = [...pointers.current.values()];
      if (gesture.current && gesture.current.kind !== 'move') setDraft(null);
      setSnapLines([]);
      setTag(null);
      begin({ kind: 'pinch', p1: [...pointers.current.keys()][0], p2: [...pointers.current.keys()][1], startDist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1 });
      return;
    }
    // A double-tap on touch opens text editing (iOS Safari sends no
    // dblclick for a double-tap).
    const now = Date.now();
    const dblTap = e.pointerType === 'touch' && lastTap.current.id === top.id && now - lastTap.current.t < 350;
    lastTap.current = { t: now, id: top.id };
    if (dblTap && el.type === 'text') {
      live.current.dispatch({ type: 'editing', id: el.id });
      return;
    }
    const start = pagePoint(e);
    begin({
      kind: 'move',
      ids,
      start,
      applied: { x: 0, y: 0 },
      origBounds: ids.map((id) => boundsOfElement(p.elements.find((t) => t.id === id))),
    });
    function d2(next) {
      live.current.dispatch({ type: 'select', ids: next });
    }
  };

  const onHandlePointerDown = (e, id, handle) => {
    e.stopPropagation();
    if (e.button === 2) return;
    trackPointer(e);
    const { page: p } = live.current;
    const el = p.elements.find((t) => t.id === id);
    if (!el) return;
    begin({ kind: 'resize', id, handle, el0: structuredClone(el) });
  };

  const onRotatePointerDown = (e, id) => {
    e.stopPropagation();
    if (e.button === 2) return;
    trackPointer(e);
    const { page: p } = live.current;
    const el = p.elements.find((t) => t.id === id);
    if (!el) return;
    const center = { x: el.x + el.w / 2, y: el.y + el.h / 2 };
    const pt = pagePoint(e);
    begin({
      kind: 'rotate',
      id,
      center,
      startAng: (Math.atan2(pt.y - center.y, pt.x - center.x) * 180) / Math.PI,
      startRot: el.rotation || 0,
    });
  };

  const onGuidePointerDown = (e, gd) => {
    e.stopPropagation();
    trackPointer(e);
    begin({ kind: 'guide', id: gd.id, axis: gd.axis });
  };

  // Stable handler identities for the memoised element views; each call
  // reaches the latest closure.
  const handlers = useRef({});
  handlers.current = { down: onElementPointerDown };
  const stableDown = useCallback((e, el) => handlers.current.down(e, el), []);
  // Only text opens for editing: typing into the editor on another kind of
// element measures its height from text fields it does not have.
const stableDbl = useCallback((el) => {
    if (el.type === 'text') live.current.dispatch({ type: 'editing', id: el.id });
  }, []);

  // Space held: pan instead of select.
  const spaceDown = useRef(false);
  useEffect(() => {
    const down = (e) => {
      // Leave Space to the control the user is on: a button, dropdown or
      // link is activated by Space, not turned into a pan.
      const t = e.target;
      const control = t instanceof Element && (
        t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement
        || t instanceof HTMLSelectElement || t instanceof HTMLButtonElement
        || (t instanceof HTMLAnchorElement && t.hasAttribute('href')) || t.hasAttribute('role')
      );
      if (e.code === 'Space' && !e.repeat && !control) {
        spaceDown.current = true;
        e.preventDefault();
      }
    };
    const up = (e) => {
      if (e.code === 'Space') spaceDown.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // ── Rendering ─────────────────────────────────────────────────────────
  if (!page) return <div className="work" ref={workRef} />;

  const sel = selection.map((id) => els.find((el) => el.id === id)).filter(Boolean);
  const editingEl = state.editingId ? findElement(els, state.editingId) : null;

  const renderEl = (el) => (
    <ElementView key={el.id} el={el} images={images} onPointerDown={stableDown} onDoubleClick={stableDbl} />
  );

  const wz = page.width * zoom;
  const hz = page.height * zoom;
  const cursor = tool === 'select' ? (spaceDown.current ? 'grab' : 'default') : 'crosshair';

  return (
    <div className="work" ref={workRef} style={{ touchAction: 'none', cursor }} data-canvas
      onPointerDown={onWorkPointerDown}
      onPointerUp={releasePointer}
      onPointerCancel={releasePointer}>
      <div style={{ position: 'absolute', left: view.x, top: view.y, width: wz, height: hz }}>
        <div className="art" style={{ left: 0, top: 0, width: page.width, height: page.height, ...pageBackgroundStyle(page), transform: `scale(${zoom})`, transformOrigin: '0 0' }}>
          {els.map(renderEl)}
          {draft && draft.kind !== 'marquee' && <ElementView el={draft} images={images} />}
          {editingEl && (
            <textarea
              autoFocus
              className="text-editor"
              style={{
                position: 'absolute',
                left: editingEl.x,
                top: editingEl.y,
                width: editingEl.w,
                height: editingEl.h,
                transform: `rotate(${editingEl.rotation || 0}deg)`,
                transformOrigin: 'center',
                ...textStyles(editingEl, fontStack(editingEl.font)).box,
                color: editingEl.color,
                opacity: editingEl.opacity,
              }}
              defaultValue={editingEl.text}
              onChange={(e) => {
                const text = e.target.value;
                live.current.apply((doc) => {
                  updateElements(doc, page.id, [editingEl.id], { text });
                  const el = findElement(doc.pages.find((p) => p.id === page.id).elements, editingEl.id);
                  el.h = measureTextHeight(el);
                }, false);
              }}
              onBlur={() => live.current.dispatch({ type: 'editing', id: null })}
              onKeyDown={(e) => {
                if (e.key === 'Escape') e.target.blur();
                e.stopPropagation();
              }}
            />
          )}
        </div>
        {/* Overlay: selection frames, handles, guides, marquee, tag. Screen coords. */}
        {draft && draft.kind === 'marquee' && (
          <div style={{ position: 'absolute', left: draft.x * zoom, top: draft.y * zoom, width: draft.w * zoom, height: draft.h * zoom, border: '1px solid rgb(var(--accent))', background: 'rgb(var(--accent) / 0.08)', pointerEvents: 'none' }} />
        )}
        {(page.guides || []).map((gd) =>
          gd.axis === 'v' ? (
            <div key={gd.id} className="gl" data-guide={gd.id} style={{ position: 'absolute', left: gd.pos * zoom, top: 0, width: 1, height: hz, cursor: 'ew-resize' }} onPointerDown={(e) => onGuidePointerDown(e, gd)} />
          ) : (
            <div key={gd.id} className="gl" data-guide={gd.id} style={{ position: 'absolute', top: gd.pos * zoom, left: 0, height: 1, width: wz, cursor: 'ns-resize' }} onPointerDown={(e) => onGuidePointerDown(e, gd)} />
          )
        )}
        {snapLines.map((ln, i) =>
          ln.axis === 'v' ? (
            <div key={i} className="gl" style={{ position: 'absolute', left: ln.pos * zoom, top: 0, width: 1, height: hz, pointerEvents: 'none' }} />
          ) : (
            <div key={i} className="gl" style={{ position: 'absolute', top: ln.pos * zoom, left: 0, height: 1, width: wz, pointerEvents: 'none' }} />
          )
        )}
        {sel.map((el) => {
          const sw = el.w * zoom;
          const sh = el.h * zoom;
          const single = sel.length === 1;
          return (
            <div key={el.id} className="sel" style={{ position: 'absolute', left: el.x * zoom, top: el.y * zoom, width: sw, height: sh, transform: `rotate(${el.rotation || 0}deg)`, transformOrigin: 'center', pointerEvents: 'none' }}>
              {single && HANDLES.map((h) => (
                <span key={h} className="h" data-handle={h} style={{ ...HANDLE_STYLE[h], pointerEvents: 'auto' }}
                  onPointerDown={(e) => onHandlePointerDown(e, el.id, h)} />
              ))}
              {single && Object.keys(ROT_STYLE).map((k) => (
                <span key={k} className="rot" data-rot={k} style={{ ...ROT_STYLE[k], pointerEvents: 'auto' }}
                  onPointerDown={(e) => onRotatePointerDown(e, el.id)} />
              ))}
            </div>
          );
        })}
        {tag && snapLines[0] && sel.length > 0 && (() => {
          const b = selBounds(sel);
          const pos = snapLines[0].axis === 'v' ? snapLines[0].pos * zoom : snapLines[0].pos * zoom;
          return (
            <span className="tag" style={{ position: 'absolute', left: snapLines[0].axis === 'v' ? pos + 8 : b.x * zoom + 8, top: snapLines[0].axis === 'v' ? b.y * zoom + 8 : pos + 8, pointerEvents: 'none' }}>
              {tag}
            </span>
          );
        })()}
      </div>
      <div className="zoom" style={{ position: 'absolute', right: 12, bottom: 10, zIndex: 6 }}>
        <button type="button" onClick={() => zoomAt(1 / 1.25, size.w / 2, size.h / 2)} aria-label="Zoom out">−</button>
        <button type="button" onClick={fit} aria-label={'Zoom ' + Math.round(zoom * 100) + '%, tap to fit the page to the window'}>{Math.round(zoom * 100)}%</button>
        <button type="button" onClick={() => zoomAt(1.25, size.w / 2, size.h / 2)} aria-label="Zoom in">+</button>
      </div>
    </div>
  );
}

function selBounds(sel) {
  if (!sel.length) return { x: 0, y: 0, w: 0, h: 0 };
  return unionBoxes(sel.map(boundsOfElement));
}
