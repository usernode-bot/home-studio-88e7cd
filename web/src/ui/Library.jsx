// The library: templates, elements (shapes, icons, illustrations and saved
// components), backgrounds, fonts, a person's own imports, favourites and
// the licences of everything bundled. Loaded only when first opened.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ASSETS, LICENSES, SOURCES, searchLibrary, attributionOf } from '../assets/catalog.js';
import { TEMPLATES, TEMPLATE_CATEGORIES } from '../assets/templates.js';
import { BUNDLED_FONTS, ensureFont, fontStack } from '../assets/fonts.js';
import { svgDataUrl } from '../assets/svg.js';
import { IMPORT_ACCEPT } from '../assets/imports.js';
import { pageBackgroundStyle } from '../doc/style.js';
import { newElement } from '../doc/model.js';
import PagePreview from '../render/PagePreview.jsx';
import ElementView from '../render/ElementView.jsx';
import { icons } from './icons.jsx';

const TABS = [
  ['templates', 'Templates'],
  ['elements', 'Elements'],
  ['backgrounds', 'Backgrounds'],
  ['fonts', 'Fonts'],
  ['uploads', 'Your files'],
  ['favorites', 'Favourites'],
  ['credits', 'Licences'],
];
const TAB_KINDS = {
  templates: ['template'],
  elements: ['shape', 'icon', 'illustration', 'component'],
  backgrounds: ['background'],
  fonts: ['font'],
  uploads: ['upload'],
};

