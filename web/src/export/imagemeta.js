// Reading and stamping PNG and JPEG files: their pixel size, and the
// resolution (DPI) a print dialog or an image editor reads, so a 2× export
// of a 1080 px design still prints at the design's own size. Pure.

import { crc32, concatBytes, utf8 } from '../io/binary.js';

const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];

// Every chunk of a PNG, its CRC checked. Throws on a damaged file.
export function pngChunks(bytes) {
  if (!PNG_SIG.every((b, i) => bytes[i] === b)) throw new Error('not a PNG');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks = [];
  let i = 8;
  while (i + 12 <= bytes.length) {
    const len = view.getUint32(i);
    const type = String.fromCharCode(...bytes.subarray(i + 4, i + 8));
    if (i + 12 + len > bytes.length) throw new Error('PNG chunk runs past the end');
    const crc = view.getUint32(i + 8 + len);
    if (crc32(bytes, i + 4, i + 8 + len) !== crc) throw new Error(`PNG ${type} chunk is damaged`);
    chunks.push({ type, start: i, end: i + 12 + len, data: bytes.subarray(i + 8, i + 8 + len) });
    i += 12 + len;
    if (type === 'IEND') break;
  }
  if (!chunks.length || chunks[0].type !== 'IHDR' || chunks[chunks.length - 1].type !== 'IEND') throw new Error('PNG is incomplete');
  return chunks;
}

export function pngInfo(bytes) {
  const chunks = pngChunks(bytes);
  const d = new DataView(chunks[0].data.buffer, chunks[0].data.byteOffset, 13);
  const phys = chunks.find((c) => c.type === 'pHYs');
  let dpi = null;
  if (phys && phys.data[8] === 1) dpi = Math.round(new DataView(phys.data.buffer, phys.data.byteOffset, 9).getUint32(0) * 0.0254);
  // Colour types 4 and 6 carry an alpha channel.
  return { width: d.getUint32(0), height: d.getUint32(4), colorType: d.getUint8(9), alpha: [4, 6].includes(d.getUint8(9)), dpi };
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(utf8(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

// The PNG with one pHYs chunk saying `dpi`, right after its header.
export function setPngDpi(bytes, dpi) {
  const chunks = pngChunks(bytes);
  const ppm = Math.round(dpi / 0.0254);
  const data = new Uint8Array(9);
  const view = new DataView(data.buffer);
  view.setUint32(0, ppm);
  view.setUint32(4, ppm);
  data[8] = 1; // metres
  const parts = [bytes.subarray(0, 8)];
  for (const c of chunks) {
    if (c.type === 'pHYs') continue;
    parts.push(bytes.subarray(c.start, c.end));
    if (c.type === 'IHDR') parts.push(chunk('pHYs', data));
  }
  return concatBytes(parts);
}

// A JPEG's JFIF resolution, or null.
export function jpegDpi(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('not a JPEG');
  if (bytes[2] === 0xff && bytes[3] === 0xe0 && String.fromCharCode(...bytes.subarray(6, 11)) === 'JFIF\0') {
    if (bytes[13] !== 1) return null;
    return (bytes[14] << 8) | bytes[15];
  }
  return null;
}

// The JPEG with a JFIF header saying `dpi` (patched in place on a copy, or
// added after the start marker when the encoder wrote none).
export function setJpegDpi(bytes, dpi) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('not a JPEG');
  const d = Math.max(1, Math.min(65535, Math.round(dpi)));
  if (bytes[2] === 0xff && bytes[3] === 0xe0 && String.fromCharCode(...bytes.subarray(6, 11)) === 'JFIF\0') {
    const out = bytes.slice();
    out[13] = 1;
    out[14] = d >> 8; out[15] = d & 255;
    out[16] = d >> 8; out[17] = d & 255;
    return out;
  }
  const app0 = new Uint8Array([0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 1, d >> 8, d & 255, d >> 8, d & 255, 0, 0]);
  return concatBytes([bytes.subarray(0, 2), app0, bytes.subarray(2)]);
}
