// The app shell: header, toolbar, page tabs, the canvas, the two panels,
// the dialogs, keyboard shortcuts, autosave wiring and the loading,
// empty and storage-error states.

import React, { Suspense, lazy, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import Canvas from '../render/Canvas.jsx';
import { LayersPanel, Inspector } from './panels.jsx';
import { NewDesignDialog, DesignsSheet, VersionHistoryDialog } from './dialogs.jsx';
import { icons } from './icons.jsx';
import {
  docReducer, initialDocState, pageOf, addElements, moveElements, removeElements, updateElements,
  duplicateSelection, groupSelection, ungroupSelection, pageAdd,
} from '../doc/store.js';
import { newDesign, newElement, uid, measureTextHeight, imageIdsIn, unionBoxes, boundsOfElement } from '../doc/model.js';
import {
  openDesignsDb, listDesigns, putDesign, deleteDesign, putImage, getImage, createAutoSaver, duplicateDesign,
  listAssets, putAsset, deleteAsset, getFavorites, setFavorite, listComponents, saveComponent, deleteComponent,
  componentElements, putVersion, listVersions,
} from '../persist/db.js';
import { writeProject, readProject, writeBackup, restoreBackup } from '../project/format.js';
import { ensureFont, fontsUsed, registerUserFont, forgetUserFont } from '../assets/fonts.js';
import {
  assetFromFile, classifyFile, elementForItem, applyBackground, placeOnPage,
} from '../assets/imports.js';
import { buildDemoDesigns } from '../demo.js';
import { shortcutFor, arrowDelta } from '../tools/shortcuts.js';

const TOOLS = [
  ['select', 'Select', 'V'],
  ['text', 'Text', 'T'],
  ['rect', 'Rectangle', 'R'],
  ['ellipse', 'Ellipse', 'E'],
  ['line', 'Line', 'L'],
];

// The library is its own chunk: its catalog, templates and previews load
// the first time someone opens it.
const Library = lazy(() => import('./Library.jsx'));
const ExportDialog = lazy(() => import('./ExportDialog.jsx'));
const loadTemplates = () => import('../assets/templates.js');

const isLibraryHash = () => /^#library\b/.test(window.location.hash);
const isExportHash = () => /^#export\b/.test(window.location.hash);
const isHistoryHash = () => /^#history\b/.test(window.location.hash);

// Browser checks for imported files.
const importChecks = {
  imageSize: (file) => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve({ w: img.naturalWidth, h: img.naturalHeight }); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
    img.src = url;
  }),
  font: (asset) => registerUserFont(asset),
};

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
  const [libraryOpen, setLibraryOpen] = useState(isLibraryHash);
  const [favorites, setFavorites] = useState(() => new Set());
  const [uploads, setUploads] = useState([]);
  const [components, setComponents] = useState([]);
  const [importError, setImportError] = useState('');
  const [exportOpen, setExportOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [versions, setVersions] = useState([]);
  const [note, setNote] = useState(''); // recovery / storage / save-failed notes
  const [storage, setStorage] = useState(null); // { text, fraction, persisted, onPersist }
  const lastVersionAt = useRef(0);
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
      for (const p of design.pages) for (const id of imageIdsIn(p.elements)) ids.add(id);
      for (const id of ids) {
        const blob = await getImage(dbLive.current, id);
        if (blob) map[id] = URL.createObjectURL(blob);
      }
    }
    setImages(map);
    dispatch({ type: 'load', doc: design, selection: opts.selection || [] });
    setPhase('ready');
    void listVersions(dbLive.current, design.id).then((rows) => setVersions(rows)).catch(() => setVersions([]));
    // Deep links into the export dialog and version history, like #library.
    for (const [is, set] of [[isExportHash, setExportOpen], [isHistoryHash, setHistoryOpen]]) {
      if (is()) {
        set(true);
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    }
  }, []);

  const refreshList = useCallback(async () => {
    if (!dbLive.current) return;
    setDesigns(await listDesigns(dbLive.current));
  }, []);

  // The library's own data on this device: imports (fonts registered so
  // designs using them draw right), saved components and favourites.
  const refreshLibrary = useCallback(async () => {
    const db = dbLive.current;
    if (!db) return;
    const assets = await listAssets(db);
    for (const a of assets) if (a.kind === 'font') await registerUserFont(a).catch(() => {});
    setUploads(assets);
    setComponents(await listComponents(db));
    setFavorites(await getFavorites(db));
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
      await refreshLibrary().catch(() => {});
      if (useDemo) {
        // The demo seeds a few obviously sample restore points, so Version
        // history can be seen populated.
        const poster = list.find((d) => d.name === 'Garden supper poster');
        if (poster && !(await listVersions(db, poster.id)).length) {
          for (const [mins, pageOf] of [[50, 1], [25, 2], [5, 3]]) {
            const clone = structuredClone(poster);
            clone.pages = clone.pages.slice(0, pageOf);
            clone.updatedAt = Date.now() - mins * 60 * 1000;
            const row = { id: `demo-${mins}`, designId: poster.id, createdAt: clone.updatedAt, pageCount: pageOf, doc: clone };
            await db.put('versions', row);
          }
        }
      }
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
  }, [open, refreshLibrary]);

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

  // ── Restore points: every 5 minutes of editing, on switching designs,
  // and just before a restore. The newest 30 are kept per design. ────────
  useEffect(() => {
    if (phase !== 'ready' || !state.doc || !dbLive.current) return;
    const t = setInterval(() => {
      const d = stateRef.current.doc;
      if (!d) return;
      if (Date.now() - lastVersionAt.current > 5 * 60 * 1000) {
        lastVersionAt.current = Date.now();
        putVersion(dbLive.current, d.id, d).then((row) => setVersions((v) => [row, ...v].slice(0, 30)))
          .catch(() => {});
      }
    }, 30000);
    return () => clearInterval(t);
  }, [phase]);

  // ── Crash recovery: a session marker says whether the last close was
  // clean. Changes flush the moment the tab hides or the page closes. ─────
  useEffect(() => {
    const key = 'home-studio:session';
    let last = null;
    try { last = JSON.parse(localStorage.getItem(key)); } catch { /* no marker yet */ }
    if (last && last.clean === false && last.designId) {
      const again = designs.find((d) => d.id === last.designId);
      if (again) setNote(`Home Studio closed unexpectedly last time. "${again.name}" was reopened from its last autosave.`);
    }
    try { localStorage.setItem(key, JSON.stringify({ designId: stateRef.current.doc ? stateRef.current.doc.id : null, clean: false })); } catch { /* ignore */ }
    const setClean = () => {
      try {
        const d = stateRef.current.doc;
        localStorage.setItem(key, JSON.stringify({ designId: d ? d.id : null, clean: true }));
      } catch { /* ignore */ }
      autoSaver.flush().catch(() => {});
    };
    const setUnclean = () => {
      try { localStorage.setItem(key, JSON.stringify({ designId: stateRef.current.doc ? stateRef.current.doc.id : null, clean: false })); } catch { /* ignore */ }
    };
    const onHide = () => (document.visibilityState === 'hidden' ? setClean() : setUnclean());
    window.addEventListener('pagehide', setClean);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', setClean);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [designs, autoSaver]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Storage: how much the designs use, whether the browser has
  // promised to keep them, and a warning when 80% full. ───────────────────
  const refreshStorage = useCallback(async () => {
    try {
      if (!navigator.storage || !navigator.storage.estimate) return;
      const { usage = 0, quota = 0 } = await navigator.storage.estimate();
      const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : true;
      const fraction = quota ? usage / quota : null;
      const mb = Math.round(usage / (1024 * 1024));
      const gb = Math.round(quota / (1024 * 1024 * 1024) * 10) / 10;
      setStorage({
        fraction, persisted,
        text: `Designs use ${mb} MB of the ${gb} GB this browser allows. Kept until you remove them.`,
        onPersist: async () => {
          try { await navigator.storage.persist(); } catch { /* refused */ }
          void refreshStorage();
        },
      });
      if (fraction != null && fraction >= 0.8) setNote((n) => n || 'Storage is nearly full on this device. Back up your designs or delete ones you no longer need.');
    } catch { /* no estimates here */ }
  }, []);
  useEffect(() => { void refreshStorage(); }, [refreshStorage, saveState]);

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

  // ── Library: imports, inserting, templates, favourites ────────────────
  const currentPage = () => {
    const st = stateRef.current;
    return st.doc ? st.doc.pages.find((pp) => pp.id === st.pageId) || st.doc.pages[0] : null;
  };
  const insertElements = useCallback((els) => {
    const p = currentPage();
    if (!p || !els.length) return;
    apply((dr) => addElements(dr, p.id, els), true);
    dispatch({ type: 'select', ids: els.map((el) => el.id) });
  }, [apply]); // eslint-disable-line react-hooks/exhaustive-deps

  // An imported image on the page: the element gets its own copy of the
  // blob, so deleting the design never removes the library's copy.
  const insertImageAsset = useCallback(async (asset) => {
    const p = currentPage();
    if (!p) return;
    const id = uid();
    try { if (dbLive.current) await putImage(dbLive.current, id, asset.blob); } catch { /* shows until reload */ }
    setImages((m) => ({ ...m, [id]: URL.createObjectURL(asset.blob) }));
    insertElements([newElement('image', placeOnPage(p, asset.w, asset.h, 0.6), {
      imageId: id, name: asset.name, natW: asset.w, natH: asset.h,
    })]);
  }, [insertElements]); // eslint-disable-line react-hooks/exhaustive-deps

  const showImportError = (msg) => {
    setImportError(msg);
    setImgError(msg);
    setTimeout(() => { setImportError(''); setImgError(''); }, 6000);
  };

  // Files from this device go into the library (Your files); with
  // `insert`, images and SVGs are also added to the current page.
  const importFiles = useCallback(async (files, insert) => {
    for (const file of files) {
      try {
        const asset = await assetFromFile(file, importChecks);
        try { if (dbLive.current) await putAsset(dbLive.current, asset); } catch { /* still usable this session */ }
        setUploads((list) => [asset, ...list]);
        if (insert && asset.kind === 'image') await insertImageAsset(asset);
        if (insert && asset.kind === 'svg') {
          const p = currentPage();
          if (p) insertElements([elementForItem({ kind: 'svg', name: asset.name, asset }, p)]);
        }
      } catch (err) {
        showImportError(err.message || "That file couldn't be imported.");
      }
    }
  }, [insertImageAsset, insertElements]); // eslint-disable-line react-hooks/exhaustive-deps

  const onFile = useCallback(async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    const usable = files.filter((f) => !['font', 'heic'].includes(classifyFile(f)));
    if (files.some((f) => classifyFile(f) === 'font')) showImportError('Fonts are imported from the library, under Your files.');
    if (files.some((f) => classifyFile(f) === 'heic')) showImportError("That HEIC photo can't be opened here. Most browsers can't read HEIC; save it as JPEG first.");
    if (usable.length) await importFiles(usable, true);
  }, [importFiles]); // eslint-disable-line react-hooks/exhaustive-deps

  // Import a file from the designs sheet: a project file comes back as a
  // new design, a backup restores, an image or SVG opens as its own design.
  const importFromSheet = useCallback(async (files) => {
    for (const f of files) {
      const kind = classifyFile(f);
      try {
        if (kind === 'project') {
          const { design, putImage: imgs, putAsset: fonts } = await readProject(f, { imageSize: importChecks.imageSize });
          for (const i of imgs) { try { if (dbLive.current) await putImage(dbLive.current, i.id, i.blob); } catch { /* shows until reload */ } }
          for (const ft of fonts) {
            const asset = { id: ft.id, kind: 'font', name: ft.name, createdAt: Date.now(), blob: ft.blob };
            try { if (dbLive.current) await putAsset(dbLive.current, asset); } catch { /* still usable */ }
            try { await registerUserFont(asset); } catch { /* fallback font */ }
            const key = 'user:' + ft.id;
            const remap = (els) => els.map((el) => {
              if (el.font === ft.key) el.font = key;
              if (el.children) remap(el.children);
              return el;
            });
            for (const p of design.pages) remap(p.elements);
          }
          if (dbLive.current) await putDesign(dbLive.current, design);
          await refreshList();
          await open(design);
          setSheet(false);
          return;
        }
        if (kind === 'backup') {
          if (!dbLive.current) throw new Error("Backups can't be restored on this device right now.");
          const added = await restoreBackup(dbLive.current, f);
          await refreshList();
          await refreshLibrary().catch(() => {});
          setImgError(`Restored: ${added.designs + added.restored} ${added.designs + added.restored === 1 ? 'design' : 'designs'} added, nothing replaced.`);
          setTimeout(() => setImgError(''), 5000);
          continue;
        }
        if (kind === 'pdf') {
          showImportError('PDF pages can\'t be brought in yet in this browser. Export your design to PDF from the Export dialog.');
          continue;
        }
        if (kind === 'image' || kind === 'svg') {
          // A picture opens as its own design at the picture's size.
          const asset = await assetFromFile(f, importChecks);
          try { if (dbLive.current) await putAsset(dbLive.current, asset); } catch { /* still usable */ }
          setUploads((list) => [asset, ...list]);
          const w = Math.min(10000, Math.max(16, Math.round(asset.w || 800)));
          const h = Math.min(10000, Math.max(16, Math.round(asset.h || 600)));
          const d = newDesign(asset.name, w, h);
          if (asset.blob) {
            const id = uid();
            try { if (dbLive.current) await putImage(dbLive.current, id, asset.blob); } catch { /* shows until reload */ }
            setImages((m) => ({ ...m, [id]: URL.createObjectURL(asset.blob) }));
            d.pages[0].elements.push(newElement('image', { x: 0, y: 0, w, h }, { imageId: id, natW: asset.w, natH: asset.h, name: asset.name }));
          } else if (asset.svg) {
            d.pages[0].elements.push(newElement('svg', { x: 0, y: 0, w, h }, { svg: asset.svg, name: asset.name }));
          }
          try { if (dbLive.current) await putDesign(dbLive.current, d); } catch { /* keep editing */ }
          await refreshList();
          await open(d);
          setSheet(false);
          return;
        }
        showImportError(`${f.name} isn't a project file, backup, image or SVG.`);
      } catch (err) {
        showImportError(err.message || "That file couldn't be imported.");
      }
    }
  }, [open, refreshList]); // eslint-disable-line react-hooks/exhaustive-deps

  // Download a design as an editable project file (.homestudio).
  const downloadDesign = useCallback(async (id) => {
    try {
      const d = stateRef.current.doc && stateRef.current.doc.id === id ? stateRef.current.doc : designs.find((x) => x.id === id);
      if (!d || !dbLive.current) return;
      const blob = await writeProject(dbLive.current, d);
      const { downloadBlob } = await import('../export/index.js');
      downloadBlob(blob, `${d.name.replace(/[\\/:*?"<>|#&]+/g, ' ').trim() || 'design'}.homestudio`);
    } catch (err) {
      showImportError(err.message || "The project file couldn't be written.");
    }
  }, [designs]);

  const backupAll = useCallback(async () => {
    if (!dbLive.current) { showImportError("Backups can't be written on this device right now."); return; }
    try {
      const blob = await writeBackup(dbLive.current);
      const { downloadBlob } = await import('../export/index.js');
      downloadBlob(blob, `Home Studio backup ${new Date().toISOString().slice(0, 10)}.homestudio-backup`);
    } catch (err) {
      showImportError(err.message || "The backup couldn't be written.");
    }
  }, []);

  // Restore an older restore point. Undo takes you straight back.
  const restoreVersion = useCallback(async (row) => {
    const d = stateRef.current.doc;
    if (!d || !dbLive.current) return;
    try { await putVersion(dbLive.current, d.id, d); } catch { /* history best-effort */ }
    apply(() => structuredClone(row.doc), true);
    const ids = new Set();
    for (const p of row.doc.pages) for (const id of imageIdsIn(p.elements)) ids.add(id);
    const map = { ...images };
    for (const id of ids) if (!map[id]) {
      const blob = await getImage(dbLive.current, id);
      if (blob) map[id] = URL.createObjectURL(blob);
    }
    setImages(map);
    setHistoryOpen(false);
  }, [apply, images]);

  const openLibrary = () => {
    if (!isLibraryHash()) window.location.hash = 'library';
    setLibraryOpen(true);
  };
  const closeLibrary = useCallback(() => {
    setLibraryOpen(false);
    if (isLibraryHash()) window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }, []);
  useEffect(() => {
    const onHash = () => {
      setLibraryOpen(isLibraryHash());
      if (isExportHash()) { setExportOpen(true); window.history.replaceState(null, '', window.location.pathname + window.location.search); }
      if (isHistoryHash()) { setHistoryOpen(true); window.history.replaceState(null, '', window.location.pathname + window.location.search); }
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const chooseTemplate = useCallback(async (tpl) => {
    const { instantiateTemplate } = await loadTemplates();
    const d = instantiateTemplate(tpl);
    try { if (dbLive.current) await putDesign(dbLive.current, d); } catch { /* keep editing */ }
    closeLibrary();
    await open(d);
    void refreshList();
  }, [open, refreshList, closeLibrary]);

  const insertItem = useCallback(async (item) => {
    const p = currentPage();
    if (!p) return;
    if (item.kind === 'component') {
      const c = item.component;
      const x = Math.round((p.width - c.w) / 2);
      const y = Math.round((p.height - c.h) / 2);
      const els = dbLive.current ? await componentElements(dbLive.current, c, x, y) : [];
      const map = {};
      for (const id of imageIdsIn(els)) {
        const blob = await getImage(dbLive.current, id);
        if (blob) map[id] = URL.createObjectURL(blob);
      }
      setImages((m) => ({ ...m, ...map }));
      insertElements(els);
    } else if (item.kind === 'upload' && item.asset.kind === 'image') {
      await insertImageAsset(item.asset);
    } else {
      const el = elementForItem(item, p);
      if (el) insertElements([el]);
    }
    closeLibrary();
  }, [insertElements, insertImageAsset, closeLibrary]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyPageBackground = useCallback((fill) => {
    const p = currentPage();
    if (!p) return;
    apply((dr) => { applyBackground(dr.pages.find((pp) => pp.id === p.id), fill); dr.updatedAt = Date.now(); }, true);
    dispatch({ type: 'select', ids: [] });
    closeLibrary();
  }, [apply, closeLibrary]); // eslint-disable-line react-hooks/exhaustive-deps

  // A font from the library: on the selected text if there is one, else a
  // new line of text set in it.
  const chooseFont = useCallback((key, name) => {
    const st = stateRef.current;
    const p = currentPage();
    if (!p) return;
    ensureFont(key);
    const texts = st.selection.map((id) => p.elements.find((el) => el.id === id)).filter((el) => el && el.type === 'text');
    if (texts.length) {
      apply((dr) => updateElements(dr, p.id, texts.map((t) => t.id), { font: key }), true);
    } else {
      const w = Math.round(p.width * 0.6);
      const el = newElement('text', { x: Math.round((p.width - w) / 2), y: Math.round(p.height / 2 - 40), w, h: 80 },
        { text: name, font: key, size: Math.max(24, Math.round(p.width / 14)), align: 'center' });
      el.h = measureTextHeight(el);
      insertElements([el]);
    }
    closeLibrary();
  }, [apply, insertElements, closeLibrary]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleFavorite = useCallback(async (id, on) => {
    setFavorites((f) => { const n = new Set(f); if (on) n.add(id); else n.delete(id); return n; });
    try { if (dbLive.current) setFavorites(await setFavorite(dbLive.current, id, on)); } catch { /* kept for this session */ }
  }, []);

  const removeUpload = useCallback(async (asset) => {
    if (!window.confirm(`Remove "${asset.name}" from your files? Designs that already use it keep it.`)) return;
    try { if (dbLive.current) await deleteAsset(dbLive.current, asset.id); } catch { /* nothing stored */ }
    if (asset.kind === 'font') forgetUserFont(asset.id);
    setUploads((list) => list.filter((a) => a.id !== asset.id));
  }, []);

  const removeComponent = useCallback(async (comp) => {
    if (!window.confirm(`Delete the component "${comp.name}"? Designs that already use it keep it.`)) return;
    try { if (dbLive.current) await deleteComponent(dbLive.current, comp.id); } catch { /* nothing stored */ }
    setComponents((list) => list.filter((c) => c.id !== comp.id));
  }, []);

  // Save the selection as a reusable component, kept in the library.
  const saveAsComponent = useCallback(async () => {
    const st = stateRef.current;
    const p = currentPage();
    if (!p || !st.selection.length) return;
    if (!dbLive.current) { showImportError("Components can't be saved on this device right now."); return; }
    const chosen = p.elements.filter((el) => st.selection.includes(el.id));
    const name = window.prompt('Name this component', chosen.length === 1 ? chosen[0].name : 'Component');
    if (name === null) return;
    const box = unionBoxes(chosen.map(boundsOfElement));
    try {
      const comp = await saveComponent(dbLive.current, name.trim() || 'Component', chosen, box);
      setComponents((list) => [comp, ...list]);
      setImgError(`Saved "${comp.name}" to the library, under Elements.`);
      setTimeout(() => setImgError(''), 4000);
    } catch {
      showImportError("The component couldn't be saved on this device.");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const copyDesign = useCallback(async (id) => {
    if (!dbLive.current) return;
    if (stateRef.current.doc?.id === id) await putDesign(dbLive.current, stateRef.current.doc);
    const copy = await duplicateDesign(dbLive.current, id);
    await refreshList();
    if (copy) await open(copy);
  }, [open, refreshList]);

  // Bundled fonts load the first time a page uses them.
  const pageFonts = page ? fontsUsed([page]).join(',') : '';
  useEffect(() => {
    if (pageFonts) pageFonts.split(',').forEach(ensureFont);
  }, [pageFonts]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t.isContentEditable) return;
      if (document.querySelector('[data-library]')) return; // the library has its own keys
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
          <div className="sub">{doc ? `${doc.name}, ${statusText}` : dbBroken ? 'Not saved' : 'Designs are saved on this device'}</div>
        </div>
        <span style={{ flex: 1 }} />
        <button className="ib" aria-label="Undo" disabled={!state.past.length} onClick={() => dispatch({ type: 'undo' })}>{icons.undo({})}</button>
        <button className="ib" aria-label="Redo" disabled={!state.future.length} onClick={() => dispatch({ type: 'redo' })}>{icons.redo({})}</button>
        <button className="ib" aria-label="Version history" title="Version history" data-history onClick={() => setHistoryOpen(true)}>{icons.history({})}</button>
        <button className="btn-primary" data-export onClick={() => setExportOpen(true)}>Export</button>
      </div>
      {note && (
        <div className="notice" role="status" data-note>
          <span style={{ flex: 1 }}>{note}</span>
          {/unexpectedly/.test(note) && <button className="btn-secondary" onClick={() => setHistoryOpen(true)}>Version history</button>}
          {/nearly full/.test(note) && <button className="btn-secondary" onClick={() => { setSheet(true); setNote(''); }}>Back up</button>}
          {/aren't saved/.test(note) && (
            <>
              <button className="btn-secondary" onClick={() => stateRef.current.doc && downloadDesign(stateRef.current.doc.id)}>Download this design</button>
              <button className="btn-secondary" onClick={() => { setSaveState('saving'); autoSaver.flush().catch(() => {}); }}>Retry</button>
            </>
          )}
          <button className="btn-secondary" aria-label="Dismiss note" onClick={() => setNote('')}>Dismiss</button>
        </div>
      )}
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
        <span className="sep" />
        <button className={'tool' + (libraryOpen ? ' on' : '')} title="Library: templates, elements, fonts"
          aria-label="Library" aria-pressed={libraryOpen} onClick={openLibrary} data-open-library>
          {icons.library({})}
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
              <button className="btn-secondary" onClick={openLibrary}>Start from a template</button>
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
            onAddImage={() => fileRef.current && fileRef.current.click()} imgError={imgError}
            onSaveComponent={saveAsComponent} />
        </div>
      )}
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/avif,image/bmp,image/svg+xml,.svg" multiple hidden onChange={onFile} />
      {sheet && doc && (
        <DesignsSheet designs={designs} currentId={doc.id} onClose={() => setSheet(false)}
          onOpen={async (d) => { setSheet(false); await open(d); }}
          onNew={() => { setSheet(false); setNewDialog(true); }}
          onDelete={(id) => removeDesign(id).then(() => setSheet(false))}
          onRename={renameDesign}
          onDuplicate={(id) => { setSheet(false); void copyDesign(id); }}
          onDownload={(id) => void downloadDesign(id)}
          onImport={(files) => void importFromSheet(files)}
          onBackup={() => void backupAll()}
          onRestoreBackup={(f) => void importFromSheet([f])}
          storage={storage} />
      )}
      {historyOpen && doc && (
        <VersionHistoryDialog design={doc} versions={versions} images={images}
          onRestore={(v) => void restoreVersion(v)} onClose={() => setHistoryOpen(false)} />
      )}
      {exportOpen && doc && (
        <Suspense fallback={<div className="dialog-scrim"><div className="dialog card" aria-busy="true"><div className="skeleton" style={{ height: 28, width: 120 }} /></div></div>}>
          <ExportDialog design={doc} page={p2 || doc.pages[0]} images={images} onClose={() => setExportOpen(false)} />
        </Suspense>
      )}
      {libraryOpen && (
        <Suspense fallback={<div className="dialog-scrim"><div className="dialog card lib" aria-busy="true"><div className="skeleton" style={{ height: 28, width: 120 }} /></div></div>}>
          <Library hasDesign={!empty} favorites={favorites} uploads={uploads} components={components} importError={importError}
            onToggleFavorite={toggleFavorite} onUseTemplate={chooseTemplate} onInsert={insertItem}
            onApplyBackground={applyPageBackground} onUseFont={chooseFont} onImport={(files) => importFiles(files, false)}
            onDeleteUpload={removeUpload} onDeleteComponent={removeComponent} onClose={closeLibrary} />
        </Suspense>
      )}
      {newDialog && <NewDesignDialog onCreate={createNew} onCancel={() => setNewDialog(false)}
        onTemplates={() => { setNewDialog(false); openLibrary(); }} />}
    </div>
  );
}
