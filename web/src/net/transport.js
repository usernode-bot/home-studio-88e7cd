// Transports: how two peers exchange protocol messages. The interface is
// tiny — send(obj), onmessage, onstatechange, close() — so the session
// runs over WebRTC in the app and over an in-memory pipe in tests.
// Every incoming frame is size-capped before it is parsed: a peer is
// untrusted, and JSON.parse of a giant frame is an attack on its own.

import { CAPS } from './protocol.js';

export const MAX_FRAME = Math.max(CAPS.opBytes, CAPS.presenceBytes) * 2;

// State: 'connecting' | 'open' | 'closed'.
export function frameOk(data) {
  if (typeof data === 'string') return data.length <= MAX_FRAME;
  if (data instanceof ArrayBuffer) return data.byteLength <= MAX_FRAME;
  return true; // small binary frames are not our protocol anyway
}

export function parseFrame(data) {
  if (!frameOk(data)) return null;
  try {
    return JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data));
  } catch {
    return null;
  }
}

export const encodeFrame = (msg) => JSON.stringify(msg);

// An in-memory pipe for tests and for the loopback self-check: what one
// end sends arrives at the other.
export function createMemoryPair() {
  let aSide;
  let bSide;
  const wire = (from, to) => ({
    send(obj) {
      if (from.state !== 'open') return;
      const data = encodeFrame(obj);
      if (to.onmessage) queueMicrotask(() => to.onmessage(data));
    },
    close() {
      from.state = 'closed';
      if (from.onstatechange) from.onstatechange('closed');
      if (to.onstatechange) to.onstatechange('closed');
      to.state = 'closed';
    },
  });
  aSide = { state: 'open', onmessage: null, onstatechange: null, ...{ } };
  bSide = { state: 'open', onmessage: null, onstatechange: null };
  const a = { ...aSide, ...wire(aSide, bSide) };
  const b = { ...bSide, ...wire(bSide, aSide) };
  return [a, b];
}