export default function Library({
  hasDesign, favorites, uploads, components, importError,
  onToggleFavorite, onUseTemplate, onInsert, onApplyBackground, onUseFont, onImport, onDeleteUpload, onDeleteComponent, onClose,
}) {
  const [tab, setTab] = useState('templates');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const importRef = useRef(null);

  // Templates build their pages once per library opening.
  const templates = useMemo(() => TEMPLATES.map((t) => ({ ...t, preview: { width: t.width, height: t.height, ...t.pages()[0] } })), []);
  const userItems = useMemo(() => [
    ...uploads.map((a) => ({
      id: 'upload:' + a.id, kind: 'upload', name: a.name, tags: [a.kind],
      category: a.kind === 'font' ? 'Fonts' : a.kind === 'svg' ? 'SVGs' : 'Images', asset: a, license: 'yours',
    })),
    ...components.map((c) => ({ id: 'component:' + c.id, kind: 'component', name: c.name, tags: ['component', 'saved'], category: 'Your components', component: c, license: 'yours' })),
  ], [uploads, components]);
  const all = useMemo(() => [...templates, ...ASSETS, ...userItems], [templates, userItems]);

  const kinds = TAB_KINDS[tab];
  const pool = tab === 'favorites' ? all.filter((it) => favorites.has(it.id)) : kinds ? all.filter((it) => kinds.includes(it.kind)) : [];
  const categories = tab === 'templates' ? TEMPLATE_CATEGORIES : [...new Set(pool.map((it) => it.category))];
  const items = searchLibrary(pool, { query, category: category || undefined });

  useEffect(() => { setCategory(''); }, [tab]);
  useEffect(() => {
    if (tab === 'fonts' || tab === 'favorites') Object.keys(BUNDLED_FONTS).forEach(ensureFont);
  }, [tab]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Object URLs for imported images, released when the list changes.
  const uploadUrls = useMemo(() => {
    const map = {};
    for (const a of uploads) if (a.kind === 'image' && a.blob) map[a.id] = URL.createObjectURL(a.blob);
    return map;
  }, [uploads]);
  useEffect(() => () => Object.values(uploadUrls).forEach((u) => URL.revokeObjectURL(u)), [uploadUrls]);

  const act = (it) => {
    if (it.kind === 'template') return onUseTemplate(it);
    if (it.kind === 'background') return onApplyBackground(it.fill);
    if (it.kind === 'font') return onUseFont(it.fontKey, it.name);
    if (it.kind === 'upload' && it.asset.kind === 'font') return onUseFont('user:' + it.asset.id, it.name);
    return onInsert(it);
  };
  const needsDesign = (it) => it.kind !== 'template';
  const actionLabel = (it) => ({
    template: 'Use template', background: 'Set as page background', font: 'Add text in this font',
  }[it.kind] || (it.kind === 'upload' && it.asset.kind === 'font' ? 'Add text in this font' : 'Add to page'));

  return (
    <div className="dialog-scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog card lib" role="dialog" aria-modal="true" aria-labelledby="library-title" data-library>
        <div className="lib-head">
          <h2 className="text-heading" id="library-title" style={{ flex: 1 }}>Library</h2>
          <button className="btn-secondary" onClick={onClose}>Close</button>
        </div>
        <div className="chips" role="tablist" aria-label="Library sections">
          {TABS.map(([key, label]) => (
            <button key={key} role="tab" aria-selected={tab === key} className={'chip' + (tab === key ? ' on' : '')}
              onClick={() => setTab(key)}>{label}</button>
          ))}
        </div>
        {tab !== 'credits' && (
          <label className="block" style={{ marginTop: 8 }}>
            <span className="sr-only">Search the library</span>
            <input className="field" type="search" value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Search, e.g. party, leaf, poster" onKeyDown={(e) => e.stopPropagation()} />
          </label>
        )}
        {tab !== 'credits' && tab !== 'favorites' && categories.length > 1 && (
          <div className="chips" aria-label="Categories" style={{ marginTop: 8 }}>
            <button className={'chip' + (!category ? ' on' : '')} aria-pressed={!category} onClick={() => setCategory('')}>All</button>
            {categories.map((c) => (
              <button key={c} className={'chip' + (category === c ? ' on' : '')} aria-pressed={category === c} onClick={() => setCategory(c)}>{c}</button>
            ))}
          </div>
        )}
        {tab === 'uploads' && (
          <div style={{ marginTop: 8 }}>
            <button className="btn-primary" onClick={() => importRef.current && importRef.current.click()}>Import files</button>
            <p className="sub" style={{ marginTop: 4 }}>Images (PNG, JPEG, GIF, WebP, AVIF, BMP and more), SVGs and fonts (TTF, OTF, WOFF). They stay on this device.</p>
            {importError && <p className="sub" role="alert" style={{ color: 'rgb(var(--danger))' }}>{importError}</p>}
            <input ref={importRef} type="file" multiple hidden accept={IMPORT_ACCEPT}
              onChange={(e) => { const files = [...(e.target.files || [])]; e.target.value = ''; if (files.length) onImport(files); }} />
          </div>
        )}
        {!hasDesign && tab !== 'templates' && tab !== 'credits' && (
          <p className="sub" style={{ marginTop: 8 }}>Open or start a design to add these to a page.</p>
        )}

        {tab === 'credits' ? <Credits /> : items.length === 0 ? (
          <div className="state-empty">
            <h3 className="text-heading">{tab === 'favorites' && !query ? 'No favourites yet' : tab === 'uploads' && !query ? 'Nothing imported yet' : 'Nothing matches'}</h3>
            <p className="sub">
              {tab === 'favorites' && !query ? 'Tap the star on anything in the library to keep it here.'
                : tab === 'uploads' && !query ? 'Import images, SVGs and fonts from this device.'
                  : 'Try another word, or show all categories.'}
            </p>
            {(query || category) && <button className="btn-secondary" onClick={() => { setQuery(''); setCategory(''); }}>Clear search</button>}
          </div>
        ) : (
          <ul className="lib-grid" data-lib-items>
            {items.map((it) => (
              <li key={it.id} className="tile" data-item={it.id}>
                <button className="tile-main" disabled={needsDesign(it) && !hasDesign} onClick={() => act(it)}
                  aria-label={actionLabel(it) + ': ' + it.name}>
                  <ItemPreview it={it} uploadUrls={uploadUrls} />
                  <span className="tile-name">{it.name}</span>
                  <span className="tile-sub">{licenseLine(it)}</span>
                </button>
                <div className="tile-actions">
                  <button className={'tile-icon' + (favorites.has(it.id) ? ' on' : '')} aria-pressed={favorites.has(it.id)}
                    aria-label={(favorites.has(it.id) ? 'Remove from favourites: ' : 'Add to favourites: ') + it.name}
                    onClick={() => onToggleFavorite(it.id, !favorites.has(it.id))}>
                    {icons.star({ fill: favorites.has(it.id) ? 'currentColor' : 'none' })}
                  </button>
                  {(it.kind === 'upload' || it.kind === 'component') && (
                    <button className="tile-icon" aria-label={'Delete ' + it.name}
                      onClick={() => (it.kind === 'upload' ? onDeleteUpload(it.asset) : onDeleteComponent(it.component))}>
                      {icons.trash({})}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function licenseLine(it) {
  if (it.license === 'yours') return it.kind === 'component' ? 'Saved by you' : 'Imported by you';
  return `${it.license} · ${attributionOf(it).replace(/^Copyright \d{4} /, '')}`;
}

function ItemPreview({ it, uploadUrls }) {
  if (it.kind === 'template') return <PagePreview page={it.preview} width={140} />;
  if (it.kind === 'component') {
    const c = it.component;
    return <PagePreview page={{ width: Math.max(1, c.w), height: Math.max(1, c.h), background: '#ffffff', elements: c.elements }} width={96} />;
  }
  if (it.kind === 'icon' || it.kind === 'illustration') {
    return <span className="preview"><img src={svgDataUrl(it.svg, '#1c1917')} alt="" loading="lazy" decoding="async" /></span>;
  }
  if (it.kind === 'shape') {
    const el = { ...newElement(it.insert.type, { x: 14, y: it.insert.type === 'line' ? 48 : 14, w: 68, h: it.insert.type === 'line' ? 0 : 68 }), ...it.insert, id: 'p-' + it.id };
    if (el.type === 'rect' && el.radius) el.radius = 14;
    return <span className="preview" style={{ width: 96, height: 96, position: 'relative' }}><ElementView el={el} /></span>;
  }
  if (it.kind === 'background') {
    return <span className="preview" style={{ ...pageBackgroundStyle(it.fill), width: 120, height: 90 }} />;
  }
  if (it.kind === 'font') {
    return <span className="preview preview-font" style={{ fontFamily: fontStack(it.fontKey) }}>Aa</span>;
  }
  const a = it.asset;
  if (a.kind === 'font') return <span className="preview preview-font" style={{ fontFamily: fontStack('user:' + a.id) }}>Aa</span>;
  if (a.kind === 'svg') return <span className="preview"><img src={svgDataUrl(a.svg)} alt="" decoding="async" /></span>;
  return <span className="preview"><img src={uploadUrls[a.id]} alt="" decoding="async" /></span>;
}

function Credits() {
  const fonts = Object.values(BUNDLED_FONTS);
  const counts = (source) => ASSETS.filter((a) => a.source === source).length;
  return (
    <div style={{ marginTop: 12 }} data-credits>
      <p className="sub" style={{ marginBottom: 8 }}>Everything in the library is free to use, also in commercial work, under these licences.</p>
      <ul className="list">
        <li className="list-row credit">
          <div>
            <div>{SOURCES.homestudio.name}</div>
            <div className="sub">Templates, shapes, illustrations and backgrounds ({counts('homestudio') + TEMPLATES.length} items). {LICENSES['CC0-1.0'].name}, no attribution needed.</div>
          </div>
        </li>
        <li className="list-row credit">
          <div>
            <div><a href={SOURCES.lucide.url} target="_blank" rel="noreferrer">{SOURCES.lucide.name}</a></div>
            <div className="sub">Icons ({counts('lucide')} items). <a href={LICENSES.ISC.url} target="_blank" rel="noreferrer">{LICENSES.ISC.name}</a>.</div>
          </div>
        </li>
        {fonts.map((f) => (
          <li key={f.family} className="list-row credit">
            <div>
              <div style={{ fontFamily: `"${f.family}", ${f.fallback}` }}><a href={f.source} target="_blank" rel="noreferrer">{f.family}</a></div>
              <div className="sub">{f.attribution}. <a href={LICENSES[f.license].url} target="_blank" rel="noreferrer">{LICENSES[f.license].name}</a>, via Fontsource.</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
