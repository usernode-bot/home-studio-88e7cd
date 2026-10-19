// A small PDF writer for exported pages. Each page is one JPEG drawn at the
// page's size in points (a design pixel is a CSS pixel, 1/96 inch, so 0.75
// pt). Print-ready pages add a bleed around the trim, the TrimBox and
// BleedBox a print shop reads, and crop marks outside the bleed. A copy of
// the editable design can ride along as an attached file, which is how Home
// Studio reopens its own PDFs as designs. Pure: bytes in, bytes out.

import { utf8, concatBytes } from '../io/binary.js';

export const PT_PER_PX = 0.75;
export const MM_TO_PT = 72 / 25.4;
export const BLEED_MM = 3;
const MARK_GAP = 2; // pt between the bleed edge and a crop mark
const MARK_LEN = 12;

// Width, height and colour components from a JPEG's frame header.
export function jpegInfo(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('not a JPEG');
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const marker = bytes[i + 1];
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return {
        height: (bytes[i + 5] << 8) | bytes[i + 6],
        width: (bytes[i + 7] << 8) | bytes[i + 8],
        components: bytes[i + 9],
      };
    }
    i += 2 + len;
  }
  throw new Error('JPEG has no frame header');
}

const pad10 = (n) => String(n).padStart(10, '0');
const f = (n) => String(Math.round(n * 1000) / 1000);

export function pdfDate(date) {
  const p = (v) => String(v).padStart(2, '0');
  return `D:${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`;
}

// A text string as UTF-16BE hex, which every reader takes for any language.
export function pdfText(s) {
  let hex = 'FEFF';
  for (const ch of String(s)) {
    const cp = ch.codePointAt(0);
    if (cp > 0xffff) {
      const v = cp - 0x10000;
      hex += (0xd800 + (v >> 10)).toString(16).padStart(4, '0') + (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, '0');
    } else {
      hex += cp.toString(16).padStart(4, '0');
    }
  }
  return `<${hex.toUpperCase()}>`;
}

// The geometry of one page in points: where the trim, the bleed and the
// image sit inside the media box.
export function pageBoxes(widthPx, heightPx, { bleedMm = 0, marks = false } = {}) {
  const W = widthPx * PT_PER_PX;
  const H = heightPx * PT_PER_PX;
  const b = bleedMm * MM_TO_PT;
  const m = marks ? b + MARK_GAP + MARK_LEN + 4 : b;
  return {
    media: [0, 0, W + m * 2, H + m * 2],
    bleed: [m - b, m - b, m + W + b, m + H + b],
    trim: [m, m, m + W, m + H],
    margin: m,
    bleedPt: b,
    W,
    H,
  };
}

function cropMarks(bx) {
  const { margin: m, bleedPt: b, W, H } = bx;
  const near = b + MARK_GAP;
  const far = near + MARK_LEN;
  const segs = [];
  for (const y of [m, m + H]) {
    segs.push([m - far, y, m - near, y], [m + W + near, y, m + W + far, y]);
  }
  for (const x of [m, m + W]) {
    segs.push([x, m - far, x, m - near], [x, m + H + near, x, m + H + far]);
  }
  return `q 0 G 0.25 w ${segs.map(([x1, y1, x2, y2]) => `${f(x1)} ${f(y1)} m ${f(x2)} ${f(y2)} l S`).join(' ')} Q`;
}

