// Presence: where everyone's cursor is and what they have selected. Sent
// outside the document store, throttled to 10 updates a second (see
// protocol.js PRESENCE_HZ), and drawn by ui/RemoteCursors.jsx. One color
// per peer, derived from its peer id, so every screen shows the same
// person in the same color without extra protocol messages.

export const PEER_COLORS = 6;

// The token name ('peer-1' … 'peer-6'), defined in styles/tailwind-input.css.
export const colorForIndex = (i) => `peer-${(i % PEER_COLORS) + 1}`;

// The same color on every peer's screen: a stable hash of the peer id.
export function colorForPeer(peerId) {
  let h = 0;
  const s = String(peerId || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return colorForIndex(h);
}

// A short display name for a peer: the name it announced, or "Guest".
export function displayName(hello) {
  const n = hello && typeof hello.name === 'string' ? hello.name.trim() : '';
  return (n || 'Guest').slice(0, 24);
}

// The throttler: pass calls through at most `hz` times a second; the last
// call within the window is kept and sent when the window closes.
export function createThrottle(hz) {
  const gap = 1000 / hz;
  let last = 0;
  let timer = null;
  let pending = null;
  const flush = () => {
    timer = null;
    if (pending === null) return;
    const value = pending;
    pending = null;
    last = Date.now();
    fn(value);
  };
  let fn = () => {};
  return {
    run(value, f) {
      fn = f;
      const now = Date.now();
      if (now - last >= gap) {
        last = now;
        f(value);
        return;
      }
      pending = value;
      if (!timer) timer = setTimeout(flush, gap - (now - last));
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}