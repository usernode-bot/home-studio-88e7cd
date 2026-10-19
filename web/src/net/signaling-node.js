// Node signaling: a WebSocket on the self-hosted Home Studio node relays
// signaling messages for one room, addressed by the room key. The host
// relays nothing itself — the node does — but the host still sequences
// every edit (see session.js).

import { cleanSignal } from './signaling.js';

// A signaling socket. state: 'connecting' | 'open' | 'closed'.
export function openNodeSignaling({ url, roomKey, peerId, name, onmessage, onstatechange }) {
  let ws;
  let closed = false;
  try {
    ws = new WebSocket(url);
  } catch {
    if (onstatechange) onstatechange('closed', 'That signaling address could not be opened.');
    return { state: 'closed', send: () => {}, close: () => {} };
  }
  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({ type: 'join', room: roomKey, from: peerId, name: String(name || '').slice(0, 40) }));
    if (onstatechange) onstatechange('open');
  });
  ws.addEventListener('message', (e) => {
    let data;
    try { data = JSON.parse(typeof e.data === 'string' ? e.data : ''); } catch { return; }
    const msg = cleanSignal(data);
    if (msg && onmessage) onmessage(msg);
  });
  ws.addEventListener('close', () => {
    if (!closed && onstatechange) onstatechange('closed');
  });
  ws.addEventListener('error', () => {
    if (!closed && onstatechange) onstatechange('closed', 'The signaling connection failed.');
  });
  return {
    get state() { return closed ? 'closed' : ws.readyState === 1 ? 'open' : 'connecting'; },
    send(obj) {
      const msg = cleanSignal({ ...obj, from: peerId });
      if (msg && ws.readyState === 1) ws.send(JSON.stringify(msg));
    },
    close() {
      closed = true;
      try { ws.close(); } catch { /* already gone */ }
      if (onstatechange) onstatechange('closed');
    },
  };
}