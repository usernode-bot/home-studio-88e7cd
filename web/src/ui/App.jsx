// The app shell: header, toolbar, page tabs, the canvas, the two panels,
// the dialogs, keyboard shortcuts, autosave wiring and the loading,
// empty and storage-error states. Phase 3 adds the File menu (export,
// opening files, project files, version history, backup and storage),
// crash recovery and the storage warnings.

import React, { Suspense, lazy, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import Canvas from '../render/Canvas.jsx';
import { LayersPanel, Inspector } from './panels.jsx';
import { NewDesignDialog, DesignsSheet } from './dialogs.jsx';
import { FileMenu, VersionsDialog, BackupDialog } from './fileDialogs.jsx';
import { icons } from './icons.jsx';
import {
  docReducer, initialDocState, pageOf, addElements, moveElements, removeElements, updateElements,
  duplicateSelection, groupSelection, ungroupSelection, pageAdd,
} from '../doc/store.js';
import {
  newDesign, newPage, newElement, uid, measureTextHeight, imageIdsIn, unionBoxes, boundsOfElement, PAGE_MAX, PAGE_MIN,
} from '../doc/model.js';
import {
  openDesignsDb, listDesigns, putDesign, getDesign, deleteDesign, putImage, getImage, createAutoSaver, duplicateDesign,
  listAssets, putAsset, deleteAsset, getFavorites, setFavorite, listComponents, saveComponent, deleteComponent,
  componentElements, listVersions, addVersion, autoVersionDue, collectProject, collectBackup, importProject,
  restoreBackup, getPref, setPref,
} from '../persist/db.js';
import { writeJournal, readJournal, clearJournal, recoveryOffer } from '../persist/recovery.js';
import { storageStatus, askToPersist, isQuotaError } from '../persist/storage.js';
import {
  parseHomeStudioFile, serializeProject, serializeBackup, freshCopy, PROJECT_SUFFIX, BACKUP_SUFFIX,
} from '../io/project.js';
import { safeFileName } from '../io/binary.js';
import { downloadBlob } from '../io/download.js';
import { ensureFont, fontsUsed, registerUserFont, forgetUserFont } from '../assets/fonts.js';
import {
  assetFromFile, classifyFile, elementForItem, applyBackground, placeOnPage, IMAGE_ACCEPT, baseName,
} from '../assets/imports.js';
import { svgSize } from '../assets/svg.js';
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
// The exporters load the first time someone exports, pdf.js the first time
// a PDF is opened.
const ExportDialog = lazy(() => import('./ExportDialog.jsx'));
const loadPdfImport = () => import('../import/pdf.js');

const OPEN_ACCEPT = `${IMAGE_ACCEPT},image/svg+xml,.svg,application/pdf,.pdf,application/json,.json`;
const isPdfFileName = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');
const isJsonFile = (f) => /json/.test(f.type || '') || /\.json$/i.test(f.name || '');
const STORAGE_CHECK_MS = 2 * 60 * 1000;
const journalStore = () => { try { return window.localStorage; } catch { return null; } };
const loadTemplates = () => import('../assets/templates.js');

const isLibraryHash = () => /^#library\b/.test(window.location.hash);

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
  // Formats not every browser shows (AVIF, BMP, HEIC, TIFF) are redrawn as PNG.
  toPng: (file) => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      c.toBlob((blob) => (blob ? resolve({ blob, w: c.width, h: c.height }) : reject(new Error('encode'))), 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
    img.src = url;
  }),
};

