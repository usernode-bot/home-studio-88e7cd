// The Export dialog: one job, turning the design into a file. Format, pages,
// size or print resolution, quality and transparency, then download. Every
// file is reopened and checked before the download starts.

import React, { useMemo, useState } from 'react';
import { runExport, FORMAT_NOTES } from '../export/index.js';
import { fitScale } from '../export/raster.js';
import { printedSize } from '../export/pdf.js';

const FORMATS = [['png', 'PNG'], ['jpeg', 'JPEG'], ['svg', 'SVG'], ['pdf', 'PDF']];
const SCALES = [1, 2, 3, 4];

export default function ExportDialog({ design, page, images, onClose }) {
  const [format, setFormat] = useState('png');
  const [pages, setPages] = useState('all'); // 'this' | 'all'
  const [scale, setScale] = useState(2);
  const [dpi, setDpi] = useState(150);
  const [quality, setQuality] = useState(90);
  const [transparent, setTransparent] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const chosen = pages === 'this' ? [page] : design.pages;
  const raster = format === 'png' || format === 'jpeg';
  const shownScale = raster ? fitScale(page.width, page.height, scale) : scale;
  const pxW = Math.round(page.width * shownScale);
  const pxH = Math.round(page.height * shownScale);

  const exportNow = async () => {
    setBusy('Preparing…');
    setError('');
    setDone('');
    try {
      const msg = await runExport(design, {
        format, pages: chosen, scale, quality, transparent, dpi,
        designName: design.name, images,
      }, (s) => setBusy(s));
      setDone(msg);
      setBusy('');
      setTimeout(() => setDone(''), 2500);
    } catch (err) {
      setBusy('');
      setError(err.message || "The export didn't work. Try again.");
    }
  };

  return (
    <div className="dialog-scrim" onPointerDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="dialog card wide" role="dialog" aria-modal="true" aria-labelledby="export-title">
        <h2 className="text-heading" id="export-title" style={{ marginBottom: 4 }}>Export</h2>
        <p className="sub" style={{ marginBottom: 12 }}>Every file is checked before it downloads. No watermarks, no limits.</p>

        <span className="section-label" style={{ display: 'block' }}>Format</span>
        <div className="chips" role="group" aria-label="Format">
          {FORMATS.map(([k, label]) => (
            <button key={k} className={'chip' + (format === k ? ' on' : '')} onClick={() => setFormat(k)}>{label}</button>
          ))}
        </div>
        <p className="sub" style={{ marginBottom: 12 }}>{FORMAT_NOTES[format]}</p>

        <span className="section-label" style={{ display: 'block' }}>Pages</span>
        <div className="chips" role="group" aria-label="Pages">
          <button className={'chip' + (pages === 'this' ? ' on' : '')} onClick={() => setPages('this')}>This page</button>
          <button className={'chip' + (pages === 'all' ? ' on' : '')} onClick={() => setPages('all')}>All pages ({design.pages.length})</button>
        </div>
        <p className="sub" style={{ marginBottom: 12 }}>
          {format === 'pdf'
            ? 'One PDF with a page for each chosen page.'
            : chosen.length === 1 ? 'One file.' : `${chosen.length} files in one ZIP.`}
        </p>

        {raster && (
          <>
            <span className="section-label" style={{ display: 'block' }}>Size</span>
            <div className="chips" role="group" aria-label="Size">
              {SCALES.map((s) => (
                <button key={s} className={'chip' + (scale === s ? ' on' : '')} onClick={() => setScale(s)}>{s}×</button>
              ))}
            </div>
            <p className="size" style={{ marginBottom: 4 }}>{pxW} × {pxH} px</p>
            {shownScale < scale && (
              <p className="sub" style={{ marginBottom: 8 }}>
                {scale}× is bigger than this browser can draw; the export uses {shownScale}× instead.
              </p>
            )}
          </>
        )}
        {format === 'pdf' && (
          <>
            <span className="section-label" style={{ display: 'block' }}>Resolution</span>
            <div className="chips" role="group" aria-label="Resolution">
              {[['screen', 'Screen (96 dpi)'], ['standard', 'Standard (150 dpi)'], ['print', 'Print (300 dpi)']].map(([k, label], i) => (
                <button key={k} className={'chip' + (dpi === [96, 150, 300][i] ? ' on' : '')} onClick={() => setDpi([96, 150, 300][i])}>{label}</button>
              ))}
            </div>
            <p className="sub" style={{ marginBottom: 12 }}>Printed size: {printedSize(page, dpi)}.</p>
          </>
        )}

        {(format === 'jpeg' || format === 'pdf') && (
          <>
            <label className="block" style={{ marginBottom: 12 }}>
              <span className="section-label" style={{ display: 'block' }}>Quality</span>
              <input type="range" min="10" max="100" value={quality} style={{ width: '100%' }}
                onChange={(e) => setQuality(Number(e.target.value))} aria-label="Quality" />
              <span className="sub">JPEG quality {quality} of 100</span>
            </label>
          </>
        )}

        {(format === 'png' || format === 'svg') && (
          <label className="check">
            <input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} />
            <span>Transparent background</span>
          </label>
        )}
        {(format === 'jpeg' || format === 'pdf') && (
          <p className="sub" style={{ marginBottom: 8 }}>JPEG and PDF always keep the background, because neither format has transparency.</p>
        )}

        {error && (
          <div className="state-error" role="alert" style={{ margin: '8px 0' }}>
            <div>{error}</div>
            <button className="btn-secondary" onClick={exportNow}>Try again</button>
          </div>
        )}
        {done && <p className="sub" style={{ color: 'rgb(var(--accent))' }}>{done}</p>}

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button className="btn-secondary" style={{ flex: 1 }} disabled={!!busy} onClick={onClose}>Cancel</button>
          <button className="btn-primary" style={{ flex: 1 }} disabled={!!busy} onClick={exportNow} data-export-run>
            {busy || `Download ${FORMATS.find(([k]) => k === format)[1]}`}
          </button>
        </div>
      </div>
    </div>
  );
}