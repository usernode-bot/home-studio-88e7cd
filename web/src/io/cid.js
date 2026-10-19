// Content identifiers: CIDv1, raw codec, base32 — the address an
// IPFS-compatible store answers for a design or an image. Computed with
// the platform's crypto (SHA-256), so a file's address is decided by its
// bytes and nothing else. Pure and browser-or-Node: no DOM.

const RAW_CODEC = 0x55; // 0x55: raw, leaf blocks in CIDv1
const SHA2_256 = 0x12; // multihash code
const B32 = 'abcdefghijklmnopqrstuvwxyz234567';

function base32(bytes) {
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
  return out;
}

// The CID for a byte array: 'b' prefix (base32 lower, multibase 0x62),
// CIDv1, raw codec, sha2-256. Resolves "bafkrei…".
export async function cidOfBytes(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const prefix = new Uint8Array([
    0x01, // CID version 1
    RAW_CODEC,
    SHA2_256, digest.length,
  ]);
  const out = new Uint8Array(prefix.length + digest.length);
  out.set(prefix);
  out.set(digest, prefix.length);
  return 'b' + base32(out);
}

export async function cidOfText(text) {
  return cidOfBytes(new TextEncoder().encode(text));
}

// Whether a string looks like one of our CIDs (base32 v1, raw, sha2-256).
export function looksLikeCid(text) {
  return typeof text === 'string' && /^bafkrei[a-z2-7]{52}$/.test(text);
}