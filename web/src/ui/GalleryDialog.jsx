// The community gallery: designs other people published, browsed by
// source (the built-in demo, plus any self-hosted nodes added here), and
// a Publish tab for sending the current design out. Browsing fetches a
// source's listing; a tile fetches its item once, on demand. Remixing
// makes a fresh local copy, credited to the original.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { fetchIndex, fetchItem } from '../gallery/api.js';
import { publishToNode, publishToIpfs, itemBytesFor } from '../gallery/publish.js';
import { GALLERY_LICENCES } from '../io/gallery.js';
import { icons } from './icons.jsx';
import PagePreview from '../render/PagePreview.jsx';

const LICENCE_HINTS = {
  'CC0-1.0': 'No rights reserved. Anyone may use it for anything, no attribution needed.',
  'CC-BY-4.0': 'Anyone may use it if they credit you.',
  'CC-BY-SA-4.0': 'Anyone may use it if they credit you and share changes under the same licence.',
};

export default function GalleryDialog({
  hasDesign, design, getProject, sources, demoSource, ipfs,
  onAddSource, onRemoveSource, onRemix, onClose,
}) {
  const [tab, setTab] = useState('browse');
  const [sourceId, setSourceId] = useState(sources.length ? sources[0].id : null);
  const [items, setItems] = useState(null); // null while loading
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState(null); // a listing row, with its parsed contents

  const source = sources.find((s) => s.id === sourceId) || sources[0] || null;

  // The listing of the chosen source.
  const load = () => {
    if (!source) { setItems([]); return; }
    setItems(null);
    setError('');
    fetchIndex(source, { demoIndex: demoSource ? demoSource.items : null })
      .then((rows) => setItems(rows))
      .catch((err) => { setItems([]); setError(err.message || 'The gallery could not be reached.'); });
  };
  useEffect(load, [source && source.id, demoSource]);

  const filtered = useMemo(() => {
    if (!items) return null;
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => it.title.toLowerCase().includes(q)
      || it.author.toLowerCase().includes(q) || it.tags.some((t) => t.includes(q)));
  }, [items, query]);

  return (
    <div className="dialog-scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog card lib" role="dialog" aria-modal="true" aria-labelledby="gallery-title" data-gallery>
        <div className="lib-head">
          {icons.globe({ width: 20, height: 20 })}
          <h2 className="text-heading" id="gallery-title" style={{ flex: 1 }}>Community gallery</h2>
          <button className="btn-secondary" onClick={onClose}>Close</button>
        </div>
        <div className="chips" role="tablist" aria-label="Gallery">
          <button role="tab" aria-selected={tab === 'browse'} className={'chip' + (tab === 'browse' ? ' on' : '')} onClick={() => setTab('browse')}>Browse</button>
          {hasDesign && (
            <button role="tab" aria-selected={tab === 'publish'} className={'chip' + (tab === 'publish' ? ' on' : '')} data-gallery-publish-tab onClick={() => setTab('publish')}>Publish</button>
          )}
        </div>

        {tab === 'browse' ? (
          <Browse
            sources={sources} source={source} onSource={(id) => { setSelected(null); setSourceId(id); }}
            items={filtered} loading={items === null} error={error} onRetry={load} onRemix={onRemix}
            query={query} setQuery={setQuery}
            adding={adding} setAdding={setAdding}
            onAddSource={onAddSource} onRemoveSource={onRemoveSource}
            selected={selected} setSelected={setSelected}
            demoSource={demoSource}
          />
        ) : (
          <Publish design={design} getProject={getProject} sources={sources.filter((s) => s.kind === 'node')} ipfs={ipfs} />
        )}
      </div>
    </div>
  );
}

// ── Browse ───────────────────────────────────────────────────────────────

