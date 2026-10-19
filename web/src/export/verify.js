// Every export is reopened and checked before it downloads. The byte-level
// checks are pure functions so tests use them too; decode checks need the
// browser's image/PDF readers.

// PNG: signature + IHDR width/height. JPEG: SOI + first SOF's dimensions.
export function pngSize(bytes) {
  if (bytes.length < 24) throw new Error('That PNG file is incomplete.');
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) if (bytes[i] !== sig[i]) throw new Error("That file isn't a PNG image.");
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) throw new Error('That PNG file is missing its header.');
  return { w: (bytes[16] << 24 | bytes[17] << 16 | bytes[18] << 8 | bytes[19]) >>> 0, h: (bytes[20] << 24 | bytes[21] << 16 | bytes[22] << 8 | bytes[23]) >>> 0 };
}

export function jpegSize(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("That file isn't a JPEG image.");
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) { i += 1; continue; }
    const marker = bytes[i + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) { i += 2; continue; }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if ((marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)) {
      return { h: (bytes[i + 5] << 8) | bytes[i + 6], w: (bytes[i + 7] << 8) | bytes[i + 8] };
    }
    i += 2 + len;
  }
  throw new Error('That JPEG file is incomplete.');
}

// The browser-side checks: decode at the expected size (PNG, JPEG), parse
// (SVG), or reopen (PDF). Anything wrong throws a message for the dialog.
export async function verifyBlob(blob, expect) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (expect.type === 'image/png') {
    const size = pngSize(bytes);
    if (expect.w && (size.w !== expect.w || size.h !== expect.h)) {
      throw new Error(`The PNG came out ${size.w} × ${size.h}, expected ${expect.w} × ${expect.h}.`);
    }
  } else if (expect.type === 'image/jpeg') {
    const size = jpegSize(bytes);
    if (expect.w && (size.w !== expect.w || size.h !== expect.h)) {
      throw new Error(`The JPEG came out ${size.w} × ${size.h}, expected ${expect.w} × ${expect.h}.`);
    }
  } else if (expect.type === 'image/svg+xml') {
    const text = new TextDecoder().decode(bytes);
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    if (doc.querySelector('parsererror')) throw new Error("The SVG file couldn't be read back.");
    const root = doc.documentElement;
    if (!root || root.nodeName !== 'svg') throw new Error("That file isn't an SVG image.");
  } else if (expect.type === 'application/pdf') {
    const { PDFDocument } = await import('pdf-lib');
    const pdf = await PDFDocument.load(bytes);
    if (expect.pages && pdf.getPageCount() !== expect.pages) {
      throw new Error(`The PDF has ${pdf.getPageCount()} pages, expected ${expect.pages}.`);
    }
  } else {
    throw new Error("That file type can't be checked.");
  }
  // Everything image-shaped must also decode in this browser.
  if (expect.type === 'image/png' || expect.type === 'image/jpeg') {
    const bmp = await createImageBitmap(blob);
    bmp.close && bmp.close();
  }
}