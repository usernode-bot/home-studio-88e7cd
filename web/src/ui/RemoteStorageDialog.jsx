// Remote storage: choose where designs also live (a self-hosted node or
// an IPFS node), connect, and sync now. Local-first throughout: nothing
// leaves this device until someone sets a remote store up, and a design
// is never deleted here because of a sync.

import React, { useEffect, useMemo, useState } from 'react';
import { Scrim } from './dialogs.jsx';
import { ADAPTERS } from '../persist/adapters/index.js';

function Head({ title, onClose }) {
  return (
    <div className="dialog-head">
      <h2 className="text-heading" id="remote-title" style={{ flex: 1 }}>{title}</h2>
      <button className="btn-secondary" onClick={onClose}>Close</button>
    </div>
  );
}

export default function RemoteStorageDialog({
  pref, queued, outbox, onConnect, onDisconnect, onSyncNow, onClose,
}) {
  const kinds = Object.keys(ADAPTERS).filter((k) => k !== 'local');
  const current = pref && pref.kind && pref.kind !== 'local' ? ADAPTERS[pref.kind] : null;
  const [kind, setKind] = useState(kinds[0]);
  const [fields, setFields] = useState({});
  const [state, setState] = useState({ s: 'idle', text: '' }); // idle | working | done | error
  const [notes, setNotes] = useState([]);
  const desc = useMemo(() => ADAPTERS[kind].describe(), [kind]);

  useEffect(() => { setFields({}); setState({ s: 'idle', text: '' }); }, [kind]);

  const connect = async () => {
    setState({ s: 'working', text: 'Testing the connection…' });
    try {
      await onConnect(kind, fields);
      setState({ s: 'done', text: 'Connected. Designs sync when you edit, and when you ask here.' });
    } catch (err) {
      setState({ s: 'error', text: err.message || 'The connection did not go through.' });
    }
  };

  const syncNow = async () => {
    setState({ s: 'working', text: 'Syncing…' });
    setNotes([]);
    try {
      const r = await onSyncNow((line) => setNotes((n) => [...n, line]));
      const parts = [];
      if (r.queued) parts.push(`${r.queued} waiting change${r.queued === 1 ? '' : 's'} sent`);
      if (r.sent) parts.push(`${r.sent} sent`);
      if (r.pulled) parts.push(`${r.pulled} brought over`);
      if (r.kept) parts.push(`${r.kept} kept as a copy`);
      if (r.failed) parts.push(`${r.failed} failed`);
      setState({ s: r.failed ? 'error' : 'done', text: parts.length ? parts.join(', ') + '.' : 'Everything is up to date.' });
    } catch (err) {
      setState({ s: 'error', text: err.message || 'The sync did not go through.' });
    }
  };

  return (
    <Scrim onClose={onClose} labelledBy="remote-title" className="wide" escape>
      <Head title="Remote storage" onClose={onClose} />

      {current ? (
        <>
          <p className="sub" style={{ marginBottom: 8 }}>
            Designs also sync to <strong>{current.describe().label}</strong>
            {pref.manifest && Object.keys(pref.manifest).length ? <> ({Object.keys(pref.manifest).length} on it)</> : null}. They still save on this device first, and work offline.
          </p>
          {state.s === 'working' && <p className="sub" aria-busy="true">{state.text}</p>}
          {state.s !== 'working' && state.text && (
            <p className="sub" role={state.s === 'error' ? 'alert' : 'status'} style={{ marginBottom: 8, color: state.s === 'error' ? 'rgb(var(--danger))' : undefined }}>{state.text}</p>
          )}
          {notes.length > 0 && (
            <ul className="list" style={{ marginBottom: 8 }}>
              {notes.slice(-4).map((n, i) => <li key={i} className="list-row sub">{n}</li>)}
            </ul>
          )}
          {queued > 0 && (
            <p className="sub" role="status" style={{ marginBottom: 8 }} data-outbox>
              {queued} change{queued === 1 ? '' : 's'} waiting to go out
              {outbox.length ? <> (oldest from {new Date(outbox[0].queuedAt).toLocaleString()})</> : null}.
            </p>
          )}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button className="btn-primary" style={{ flex: 1 }} disabled={state.s === 'working'} onClick={syncNow} data-sync-now>
              Sync now
            </button>
            <button className="btn-secondary" onClick={onDisconnect} data-disconnect>Disconnect</button>
          </div>
          <p className="sub">
            Sync never deletes the copy on this device. A design changed on both sides is kept twice: the newer copy wins, the older one stays as a kept copy.
          </p>
        </>
      ) : (
        <>
          <p className="sub" style={{ marginBottom: 8 }}>
            Designs save on this device. If you also want them on a store you control, connect one. Nothing is sent anywhere until you do.
          </p>
          <div className="chips" role="tablist" aria-label="Store kind">
            {kinds.map((k) => (
              <button key={k} role="tab" aria-selected={kind === k} className={'chip' + (kind === k ? ' on' : '')} onClick={() => setKind(k)}>
                {ADAPTERS[k].describe().label}
              </button>
            ))}
          </div>
          <p className="sub" style={{ margin: '8px 0' }}>{desc.hint}</p>
          {desc.fields.map((f) => (
            <label key={f.key} className="block" style={{ marginBottom: 8 }}>
              <span className="section-label" style={{ display: 'block' }}>{f.label}</span>
              <input
                className="field" type={f.secret ? 'password' : 'text'} autoComplete="off"
                value={fields[f.key] || ''} placeholder={f.placeholder || (f.key === 'pin' ? 'yes' : undefined)}
                onChange={(e) => setFields((v) => ({ ...v, [f.key]: e.target.value }))} />
            </label>
          ))}
          {state.text && (
            <p className="sub" role={state.s === 'error' ? 'alert' : 'status'} style={{ marginBottom: 8, color: state.s === 'error' ? 'rgb(var(--danger))' : undefined }}>{state.text}</p>
          )}
          <button className="btn-primary" style={{ width: '100%' }} disabled={state.s === 'working'} onClick={connect} data-connect>
            Test and connect
          </button>
          <p className="sub" style={{ marginTop: 8 }}>
            Queued changes wait on this device when you are offline and go out when the connection is back. A store you connect never sees a design you have not sent.
          </p>
        </>
      )}
    </Scrim>
  );
}