// Byte helpers shared by the file formats: base64 both ways, CRC-32 (ZIP
// and PNG both use it), text to bytes and joining byte chunks. Pure and
// browser-or-Node: no DOM.

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes) {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  if (i < bytes.length) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + '=';
  }
  return out;
}

const B64_INDEX = new Int16Array(128).fill(-1);
for (let i = 0; i < B64.length; i++) B64_INDEX[B64.charCodeAt(i)] = i;

// Rejects anything that isn't plain base64, so a damaged file says so.
export function base64ToBytes(text) {
  const s = String(text).replace(/\s+/g, '');
  if (s.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(s) || /=[^=]/.test(s)) throw new Error('bad base64');
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((s.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    const n = (B64_INDEX[s.charCodeAt(i)] << 18) | (B64_INDEX[s.charCodeAt(i + 1)] << 12)
      | (Math.max(0, B64_INDEX[s.charCodeAt(i + 2)]) << 6) | Math.max(0, B64_INDEX[s.charCodeAt(i + 3)]);
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

let CRC_TABLE = null;
export function crc32(bytes, start = 0, end = bytes.length) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export const utf8 = (s) => new TextEncoder().encode(s);
export const fromUtf8 = (b) => new TextDecoder().decode(b);

export function concatBytes(chunks) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

export async function blobToBytes(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

export async function blobToDataUrl(blob) {
  return `data:${blob.type || 'application/octet-stream'};base64,${bytesToBase64(await blobToBytes(blob))}`;
}

// A filename-safe version of a design or page name.
export function safeFileName(name, fallback = 'design') {
  const s = String(name || '').normalize('NFKC').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return s || fallback;
}
