// The two side panels: the layers list and the properties inspector.

import React, { useEffect, useRef, useState } from 'react';
import { icons } from './icons.jsx';
import { boundsOfElement, TYPE_LABELS, FONT_LABELS } from '../doc/model.js';
import { updateElements, removeElements } from '../doc/store.js';
import { alignBoxes, distributeBoxes } from '../tools/align.js';

const TYPE_ICONS = {
  text: icons.text,
  rect: icons.rect,
  ellipse: icons.ellipse,
  line: icons.line,
  image: icons.image,
  group: icons.group,
};

// One layers row, draggable to reorder, double-tappable to rename.
function LayerRow({ el, selected, index, total, onSelect, onReorder, onRename }) {
  const [renaming, setRenaming] = useState(false);
  const rowRef = useRef(null);
  const drag = useRef(null);

  const onPointerDown = (e) => {
    if (e.button === 2) return;
    drag.current = { id: el.id, index, startY: e.clientY, moved: false };
    const move = (ev) => {
      if (!drag.current) return;
      if (Math.abs(ev.clientY - drag.current.startY) > 6) drag.current.moved = true;
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const d = drag.current;
      drag.current = null;
      if (!d || !d.moved) return;
      // Which row did we land on?
      const rows = [...rowRef.current.parentElement.children].filter((n) => n.dataset && n.dataset.lrow !== undefined);
      let target = rows.findIndex((r) => {
        const b = r.getBoundingClientRect();
        return ev.clientY < b.top + b.height / 2;
      });
      if (target === -1) target = rows.length;
      onReorder(d.id, target);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <li className={'list-row' + (selected ? ' on' : '')} data-lrow={el.id} ref={rowRef}
      onPointerDown={onPointerDown}
      onClick={(e) => onSelect(el.id, e.shiftKey)}
      onDoubleClick={() => setRenaming(true)}>
      {renaming ? (
        <input className="field" style={{ minHeight: 36, padding: '4px 8px' }} autoFocus defaultValue={el.name}
          onBlur={(e) => { onRename(el.id, e.target.value); setRenaming(false); }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') { onRename(el.id, e.target.value); setRenaming(false); } e.stopPropagation(); }} />
      ) : (
        <>
          {TYPE_ICONS[el.type] ? TYPE_ICONS[el.type]({}) : icons.select({})}
          <span>{el.name}</span>
          <span>{TYPE_LABELS[el.type]}</span>
        </>
      )}
    </li>
  );
}

export function LayersPanel({ page, selection, dispatch, apply, total }) {
  if (!page) return null;
  const top = [...page.elements].reverse(); // topmost first
  const select = (id, shift) => {
    if (shift) {
      const has = selection.includes(id);
      dispatch({ type: 'select', ids: has ? selection.filter((i) => i !== id) : [...selection, id] });
    } else {
      dispatch({ type: 'select', ids: [id] });
    }
  };
  const rename = (id, name) => {
    if (!name.trim()) return;
    apply((doc) => {
      const walkUp = (els) => {
        for (const el of els) {
          if (el.id === id) { el.name = name.trim(); return true; }
          if (el.children && walkUp(el.children)) return true;
        }
        return false;
      };
      const p = doc.pages.find((pp) => pp.id === page.id);
      walkUp(p.elements);
    }, true);
  };
  return (
    <div className="panel layers" data-layers-panel>
      <div className="section-label">Layers on {page.name}</div>
      <ul className="list" data-layers>
        {top.map((el, i) => (
          <LayerRow key={el.id} el={el} selected={selection.includes(el.id)} index={i} total={top.length}
            onSelect={select} onReorder={reorderRow(page, apply)} onRename={rename} />
        ))}
      </ul>
    </div>
  );
}

// Reorder: `target` is the row position topmost-first (0 = new top).
function reorderRow(page, apply) {
  return (id, target) => {
    apply((doc) => {
      const p = doc.pages.find((pp) => pp.id === page.id);
      const n = p.elements.length;
      // array index (bottom first): topmost-first target t -> index n - t,
      // removing the row first shifts higher indices down by one.
      const from = p.elements.findIndex((e) => e.id === id);
      let index = n - target;
      if (from < index) index -= 1;
      p.elements.splice(Math.max(0, Math.min(n - 1, index)), 0, p.elements.splice(from, 1)[0]);
      doc.updatedAt = Date.now();
    }, true);
  };
}

// ── Properties inspector ─────────────────────────────────────────────────

function NumField({ label, value, onCommit, style }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => {
    const n = parseFloat(v);
    if (Number.isFinite(n) && n !== value) onCommit(n);
    else setV(value);
  };
  return (
    <label className="f" style={style}>
      <b>{label}</b>
      <input className="num" inputMode="decimal" value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); e.stopPropagation(); }} />
    </label>
  );
}

