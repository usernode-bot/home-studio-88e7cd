// The app shell: header, toolbar, page tabs, the canvas, the two panels,
// the dialogs, keyboard shortcuts, autosave wiring and the loading,
// empty and storage-error states.

import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import Canvas from '../render/Canvas.jsx';
import { LayersPanel, Inspector } from './panels.jsx';
import { NewDesignDialog, DesignsSheet } from './dialogs.jsx';
import { icons } from './icons.jsx';
import {
  docReducer, initialDocState, pageOf, addElements, moveElements, removeElements,
  duplicateSelection, groupSelection, ungroupSelection, pageAdd,
} from '../doc/store.js';
import { newDesign, newElement, uid, measureTextHeight } from '../doc/model.js';
import {
  openDesignsDb, listDesigns, putDesign, deleteDesign, putImage, getImage, createAutoSaver,
} from '../persist/db.js';
import { buildDemoDesigns } from '../demo.js';
import { shortcutFor, arrowDelta } from '../tools/shortcuts.js';

const TOOLS = [
  ['select', 'Select', 'V'],
  ['text', 'Text', 'T'],
  ['rect', 'Rectangle', 'R'],
  ['ellipse', 'Ellipse', 'E'],
  ['line', 'Line', 'L'],
];

const reid = () => Math.random().toString(36).slice(2, 10);

