// PDF export: each page is a high-resolution picture, embedded with pdf-lib.
// A faithful vector PDF of every style isn't reliable in the browser, so the
// dialog says the text can't be selected or edited.

import { fitScale } from './raster.js';

// dpi: 96 (screen), 150 (standard), 300 (print). quality: JPEG quality 10..100.
export async function buildPdf(pages, { dpi = 150, quality = 90, svgFor, images = {}, fontCss = '', measure, onProgress } = {}) {
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  pdf.setTitle('Home Studio design');
  pdf.setCreator('Home Studio');
  const q = Math.min(100, Math.max(10, quality)) / 100;
  for (let i = 0; i < pages.length; i++) {
    if (onProgress) onProgress(i + 1, pages.length);
    const page = pages[i];
    const scale = fitScale(page.width, page.height, dpi / 96);
    const { rasterize } = await import('./raster.js');
    const svg = svgFor(page, scale);
    const blob = await rasterize(svg, Math.round(page.width * scale), Math.round(page.height * scale),
      { type: 'image/jpeg', quality: q, background: page.background || '#ffffff' });
    const jpg = await pdf.embedJpg(await blob.arrayBuffer());
    const p = pdf.addPage([page.width * 0.75, page.height * 0.75]);
    p.drawImage(jpg, { x: 0, y: 0, width: p.getWidth(), height: p.getHeight() });
  }
  const bytes = await pdf.save();
  return new Blob([bytes], { type: 'application/pdf' });
}

// The resolution choices the dialog offers, with their printed size text.
export const DPI_OPTIONS = [
  ['screen', 'Screen', 96],
  ['standard', 'Standard', 150],
  ['print', 'Print', 300],
];

export function printedSize(page, dpi) {
  const cmW = (page.width / dpi) * 2.54;
  const cmH = (page.height / dpi) * 2.54;
  const fmt = (cm) => (cm >= 10 ? Math.round(cm * 10) / 10 : Math.round(cm * 100) / 100);
  return `${fmt(cmW)} × ${fmt(cmH)} cm · ${fmt(cmW / 2.54)} × ${fmt(cmH / 2.54)} in`;
}