function ColorField({ label, value, onCommit }) {
  return (
    <label className="f">
      <b>{label}</b>
      <input type="color" className="color" value={/^#[0-9a-fA-F]{6}$/.test(value || '') ? value : '#000000'}
        onChange={(e) => onCommit(e.target.value)} />
    </label>
  );
}

export function Inspector({ state, dispatch, apply, page, onAddImage, imgError }) {
  const sel = state.selection.map((id) => page.elements.find((el) => el.id === id)).filter(Boolean);
  const one = sel.length === 1 ? sel[0] : null;
  const pageMode = sel.length === 0;
  const [showAlign, setShowAlign] = useState(false);

  const set = (patch) => {
    const ids = state.selection;
    apply((doc) => updateElements(doc, page.id, ids, patch), true);
  };
  const setOne = (patch) => set(patch);

  const align = (mode) => {
    apply((doc) => {
      const p = doc.pages.find((pp) => pp.id === page.id);
      const chosen = p.elements.filter((e) => state.selection.includes(e.id));
      const boxes = chosen.map(boundsOfElement);
      const out = alignBoxes(boxes, p, mode);
      chosen.forEach((el, i) => {
        el.x += out[i].x - boxes[i].x;
        el.y += out[i].y - boxes[i].y;
      });
      doc.updatedAt = Date.now();
    }, true);
  };
  const distribute = (axis) => {
    apply((doc) => {
      const p = doc.pages.find((pp) => pp.id === page.id);
      const chosen = p.elements.filter((e) => state.selection.includes(e.id));
      const boxes = chosen.map(boundsOfElement);
      const out = distributeBoxes(boxes, axis);
      chosen.forEach((el, i) => {
        el.x += out[i].x - boxes[i].x;
        el.y += out[i].y - boxes[i].y;
      });
      doc.updatedAt = Date.now();
    }, true);
  };
  const remove = () => {
    apply((doc) => removeElements(doc, page.id, state.selection), true);
  };

  const title = pageMode ? 'Properties: ' + page.name : one ? 'Properties: ' + one.name : 'Properties: ' + sel.length + ' selected';

  return (
    <div className="panel props" data-inspector>
      <div className="section-label">{title}</div>
      {pageMode ? (
        <>
          <div className="list"><div className="grid">
            <label className="f"><b>Name</b><input className="num" value={page.name}
              onChange={(e) => apply((doc) => { doc.pages.find((p) => p.id === page.id).name = e.target.value; }, false)} />
            </label>
            <ColorField label="Page" value={page.background} onCommit={(v) => apply((doc) => { doc.pages.find((p) => p.id === page.id).background = v; }, true)} />
            <NumField label="W" value={page.width} onCommit={(v) => apply((doc) => { doc.pages.find((p) => p.id === page.id).width = Math.round(v); }, true)} />
            <NumField label="H" value={page.height} onCommit={(v) => apply((doc) => { doc.pages.find((p) => p.id === page.id).height = Math.round(v); }, true)} />
          </div></div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn-secondary" style={{ flex: 1 }} onClick={() => apply((doc) => {
              const i = doc.pages.findIndex((p) => p.id === page.id);
              const copy = structuredClone(doc.pages[i]);
              copy.id = Math.random().toString(36).slice(2, 10);
              copy.name = copy.name + ' copy';
              for (const el of copy.elements) { el.id = Math.random().toString(36).slice(2, 10); (el.children || []).forEach((c) => (c.id = Math.random().toString(36).slice(2, 10))); }
              for (const g of copy.guides) g.id = Math.random().toString(36).slice(2, 10);
              doc.pages.splice(i + 1, 0, copy);
              doc.updatedAt = Date.now();
            }, true)}>Duplicate page</button>
            <button className="btn-secondary" style={{ flex: 1 }} onClick={() => {
              if (page.elements.length > 0 && !window.confirm('Delete this page and everything on it?')) return;
              apply((doc) => {
                if (doc.pages.length > 1) { doc.pages = doc.pages.filter((p) => p.id !== page.id); doc.updatedAt = Date.now(); }
              }, true);
            }}>Delete page</button>
          </div>
        </>
      ) : one ? (
        <>
          <div className="list"><div className="grid">
            <NumField label="X" value={Math.round(one.x)} onCommit={(v) => setOne({ x: v })} />
            <NumField label="Y" value={Math.round(one.y)} onCommit={(v) => setOne({ y: v })} />
            <NumField label="W" value={Math.round(one.w)} onCommit={(v) => setOne({ w: Math.max(1, v) })} />
            <NumField label="H" value={Math.round(one.h)} onCommit={(v) => setOne({ h: Math.max(1, v) })} />
            <NumField label="Angle" value={Math.round(one.rotation || 0)} onCommit={(v) => setOne({ rotation: v })} />
            <NumField label="Opacity" value={Math.round((one.opacity ?? 1) * 100)} onCommit={(v) => setOne({ opacity: Math.min(1, Math.max(0, v / 100)) })} />
            {(one.type === 'rect' || one.type === 'ellipse') && (
              <>
                <ColorField label="Fill" value={one.fill} onCommit={(v) => setOne({ fill: v })} />
                <ColorField label="Stroke" value={one.stroke || '#000000'} onCommit={(v) => setOne({ stroke: v, strokeWidth: one.strokeWidth || 1 })} />
                <NumField label="Stroke width" style={{ gridColumn: 'span 2' }} value={one.strokeWidth || 0} onCommit={(v) => setOne({ strokeWidth: Math.max(0, v) })} />
                {one.type === 'rect' && <NumField label="Corner" value={one.radius || 0} onCommit={(v) => setOne({ radius: Math.max(0, v) })} />}
              </>
            )}
            {one.type === 'line' && (
              <>
                <ColorField label="Stroke" value={one.stroke} onCommit={(v) => setOne({ stroke: v })} />
                <NumField label="Stroke width" style={{ gridColumn: 'span 2' }} value={one.strokeWidth || 0} onCommit={(v) => setOne({ strokeWidth: Math.max(1, v) })} />
              </>
            )}
            {one.type === 'text' && (
              <>
                <label className="f"><b>Font</b>
                  <select className="num" value={one.font} onChange={(e) => setOne({ font: e.target.value })}>
                    {Object.entries(FONT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
                <NumField label="Size" value={one.size} onCommit={(v) => setOne({ size: Math.max(4, v) })} />
                <label className="f"><b>Weight</b>
                  <select className="num" value={String(one.weight)} onChange={(e) => setOne({ weight: Number(e.target.value) })}>
                    <option value="400">Regular</option>
                    <option value="700">Bold</option>
                  </select>
                </label>
                <label className="f"><b>Align</b>
                  <select className="num" value={one.align} onChange={(e) => setOne({ align: e.target.value })}>
                    <option value="left">Left</option>
                    <option value="center">Centre</option>
                    <option value="right">Right</option>
                  </select>
                </label>
                <ColorField label="Colour" value={one.color} onCommit={(v) => setOne({ color: v })} />
              </>
            )}
          </div></div>
          {(state.selection.length > 1 || showAlign) && sel.length > 0 && (
            <div className="align-row" data-align>
              {[['left', 'Left'], ['hcenter', 'Centre X'], ['right', 'Right'], ['top', 'Top'], ['vmiddle', 'Middle'], ['bottom', 'Bottom']].map(([mode, label]) => (
                <button key={mode} className="tool" title={label} aria-label={'Align ' + label} onClick={() => align(mode)}>
                  <AlignIcon mode={mode} />
                </button>
              ))}
              {state.selection.length > 2 && (
                <>
                  <button className="tool" title="Space evenly horizontally" aria-label="Distribute horizontally" onClick={() => distribute('x')}>↔</button>
                  <button className="tool" title="Space evenly vertically" aria-label="Distribute vertically" onClick={() => distribute('y')}>↕</button>
                </>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="list"><div className="grid">
          <div className="f"><b>Selected</b>{sel.length}</div>
        </div></div>
      )}
      {imgError && <div className="sub" style={{ padding: '0 4px 8px' }}>{imgError}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button type="button" className="btn-primary" style={{ flex: 1, minWidth: 150 }} onClick={onAddImage}>Add image</button>
        {sel.length > 0 && (
          <button type="button" className="btn-secondary" style={{ flex: 1 }} aria-expanded={showAlign}
            aria-label="Align" title="Align the selection" onClick={() => setShowAlign((s) => !s)}>Align</button>
        )}
        {sel.length > 0 && (
          <button type="button" className="btn-secondary" onClick={remove} aria-label="Delete">
            {icons.trash({})}
          </button>
        )}
      </div>
    </div>
  );
}

// Small alignment glyphs for the align row.
function AlignIcon({ mode }) {
  const box = 20;
  const bar = (x, y, w, h) => <rect x={x} y={y} width={w} height={h} rx="1.5" fill="currentColor" stroke="none" />;
  const line = (d) => <path d={d} />;
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      {mode === 'left' && <>{line('M5 4v16')}{bar(8, 9, 11, 6)}</>}
      {mode === 'hcenter' && <>{line('M12 4v16')}{bar(6, 9, 12, 6)}</>}
      {mode === 'right' && <>{line('M19 4v16')}{bar(5, 9, 11, 6)}</>}
      {mode === 'top' && <>{line('M4 5h16')}{bar(9, 8, 6, 11)}</>}
      {mode === 'vmiddle' && <>{line('M4 12h16')}{bar(9, 6, 6, 12)}</>}
      {mode === 'bottom' && <>{line('M4 19h16')}{bar(9, 5, 6, 11)}</>}
    </svg>
  );
}
