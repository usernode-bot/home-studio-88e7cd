// Manual signaling: the offer and answer travel as codes a person copies
// and pastes between two devices. Zero infrastructure, one guest at a
// time — the shape the collaboration works in when there is no node.

// A code is the connection JSON, compressed to base32 text in groups, so
// it survives whitespace and case slips when it is copied.
export function codeFrom(obj) {
  const text = JSON.stringify(obj);
  let b32 = '';
  const bytes = new TextEncoder().encode(text);
  const A = 'abcdefghijklmnopqrstuvwxyz234567';
  let bits = 0;
  let value = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      b32 += A[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) b32 += A[(value << (5 - bits)) & 31];
  return (b32.toUpperCase().match(/.{1,5}/g) || []).join('-');
}

export function objFromCode(code) {
  const A = 'abcdefghijklmnopqrstuvwxyz234567';
  const clean = String(code || '').toUpperCase().replace(/[^A-Z2-7]/g, '').toLowerCase();
  if (!clean) throw new Error('That code is empty.');
  const bytes = [];
  let bits = 0;
  let value = 0;
  for (const c of clean) {
    const i = A.indexOf(c);
    if (i === -1) throw new Error('That code has a character it should not have.');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  let obj;
  try {
    obj = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes)));
  } catch {
    throw new Error('That code is not a Home Studio connection code.');
  }
  if (!obj || typeof obj !== 'object') throw new Error('That code is not a Home Studio connection code.');
  return obj;
}