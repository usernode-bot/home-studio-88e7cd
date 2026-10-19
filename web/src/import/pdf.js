// Opening PDFs, with pdf.js (Apache License 2.0), loaded only when a PDF is
// opened. A PDF Home Studio exported carries its editable design as an
// attached file, and opens as that design again. Any other PDF opens as a
// new design with each page as a picture at the page's own size: its text
// isn't editable, but it can be drawn over, cropped and exported.

import { PAGE_MAX, PAGE_MIN } from '../doc/model.js';
import { PROJECT_SUFFIX } from '../io/project.js';
import { fromUtf8 } from '../io/binary.js';

export const PDF_MAX_PAGES = 100;
const PX_PER_PT = 96 / 72;
const MAX_PIXELS = 12_000_000; // per rendered page

async function loadPdfjs() {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.min.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

// The page size a PDF page becomes, in design px (1 pt = 4/3 px).
export function pdfPageSize(ptW, ptH) {
  let w = ptW * PX_PER_PT;
  let h = ptH * PX_PER_PT;
  const shrink = Math.min(1, PAGE_MAX / Math.max(w, h));
  w *= shrink;
  h *= shrink;
  return { width: Math.min(PAGE_MAX, Math.max(PAGE_MIN, Math.round(w))), height: Math.min(PAGE_MAX, Math.max(PAGE_MIN, Math.round(h))) };
}

// Opens the PDF. Resolves { pageCount, projectText, renderPage(n), close }.
export async function openPdf(bytes) {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: bytes, isEvalSupported: false, enableXfa: false, verbosity: 0 });
  let doc;
  try {
    doc = await task.promise;
  } catch (err) {
    if (err && err.name === 'PasswordException') throw new Error("This PDF is protected by a password, so it can't be opened.");
    throw new Error("This PDF couldn't be read. It may be damaged.");
  }
  let projectText = null;
  try {
    // A Map of id -> { filename }; the bytes are read separately.
    const att = await doc.getAttachments();
    const hit = att && [...att.entries()].find(([, a]) => a.filename && a.filename.endsWith(PROJECT_SUFFIX));
    if (hit) projectText = fromUtf8(await doc.getAttachmentContent(hit[0]));
  } catch { /* no attachments */ }
  return {
    pageCount: doc.numPages,
    projectText,
    // Page n (from 1) drawn as a PNG at twice its design size, within limits.
    async renderPage(n) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const size = pdfPageSize(base.width, base.height);
      const scale = Math.min(2 * (size.width / base.width), Math.sqrt(MAX_PIXELS / (base.width * base.height)));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, canvas, viewport }).promise;
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      const natW = canvas.width;
      const natH = canvas.height;
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
      if (!blob) throw new Error(`Page ${n} of this PDF is too large to open on this device.`);
      return { blob, ...size, natW, natH };
    },
    close: () => task.destroy(),
  };
}
