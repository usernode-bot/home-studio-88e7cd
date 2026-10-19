// The File menu and what it opens: version history, and backup, restore
// and storage on this device. Each dialog owns its own loading, empty,
// error and done states; the app passes in what to do.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Scrim, timeAgo } from './dialogs.jsx';
import PagePreview from '../render/PagePreview.jsx';
import { formatBytes } from '../persist/storage.js';
import { BACKUP_SUFFIX } from '../io/project.js';

const stamp = (ts) => new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

function Head({ id, title, onClose }) {
  return (
    <div className="dialog-head">
      <h2 className="text-heading" id={id} style={{ flex: 1 }}>{title}</h2>
      <button className="btn-secondary" onClick={onClose}>Close</button>
    </div>
  );
}

export function FileMenu({ hasDesign, onExport, onOpenFile, onDownloadProject, onVersions, onBackup, onClose }) {
  const rows = [
    ['open', 'Open a file', 'Images, SVGs, PDFs and Home Studio files', onOpenFile, false],
    ['project', 'Download project file', 'This design with its pages, layers and images, to open here or on another device', onDownloadProject, !hasDesign],
    ['versions', 'Version history', 'Go back to an earlier version of this design', onVersions, !hasDesign],
    ['backup', 'Backup and storage', 'Back up every design, restore a backup, see the space used', onBackup, false],
  ];
  return (
    <Scrim onClose={onClose} labelledBy="file-title" escape>
      <Head id="file-title" title="File" onClose={onClose} />
      <button className="btn-primary" style={{ width: '100%', marginBottom: 12 }} disabled={!hasDesign} onClick={onExport} data-export>
        Export
      </button>
      <ul className="list" data-file-menu>
        {rows.map(([key, title, sub, act, disabled]) => (
          <li key={key}>
            <button className="menu-row" disabled={disabled} onClick={act} data-file-action={key}>
              <span>{title}</span>
              <span className="sub">{sub}</span>
            </button>
          </li>
        ))}
      </ul>
    </Scrim>
  );
}

// ── Version history ──────────────────────────────────────────────────────

export function VersionsDialog({ designName, images, load, onSave, onRestore, onClose }) {
  const [list, setList] = useState(null); // null loading | 'error' | []
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const refresh = useCallback(async () => {
    setList(null);
    try { setList(await load()); } catch { setList('error'); }
  }, [load]);
  useEffect(() => { refresh(); }, [refresh]);

  const save = async () => {
    const label = window.prompt('Name this version', 'Saved version');
    if (label === null) return;
    setBusy(true);
    try {
      await onSave(label.trim() || 'Saved version');
      setMessage('Version saved.');
      await refresh();
    } catch {
      setMessage("The version couldn't be saved on this device.");
    }
    setBusy(false);
  };
  const restore = async (v) => {
    if (!window.confirm(`Go back to the version from ${stamp(v.createdAt)}? The design as it is now is kept as a version first.`)) return;
    setBusy(true);
    try {
      await onRestore(v);
    } catch {
      setMessage("That version couldn't be restored.");
      setBusy(false);
    }
  };

  return (
    <Scrim onClose={onClose} labelledBy="versions-title" className="wide" escape>
      <Head id="versions-title" title="Version history" onClose={onClose} />
      <p className="sub" style={{ marginBottom: 12 }}>
        {designName} is saved as a version every 10 minutes while you edit. Save one yourself before a big change.
      </p>
      <button className="btn-primary" style={{ width: '100%', marginBottom: 8 }} disabled={busy || list === null} onClick={save}>Save this version</button>
      {message && <p className="sub" role="status" style={{ marginBottom: 8 }}>{message}</p>}
      {list === null && (
        <ul className="list" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className="version-row"><span className="skeleton" style={{ width: 56, height: 56 }} /><span style={{ flex: 1 }}><span className="skeleton" style={{ display: 'block', width: 140, height: 14 }} /></span></li>
          ))}
        </ul>
      )}
      {list === 'error' && (
        <div className="state-error" role="alert">
          <p>Version history couldn't be read on this device. The design itself is still saved.</p>
          <button className="btn-secondary" onClick={refresh}>Retry</button>
        </div>
      )}
      {Array.isArray(list) && list.length === 0 && (
        <div className="state-empty">
          <h3 className="text-heading">No earlier versions yet</h3>
          <p className="sub">The first one is saved after a few minutes of editing, or when you save one now.</p>
        </div>
      )}
      {Array.isArray(list) && list.length > 0 && (
        <ul className="list" data-versions>
          {list.map((v) => (
            <li key={v.id} className="version-row">
              {v.design.pages[0] && <PagePreview page={v.design.pages[0]} width={56} images={images} />}
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block' }}>{v.label}</span>
                <span className="sub" style={{ display: 'block' }}>{stamp(v.createdAt)} · {plural(v.design.pages.length, 'page')}</span>
              </span>
              <button className="btn-secondary" disabled={busy} onClick={() => restore(v)} aria-label={`Restore the version from ${stamp(v.createdAt)}`}>Restore</button>
            </li>
          ))}
        </ul>
      )}
    </Scrim>
  );
}

