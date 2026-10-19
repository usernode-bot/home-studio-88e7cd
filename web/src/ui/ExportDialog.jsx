// The Export dialog: format, pages, size or resolution, quality,
// transparency and print-ready PDF. Loaded with the exporters the first
// time someone exports.

import React, { useMemo, useState } from 'react';
import { Scrim } from './dialogs.jsx';
import { FORMATS, SCALES, PDF_DPI, CSS_DPI, capScale, exportSettings } from '../export/options.js';
import { exportDesign } from '../export/render.js';
import { formatBytes } from '../persist/storage.js';

export default function ExportDialog({ design, pageId, deps, onDownload, onClose }) {
  const [format, setFormat] = useState('png');
  const [which, setWhich] = useState(design.pages.length > 1 ? 'all' : 'current');
  const [chosen, setChosen] = useState(() => new Set([pageId]));
  const [scale, setScale] = useState(2);
  const [quality, setQuality] = useState(92);
  const [transparent, setTransparent] = useState(false);
  const [dpi, setDpi] = useState(150);
  const [printReady, setPrintReady] = useState(false);
  const [includeProject, setIncludeProject] = useState(true);
  const [run, setRun] = useState({ state: 'idle' }); // idle | working | done | error

  const current = design.pages.find((p) => p.id === pageId) || design.pages[0];
  const pages = which === 'all' ? design.pages : which === 'current' ? [current] : design.pages.filter((p) => chosen.has(p.id));
  const settings = exportSettings({ format, scale, quality: quality / 100, transparent, dpi, printReady, includeProject });
  const sample = pages[0] || current;
  const plan = useMemo(() => capScale(sample.width, sample.height, format === 'pdf' ? settings.dpi / CSS_DPI : settings.scale),
    [sample, format, settings.dpi, settings.scale]);

  const start = async () => {
    setRun({ state: 'working', done: 0, total: pages.length });
    try {
      const r = await exportDesign(design, pages, settings, deps, (done, total) => setRun({ state: 'working', done, total }));
      onDownload(r.blob, r.name);
      setRun({ state: 'done', name: r.name, size: r.blob.size, missing: r.missingImages, capped: r.capped });
    } catch (err) {
      console.warn('export failed', err);
      setRun({ state: 'error', text: err && err.message ? err.message : 'The export failed.' });
    }
  };
  const toggle = (id) => setChosen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const working = run.state === 'working';
  const many = pages.length > 1 && format !== 'pdf';

  return (
    <Scrim onClose={working ? () => {} : onClose} labelledBy="export-title" className="wide" escape={!working}>
      <div className="dialog-head">
        <h2 className="text-heading" id="export-title" style={{ flex: 1 }}>Export</h2>
        <button className="btn-secondary" onClick={onClose} disabled={working}>Close</button>
      </div>

      <h3 className="section-label">Format</h3>
      <div className="chips" role="radiogroup" aria-label="Format">
        {Object.entries(FORMATS).map(([key, f]) => (
          <button key={key} role="radio" aria-checked={format === key} className={'chip' + (format === key ? ' on' : '')}
            onClick={() => setFormat(key)} data-format={key}>{f.label}</button>
        ))}
      </div>
      <p className="sub" style={{ margin: '6px 4px 0' }}>{FORMATS[format].hint}</p>

      {design.pages.length > 1 && (
        <>
          <h3 className="section-label" style={{ marginTop: 16 }}>Pages</h3>
          <div className="chips" role="radiogroup" aria-label="Pages">
            {[['all', `All ${design.pages.length} pages`], ['current', 'This page'], ['choose', 'Choose pages']].map(([key, label]) => (
              <button key={key} role="radio" aria-checked={which === key} className={'chip' + (which === key ? ' on' : '')} onClick={() => setWhich(key)}>{label}</button>
            ))}
          </div>
          {which === 'choose' && (
            <ul className="list" style={{ marginTop: 8 }}>
              {design.pages.map((p, i) => (
                <li key={p.id} className="list-row">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minHeight: 28 }}>
                    <input type="checkbox" className="check" checked={chosen.has(p.id)} onChange={() => toggle(p.id)} />
                    <span>{i + 1}. {p.name}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {(format === 'png' || format === 'jpeg') && (
        <>
          <h3 className="section-label" style={{ marginTop: 16 }}>Size</h3>
          <div className="chips" role="radiogroup" aria-label="Size">
            {SCALES.map((s) => (
              <button key={s} role="radio" aria-checked={scale === s} className={'chip' + (scale === s ? ' on' : '')} onClick={() => setScale(s)}>{s}×</button>
            ))}
          </div>
          <p className="sub" style={{ margin: '6px 4px 0' }} data-output-size>
            {plan.width} × {plan.height} px{pages.length > 1 ? ' for the first page' : ''}, {Math.round(CSS_DPI * plan.scale)} DPI.
            {plan.capped ? ' Lowered to the largest size this browser can draw.' : ''}
          </p>
        </>
      )}

      {format === 'pdf' && (
        <>
          <h3 className="section-label" style={{ marginTop: 16 }}>Resolution</h3>
          <div className="chips" role="radiogroup" aria-label="Resolution">
            {PDF_DPI.map(([d, label]) => (
              <button key={d} role="radio" aria-checked={settings.dpi === d} disabled={printReady && d !== 300}
                className={'chip' + (settings.dpi === d ? ' on' : '')} onClick={() => setDpi(d)}>{label}</button>
            ))}
          </div>
          <label className="f" style={{ marginTop: 8 }}>
            <b>Print-ready: 300 DPI, 3 mm bleed and crop marks</b>
            <input type="checkbox" checked={printReady} onChange={(e) => setPrintReady(e.target.checked)} data-print-ready />
          </label>
          <label className="f" style={{ marginTop: 8 }}>
            <b>Include an editable copy, so Home Studio can reopen it</b>
            <input type="checkbox" checked={includeProject} onChange={(e) => setIncludeProject(e.target.checked)} />
          </label>
          <p className="sub" style={{ margin: '6px 4px 0' }}>
            {(sample.width * 0.75 / 72 * 25.4).toFixed(0)} × {(sample.height * 0.75 / 72 * 25.4).toFixed(0)} mm per page{printReady ? ' at the trim' : ''}.
          </p>
        </>
      )}

      {(format === 'jpeg' || format === 'pdf') && (
        <label className="f range" style={{ marginTop: 8 }}>
          <b>Quality</b>
          <input type="range" min={50} max={100} step={1} value={quality} onChange={(e) => setQuality(Number(e.target.value))} />
          <span className="range-val">{quality}%</span>
        </label>
      )}
      {(format === 'png' || format === 'svg') && (
        <label className="f" style={{ marginTop: 8 }}>
          <b>Transparent background</b>
          <input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} data-transparent />
        </label>
      )}

      <div className="dialog-foot">
        {run.state === 'working' && (
          <p className="sub" role="status" aria-live="polite">Exporting page {Math.min(run.done + 1, run.total)} of {run.total}…</p>
        )}
        {run.state === 'done' && (
          <p className="sub" role="status" data-export-done>
            Downloaded {run.name} ({formatBytes(run.size)}).
            {run.missing ? ` ${run.missing} image${run.missing === 1 ? " wasn't" : "s weren't"} on this device and ${run.missing === 1 ? 'was' : 'were'} left out.` : ''}
            {run.capped ? ' Some pages were made smaller to fit what this browser can draw.' : ''}
          </p>
        )}
        {run.state === 'error' && <p className="sub" role="alert" style={{ color: 'rgb(var(--danger))' }}>{run.text} Your design is unchanged. Try again.</p>}
        <button className="btn-primary" style={{ width: '100%' }} disabled={working || !pages.length} onClick={start} data-download>
          {working ? 'Exporting…' : !pages.length ? 'Choose at least one page' : `Download ${FORMATS[format].label}${many ? 's as a ZIP' : ''}`}
        </button>
      </div>
    </Scrim>
  );
}
