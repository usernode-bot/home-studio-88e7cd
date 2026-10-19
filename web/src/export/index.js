// The export pipeline: pick pages, draw each through the one serialiser,
// rasterise (PNG, JPEG) or keep the SVG, build the PDF, then reopen and
// verify every file before anything downloads. Several PNG, JPEG or SVG
// pages arrive as one ZIP, since browsers block several downloads at once.

import { zipSync, strToU8 } from 'fflate';
import { pageToSvg } from './svgPage.js';
import { rasterize, fitScale } from './raster.js';
import { buildPdf } from './pdf.js';
import { verifyBlob } from './verify.js';
import { fontsInlineCss } from './fontsInline.js';
import { canvasMeasure } from './textLayout.js';

const FORMAT_LABELS = { png: 'PNG', jpeg: 'JPEG', svg: 'SVG', pdf: 'PDF' };

// Unsafe characters out of a file name, duplicates numbered.
export function safeName(base, taken) {
  let name = String(base).replace(/[\\/:*?"<>|#&]+/g, ' ').replace(/\s+/g, ' ').trim() || 'page';
  let candidate = name;
  let i = 2;
  while (taken.has(candidate.toLowerCase())) candidate = `${name} ${i++}`;
  taken.add(candidate.toLowerCase());
  return candidate;
}

const extOf = (fmt) => ({ png: 'png', jpeg: 'jpg', svg: 'svg', pdf: 'pdf' }[fmt]);

export const downloadBlob = (blob, name) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
};

export const FORMAT_NOTES = {
  png: 'Crisp at any size, with optional transparency.',
  jpeg: 'Smaller files; always keeps the background, because JPEG has no transparency.',
  svg: "Shapes and text stay sharp at any size. Bundled and imported fonts are embedded; system fonts use the viewer's own.",
  pdf: 'Each page is a high-resolution picture, so text in the PDF can\'t be selected or edited.',
};

// The whole export: resolves a message for the dialog, downloads the files.
// opts: { format, pages (array of page objects), scale (1..4), quality,
// transparent, dpi, designName }
export async function runExport(design, opts, onProgress = () => {}) {
  const { format, transparent = false, quality = 90, dpi = 150, designName = 'Design' } = opts;
  const pages = opts.pages;
  if (!pages || !pages.length) throw new Error('Choose at least one page to export.');
  const measure = canvasMeasure();
  onProgress('Preparing fonts…');
  const fontCss = await fontsInlineCss(pages, () => null);
  const images = opts.images || {};

  onProgress(`Drawing…`);
  if (format === 'pdf') {
    const blob = await buildPdf(pages, {
      dpi, quality,
      svgFor: (page, scale) => pageToSvg(page, { scale, images, fontCss, measure }),
      images, fontCss, measure,
      onProgress: (i, total) => onProgress(`Drawing page ${i} of ${total}…`),
    });
    onProgress('Checking the PDF…');
    await verifyBlob(blob, { type: 'application/pdf', pages: pages.length });
    downloadBlob(blob, `${safeName(designName, new Set())}.pdf`);
    return 'PDF downloaded.';
  }

  const blobs = [];
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    onProgress(`Drawing page ${i + 1} of ${pages.length}…`);
    if (format === 'svg') {
      const scale = opts.scale || 1;
      const svg = pageToSvg(page, { scale, transparent, images, fontCss, measure });
      blobs.push({ name: `${safeName(`${designName} - ${page.name}`, new Set())}.svg`, blob: new Blob([svg], { type: 'image/svg+xml' }), expect: { type: 'image/svg+xml' } });
      continue;
    }
    const scale = fitScale(page.width, page.height, opts.scale || 1);
    const w = Math.round(page.width * scale);
    const h = Math.round(page.height * scale);
    const svg = pageToSvg(page, { scale, transparent, images, fontCss, measure });
    const type = format === 'jpeg' ? 'image/jpeg' : 'image/png';
    const blob = await rasterize(svg, w, h, {
      type,
      quality: format === 'jpeg' ? Math.min(100, Math.max(10, quality)) / 100 : undefined,
      background: page.background || '#ffffff',
    });
    blobs.push({
      name: `${safeName(`${designName} - ${page.name}`, new Set())}.${extOf(format)}`,
      blob,
      expect: { type, w, h },
    });
  }

  onProgress(`Checking ${blobs.length === 1 ? 'the file' : `${blobs.length} files`}…`);
  for (const { name, blob, expect } of blobs) await verifyBlob(blob, expect);
  if (blobs.length === 1) {
    downloadBlob(blobs[0].blob, blobs[0].name);
  } else {
    const files = {};
    for (const { name, blob } of blobs) files[name] = new Uint8Array(await blob.arrayBuffer());
    const zip = new Blob([zipSync(files)], { type: 'application/zip' });
    downloadBlob(zip, `${safeName(designName, new Set())} ${FORMAT_LABELS[format]}.zip`);
  }
  return blobs.length === 1 ? `${FORMAT_LABELS[format]} downloaded.` : `${FORMAT_LABELS[format]} files downloaded as one ZIP.`;
}