// The self-hosted node's signaling relay for collaboration: one WebSocket,
// rooms addressed by the room key, messages relayed between the people in
// a room so their browsers can find each other before WebRTC takes over.
// The node relays signaling only — it never sees the document, the edits
// or the images; those travel peer-to-peer over the data channel, and the
// host's browser sequences every edit (see web/src/net/session.js).
//
// The protocol is what the app speaks (web/src/net/signaling-node.js):
//   client -> node: { type: 'join', room, from, name }
//                   { type: 'offer'|'answer'|'candidate'|'bye', from, to, ... }
//   node   -> room: the same message, relayed to the person it names
//                   (a join goes to everyone else in the room; the host
//                   answers with the roster, which is relayed like the rest)
//
// Run it:  node signal.js         (or: npm run signal in this directory)
// Config:  PORT (default 8788). Put TLS in front for wss:// — a browser
//          will not open a ws:// socket from an https:// page.

import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT || process.env.HOME_STUDIO_SIGNAL_PORT || 8788);
const MAX_PEERS = 8; // the app's own room cap (session.js)
const MAX_FRAME = 32 * 1024; // offers, answers and candidates are small

const log = (...args) => console.log('[signal]', ...args);

// Room keys arrive as the app draws them (AB12-... groups); the address
// is the key with everything but its alphabet removed.
const cleanRoom = (raw) => {
  const s = String(raw || '').toUpperCase().replace(/[^A-Z2-7-]/g, '');
  return s.length >= 20 && s.length <= 64 ? s : null;
};

const cleanText = (v, n) => (typeof v === 'string' && v.length <= n ? v : null);

// Whether a relayed message is well-formed enough to pass on. Everything
// else is dropped: the relay never forwards what the app would refuse.
function cleanSignal(m) {
  if (!m || typeof m !== 'object') return null;
  const type = String(m.type || '');
  if (!['join', 'peers', 'offer', 'answer', 'candidate', 'bye'].includes(type)) return null;
  const out = { type, from: String(m.from || '').slice(0, 80) };
  if (out.from !== m.from) return null;
  if (m.to !== undefined) out.to = String(m.to || '').slice(0, 80);
  if (type === 'offer' || type === 'answer') {
    if (typeof m.sdp !== 'string' || m.sdp.length > 20000) return null;
    out.sdp = m.sdp;
  }
  if (type === 'candidate') {
    if (typeof m.candidate !== 'string' || m.candidate.length > 2000) return null;
    out.candidate = m.candidate;
  }
  if (type === 'peers') {
    if (!Array.isArray(m.ids)) return null;
    out.ids = m.ids.filter((x) => typeof x === 'string' && x.length <= 80).slice(0, 8);
  }
  return out;
}

// peerId -> socket, roomKey -> Set<peerId>.
const sockets = new Map();
const rooms = new Map();

const memberIds = (room) => [...(rooms.get(room) || [])];

function leave(room, peerId) {
  const set = rooms.get(room);
  if (!set) return;
  set.delete(peerId);
  if (!set.size) rooms.delete(room);
}

const wss = new WebSocketServer({ port: PORT, maxPayload: MAX_FRAME });

wss.on('connection', (ws) => {
  let room = null;
  let peerId = null;
  const mine = new Map(); // every peer id this socket registered -> its room

  ws.on('message', (data) => {
    let m;
    try { m = JSON.parse(data.toString()); } catch { return; }
    if (m && m.type === 'join') {
      const key = cleanRoom(m.room);
      const id = cleanText(m.from, 80);
      if (!key || !id || (sockets.has(id) && sockets.get(id) !== ws)) {
        ws.send(JSON.stringify({ type: 'error', text: 'That room key or peer id is not one this relay accepts.' }));
        return;
      }
      const set = rooms.get(key);
      if (set && set.size >= MAX_PEERS && !set.has(id)) {
        ws.send(JSON.stringify({ type: 'error', text: 'That room is full.' }));
        return;
      }
      // A socket that joins again must not keep its previous registration
      // alive: a ghost id could later be claimed by a newcomer, who would
      // then receive the ghost's messages.
      for (const [oldId, oldRoom] of mine) {
        if (sockets.get(oldId) === ws) sockets.delete(oldId);
        leave(oldRoom, oldId);
      }
      mine.clear();
      room = key;
      peerId = id;
      sockets.set(id, ws);
      mine.set(id, key);
      const roster = rooms.get(key) || new Set();
      roster.add(id);
      rooms.set(key, roster);
      log('join', key, id, '- room now', [...roster].length);
      // Everyone else in the room hears about the join; the host admits
      // the newcomer and starts the connection. The name rides along so
      // the host can greet the person by it.
      const relayed = cleanSignal({ type: 'join', from: id, name: cleanText(m.name, 40) || '' });
      if (relayed && typeof m.name === 'string') relayed.name = m.name.slice(0, 40);
      for (const other of roster) {
        if (other === id) continue;
        const sock = sockets.get(other);
        if (sock && sock.readyState === 1) sock.send(JSON.stringify(relayed));
      }
      return;
    }
    if (!room) return;
    // The relay stamps the sender itself: a member cannot send as someone
    // else, and a client that omits its id still gets through.
    const msg = cleanSignal({ ...m, from: peerId });
    if (!msg) return;
    if (msg.type === 'bye') {
      if (sockets.get(peerId) === ws) sockets.delete(peerId);
      leave(room, peerId);
      mine.delete(peerId);
      try { ws.close(); } catch { /* already gone */ }
      return;
    }
    if (typeof msg.to !== 'string') return;
    const target = sockets.get(msg.to);
    if (target && target.readyState === 1) target.send(JSON.stringify(msg));
  });

  ws.on('close', () => {
    // By socket, not by the latest id alone: a socket that re-joined
    // under a new id still owns the removal of every id it registered.
    for (const [id, key] of mine) {
      if (sockets.get(id) === ws) sockets.delete(id);
      leave(key, id);
      log('left', key, id);
    }
  });
});

// A stopped container must not be killed mid-relay: stop accepting, close
// every socket, exit.
let shuttingDown = false;
const shutdown = (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  log(signal + ' received, closing');
  for (const ws of wss.clients) try { ws.close(); } catch { /* already gone */ }
  wss.close(() => process.exit(0));
  const t = setTimeout(() => process.exit(0), 3000);
  t.unref?.();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

wss.on('listening', () => log('listening on', PORT));