// A page size that fits an image of w × h inside the page limits.
function pageSizeFor(w, h) {
  const shrink = Math.min(1, PAGE_MAX / Math.max(w, h));
  const grow = Math.max(1, PAGE_MIN / Math.min(w, h));
  const s = shrink < 1 ? shrink : grow;
  return { width: Math.min(PAGE_MAX, Math.max(PAGE_MIN, Math.round(w * s))), height: Math.min(PAGE_MAX, Math.max(PAGE_MIN, Math.round(h * s))) };
}

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
  const [fileMenu, setFileMenu] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(null); // null, or { restore: parsed backup | null }
  const [notice, setNotice] = useState(null); // { tone: 'info' | 'error', text }
  const [recovery, setRecovery] = useState(null); // a design offered back after a crash
  const [quota, setQuota] = useState({ level: 'ok', dismissed: false });
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  const [lastBackupAt, setLastBackupAt] = useState(null);
  const apiRef = useRef(null);
  const fileRef = useRef(null);
  const openRef = useRef(null);
  const dbLive = useRef(null);
  const dbName = useRef('home-studio');
  const lastVersions = useRef({});
  const storageCheckedAt = useRef(0);
  const noticeTimer = useRef(null);
  const recoveryRef = useRef(null);
  recoveryRef.current = recovery;
  const imagesRef = useRef(images);
  imagesRef.current = images;
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
    dbName.current = useDemo ? 'home-studio-demo' : 'home-studio';
    try {
      const db = await openDesignsDb(useDemo);
      dbLive.current = db;
      // A copy of unsaved work left by a crash or a closed tab.
      const journal = journalStore() && readJournal(journalStore(), dbName.current);
      if (journal) {
        const offer = recoveryOffer(journal, await getDesign(db, journal.doc.id));
        if (offer) setRecovery(offer);
        else clearJournal(journalStore(), dbName.current, null);
      }
      setLastBackupAt((await getPref(db, 'lastBackupAt').catch(() => null)) || null);
      void storageStatus().then((st) => { if (st && st.level !== 'ok') setQuota({ level: st.level, dismissed: false }); });
      if (useDemo && !(await listDesigns(db)).length) {
        for (const d of buildDemoDesigns()) await putDesign(db, d);
      }
      const list = await listDesigns(db);
      setDesigns(list);
      setDbBroken(false);
      await refreshLibrary().catch(() => {});
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
    const db = dbLive.current;
    if (!db) { setSaveState('error'); return; }
    try {
      await putDesign(db, d);
      setSaveState('saved');
      if (!recoveryRef.current && journalStore()) clearJournal(journalStore(), dbName.current, d);
      void refreshList();
    } catch (err) {
      setSaveState('error');
      if (isQuotaError(err)) setQuota({ level: 'full', dismissed: false });
      return;
    }
    // An automatic version every 10 minutes of changes.
    try {
      const lv = lastVersions.current;
      if (!(d.id in lv)) lv[d.id] = (await listVersions(db, d.id))[0] || null;
      if (autoVersionDue(d, lv[d.id])) lv[d.id] = await addVersion(db, d, 'Autosaved', true);
    } catch { /* the design itself is saved */ }
    if (Date.now() - storageCheckedAt.current > STORAGE_CHECK_MS) {
      storageCheckedAt.current = Date.now();
      const st = await storageStatus();
      if (st) setQuota((q) => (q.level === st.level ? q : { level: st.level, dismissed: false }));
    }
  }), [refreshList]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (phase !== 'ready' || !state.doc) return;
    setSaveState('saving');
    autoSaver.schedule(state.doc);
  }, [state.doc, phase, autoSaver]);

  // Crash recovery: every change is copied to localStorage at once (within
  // 300 ms), and cleared when the autosave lands. Paused while a recovered
  // copy is waiting for a decision, so it isn't overwritten.
  useEffect(() => {
    if (phase !== 'ready' || !state.doc || recovery || !journalStore()) return undefined;
    const t = setTimeout(() => writeJournal(journalStore(), dbName.current, state.doc), 300);
    return () => clearTimeout(t);
  }, [state.doc, phase, recovery]);

  // Save straight away when the page is hidden or closed.
  useEffect(() => {
    const flush = () => {
      const st = stateRef.current;
      if (st.doc && !recoveryRef.current && journalStore()) writeJournal(journalStore(), dbName.current, st.doc);
      void autoSaver.flush().catch(() => {});
    };
    const onVis = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVis);
    return () => { window.removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', onVis); };
  }, [autoSaver]);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

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
    const usable = files.filter((f) => classifyFile(f) !== 'font');
    if (files.length && !usable.length) showImportError('Fonts are imported from the library, under Your files.');
    if (usable.length) await importFiles(usable, true);
  }, [importFiles]); // eslint-disable-line react-hooks/exhaustive-deps

  const openLibrary = () => {
    if (!isLibraryHash()) window.location.hash = 'library';
    setLibraryOpen(true);
  };
  const closeLibrary = useCallback(() => {
    setLibraryOpen(false);
    if (isLibraryHash()) window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }, []);
  useEffect(() => {
    const onHash = () => setLibraryOpen(isLibraryHash());
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

  // ── File: notices, opening files, project files, backup, versions ─────
  const showNotice = useCallback((tone, text, keep) => {
    clearTimeout(noticeTimer.current);
    setNotice(text ? { tone, text } : null);
    if (text && !keep) noticeTimer.current = setTimeout(() => setNotice(null), tone === 'error' ? 10000 : 6000);
  }, []);

  // Reads an image blob or an imported font from this device, or from what
  // the open design holds when storage is broken.
  const fileAccess = useMemo(() => ({
    getImage: async (id) => {
      if (dbLive.current) { const b = await getImage(dbLive.current, id); if (b) return b; }
      const url = imagesRef.current[id];
      return url ? (await fetch(url)).blob() : null;
    },
    getAsset: async (id) => (dbLive.current ? dbLive.current.get('assets', id) : null),
    getFontBlob: async (id) => (dbLive.current ? ((await dbLive.current.get('assets', id)) || {}).blob || null : null),
  }), []);

  // Open a design that came from a file: store it and its images, then show it.
  const openImported = useCallback(async (design, images) => {
    const urls = {};
    for (const img of images) {
      const blob = img.blob || new Blob([img.bytes], { type: img.type });
      if (dbLive.current) { try { await putImage(dbLive.current, img.id, blob); } catch { /* shows until reload */ } }
      urls[img.id] = URL.createObjectURL(blob);
    }
    try { if (dbLive.current) await putDesign(dbLive.current, design); } catch { /* keep editing */ }
    await open(design);
    setImages((m) => ({ ...m, ...urls }));
    void refreshList();
  }, [open, refreshList]);

  const openProjectFile = useCallback(async (parsed) => {
    let design;
    if (dbLive.current) {
      design = await importProject(dbLive.current, parsed);
      await open(design);
      await refreshLibrary().catch(() => {});
      void refreshList();
    } else {
      const copy = freshCopy(parsed);
      design = copy.design;
      await openImported(design, copy.images);
    }
    showNotice('info', [`Opened "${design.name}".`, ...parsed.warnings].join(' '));
  }, [open, openImported, refreshLibrary, refreshList, showNotice]);

  const openPdfFile = useCallback(async (file) => {
    showNotice('info', `Opening ${file.name}…`, true);
    const { openPdf, PDF_MAX_PAGES } = await loadPdfImport();
    const pdf = await openPdf(new Uint8Array(await file.arrayBuffer()));
    try {
      if (pdf.projectText) {
        try {
          const parsed = parseHomeStudioFile(pdf.projectText);
          if (parsed.kind === 'project') { await openProjectFile(parsed); return; }
        } catch { /* open its pages as pictures instead */ }
      }
      const count = Math.min(pdf.pageCount, PDF_MAX_PAGES);
      const design = newDesign(baseName(file.name), 1080, 1080);
      design.pages = [];
      const images = [];
      for (let n = 1; n <= count; n++) {
        showNotice('info', `Opening page ${n} of ${count}…`, true);
        const r = await pdf.renderPage(n);
        const id = uid();
        images.push({ id, blob: r.blob });
        const pg = newPage(`Page ${n}`, r.width, r.height);
        pg.elements.push(newElement('image', { x: 0, y: 0, w: r.width, h: r.height }, { imageId: id, name: `PDF page ${n}`, natW: r.natW, natH: r.natH }));
        design.pages.push(pg);
      }
      await openImported(design, images);
      showNotice('info', `Opened "${design.name}". Its pages are pictures, so their text can't be edited, but you can add to them.`
        + (pdf.pageCount > count ? ` Only the first ${count} of ${pdf.pageCount} pages were opened.` : ''));
    } finally {
      pdf.close();
    }
  }, [openImported, openProjectFile, showNotice]);

  // An image or SVG opened as a new design at its own size.
  const openPictureFile = useCallback(async (file) => {
    const asset = await assetFromFile(file, importChecks);
    if (asset.kind === 'font') throw new Error('Fonts are imported from the library, under Your files.');
    const { width, height } = pageSizeFor(asset.w || svgSize(asset.svg).w, asset.h || svgSize(asset.svg).h);
    const design = newDesign(asset.name, width, height);
    const box = { x: 0, y: 0, w: width, h: height };
    if (asset.kind === 'image') {
      const id = uid();
      design.pages[0].elements.push(newElement('image', box, { imageId: id, name: asset.name, natW: asset.w, natH: asset.h }));
      await openImported(design, [{ id, blob: asset.blob }]);
    } else {
      design.pages[0].elements.push(elementForItem({ kind: 'svg', name: asset.name, asset }, design.pages[0]));
      Object.assign(design.pages[0].elements[0], box);
      await openImported(design, []);
    }
    showNotice('info', `Opened "${design.name}" as a new design.`);
  }, [openImported, showNotice]);

  const openFiles = useCallback(async (files) => {
    setFileMenu(false);
    for (const file of files) {
      try {
        if (isPdfFileName(file)) await openPdfFile(file);
        else if (isJsonFile(file)) {
          const parsed = parseHomeStudioFile(await file.text());
          if (parsed.kind === 'backup') setBackupOpen({ restore: parsed });
          else await openProjectFile(parsed);
        } else if (classifyFile(file)) await openPictureFile(file);
        else throw new Error(`${file.name} isn't a file Home Studio can open. It opens images, SVGs, PDFs and Home Studio files.`);
      } catch (err) {
        showNotice('error', err && err.message ? err.message : `${file.name} couldn't be opened.`);
      }
    }
  }, [openPdfFile, openProjectFile, openPictureFile, showNotice]);

  const downloadProject = useCallback(async () => {
    setFileMenu(false);
    const d = stateRef.current.doc;
    if (!d) return;
    try {
      const bytes = serializeProject(await collectProject(d, fileAccess));
      const name = safeFileName(d.name) + PROJECT_SUFFIX;
      downloadBlob(new Blob([bytes], { type: 'application/json' }), name);
      showNotice('info', `Downloaded ${name}. Open it from File, Open a file, here or on another device.`);
    } catch {
      showNotice('error', "The project file couldn't be made. Your design is unchanged.");
    }
  }, [fileAccess, showNotice]);

  const runBackup = useCallback(async () => {
    const db = dbLive.current;
    if (!db) throw new Error('no storage');
    await autoSaver.flush().catch(() => {});
    const data = await collectBackup(db);
    const bytes = serializeBackup(data);
    const name = `Home Studio backup ${new Date().toISOString().slice(0, 10)}${BACKUP_SUFFIX}`;
    downloadBlob(new Blob([bytes], { type: 'application/json' }), name);
    const now = Date.now();
    await setPref(db, 'lastBackupAt', now).catch(() => {});
    setLastBackupAt(now);
    return { name, size: bytes.length, designs: data.designs.length };
  }, [autoSaver]);

  const readBackupFile = useCallback(async (file) => {
    const parsed = parseHomeStudioFile(await file.text());
    if (parsed.kind !== 'backup') throw new Error('This file is one design, not a backup. Open it from File, Open a file.');
    return parsed;
  }, []);

  const runRestore = useCallback(async (parsed) => {
    const db = dbLive.current;
    if (!db) throw new Error('no storage');
    await autoSaver.flush().catch(() => {});
    const r = await restoreBackup(db, parsed);
    await refreshList();
    await refreshLibrary().catch(() => {});
    const cur = stateRef.current.doc;
    const list = await listDesigns(db);
    if (cur && parsed.designs.some((d) => d.id === cur.id) && r.replaced) {
      const fresh = await getDesign(db, cur.id);
      if (fresh) await open(fresh);
    } else if (!cur && list.length) {
      await open(list[0]);
    }
    return r;
  }, [autoSaver, open, refreshList, refreshLibrary]);

  const loadVersions = useCallback(async () => {
    if (!dbLive.current) throw new Error('no storage');
    return listVersions(dbLive.current, stateRef.current.doc.id);
  }, []);

  const saveVersion = useCallback(async (label) => {
    const d = stateRef.current.doc;
    lastVersions.current[d.id] = await addVersion(dbLive.current, d, label, false);
  }, []);

  const restoreVersion = useCallback(async (v) => {
    const db = dbLive.current;
    const d = stateRef.current.doc;
    lastVersions.current[d.id] = await addVersion(db, d, 'Before going back', false);
    const map = {};
    for (const p of v.design.pages) {
      for (const id of imageIdsIn(p.elements)) {
        if (imagesRef.current[id]) continue;
        const blob = await getImage(db, id);
        if (blob) map[id] = URL.createObjectURL(blob);
      }
    }
    setImages((m) => ({ ...m, ...map }));
    apply((dr) => { dr.pages = structuredClone(v.design.pages); dr.name = v.design.name; dr.updatedAt = Date.now(); }, true);
    dispatch({ type: 'set-page', pageId: v.design.pages[0].id });
    setVersionsOpen(false);
    showNotice('info', `Went back to the version from ${new Date(v.createdAt).toLocaleString()}. Undo brings back what you had.`);
  }, [apply, showNotice]);

  const restoreRecovered = useCallback(async () => {
    const doc = recovery;
    setRecovery(null);
    try { if (dbLive.current) await putDesign(dbLive.current, doc); } catch { /* still opens */ }
    if (journalStore()) clearJournal(journalStore(), dbName.current, doc);
    await open(doc);
    void refreshList();
    showNotice('info', `Restored your latest changes to "${doc.name}".`);
  }, [recovery, open, refreshList, showNotice]);

  const discardRecovered = useCallback(() => {
    if (journalStore()) clearJournal(journalStore(), dbName.current, null);
    setRecovery(null);
  }, []);

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
      if (document.querySelector('.dialog-scrim')) return; // dialogs have their own keys
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

  const statusText = (dbBroken ? 'Not saved' : saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Not saved' : 'saved on this device')
    + (online ? '' : ', offline');

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
        <button className="ib" aria-label="File: export, open, versions and backup" title="File" onClick={() => setFileMenu(true)} data-open-file-menu>{icons.file({})}</button>
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
      {recovery && (
        <div className="notice" role="alert" data-recovery>
          <span>Home Studio closed before your latest changes to "{recovery.name}" were saved.</span>
          <span className="notice-actions">
            <button className="btn-secondary" onClick={discardRecovered}>Discard</button>
            <button className="btn-secondary" onClick={restoreRecovered}>Restore changes</button>
          </span>
        </div>
      )}
      {quota.level !== 'ok' && !quota.dismissed && (
        <div className="notice error" role="alert" data-quota>
          <span>
            {quota.level === 'full' ? 'This device is out of space for designs, so changes may not save.' : 'This device is running low on space for designs.'}
            {' '}Back up your designs, then delete ones you no longer need.
          </span>
          <span className="notice-actions">
            <button className="btn-secondary" onClick={() => setQuota((q) => ({ ...q, dismissed: true }))}>Dismiss</button>
            <button className="btn-secondary" onClick={() => setBackupOpen({ restore: null })}>Back up</button>
          </span>
        </div>
      )}
      {notice && (
        <div className={'notice' + (notice.tone === 'error' ? ' error' : '')} role={notice.tone === 'error' ? 'alert' : 'status'} data-notice>
          <span>{notice.text}</span>
          <span className="notice-actions"><button className="btn-secondary" onClick={() => showNotice(null, '')}>Dismiss</button></span>
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
              <button className="btn-secondary" onClick={() => openRef.current && openRef.current.click()}>Open a file</button>
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
      <input ref={fileRef} type="file" accept={`${IMAGE_ACCEPT},image/svg+xml,.svg`} multiple hidden onChange={onFile} />
      <input ref={openRef} type="file" accept={OPEN_ACCEPT} multiple hidden data-open-input
        onChange={(e) => { const files = [...(e.target.files || [])]; e.target.value = ''; if (files.length) void openFiles(files); }} />
      {fileMenu && (
        <FileMenu hasDesign={!empty} onClose={() => setFileMenu(false)}
          onExport={() => { setFileMenu(false); setExportOpen(true); }}
          onOpenFile={() => openRef.current && openRef.current.click()}
          onDownloadProject={downloadProject}
          onVersions={() => { setFileMenu(false); setVersionsOpen(true); }}
          onBackup={() => { setFileMenu(false); setBackupOpen({ restore: null }); }} />
      )}
      {exportOpen && doc && p2 && (
        <Suspense fallback={<div className="dialog-scrim"><div className="dialog card wide" aria-busy="true"><div className="skeleton" style={{ height: 28, width: 120 }} /></div></div>}>
          <ExportDialog design={doc} pageId={p2.id} onClose={() => setExportOpen(false)} onDownload={downloadBlob}
            deps={{ getImage: fileAccess.getImage, getFontBlob: fileAccess.getFontBlob, project: () => collectProject(stateRef.current.doc, fileAccess) }} />
        </Suspense>
      )}
      {versionsOpen && doc && (
        <VersionsDialog designName={doc.name} images={images} load={loadVersions} onSave={saveVersion} onRestore={restoreVersion}
          onClose={() => setVersionsOpen(false)} />
      )}
      {backupOpen && (
        <BackupDialog lastBackupAt={lastBackupAt} initialRestore={backupOpen.restore} loadStorage={storageStatus}
          onBackup={runBackup} onReadBackup={readBackupFile} onRestore={runRestore} onPersist={askToPersist}
          onClose={() => setBackupOpen(null)} />
      )}
      {sheet && doc && (
        <DesignsSheet designs={designs} currentId={doc.id} onClose={() => setSheet(false)}
          onOpen={async (d) => { setSheet(false); await open(d); }}
          onNew={() => { setSheet(false); setNewDialog(true); }}
          onDelete={(id) => removeDesign(id).then(() => setSheet(false))}
          onRename={renameDesign}
          onDuplicate={(id) => { setSheet(false); void copyDesign(id); }} />
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