// pages: [{ jpeg: Uint8Array, widthPx, heightPx }] (design size, not image
// pixels); opts: { title, bleedMm, marks, attachment: { name, bytes, mime }, date }.
export function buildPdf(pages, opts = {}) {
  const { title = 'Design', bleedMm = 0, marks = false, attachment = null, date = new Date() } = opts;
  if (!pages.length) throw new Error('no pages');
  const objects = []; // index i holds object i+1's bytes
  const reserve = () => { objects.push(null); return objects.length; };
  const set = (num, ...parts) => {
    objects[num - 1] = concatBytes([utf8(`${num} 0 obj\n`), ...parts.map((p) => (typeof p === 'string' ? utf8(p) : p)), utf8('\nendobj\n')]);
  };
  const stream = (num, dict, bytes) => set(num, `<< ${dict} /Length ${bytes.length} >>\nstream\n`, bytes, '\nendstream');

  const catalog = reserve();
  const pagesNum = reserve();
  const info = reserve();
  const kids = [];
  for (const pg of pages) {
    const img = jpegInfo(pg.jpeg);
    const bx = pageBoxes(pg.widthPx, pg.heightPx, { bleedMm, marks });
    const pageNum = reserve();
    const imgNum = reserve();
    const contentNum = reserve();
    kids.push(pageNum);
    const cs = img.components === 1 ? '/DeviceGray' : img.components === 4 ? '/DeviceCMYK' : '/DeviceRGB';
    stream(imgNum, `/Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace ${cs} /BitsPerComponent 8 /Filter /DCTDecode${img.components === 4 ? ' /Decode [1 0 1 0 1 0 1 0]' : ''}`, pg.jpeg);
    const [bx1, by1, bx2, by2] = bx.bleed;
    let content = `q ${f(bx2 - bx1)} 0 0 ${f(by2 - by1)} ${f(bx1)} ${f(by1)} cm /Im0 Do Q`;
    if (marks) content += '\n' + cropMarks(bx);
    stream(contentNum, '', utf8(content));
    const box = (a) => `[${a.map(f).join(' ')}]`;
    set(pageNum, `<< /Type /Page /Parent ${pagesNum} 0 R /MediaBox ${box(bx.media)} /BleedBox ${box(bx.bleed)} /TrimBox ${box(bx.trim)}`
      + ` /Resources << /XObject << /Im0 ${imgNum} 0 R >> >> /Contents ${contentNum} 0 R >>`);
  }
  set(pagesNum, `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`);
  set(info, `<< /Title ${pdfText(title)} /Producer ${pdfText('Home Studio')} /Creator ${pdfText('Home Studio')} /CreationDate (${pdfDate(date)}) >>`);

  let names = '';
  if (attachment) {
    const fileNum = reserve();
    const specNum = reserve();
    const mime = (attachment.mime || 'application/octet-stream').replace('/', '#2F');
    stream(fileNum, `/Type /EmbeddedFile /Subtype /${mime} /Params << /Size ${attachment.bytes.length} /ModDate (${pdfDate(date)}) >>`, attachment.bytes);
    const ascii = attachment.name.replace(/[^\x20-\x7e]/g, '_').replace(/[()\\]/g, '_');
    set(specNum, `<< /Type /Filespec /F (${ascii}) /UF ${pdfText(attachment.name)} /Desc ${pdfText('Editable Home Studio design')} /AFRelationship /Source /EF << /F ${fileNum} 0 R /UF ${fileNum} 0 R >> >>`);
    names = ` /Names << /EmbeddedFiles << /Names [${pdfText(attachment.name)} ${specNum} 0 R] >> >> /AF [${specNum} 0 R]`;
  }
  set(catalog, `<< /Type /Catalog /Pages ${pagesNum} 0 R${names} >>`);

  const header = concatBytes([utf8('%PDF-1.7\n%'), new Uint8Array([0xe2, 0xe3, 0xcf, 0xd3]), utf8('\n')]);
  const chunks = [header];
  const offsets = [];
  let pos = header.length;
  for (const o of objects) {
    offsets.push(pos);
    chunks.push(o);
    pos += o.length;
  }
  const xref = [`xref\n0 ${objects.length + 1}\n`, '0000000000 65535 f \n', ...offsets.map((o) => `${pad10(o)} 00000 n \n`)].join('');
  chunks.push(utf8(xref + `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${pos}\n%%EOF\n`));
  return concatBytes(chunks);
}