// ── Backup, restore and storage ──────────────────────────────────────────

function restoreSummary(p) {
  const parts = [plural(p.designs.length, 'design')];
  if (p.images.length) parts.push(plural(p.images.length, 'image'));
  if (p.assets.length) parts.push(plural(p.assets.length, 'library file'));
  if (p.components.length) parts.push(plural(p.components.length, 'component'));
  if (p.versions.length) parts.push(plural(p.versions.length, 'version'));
  const when = Date.parse(p.exportedAt);
  return `This backup${Number.isFinite(when) ? ` from ${stamp(when)}` : ''} has ${parts.join(', ')}.`;
}

function restoreResult(r) {
  const parts = [];
  if (r.added) parts.push(`added ${plural(r.added, 'design')}`);
  if (r.replaced) parts.push(`updated ${plural(r.replaced, 'design')} with the backup's newer copy`);
  if (r.library) parts.push(`added ${plural(r.library, 'library file')}`);
  if (r.components) parts.push(`added ${plural(r.components, 'component')}`);
  if (r.versions) parts.push(`added ${plural(r.versions, 'version')}`);
  let s = parts.length ? `Restored: ${parts.join(', ')}.` : 'Nothing new to restore.';
  if (r.kept) s += ` Kept ${plural(r.kept, 'design')} as ${r.kept === 1 ? 'it is' : 'they are'} here, because the copy here is as new or newer.`;
  return s;
}

