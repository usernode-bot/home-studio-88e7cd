// The collaboration session: one shared editing room over the document.
// A session has a role — the host (who made the room) or a guest — and
// runs a star: every guest talks to the host, and the host sequences the
// edits so every peer applies them in the same order. Guests apply only
// what the host relays, with a contiguous sequence number; a gap means
// something was missed and the guest asks the host for the full page
// state. A drop and rejoin is handled as a merge, where a deletion beats
// an edit (see merge.js).
//
// The session owns no document state: it emits ops and presence and the
// app applies them through the document store, the same door every local
// edit goes through.
//
// Two signaling modes: node (a WebSocket on the self-hosted node relays
// signaling for the room, many peers) and manual (copy-paste connection
// codes, exactly two peers with the fixed ids 'host' and 'guest').

import { validateMessage, CAPS } from './protocol.js';
import { MAX_FRAME } from './transport.js';
import { createPeer } from './webrtc.js';
import { createThrottle, displayName, colorForPeer } from './presence.js';

const MAX_PEERS = 8;

export function createSession({ role, peerId, name, signaling, iceServers, onEvent }) {
  const peers = new Map(); // peerId -> { peerId, name, color, state, pc, presence, host }
  let lamport = 0;
  let seq = 0; // host: the sequence assigned to each relayed batch
  let expectedSeq = 1; // guest: the sequence the host's next batch carries (its first batch is 1)
  const tombstones = new Set(); // element ids deleted locally since joining
  const remoteTombstones = new Set();
  const emit = (type, detail) => { if (onEvent) onEvent({ type, ...detail }); };
  const throttledPresence = createThrottle(10);

  const peersList = () => [...peers.values()].map((p) => ({
    peerId: p.peerId, name: p.name, color: p.color, state: p.state,
    presence: p.presence || null,
  }));
  const emitPeers = () => emit('peers', { peers: peersList(), role });

  // A guest that asked the host for a full state (a sequence gap) and
  // hears nothing back is not going to catch up silently: say so.
  let resyncTimer = null;
  const armResyncTimer = () => {
    if (role !== 'guest') return;
    clearTimeout(resyncTimer);
    resyncTimer = setTimeout(() => {
      resyncTimer = null;
      emit('notice', { text: 'The room connection is too slow to catch up. Your edits are saved on this device.' });
    }, 10000);
  };
  const clearResyncTimer = () => {
    clearTimeout(resyncTimer);
    resyncTimer = null;
  };

  // ── Signaling ──────────────────────────────────────────────────────────
  // `signaling` is { send, close } backed by a WebSocket (node mode) or
  // null (manual mode, where outgoing signals are emitted as 'signal-out'
  // events for the dialog to turn into codes, and incoming ones arrive
  // through signalIn).
  let sig = signaling || null;

  const sendSignal = (msg) => {
    if (sig) sig.send(msg);
    else {
      // Manual mode has no channel once the codes are exchanged, and the
      // offer/answer codes already carry a complete ICE bundle (the offer
      // waits for gathering). A candidate surfacing later cannot be
      // delivered and would only overwrite the code someone is copying.
      if (msg.type === 'candidate') return;
      emit('signal-out', { msg: { ...msg, from: peerId } });
    }
  };

  // Incoming signaling: an offer or answer for one of our peers.
  const signalIn = async (msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'join' && role === 'host') {
      if (peers.size >= MAX_PEERS) return;
      admitPeer(msg.from, displayName(msg));
      sendSignal({ type: 'peers', to: msg.from, ids: [...peers.keys()] });
      return;
    }
    if (msg.type !== 'offer' && msg.type !== 'answer' && msg.type !== 'candidate') return;
    if (msg.to !== peerId) return;
    let p = peers.get(msg.from);
    if (!p && msg.type === 'offer') p = admitPeer(msg.from, 'Peer');
    if (!p) return;
    await p.pc.signal(msg);
  };

  const admitPeer = (id, name0) => {
    if (peers.has(id) || id === peerId) return peers.get(id);
    const pc = createPeer({
      initiator: role === 'host',
      peerId: id,
      iceServers,
      onmessage: (m) => onChannelMessage(id, m),
      onstate: (s) => {
        const p2 = peers.get(id);
        if (!p2) return;
        p2.state = s;
        if (s === 'open') {
          p2.pc.send({ kind: 'hello', name, lamport });
        } else if (s === 'closed') {
          if (role === 'guest' && p2.host) emit('notice', { text: 'The host disconnected. Your work is saved on this device.' });
          peers.delete(id);
        }
        emitPeers();
      },
      onsignal: (m) => sendSignal(m),
    });
    const p = { peerId: id, name: name0, color: colorForPeer(id), state: 'connecting', pc, host: role === 'guest', presence: null };
    peers.set(id, p);
    if (role === 'host') void pc.connect();
    emitPeers();
    return p;
  };

  // Manual mode only: the host opens the one manual peer.
  const admit = (id, name0) => role === 'host' ? admitPeer(id, name0 || 'Guest') : null;

  // ── Channel messages ───────────────────────────────────────────────────
  const onChannelMessage = (from, m) => {
    if (!m || typeof m !== 'object' || typeof m.kind !== 'string') return;
    if (m.kind === 'hello') {
      const hello = validateMessage(m, 'hello');
      if (!hello) return;
      const p = peers.get(from);
      if (!p) return;
      p.name = displayName(hello);
      if (typeof hello.lamport === 'number' && hello.lamport > lamport) lamport = hello.lamport + 1;
      emitPeers();
      return;
    }
    if (m.kind === 'presence') {
      const presence = validateMessage(m, 'presence');
      if (!presence) return;
      const p = peers.get(from);
      if (!p) return;
      p.presence = presence;
      emitPeers();
      return;
    }
    if (m.kind === 'ops') return onOps(from, m);
    if (m.kind === 'needstate' && role === 'host') {
      emit('state-request', { to: from });
      return;
    }
    if (m.kind === 'state') {
      const state = validateMessage(m, 'state');
      if (!state) return;
      const p = peers.get(from);
      if (!p || !p.host) return;
      if (typeof m.seq === 'number' && m.seq >= 0) expectedSeq = m.seq + 1;
      clearResyncTimer();
      emit('state', { pages: state.pages, from, tombstones: state.tombstones });
    }
  };

  // An ops message: a guest's edit for the host to sequence (host side),
  // or the host's relay of some peer's edit (guest side).
  const onOps = (from, m) => {
    const p = peers.get(from);
    if (!p) return;
    if (!Array.isArray(m.ops) || !m.ops.length || m.ops.length > 40) return;
    const ops = m.ops.map((op) => validateMessage({ ...op, pageId: m.pageId }, 'op'));
    if (ops.some((op) => !op)) return; // one bad op spoils the batch: drop it
    const lam = typeof m.lamport === 'number' ? m.lamport : 0;
    if (lam > lamport) lamport = lam + 1;
    if (role === 'host') {
      seq += 1;
      emit('ops', { pageId: m.pageId, ops, from, seq });
      relay(m, from, seq);
      rememberTombstones(remoteTombstones, ops);
      return;
    }
    // Guest side: the host's sequence decides. An echo of this guest's
    // own batch marks its sequence as consumed (the edits were applied
    // here when they were sent). A gap means we missed something while
    // the connection flapped: ask for the full state.
    const s = typeof m.seq === 'number' ? m.seq : null;
    if (s === null) return;
    if (m.fromId === peerId) {
      if (s >= expectedSeq) expectedSeq = s + 1;
      return;
    }
    if (s > expectedSeq) {
      p.pc.send({ kind: 'needstate' });
      armResyncTimer();
      return;
    }
    if (s < expectedSeq) return; // an old relay arriving late
    expectedSeq += 1;
    emit('ops', { pageId: m.pageId, ops, from: m.fromId || from, seq: s });
    rememberTombstones(remoteTombstones, ops);
  };

  const rememberTombstones = (into, ops) => {
    for (const op of ops) if (op && op.t === 'del') for (const id of op.ids) into.add(id);
  };

  const relay = (m, from, assigned) => {
    for (const p of peers.values()) {
      // The sender hears its own echo too: it is how it learns one more
      // sequence number was consumed and stays in step with the room.
      if (p.state !== 'open') continue;
      p.pc.send({ kind: 'ops', pageId: m.pageId, ops: m.ops, lamport: m.lamport, seq: assigned, fromId: from });
    }
  };

  // ── Outgoing ───────────────────────────────────────────────────────────
  const broadcast = (msg) => {
    for (const p of peers.values()) if (p.state === 'open') p.pc.send(msg);
  };

  // The app's edits, as diff ops. A guest sends to the host; the host
  // assigns a sequence and sends to everyone. Every op is checked against
  // what the protocol accepts before it leaves: a change a receiver would
  // drop means divergence (applied here, not in the room), so it never
  // leaves and the person is told. A batch too large for one message is
  // split; a single op too large for one message is skipped for peers
  // (the local edit stays, and everyone is told).
  const sendOps = (pageId, ops) => {
    if (!Array.isArray(ops) || !ops.length) return;
    const sendable = [];
    let refused = 0;
    for (const op of ops) {
      if (validateMessage({ ...op, pageId }, 'op')) sendable.push(op);
      else refused += 1;
    }
    if (refused) {
      emit('notice', { text: refused === 1
        ? 'One change could not be shared with the room and applies only here.'
        : refused + ' changes could not be shared with the room and apply only here.' });
    }
    if (!sendable.length) return;
    lamport += 1;
    const batches = [[]];
    for (const op of sendable) {
      const batch = batches[batches.length - 1];
      const probe = JSON.stringify({ kind: 'ops', pageId, ops: [...batch, op], lamport });
      if (probe.length > CAPS.opBytes) {
        if (batch.length) batches.push([op]);
        else {
          emit('notice', { text: 'One change was too large to send and was skipped for the room.' });
          continue;
        }
        if (JSON.stringify({ kind: 'ops', pageId, ops: batches[batches.length - 1], lamport }).length > CAPS.opBytes) {
          batches.pop();
          emit('notice', { text: 'One change was too large to send and was skipped for the room.' });
          continue;
        }
      } else {
        batch.push(op);
      }
    }
    for (const batch of batches) {
      if (!batch.length) continue;
      rememberTombstones(tombstones, batch);
      if (role === 'guest') {
        const host = [...peers.values()].find((q) => q.host && q.state === 'open');
        if (!host) continue;
        host.pc.send({ kind: 'ops', pageId, ops: batch, lamport });
      } else {
        seq += 1;
        broadcast({ kind: 'ops', pageId, ops: batch, lamport, seq });
      }
    }
  };

  // The app's answer to 'state-request' (a peer resyncing): the current
  // page snapshots, with the sequence to resume from and the element ids
  // this side knows were deleted, so the peer's merge respects them.
  const sendState = (pages, forPeer = null) => {
    const tombs = [...new Set([...tombstones, ...remoteTombstones])];
    // A big design does not fit one frame: the pages go out as several
    // state messages, each held to the same frame cap every message is,
    // and each part merges the same way on arrival.
    const parts = [[]];
    let oversize = false;
    for (const p of pages) {
      const part = parts[parts.length - 1];
      if (JSON.stringify({ kind: 'state', pages: [...part, p], seq, tombstones: tombs }).length > MAX_FRAME && part.length) parts.push([p]);
      else part.push(p);
      if (JSON.stringify({ kind: 'state', pages: [p], seq, tombstones: tombs }).length > MAX_FRAME) oversize = true;
    }
    if (oversize) emit('notice', { text: 'This design is too large to share in full over the room connection.' });
    for (const part of parts) {
      if (!part.length) continue;
      const msg = { kind: 'state', pages: part, seq, tombstones: tombs };
      if (forPeer) {
        const p = peers.get(forPeer);
        if (p) p.pc.send(msg);
      } else broadcast(msg);
    }
  };

  const sendPresence = (presence) => {
    throttledPresence.run(presence, (p) => {
      const msg = validateMessage({ kind: 'presence', ...p }, 'presence');
      if (msg) broadcast({ kind: 'presence', ...msg });
    });
  };

  // ── Lifecycle ──────────────────────────────────────────────────────────
  const leave = () => {
    clearResyncTimer();
    sendSignal({ type: 'bye' });
    for (const p of peers.values()) p.pc.close();
    peers.clear();
    if (sig) { sig.close(); sig = null; }
    throttledPresence.cancel();
    emitPeers();
    emit('closed', {});
  };

  return {
    role,
    get peerId() { return peerId; },
    get lamport() { return lamport; },
    get connected() { return [...peers.values()].some((p) => p.state === 'open'); },
    get myColor() { return colorForPeer(peerId); },
    peers: peersList,
    tombstones,
    remoteTombstones,
    markDeleted: (ids) => { for (const id of ids) tombstones.add(id); },
    admit,
    signalIn,
    sendOps,
    sendState,
    sendPresence,
    leave,
    get seq() { return seq; },
    get expectedSeq() { return expectedSeq; },
  };
}