function Browse({ sources, source, onSource, items, loading, error, onRetry, onRemix, query, setQuery,
  adding, setAdding, onAddSource, onRemoveSource, selected, setSelected, demoSource }) {
  const [addUrl, setAddUrl] = useState('');
  const [addName, setAddName] = useState('');
  const [addError, setAddError] = useState('');
  const [parsed, setParsed] = useState(null); // the selected item's contents
  const [busy, setBusy] = useState(false);

  const open = async (row) => {
    setSelected(row);
    setParsed(null);
    setBusy(true);
    try {
      const got = await getItem(source, row.id, demoSource);
      setParsed(got);
    } catch (err) {
      setError(err.message || 'That design could not be opened.');
      setSelected(null);
    } finally {
      setBusy(false);
    }
  };

  const remix = () => {
    if (!parsed) return;
    onRemix(parsed);
  };

  return (
    <>
      <div className="chips" aria-label="Gallery sources" style={{ marginTop: 8 }}>
        {sources.map((s) => (
          <button key={s.id} className={'chip' + (source && source.id === s.id ? ' on' : '')} aria-pressed={source && source.id === s.id}
            data-gallery-source={s.id} onClick={() => onSource(s.id)}>
            {s.name}
            {!s.builtIn && (
              <span role="button" tabIndex={0} aria-label={'Remove ' + s.name} style={{ marginLeft: 6, display: 'inline-flex' }}
                onClick={(e) => { e.stopPropagation(); onRemoveSource(s.id); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onRemoveSource(s.id); } }}>
                {icons.trash({ width: 14, height: 14 })}
              </span>
            )}
          </button>
        ))}
        <button className="chip" aria-pressed={adding} onClick={() => setAdding(!adding)}>+ Add a node</button>
      </div>

      {adding && (
        <div style={{ marginTop: 8, marginBottom: 8 }}>
          <label className="block" style={{ marginBottom: 8 }}>
            <span className="section-label" style={{ display: 'block' }}>Gallery address</span>
            <input className="field" value={addUrl} onChange={(e) => setAddUrl(e.target.value)} placeholder="e.g. https://studio.example.com" />
          </label>
          <label className="block" style={{ marginBottom: 8 }}>
            <span className="section-label" style={{ display: 'block' }}>Name (optional)</span>
            <input className="field" value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="e.g. Village hall gallery" />
          </label>
          {addError && <p className="sub" role="alert" style={{ color: 'rgb(var(--danger))' }}>{addError}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-secondary" style={{ flex: 1 }} onClick={() => { setAdding(false); setAddError(''); }}>Cancel</button>
            <button className="btn-primary" style={{ flex: 1 }} data-gallery-add
              onClick={async () => {
                setAddError('');
                try {
                  const s = await onAddSource({ url: addUrl.trim(), name: addName.trim() });
                  setAdding(false);
                  setAddUrl('');
                  setAddName('');
                  if (s) onSource(s.id);
                } catch (err) { setAddError(err.message); }
              }}>
              Add source
            </button>
          </div>
        </div>
      )}

      <label className="block" style={{ marginTop: 8 }}>
        <span className="sr-only">Search the gallery</span>
        <input className="field" type="search" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search, e.g. poster, garden, flyer" onKeyDown={(e) => e.stopPropagation()} />
      </label>

      {selected && (
        <div className="card" style={{ marginTop: 10, padding: 12 }} data-gallery-detail>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h3 className="text-heading">{selected.title}</h3>
              <p className="sub">{selected.author} · {selected.licence}</p>
              {selected.tags.length > 0 && (
                <p className="sub">{selected.tags.map((t) => '#' + t).join(' ')}</p>
              )}
              {parsed && parsed.item.description && <p className="sub">{parsed.item.description}</p>}
              {busy && <p className="sub">Opening…</p>}
              {parsed && parsed.warnings.length > 0 && <p className="sub">{parsed.warnings.join(' ')}</p>}
              <button className="btn-primary" style={{ marginTop: 8 }} disabled={!parsed || busy} data-gallery-remix onClick={remix}>
                Make a copy to edit
              </button>
              <p className="sub" style={{ marginTop: 4 }}>The copy is yours to change; it stays on this device.</p>
            </div>
            <div style={{ width: 140, flexShrink: 0 }}>
              {parsed
                ? <GalleryPreview parsed={parsed} />
                : <div className="skeleton" style={{ width: 140, height: Math.round(140 * 1.25) }} />}
            </div>
          </div>
        </div>
      )}

      {loading && (
        <ul className="lib-grid" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="tile">
              <div className="skeleton" style={{ width: 140, height: 176 }} />
            </li>
          ))}
        </ul>
      )}

      {error && (
        <div className="state-error" style={{ marginTop: 12 }}>
          <p>{error}</p>
          <button className="btn-secondary" onClick={onRetry}>Retry</button>
        </div>
      )}

      {!loading && !error && items && items.length === 0 && (
        <div className="state-empty" data-gallery-empty>
          <h3 className="text-heading">{query ? 'Nothing matches' : source && source.kind === 'demo' ? 'The demo gallery is empty here' : 'Nothing published yet'}</h3>
          <p className="sub">{query ? 'Try another word.' : 'Publish a design from the Publish tab, and it appears here.'}</p>
        </div>
      )}

      {!loading && !error && items && items.length > 0 && (
        <ul className="lib-grid" data-gallery-items>
          {items.map((row) => (
            <li key={row.id} className="tile" data-gallery-item={row.id}>
              <button className="tile-main" onClick={() => open(row)} aria-label={'Show ' + row.title}>
                <GalleryTile source={source} row={row} demoSource={demoSource} />
                <span className="tile-name">{row.title}</span>
                <span className="tile-sub">{row.author} · {row.licence}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// One tile: fetches its item once to draw the preview. A row that cannot
// be fetched shows its licence without a picture.
function GalleryTile({ source, row, demoSource }) {
  const [parsed, setParsed] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    getItem(source, row.id, demoSource)
      .then((got) => { if (alive) setParsed(got); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [source && source.id, row.id]);
  if (failed) return <div className="preview" style={{ width: 140, height: 176 }} />;
  if (!parsed) return <div className="skeleton" style={{ width: 140, height: 176 }} />;
  return <GalleryPreview parsed={parsed} width={140} />;
}

function GalleryPreview({ parsed, width = 140 }) {
  const urls = useMemo(() => {
    const map = {};
    for (const img of (parsed && parsed.images) || []) {
      map[img.id] = URL.createObjectURL(new Blob([img.bytes], { type: img.type }));
    }
    return map;
  }, [parsed]);
  useEffect(() => () => Object.values(urls).forEach((u) => URL.revokeObjectURL(u)), [urls]);
  const page = parsed && parsed.design && parsed.design.pages[0];
  if (!page) return null;
  return <PagePreview page={page} width={width} images={urls} />;
}

// One fetch per item per dialog session: the tile and the detail panel
// share it, and a second look at the same tile does not re-download.
const itemCache = new Map();
function getItem(source, id, demoSource) {
  const key = `${source && source.id}:${id}`;
  if (itemCache.has(key)) return Promise.resolve(itemCache.get(key));
  return fetchItem(source, id, { demoItem: demoSource ? demoSource.itemBytes : null })
    .then((parsed) => { itemCache.set(key, parsed); return parsed; });
}

// ── Publish ──────────────────────────────────────────────────────────────

function Publish({ design, getProject, sources, ipfs }) {
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [licence, setLicence] = useState('CC0-1.0');
  const [dest, setDest] = useState(sources.length ? 'node' : 'ipfs');
  const [nodeUrl, setNodeUrl] = useState(sources.length ? sources[0].url : '');
  const [adminKey, setAdminKey] = useState('');
  const [state, setState] = useState('idle'); // idle | working | done | error
  const [result, setResult] = useState('');
  const [error, setError] = useState('');

  const page = design && design.pages[0];

  const publish = async () => {
    setError('');
    setState('working');
    try {
      const project = await getProject();
      const item = {
        title: title.trim() || design.name.trim() || 'Untitled design',
        author: author.trim(),
        description,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        licence,
      };
      const bytes = itemBytesFor({ design: project.design, images: project.images, fonts: project.fonts, item });
      let out;
      if (dest === 'node') {
        out = await publishToNode({ url: nodeUrl, adminKey, itemBytes: bytes });
        setResult(out.id ? `Published. Its id there is ${out.id}.` : 'Published to the gallery.');
      } else {
        out = await publishToIpfs({ ...ipfs, design: project.design, images: project.images, fonts: project.fonts, item });
        setResult(`Published. Its address is ${out.cid}.`);
      }
      setState('done');
    } catch (err) {
      setError(err.message || 'Publishing did not go through.');
      setState('error');
    }
  };

  if (!page) return null;

  return (
    <div style={{ marginTop: 8 }} data-gallery-publish>
      <p className="sub">Publishing sends a copy of this design, with its images packed in, to the gallery you choose. It does not change anything on this device.</p>
      <label className="block" style={{ marginBottom: 8 }}>
        <span className="section-label" style={{ display: 'block' }}>Title</span>
        <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={design.name || 'e.g. Garden supper poster'} />
      </label>
      <label className="block" style={{ marginBottom: 8 }}>
        <span className="section-label" style={{ display: 'block' }}>Your name (optional)</span>
        <input className="field" value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="e.g. Sam" maxLength={80} />
      </label>
      <label className="block" style={{ marginBottom: 8 }}>
        <span className="section-label" style={{ display: 'block' }}>Description (optional)</span>
        <textarea className="field" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={600} placeholder="What is it, in a line" />
      </label>
      <label className="block" style={{ marginBottom: 8 }}>
        <span className="section-label" style={{ display: 'block' }}>Tags (comma separated, up to 10)</span>
        <input className="field" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="e.g. poster, garden, event" />
      </label>
      <label className="block" style={{ marginBottom: 8 }}>
        <span className="section-label" style={{ display: 'block' }}>Licence</span>
        <select className="field" value={licence} onChange={(e) => setLicence(e.target.value)}>
          {GALLERY_LICENCES.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <span className="sub" style={{ display: 'block', marginTop: 4 }}>{LICENCE_HINTS[l]}</span>
      </label>

      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        {sources.length > 0 && (
          <button className={'chip' + (dest === 'node' ? ' on' : '')} aria-pressed={dest === 'node'} onClick={() => setDest('node')}>A node gallery</button>
        )}
        <button className={'chip' + (dest === 'ipfs' ? ' on' : '')} aria-pressed={dest === 'ipfs'} onClick={() => setDest('ipfs')}>An IPFS-compatible store</button>
      </div>

      {dest === 'node' && (
        <>
          {sources.length === 0 && (
            <p className="sub" style={{ marginBottom: 8 }}>Add a node gallery in the Browse tab first (its address), or publish to an IPFS-compatible store.</p>
          )}
          {sources.length > 0 && (
            <label className="block" style={{ marginBottom: 8 }}>
              <span className="section-label" style={{ display: 'block' }}>Node gallery</span>
              <select className="field" value={nodeUrl} onChange={(e) => setNodeUrl(e.target.value)}>
                {sources.map((s) => <option key={s.id} value={s.url}>{s.name}</option>)}
              </select>
            </label>
          )}
          <label className="block" style={{ marginBottom: 8 }}>
            <span className="section-label" style={{ display: 'block' }}>Admin key</span>
            <input className="field" type="password" value={adminKey} onChange={(e) => setAdminKey(e.target.value)} placeholder="The key from whoever runs the node" />
          </label>
        </>
      )}

      {state === 'working' && <p className="sub" data-gallery-publish-state>Working…</p>}
      {state === 'done' && <p className="sub" style={{ color: 'rgb(var(--accent))' }} data-gallery-publish-state>{result}</p>}
      {state === 'error' && <p className="sub" role="alert" style={{ color: 'rgb(var(--danger))' }} data-gallery-publish-state>{error}</p>}

      <button className="btn-primary" style={{ width: '100%', marginTop: 8 }} disabled={state === 'working' || (dest === 'node' && sources.length === 0)}
        data-gallery-publish-go onClick={publish}>
        {state === 'done' ? 'Publish again' : 'Publish'}
      </button>
    </div>
  );
}