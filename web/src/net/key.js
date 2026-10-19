// Room keys: 128 random bits shown as base32 groups, and back again.
// Pure and browser-or-Node: crypto.getRandomValues exists in both.

const B32 = 'abcdefghijklmnopqrstuvwxyz234567';

export function randomKeyBytes(n) {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function bytesToBase32Shorts(bytes) {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out.toUpperCase();
}

export function base32ShortsToBytes(chars) {
  const upper = String(chars).toUpperCase().replace(/[^A-Z2-7]/g, '');
  const bytes = [];
  let bits = 0;
  let value = 0;
  for (const c of upper) {
    value = (value << 5) | B32.indexOf(c.toLowerCase());
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
}