export default function App() {
  const [state, dispatch] = useReducer(docReducer, undefined, initialDocState);
  const [phase, setPhase] = useState('loading'); // loading | ready | empty
  const [dbBroken, setDbBroken] = useState(false);
  const [designs, setDesigns] = useState([]);
  const [demo, setDemo] = useState(false);
  const [saveState, setSaveState] = useState('saved');
  const [zoom, setZoom] = useState(1);
  const [view, setView] = useState({ x: 0, y: 0 });
  const [sheet, setSheet] = useState(false);
  const [newDialog, setNewDialog] = useState(false);
  const [images, setImages] = useState({});
  const [imgError, setImgError] = useState('');
  const apiRef = useRef(null);
  const fileRef = useRef(null);
  const dbLive = useRef(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const apply = useCallback((fn, history) => dispatch({ type: 'apply', fn, history: !!history }), []);
  const doc = state.doc;
  const page = pageOf(state);

  // ── Boot: staging demo, the database, the newest design ───────────────
  const open = useCallback(async (design, opts = {}) => {
    const map = {};
    if (dbLive.current) {
      const ids = new Set();
      for (const p of design.pages) {
        for (const el of p.elements) {
          if (el.type === 'image' && el.imageId) ids.add(el.imageId);
          for (const c of el.children || []) if (c.type === 'image' && c.imageId) ids.add(c.imageId);
        }
      }
      for (const id of ids) {
        const blob = await getImage(dbLive.current, id);
        if (blob) map[id] = URL.createObjectURL(blob);
      }
    }
    setImages(map);
    dispatch({ type: 'load', doc: design, selection: opts.selection || [] });
    setPhase('ready');
  }, []);

  const refreshList = useCallback(async () => {
    if (!dbLive.current) return;
    setDesigns(await listDesigns(dbLive.current));
  }, []);

  const boot = useCallback(async () => {
    setPhase('loading');
    let staging = false;
    try {
      const res = await fetch('/api/env');
      staging = (await res.json()).staging === true;
    } catch { /* offline or plain local run: no demo */ }
    const useDemo = staging && new URLSearchParams(window.location.search).get('demo') === '1';
    setDemo(useDemo);
    try {
      const db = await openDesignsDb(useDemo);
      dbLive.current = db;
      if (useDemo && !(await listDesigns(db)).length) {
        for (const d of buildDemoDesigns()) await putDesign(db, d);
      }
      const list = await listDesigns(db);
      setDesigns(list);
      setDbBroken(false);
      if (list.length) {
        const wantDemoSelection = useDemo && list[0].pages[0]?.elements.some((e) => e.id === 'd-block');
        await open(list[0], { selection: wantDemoSelection ? ['d-block'] : [] });
      } else {
        setPhase('empty');
      }
    } catch {
      // Storage can't open: editing still works, nothing saves.
      dbLive.current = null;
      setDbBroken(true);
      setDesigns([]);
      setPhase('empty');
    }
  }, [open]);

  useEffect(() => { boot(); }, [boot]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Autosave: debounced 800 ms after each change ──────────────────────
  const autoSaver = useMemo(() => createAutoSaver(async (d) => {
    if (!dbLive.current) { setSaveState('error'); return; }
    try {
      await putDesign(dbLive.current, d);
      setSaveState('saved');
      void refreshList();
    } catch {
      setSaveState('error');
    }
  }), [refreshList]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (phase !== 'ready' || !state.doc) return;
    setSaveState('saving');
    autoSaver.schedule(state.doc);
  }, [state.doc, phase, autoSaver]);

  // ── Designs: create, open, rename, delete ─────────────────────────────
  const createNew = useCallback(async ({ name, width, height }) => {
    const d = newDesign(name, width, height);
    try { if (dbLive.current) await putDesign(dbLive.current, d); } catch { /* keep editing */ }
    setNewDialog(false);
    await open(d);
    void refreshList();
  }, [open, refreshList]);

  const renameDesign = useCallback(async (id, name) => {
    if (!name.trim() || !dbLive.current) return;
    const d = designs.find((x) => x.id === id);
    if (!d) return;
    await putDesign(dbLive.current, { ...structuredClone(d), name: name.trim() });
    if (stateRef.current.doc?.id === id) apply((dr) => { dr.name = name.trim(); }, false);
    void refreshList();
  }, [designs, apply, refreshList]);

  const removeDesign = useCallback(async (id) => {
    const d = designs.find((x) => x.id === id);
    if (!d) return;
    if (!window.confirm(`Delete "${d.name}"? This can't be undone.`)) return;
    try { await deleteDesign(dbLive.current, id); } catch { /* nothing to clean up */ }
    await refreshList();
    if (stateRef.current.doc?.id === id) {
      const rest = await listDesigns(dbLive.current);
      if (rest.length) await open(rest[0]);
      else { dispatch({ type: 'load', doc: null }); setPhase('empty'); }
    }
  }, [designs, open, refreshList]);

  // ── Images from this device ───────────────────────────────────────────
  const onFile = useCallback(async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const st = stateRef.current;
    const p = st.doc ? st.doc.pages.find((pp) => pp.id === st.pageId) : null;
    if (!p) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = async () => {
      const id = uid();
      const scale = Math.min((p.width * 0.6) / img.naturalWidth, (p.height * 0.6) / img.naturalHeight, 1);
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const el = newElement('image', { x: Math.round((p.width - w) / 2), y: Math.round((p.height - h) / 2), w, h },
        { imageId: id, name: file.name.replace(/\.[^.]+$/, '') || 'Image' });
      try { if (dbLive.current) await putImage(dbLive.current, id, file); } catch { /* keeps showing until reload */ }
      setImages((m) => ({ ...m, [id]: url }));
      apply((dr) => addElements(dr, p.id, [el]), true);
      dispatch({ type: 'select', ids: [el.id] });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setImgError("That file isn't an image this browser can open.");
      setTimeout(() => setImgError(''), 5000);
    };
    img.src = url;
  }, [apply]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.isContentEditable) return;
      const st = stateRef.current;
      const p = st.doc ? st.doc.pages.find((pp) => pp.id === st.pageId) : null;
      if (!p) return;
      const arrow = arrowDelta(e);
      if (arrow && st.selection.length) {
        e.preventDefault();
        apply((dr) => moveElements(dr, p.id, st.selection, arrow.dx, arrow.dy), true);
        return;
      }
      const action = shortcutFor(e);
      if (!action) return;
      e.preventDefault();
      if (action.startsWith('tool:')) { dispatch({ type: 'tool', tool: action.slice(5) }); return; }
      switch (action) {
        case 'undo': dispatch({ type: 'undo' }); break;
        case 'redo': dispatch({ type: 'redo' }); break;
        case 'delete':
          if (st.selection.length) apply((dr) => removeElements(dr, p.id, st.selection), true);
          break;
        case 'duplicate': {
          if (!st.selection.length) break;
          const draft = structuredClone(st.doc);
          const r = duplicateSelection(draft, p.id, st.selection);
          dispatch({ type: 'apply', fn: () => structuredClone(r.doc), history: true });
          dispatch({ type: 'select', ids: r.newIds });
          break;
        }
        case 'group': {
          if (st.selection.length < 2) break;
          const draft = structuredClone(st.doc);
          groupSelection(draft, p.id, st.selection);
          const gid = draft.pages.find((pp) => pp.id === p.id).elements.at(-1).id;
          dispatch({ type: 'apply', fn: () => structuredClone(draft), history: true });
          dispatch({ type: 'select', ids: [gid] });
          break;
        }
        case 'ungroup': {
          const draft = structuredClone(st.doc);
          const r = ungroupSelection(draft, p.id, st.selection);
          if (!r.freedIds.length) break;
          dispatch({ type: 'apply', fn: () => structuredClone(r.doc), history: true });
          dispatch({ type: 'select', ids: r.freedIds });
          break;
        }
        case 'select-all':
          dispatch({ type: 'select', ids: p.elements.map((el) => el.id) });
          break;
        case 'zoom-in': if (apiRef.current) apiRef.current.zoom(1.25); break;
        case 'zoom-out': if (apiRef.current) apiRef.current.zoom(1 / 1.25); break;
        case 'zoom-reset': if (apiRef.current) apiRef.current.fit(); break;
        case 'add-guide':
          apply((dr) => {
            const pg = dr.pages.find((pp) => pp.id === p.id);
            pg.guides.push({ id: uid(), axis: 'h', pos: Math.round(p.height / 2) });
            dr.updatedAt = Date.now();
          }, true);
          break;
        case 'escape':
          dispatch({ type: 'editing', id: null });
          dispatch({ type: 'select', ids: [] });
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [apply]);

  // ── Toolbar actions ───────────────────────────────────────────────────
  const hasGroup = state.selection.some((id) => page?.elements.find((el) => el.id === id)?.type === 'group');
  const groupOrUngroup = () => {
    if (!page) return;
    if (hasGroup) {
      const draft = structuredClone(state.doc);
      const r = ungroupSelection(draft, page.id, state.selection);
      if (!r.freedIds.length) return;
      dispatch({ type: 'apply', fn: () => structuredClone(r.doc), history: true });
      dispatch({ type: 'select', ids: r.freedIds });
    } else {
      if (state.selection.length < 2) return;
      const draft = structuredClone(state.doc);
      groupSelection(draft, page.id, state.selection);
      const gid = draft.pages.find((pp) => pp.id === page.id).elements.at(-1).id;
      dispatch({ type: 'apply', fn: () => structuredClone(draft), history: true });
      dispatch({ type: 'select', ids: [gid] });
    }
  };
  const addVGuide = () => {
    if (!page) return;
    apply((dr) => {
      const pg = dr.pages.find((pp) => pp.id === page.id);
      pg.guides.push({ id: uid(), axis: 'v', pos: Math.round(page.width / 2) });
      dr.updatedAt = Date.now();
    }, true);
  };
  const switchPage = (pageId) => dispatch({ type: 'set-page', pageId });
  const addPage = () => {
    if (!page) return;
    const draft = structuredClone(state.doc);
    const id = pageAdd(draft, page.id);
    dispatch({ type: 'apply', fn: () => structuredClone(draft), history: true });
    dispatch({ type: 'set-page', pageId: id });
  };

  const statusText = dbBroken ? 'Not saved' : saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Not saved' : 'saved on this device';

  // ── Loading state ─────────────────────────────────────────────────────
  if (phase === 'loading') {
    return (
      <div className="app" aria-busy="true">
        <div className="top">
          <div>
            <h1>Home Studio</h1>
            <div className="sub"><span className="skeleton" style={{ display: 'inline-block', width: 150, height: 14 }} /></div>
          </div>
          <span style={{ flex: 1 }} />
        </div>
        <div className="toolbar">{TOOLS.map(([t]) => <span key={t} className="skeleton" style={{ width: 32, height: 32, borderRadius: 8 }} />)}</div>
        <div className="work"><div className="skeleton" style={{ position: 'absolute', left: '50%', top: '50%', width: 200, height: 140, transform: 'translate(-50%,-50%)' }} /></div>
        <div className="panel">
          <div className="section-label">Layers</div>
          <ul className="list">{[0, 1, 2, 3].map((i) => <li key={i} className="list-row"><span className="skeleton" style={{ width: i % 2 ? 90 : 140, height: 14 }} /></li>)}</ul>
        </div>
        <div className="panel">
          <div className="section-label">Properties</div>
          <div className="list"><div className="grid">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="f"><b>X</b><span className="skeleton" style={{ width: 40, height: 12 }} /></div>)}</div></div>
        </div>
      </div>
    );
  }

  const empty = phase === 'empty' || !doc;
  const p2 = page || null;

  return (
    <div className="app">
      <div className="top">
        <div>
          <h1><button className="title-btn" onClick={() => setSheet(true)} aria-label="Home Studio: open the designs on this device">Home Studio</button></h1>
          <div className="sub">{doc ? `${doc.name}, ${statusText}` : 'Designs are saved on this device'}</div>
        </div>
        <span style={{ flex: 1 }} />
        <button className="ib" aria-label="Undo" disabled={!state.past.length} onClick={() => dispatch({ type: 'undo' })}>{icons.undo({})}</button>
        <button className="ib" aria-label="Redo" disabled={!state.future.length} onClick={() => dispatch({ type: 'redo' })}>{icons.redo({})}</button>
      </div>
      {dbBroken && (
        <div className="state-error" role="alert" style={{ borderBottom: '1px solid rgb(var(--line))' }}>
          <div>Designs can't be saved on this device right now. Editing still works without saving.</div>
          <button className="btn-secondary" onClick={() => boot()}>Retry</button>
        </div>
      )}
      {demo && (
        <div className="sub" data-usernode-demo-note style={{ padding: '8px 16px' }}>
          Staging demo: sample designs, kept apart from your own.
        </div>
      )}
      <div className="toolbar" role="toolbar" aria-label="Tools">
        {TOOLS.map(([t, label, key]) => (
          <button key={t} className={'tool' + (state.tool === t && !empty ? ' on' : '')} title={`${label} (${key})`}
            aria-label={label + ', shortcut ' + key} aria-pressed={state.tool === t && !empty}
            disabled={empty} onClick={() => dispatch({ type: 'tool', tool: t })}>
            {icons[t]({})}
          </button>
        ))}
        <span className="sep" />
        <button className="tool" title={hasGroup ? 'Ungroup (Ctrl+Shift+G)' : 'Group (Ctrl+G)'}
          aria-label={hasGroup ? 'Ungroup' : 'Group'} disabled={empty || (!hasGroup && state.selection.length < 2)}
          onClick={groupOrUngroup}>
          {icons.group({})}
        </button>
        <button className="tool" title="Add guide (G)" aria-label="Add guide" disabled={empty} onClick={addVGuide}>
          {icons.guide({})}
        </button>
      </div>
      {doc && p2 && (
        <div className="pages" data-pages>
          {doc.pages.map((pg) => (
            <button key={pg.id} className={'pg' + (pg.id === p2.id ? ' on' : '')} onClick={() => switchPage(pg.id)}>{pg.name}</button>
          ))}
          <button className="pg" onClick={addPage}>+ Add</button>
          <span style={{ marginLeft: 'auto' }} className="sub">{p2.width} × {p2.height}</span>
        </div>
      )}
      {empty && (
        <div className="work" data-empty>
          {dbBroken ? (
            <div className="state-error" data-empty role="alert">
              <h2 className="text-heading">Designs can't be saved on this device right now.</h2>
              <p className="sub">Editing still works without saving.</p>
              <button className="btn-secondary" onClick={() => boot()}>Retry</button>
            </div>
          ) : (
            <div className="state-empty">
              <h2 className="text-heading">No designs yet</h2>
              <p className="sub">Make a design at a size you set, then add text, shapes and images.</p>
              <button className="btn-primary" onClick={() => setNewDialog(true)}>New design</button>
            </div>
          )}
        </div>
      )}
      {!empty && (
        <div className="main">
          <LayersPanel page={p2} selection={state.selection} dispatch={dispatch} apply={apply} />
          <Canvas state={state} dispatch={dispatch} apply={apply} page={p2}
            zoom={zoom} setZoom={setZoom} view={view} setView={setView}
            images={images} onFitReady={(a) => (apiRef.current = a)} />
          <Inspector state={state} dispatch={dispatch} apply={apply} page={p2}
            onAddImage={() => fileRef.current && fileRef.current.click()} imgError={imgError} />
        </div>
      )}
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
      {sheet && doc && (
        <DesignsSheet designs={designs} currentId={doc.id} onClose={() => setSheet(false)}
          onOpen={async (d) => { setSheet(false); await open(d); }}
          onNew={() => { setSheet(false); setNewDialog(true); }}
          onDelete={(id) => removeDesign(id).then(() => setSheet(false))}
          onRename={renameDesign} />
      )}
      {newDialog && <NewDesignDialog onCreate={createNew} onCancel={() => setNewDialog(false)} />}
    </div>
  );
}
