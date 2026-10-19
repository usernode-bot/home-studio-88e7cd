// The two dialogs: the new-design dialog and the designs sheet.

import React, { useState } from 'react';
import { pageIsValid } from '../doc/model.js';
import { icons } from './icons.jsx';

function timeAgo(ts) {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 90) return 'just now';
  const m = Math.round(s / 60);
  if (m < 90) return m + ' min ago';
  const h = Math.round(m / 60);
  if (h < 36) return h + ' h ago';
  const d = Math.round(h / 24);
  return d + ' d ago';
}

function Scrim({ onClose, children, labelledBy }) {
  return (
    <div className="dialog-scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog card" role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
        {children}
      </div>
    </div>
  );
}

export function NewDesignDialog({ onCreate, onCancel }) {
  const [name, setName] = useState('');
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const ok = (v) => /^-?\d+$/.test(v.trim());
  const valid = ok(width) && ok(height) && pageIsValid(parseInt(width, 10), parseInt(height, 10));
  return (
    <Scrim onClose={onCancel} labelledBy="new-design-title">
      <h2 className="text-heading" id="new-design-title" style={{ marginBottom: 4 }}>New design</h2>
      <p className="sub" style={{ marginBottom: 12 }}>Set the size in pixels. You can change it later.</p>
      <label className="block" style={{ marginBottom: 8 }}>
        <span className="section-label" style={{ display: 'block' }}>Name</span>
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Garden supper poster" autoFocus />
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        <label style={{ flex: 1 }}>
          <span className="section-label" style={{ display: 'block' }}>Width (px)</span>
          <input className="field" inputMode="numeric" value={width} onChange={(e) => setWidth(e.target.value)} placeholder="e.g. 1080" />
        </label>
        <label style={{ flex: 1 }}>
          <span className="section-label" style={{ display: 'block' }}>Height (px)</span>
          <input className="field" inputMode="numeric" value={height} onChange={(e) => setHeight(e.target.value)} placeholder="e.g. 1350" />
        </label>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button className="btn-secondary" style={{ flex: 1 }} onClick={onCancel}>Cancel</button>
        <button className="btn-primary" style={{ flex: 1 }} disabled={!valid}
          onClick={() => onCreate({ name: name.trim() || 'Untitled design', width: parseInt(width, 10), height: parseInt(height, 10) })}>
          Create
        </button>
      </div>
    </Scrim>
  );
}

export function DesignsSheet({ designs, currentId, onOpen, onNew, onDelete, onRename, onClose }) {
  const [renaming, setRenaming] = useState(null);
  return (
    <Scrim onClose={onClose} labelledBy="designs-title">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <h2 className="text-heading" id="designs-title" style={{ flex: 1 }}>Designs on this device</h2>
        <button className="btn-secondary" onClick={onClose} aria-label="Close">Close</button>
      </div>
      <button className="btn-primary" style={{ width: '100%', marginBottom: 12 }} onClick={onNew}>New design</button>
      <ul className="list" data-designs>
        {designs.map((d) => (
          <li key={d.id} className={'list-row' + (d.id === currentId ? ' on' : '')}>
            {renaming === d.id ? (
              <input className="field" style={{ minHeight: 36 }} autoFocus defaultValue={d.name}
                onBlur={(e) => { onRename(d.id, e.target.value); setRenaming(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') { onRename(d.id, e.target.value); setRenaming(null); } }} />
            ) : (
              <>
                <button style={{ background: 'none', border: 0, padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left', flex: 1, minHeight: 44 }}
                  onClick={() => onOpen(d)}>
                  <span style={{ display: 'block' }}>{d.name}</span>
                  <span className="sub" style={{ display: 'block' }}>
                    {d.pages[0] ? d.pages[0].width + ' × ' + d.pages[0].height : ''} · {timeAgo(d.updatedAt)}
                  </span>
                </button>
                <button className="btn-secondary" style={{ minHeight: 44, minWidth: 44 }} aria-label={'Rename ' + d.name} onClick={() => setRenaming(d.id)}>
                  {icons.text({ width: 18, height: 18 })}
                </button>
                <button className="btn-secondary" style={{ minHeight: 44, minWidth: 44 }} aria-label={'Delete ' + d.name}
                  onClick={() => onDelete(d.id)}>
                  {icons.trash({ width: 18, height: 18 })}
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </Scrim>
  );
}