export function BackupDialog({ lastBackupAt, loadStorage, onBackup, onReadBackup, onRestore, onPersist, initialRestore, onClose }) {
  const [storage, setStorage] = useState('loading');
  const [backup, setBackup] = useState({ state: 'idle', text: '' });
  const [pending, setPending] = useState(initialRestore || null);
  const [restore, setRestore] = useState({ state: 'idle', text: '' });
  const pickRef = useRef(null);

  const refreshStorage = useCallback(async () => {
    setStorage('loading');
    setStorage(await loadStorage());
  }, [loadStorage]);
  useEffect(() => { refreshStorage(); }, [refreshStorage]);

  const runBackup = async () => {
    setBackup({ state: 'working', text: 'Preparing the backup…' });
    try {
      const r = await onBackup();
      setBackup({ state: 'done', text: `Downloaded ${r.name} (${formatBytes(r.size)}), with ${plural(r.designs, 'design')}.` });
    } catch {
      setBackup({ state: 'error', text: "The backup couldn't be made. Your designs are still on this device." });
    }
  };
  const pick = async (file) => {
    setRestore({ state: 'working', text: `Reading ${file.name}…` });
    try {
      setPending(await onReadBackup(file));
      setRestore({ state: 'idle', text: '' });
    } catch (err) {
      setPending(null);
      setRestore({ state: 'error', text: err.message || "That file couldn't be read." });
    }
  };
  const confirm = async () => {
    setRestore({ state: 'working', text: 'Restoring…' });
    try {
      const r = await onRestore(pending);
      setPending(null);
      setRestore({ state: 'done', text: restoreResult(r) });
      void refreshStorage();
    } catch {
      setRestore({ state: 'error', text: "The backup couldn't be restored. Nothing on this device was removed." });
    }
  };
  const persist = async () => {
    await onPersist();
    void refreshStorage();
  };

  return (
    <Scrim onClose={onClose} labelledBy="backup-title" className="wide" escape>
      <Head id="backup-title" title="Backup and storage" onClose={onClose} />

      <h3 className="section-label">Back up</h3>
      <p className="sub" style={{ marginBottom: 8 }}>
        One file with every design, its images and versions, and your library. Keep it somewhere safe, or move your designs to another device.
        {' '}{lastBackupAt ? `Last backup ${timeAgo(lastBackupAt)}.` : 'No backup yet.'}
      </p>
      <button className="btn-primary" style={{ width: '100%' }} disabled={backup.state === 'working'} onClick={runBackup} data-backup>Download backup</button>
      {backup.text && <p className="sub" role={backup.state === 'error' ? 'alert' : 'status'} style={{ marginTop: 6, color: backup.state === 'error' ? 'rgb(var(--danger))' : undefined }}>{backup.text}</p>}

      <h3 className="section-label" style={{ marginTop: 20 }}>Restore</h3>
      {pending ? (
        <div data-restore-pending>
          <p style={{ marginBottom: 4 }}>{restoreSummary(pending)}</p>
          <p className="sub" style={{ marginBottom: 8 }}>Designs already here stay unless the backup has a newer copy. Nothing is deleted.</p>
          {pending.warnings.map((w) => <p key={w} className="sub">{w}</p>)}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-secondary" style={{ flex: 1 }} onClick={() => setPending(null)}>Cancel</button>
            <button className="btn-secondary" style={{ flex: 1 }} disabled={restore.state === 'working'} onClick={confirm} data-confirm-restore>Restore</button>
          </div>
        </div>
      ) : (
        <>
          <p className="sub" style={{ marginBottom: 8 }}>Bring back designs from a Home Studio backup file.</p>
          <button className="btn-secondary" style={{ width: '100%' }} disabled={restore.state === 'working'} onClick={() => pickRef.current && pickRef.current.click()}>Restore from a backup</button>
        </>
      )}
      {restore.text && <p className="sub" role={restore.state === 'error' ? 'alert' : 'status'} style={{ marginTop: 6, color: restore.state === 'error' ? 'rgb(var(--danger))' : undefined }}>{restore.text}</p>}
      <input ref={pickRef} type="file" hidden accept={`${BACKUP_SUFFIX},.json,application/json`}
        onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) pick(f); }} />

      <h3 className="section-label" style={{ marginTop: 20 }}>Storage on this device</h3>
      {storage === 'loading' ? (
        <div aria-busy="true"><span className="skeleton" style={{ display: 'block', width: 220, height: 14 }} /></div>
      ) : storage ? (
        <div data-storage>
          <p>Using {formatBytes(storage.usage)} of about {formatBytes(storage.quota)}.</p>
          <progress className="meter" max={1} value={storage.quota ? Math.min(1, storage.usage / storage.quota) : 0} aria-label="Space used" />
          {storage.level !== 'ok' && (
            <p className="sub" style={{ color: 'rgb(var(--danger))' }}>
              Space is running out. Back up, then delete designs you no longer need.
            </p>
          )}
          <p className="sub" style={{ marginTop: 4 }}>
            {storage.persisted
              ? 'Your browser keeps these designs until you delete them.'
              : 'Your browser may clear these designs if the device runs low on space.'}
          </p>
          {!storage.persisted && <button className="btn-secondary" style={{ marginTop: 8 }} onClick={persist}>Ask the browser to keep them</button>}
        </div>
      ) : (
        <p className="sub">This browser doesn't say how much space is used.</p>
      )}
    </Scrim>
  );
}
