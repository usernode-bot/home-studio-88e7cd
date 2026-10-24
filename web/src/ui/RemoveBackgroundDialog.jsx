// The Remove background dialog: asks once before the one-time download,
// shows progress while the helper downloads and runs, then the cut-out on
// a checkered backdrop to Apply or Cancel. Loaded, with its worker, only
// when someone presses Remove background.

import React, { useEffect, useRef, useState } from 'react';
import { Scrim } from './dialogs.jsx';
import { createRemover } from '../bgremove/client.js';
import { DOWNLOAD_MB } from '../bgremove/info.js';
import { LOW_KEPT } from '../bgremove/cutout.js';

const mb = (n) => Math.max(0, Math.round(n / 1e6));

export default function RemoveBackgroundDialog({ photoUrl, getBlob, ready, onReady, onApply, onClose }) {
  // consent | downloading | working | preview | error | applying
  const [phase, setPhase] = useState(ready ? 'working' : 'consent');
  const [progress, setProgress] = useState({ loaded: 0, total: 0 });
  const [failed, setFailed] = useState(null); // 'download' | 'run'
  const [result, setResult] = useState(null); // { blob, url, w, h, kept }
  const [side, setSide] = useState('after');
  const remover = useRef(null);
  const resultUrl = useRef(null);

  const start = async () => {
    setFailed(null);
    setPhase(ready ? 'working' : 'downloading');
    setProgress({ loaded: 0, total: 0 });
    if (!remover.current) remover.current = createRemover();
    try {
      const blob = await getBlob();
      if (!blob) throw Object.assign(new Error('The photo is not on this device.'), { stage: 'run' });
      const r = await remover.current.run(blob, (msg) => {
        if (msg.type === 'progress') { setPhase('downloading'); setProgress({ loaded: msg.loaded, total: msg.total }); }
        if (msg.type === 'working') setPhase('working');
      });
      // Only a run that worked means the helper is here and works: from now
      // on the download question is skipped.
      onReady();
      if (resultUrl.current) URL.revokeObjectURL(resultUrl.current);
      resultUrl.current = URL.createObjectURL(r.blob);
      setResult({ ...r, url: resultUrl.current });
      setSide('after');
      setPhase('preview');
    } catch (err) {
      if (err && err.cancelled) return;
      console.warn('remove background failed', err);
      setFailed(err && err.stage === 'download' ? 'download' : 'run');
      setPhase('error');
    }
  };

  // Already downloaded once: start straight away. Closing ends the worker
  // and frees the preview.
  useEffect(() => {
    if (ready) void start();
    return () => {
      if (remover.current) remover.current.stop();
      if (resultUrl.current) URL.revokeObjectURL(resultUrl.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = async () => {
    setPhase('applying');
    try {
      await onApply(result);
    } catch (err) {
      console.warn('applying the cut-out failed', err);
      setFailed('run');
      setPhase('error');
    }
  };

  const applying = phase === 'applying';
  const busy = phase === 'downloading' || phase === 'working';
  const shown = phase === 'preview' || applying ? (side === 'after' ? result.url : photoUrl) : photoUrl;
  const total = progress.total || DOWNLOAD_MB * 1e6;

  return (
    <Scrim onClose={applying ? () => {} : onClose} labelledBy="remove-bg-title" className="wide" escape={!applying}>
      <div className="dialog-head">
        <h2 className="text-heading" id="remove-bg-title" style={{ flex: 1 }}>Remove background</h2>
      </div>

      {phase === 'consent' && (
        <p className="sub" style={{ margin: '0 4px 12px' }} data-remove-bg-consent>
          This works on your device, so your photo never leaves it. The first time, it downloads a helper of
          about {DOWNLOAD_MB} MB. After that it works offline.
        </p>
      )}

      {(phase === 'preview' || applying) && (
        <div className="chips" role="radiogroup" aria-label="Show" style={{ marginBottom: 10 }}>
          {[['before', 'Before'], ['after', 'After']].map(([key, label]) => (
            <button key={key} role="radio" aria-checked={side === key} className={'chip' + (side === key ? ' on' : '')}
              onClick={() => setSide(key)} data-remove-bg-side={key}>{label}</button>
          ))}
        </div>
      )}

      <div className="checker" data-remove-bg-preview={phase}>
        {shown && <img src={shown} alt={side === 'after' && result ? 'The photo without its background' : 'The photo'} />}
      </div>

      {phase === 'downloading' && (
        <p className="sub" role="status" aria-live="polite" style={{ margin: '8px 4px 0' }} data-remove-bg-progress>
          Downloading {mb(progress.loaded)} of {mb(total)} MB
          <progress className="meter" max={total} value={progress.loaded} />
        </p>
      )}
      {phase === 'working' && (
        <p className="sub" role="status" aria-live="polite" style={{ margin: '8px 4px 0' }}>Finding the subject…</p>
      )}
      {(phase === 'preview' || applying) && (
        <>
          {result.kept < LOW_KEPT && (
            <p className="sub" role="status" style={{ margin: '8px 4px 0' }} data-remove-bg-low>
              Not much was kept. This works best on photos with one clear subject.
            </p>
          )}
          <p className="sub" style={{ margin: '8px 4px 0' }}>
            The checkered parts will be transparent. To save a transparent PNG, use Export, choose PNG and tick
            Transparent background.
          </p>
        </>
      )}
      {phase === 'error' && (
        <p className="sub" role="alert" style={{ margin: '8px 4px 0', color: 'rgb(var(--danger))' }} data-remove-bg-error={failed}>
          {failed === 'download'
            ? "Couldn't download the background helper. Your photo is unchanged and the rest of the editor still works."
            : "Couldn't remove the background from this photo. Your photo is unchanged."}
        </p>
      )}

      <div className="dialog-foot">
        {phase === 'consent' && (
          <button className="btn-primary" style={{ width: '100%' }} onClick={start} data-remove-bg-start>Download and remove</button>
        )}
        {phase === 'error' && (
          <button className="btn-primary" style={{ width: '100%' }} onClick={start} data-remove-bg-retry>Retry</button>
        )}
        {(busy || phase === 'preview' || applying) && (
          <button className="btn-primary" style={{ width: '100%' }} disabled={phase !== 'preview'} onClick={apply} data-remove-bg-apply>
            Apply
          </button>
        )}
        <button className="btn-secondary" style={{ width: '100%' }} disabled={applying} onClick={onClose}>Cancel</button>
      </div>
    </Scrim>
  );
}
