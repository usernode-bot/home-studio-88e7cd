// Collaboration: the diff -> validate -> apply roundtrip, the messages a
// peer must never get away with, and two sessions wired over a loopback
// RTCPeerConnection pair — host sequencing, sequence handling, presence,
// tombstones, the state resync, and the rejoin merge.

import { describe, it, expect } from 'vitest';
import {
  validateMessage, diffElements, applyOpsToElements, elementsChanged,
  CAPS, clockAfter, newPeerId,
} from '../web/src/net/protocol.js';
import { createSession } from '../web/src/net/session.js';
import { mergeDocs } from '../web/src/net/merge.js';
import { codeFrom, objFromCode } from '../web/src/net/signaling-manual.js';
import { openNodeSignaling } from '../web/src/net/signaling-node.js';
import { newElement, PAGE_MIN, PAGE_MAX } from '../web/src/doc/model.js';

// ── A loopback RTCPeerConnection ─────────────────────────────────────────
// Two of these in one process form a pair: whatever one channel sends, the
// other receives. Signaling (offer/answer) still travels through the
// session's own signal-out events, so the handshake is the real one.

const WIRE = [];

class FakeChannel {
  constructor(pc) {
    this.pc = pc;
    this.readyState = 'open';
    this._opened = false;
    this._closed = false;
    this._onmessage = null;
    this._inbox = []; // arrives before the session wired its handlers
    this.onopen = null;
    this.onclose = null;
    this.filter = null; // a test hook: return false to drop one message
  }
  set onmessage(fn) { this._onmessage = fn; if (fn) for (const e of this._inbox.splice(0)) fn(e); }
  get onmessage() { return this._onmessage; }
  send(data) {
    for (const pc of WIRE) {
      if (pc === this.pc) continue;
      if (pc.channel) pc.channel.receive(data);
      else pc.pending.push(data); // sent before the other side's channel existed
    }
  }
  receive(data) {
    const e = { data };
    if (this.filter && !this.filter(data)) return;
    if (this._onmessage) this._onmessage(e);
    else this._inbox.push(e);
  }
  close() {
    if (this._closed) return;
    this._closed = true;
    if (this.onclose) this.onclose();
    for (const pc of WIRE) {
      if (pc === this.pc || !pc.channel) continue;
      pc.channel._remoteClose();
    }
  }
  _remoteClose() {
    if (this._closed) return;
    this._closed = true;
    if (this.onclose) this.onclose();
  }
}

// The channels of one connection open together, the way a real
// RTCPeerConnection's data channel does on both ends at once.
function tryOpenAll() {
  // Neither end opens until the pair is complete: the answering side's
  // channel only comes to exist when it applies the offer.
  if (WIRE.length < 2 || WIRE.some((pc) => !pc.channel)) return;
  for (const pc of WIRE) {
    if (pc.channel._opened) continue;
    pc.channel._opened = true;
    queueMicrotask(() => {
      if (pc.ondatachannel) pc.ondatachannel({ channel: pc.channel });
      if (pc.channel.onopen) pc.channel.onopen();
      for (const d of pc.pending.splice(0)) pc.channel.receive(d);
    });
  }
}

class FakePC {
  constructor() {
    this.iceGatheringState = 'complete';
    this.connectionState = 'connected';
    this.signalingState = 'stable';
    this.ondatachannel = null;
    this.onicecandidate = null;
    this.onconnectionstatechange = null;
    this.channel = null;
    this.pending = [];
    WIRE.push(this);
  }
  createDataChannel() {
    const ch = new FakeChannel(this);
    this.channel = ch;
    tryOpenAll();
    return ch;
  }
  async createOffer() { return { type: 'offer', sdp: '{}' }; }
  async createAnswer() { return { type: 'answer', sdp: '{}' }; }
  async setLocalDescription(d) { this.localDescription = d; }
  async setRemoteDescription(d) {
    this.remoteDescription = d;
    if (d.type === 'offer' && !this.channel) {
      const ch = new FakeChannel(this);
      this.channel = ch;
      tryOpenAll();
    }
  }
  async addIceCandidate() {}
  close() { if (this.channel) this.channel.close(); }
}

globalThis.RTCPeerConnection = FakePC;

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

function makePair() {
  WIRE.length = 0;
  const hostEvents = [];
  const guestEvents = [];
  const host = createSession({ role: 'host', peerId: 'host', name: 'Host', signaling: null, onEvent: (e) => hostEvents.push(e) });
  const guest = createSession({ role: 'guest', peerId: 'guest', name: 'Guest', signaling: null, onEvent: (e) => guestEvents.push(e) });
  return { host, guest, hostEvents, guestEvents };
}

// The real handshake, codes and all: the host admits the guest, the offer
// travels as a copy-paste code, the answer comes back the same way.
async function connectPair({ host, guest, hostEvents, guestEvents }) {
  host.admit('guest', 'Guest');
  await tick();
  const offerEvent = hostEvents.filter((e) => e.type === 'signal-out').at(-1);
  expect(objFromCode(codeFrom(offerEvent.msg)).type).toBe('offer');
  await guest.signalIn(objFromCode(codeFrom(offerEvent.msg)));
  await tick();
  const answerEvent = guestEvents.filter((e) => e.type === 'signal-out').at(-1);
  await host.signalIn(objFromCode(codeFrom(answerEvent.msg)));
  await tick();
}

const rect = (id, x, y) => ({ id, type: 'rect', name: 'Rectangle', x, y, w: 100, h: 50, rotation: 0, opacity: 1, fill: '#6b7280' });

describe('diff, validate, apply roundtrip', () => {
  it('carries a move, an edit, an add and a delete to the same result', () => {
    const before = [rect('e1', 0, 0), rect('e2', 120, 10), rect('e3', 0, 200)];
    const after = structuredClone(before);
    after[0].x += 30; after[0].y += 12; // moved
    after[1].fill = '#ff0066'; // edited
    after[1].shadow = { x: 4, y: 4, blur: 8, color: '#000000' }; // edited, nested object
    after.splice(2, 0, rect('e4', 300, 0)); // added before the last
    after.pop(); // deleted (the last element)

    const ops = diffElements(before, after);
    const validated = ops.map((op) => validateMessage({ ...op, pageId: 'p' }, 'op'));
    expect(validated.every(Boolean)).toBe(true);
    expect(applyOpsToElements(before, validated)).toEqual(after);
  });

  it('maps a pure move to move and an edit to set', () => {
    const before = [rect('e1', 0, 0), rect('e2', 10, 10)];
    const moved = structuredClone(before);
    moved[0].x = 40; moved[0].y = 60;
    const edited = structuredClone(before);
    edited[1].fill = '#123456';
    expect(diffElements(before, moved).map((o) => o.t)).toEqual(['move']);
    const setOps = diffElements(before, edited);
    expect(setOps).toHaveLength(1);
    expect(setOps[0].t).toBe('set');
    expect(setOps[0].patch.fill).toBe('#123456');
    expect(setOps[0].patch.id).toBeUndefined();
  });

  it('replays a pure reorder as an ord op', () => {
    const before = [rect('e1', 0, 0), rect('e2', 10, 10), rect('e3', 20, 20)];
    const after = [before[2], before[0], before[1]];
    const ops = diffElements(before, after);
    expect(ops.map((o) => o.t)).toEqual(['ord']);
    expect(applyOpsToElements(before, ops.map((op) => validateMessage({ ...op, pageId: 'p' }, 'op')))).toEqual(after);
  });

  it('sees no difference when nothing changed', () => {
    const els = [rect('e1', 0, 0)];
    expect(elementsChanged(els, structuredClone(els))).toBe(false);
    expect(diffElements(els, structuredClone(els))).toEqual([]);
  });
});

describe('validateMessage', () => {
  const op = (m) => validateMessage(m, 'op');

  it('accepts a well-formed add', () => {
    const good = op({ t: 'add', pageId: 'pg', els: [rect('e1', 0, 0)] });
    expect(good.t).toBe('add');
    expect(good.els[0].id).toBe('e1');
  });

  it('rejects the malformed and the oversized', () => {
    expect(validateMessage(null, 'op')).toBe(null);
    expect(op({ t: 'nope' })).toBe(null);
    expect(op({ t: 'add', els: [] })).toBe(null);
    expect(op({ t: 'add', els: Array.from({ length: CAPS.elementsPerOp + 1 }, (_, i) => rect('e' + i, 0, 0)) })).toBe(null);
    expect(op({ t: 'add', els: [{ id: 'e1' }] })).toBe(null); // no type
    expect(op({ t: 'del', ids: 'e1' })).toBe(null);
    expect(op({ t: 'del', ids: [123] })).toBe(null);
    expect(op({ t: 'del', ids: [] })).toBe(null);
    expect(op({ t: 'set', ids: ['e1'], patch: {} })).toBe(null);
    expect(op({ t: 'set', ids: ['e1'], patch: { fill: 1 / 0 } })).toBe(null);
    expect(op({ t: 'move', ids: ['e1'], dx: 1, dy: Infinity })).toBe(null);
    expect(op({ t: 'ord', ids: ['e1', 42] })).toBe(null);
    expect(op({ t: 'pageDel' })).toBe(null);
  });

  it('rejects bad presence, hello and state messages', () => {
    expect(validateMessage({ x: 'a', y: 2 }, 'presence')).toBe(null);
    expect(validateMessage({ x: 1 }, 'presence')).toBe(null);
    expect(validateMessage({ name: '   ' }, 'hello')).toBe(null);
    expect(validateMessage({ pages: 'x' }, 'state')).toBe(null);
    expect(validateMessage({ pages: [{ id: 'pg', elements: [rect('e1', 0, 0)] }] }, 'state')).not.toBe(null);
    const bad = rect('e1', 0, 0); bad.w = NaN;
    expect(validateMessage({ pages: [{ id: 'pg', elements: [bad] }] }, 'state')).toBe(null);
  });

  it('cleans a presence message: rounded position, capped selection', () => {
    const p = validateMessage({ x: 5.6, y: 7.2, pageId: 'pg', selection: ['e1', 42, 'e2'], done: true }, 'presence');
    expect(p).toEqual({ x: 6, y: 7, pageId: 'pg', selection: ['e1', 'e2'], done: true });
  });

  it('trims a hello name and keeps a lamport', () => {
    expect(validateMessage({ name: '  Sam  ', lamport: 7 }, 'hello')).toEqual({ name: 'Sam', lamport: 7 });
  });
});

describe('the lamport clock', () => {
  it('orders by count, then breaks ties by peer id', () => {
    expect(clockAfter(5, 4, 'a', 'b')).toBe(true);
    expect(clockAfter(4, 5, 'a', 'b')).toBe(false);
    expect(clockAfter(5, 5, 'b', 'a')).toBe(true);
    expect(clockAfter(5, 5, 'a', 'b')).toBe(false);
    expect(newPeerId()).not.toBe(newPeerId());
  });
});

describe('two sessions in a room', () => {
  it('connects over copy-paste codes and greets each other', async () => {
    const pair = makePair();
    await connectPair(pair);
    expect(pair.host.connected).toBe(true);
    expect(pair.guest.connected).toBe(true);
    const guests = pair.host.peers();
    expect(guests).toHaveLength(1);
    expect(guests[0].state).toBe('open');
    expect(guests[0].name).toBe('Guest');
    expect(pair.guest.peers()[0].name).toBe('Host');
  });

  it('relays edits in sequence, both directions, with no echo applied twice', async () => {
    const pair = makePair();
    await connectPair(pair);
    const el = rect('e1', 0, 0);

    pair.host.sendOps('pg1', [{ t: 'add', els: [el] }]);
    await tick();
    const atGuest = pair.guestEvents.filter((e) => e.type === 'ops');
    expect(atGuest).toHaveLength(1);
    expect(atGuest[0].seq).toBe(1);
    expect(atGuest[0].ops[0].t).toBe('add');
    expect(atGuest[0].ops[0].els[0].type).toBe('rect');

    // The guest's edit gets the next sequence; the guest does not apply
    // its own echo a second time.
    pair.guest.sendOps('pg1', [{ t: 'set', ids: ['e1'], patch: { x: 5 } }]);
    await tick();
    expect(pair.hostEvents.filter((e) => e.type === 'ops')).toHaveLength(1);
    expect(pair.guestEvents.filter((e) => e.type === 'ops')).toHaveLength(1);

    // And the room stays in step: the host's next edit lands as the very
    // next sequence, with no resync asked for.
    pair.host.sendOps('pg1', [{ t: 'move', ids: ['e1'], dx: 3, dy: 0 }]);
    await tick();
    const opsAtGuest = pair.guestEvents.filter((e) => e.type === 'ops');
    expect(opsAtGuest).toHaveLength(2);
    expect(opsAtGuest[1].seq).toBe(3);
    expect(pair.guestEvents.filter((e) => e.type === 'state')).toHaveLength(0);
  });

  it('carries presence both ways', async () => {
    const pair = makePair();
    await connectPair(pair);
    pair.host.sendPresence({ x: 5.6, y: 7.2, pageId: 'pg1', selection: ['e1'] });
    await tick();
    const p = pair.guest.peers()[0].presence;
    expect(p.x).toBe(6);
    expect(p.y).toBe(7);
    expect(p.pageId).toBe('pg1');
    expect(p.selection).toEqual(['e1']);
  });

  it('asks for the full state when a batch was missed, and resumes in step', async () => {
    const pair = makePair();
    await connectPair(pair);
    const el = rect('e1', 0, 0);
    const guestPc = WIRE[1]; // the guest's connection to the host

    // The connection "drops" one batch: the guest sees a sequence gap.
    guestPc.channel.filter = () => { guestPc.channel.filter = null; return false; };
    pair.host.sendOps('pg1', [{ t: 'add', els: [el] }]);
    await tick();
    expect(pair.guestEvents.filter((e) => e.type === 'ops')).toHaveLength(0);
    pair.host.sendOps('pg1', [{ t: 'move', ids: ['e1'], dx: 1, dy: 0 }]);
    await tick();
    expect(pair.hostEvents.some((e) => e.type === 'state-request' && e.to === 'guest')).toBe(true);
    expect(pair.guestEvents.filter((e) => e.type === 'ops')).toHaveLength(0);

    // The host answers with the snapshot; from there the room is in step.
    pair.host.sendState([{ id: 'pg1', elements: [el] }], 'guest');
    await tick();
    const st = pair.guestEvents.filter((e) => e.type === 'state').at(-1);
    expect(st.pages[0].id).toBe('pg1');
    expect(st.pages[0].elements).toHaveLength(1);
    pair.host.sendOps('pg1', [{ t: 'set', ids: ['e1'], patch: { x: 9 } }]);
    await tick();
    const late = pair.guestEvents.filter((e) => e.type === 'ops').at(-1);
    expect(late.seq).toBe(3);
    expect(pair.guestEvents.filter((e) => e.type === 'state')).toHaveLength(1);
  });

  it('remembers tombstones on both sides of a delete', async () => {
    const pair = makePair();
    await connectPair(pair);
    pair.host.sendOps('pg1', [{ t: 'del', ids: ['e1', 'e2'] }]);
    await tick();
    expect([...pair.host.tombstones].sort()).toEqual(['e1', 'e2']);
    expect([...pair.guest.remoteTombstones].sort()).toEqual(['e1', 'e2']);
    pair.guest.markDeleted(['e3']);
    expect([...pair.guest.tombstones]).toEqual(['e3']);
  });

  it('leaves cleanly: the guest is told the host went away', async () => {
    const pair = makePair();
    await connectPair(pair);
    pair.host.leave();
    await tick();
    expect(pair.hostEvents.some((e) => e.type === 'closed')).toBe(true);
    expect(pair.host.peers()).toHaveLength(0);
    expect(pair.guestEvents.some((e) => e.type === 'notice' && /host disconnected/i.test(e.text))).toBe(true);
  });

  it('connects a host and a guest through a node\'s signaling', async () => {
    // A tiny relay with the same rules as selfhost/signal.js: a join goes
    // to everyone else in the room, everything else goes to the person it
    // names, and the sender is who the socket says it is.
    const sockets = new Set();
    const byPeer = new Map();
    class FakeNodeWS {
      constructor() {
        this.readyState = 1;
        this.peerId = null;
        this._handlers = {};
        sockets.add(this);
        queueMicrotask(() => this._fire('open', {}));
      }
      addEventListener(type, fn) { this._handlers[type] = fn; }
      _fire(type, ev) { const fn = this._handlers[type]; if (fn) fn(ev); }
      send(data) {
        const m = JSON.parse(data);
        if (m.type === 'join') {
          this.peerId = m.from;
          byPeer.set(m.from, this);
          for (const s of sockets) {
            if (s === this || !s.peerId) continue;
            s._fire('message', { data: JSON.stringify({ type: 'join', from: m.from, name: m.name || '' }) });
          }
          return;
        }
        const target = byPeer.get(m.to);
        if (target) target._fire('message', { data: JSON.stringify({ ...m, from: this.peerId }) });
      }
      close() {
        sockets.delete(this);
        if (this.peerId) byPeer.delete(this.peerId);
        this._fire('close', {});
      }
    }
    const realWebSocket = globalThis.WebSocket;
    globalThis.WebSocket = FakeNodeWS;
    WIRE.length = 0; // earlier tests left their closed connections behind
    try {
      // One identity is shared by the signaling socket and the session —
      // peers are admitted by their signaling id, so the session must
      // answer to it.
      const hostPid = newPeerId();
      const guestPid = newPeerId();
      const hostEvents = [];
      const guestEvents = [];
      const roomKey = 'ABCDE-FGHIJ-KLMNO-PQRST-UVWXY';
      const hostSig = openNodeSignaling({
        url: 'ws://node.example/signal', roomKey, peerId: hostPid, name: 'Host',
        onmessage: (m) => { void host.signalIn(m); },
      });
      const host = createSession({ role: 'host', peerId: hostPid, name: 'Host', signaling: hostSig, onEvent: (e) => hostEvents.push(e) });
      await tick();
      const guestSig = openNodeSignaling({
        url: 'ws://node.example/signal', roomKey, peerId: guestPid, name: 'Guest',
        onmessage: (m) => { void guest.signalIn(m); },
      });
      const guest = createSession({ role: 'guest', peerId: guestPid, name: 'Guest', signaling: guestSig, onEvent: (e) => guestEvents.push(e) });
      await tick(20);
      expect(host.connected).toBe(true);
      expect(guest.connected).toBe(true);
      expect(host.peers()[0].name).toBe('Guest');
      expect(guest.peers()[0].name).toBe('Host');

      // The room runs like any other: the host sequences, the guest applies.
      host.sendOps('pg1', [{ t: 'add', els: [rect('e1', 0, 0)] }]);
      await tick();
      const ops = guestEvents.filter((e) => e.type === 'ops');
      expect(ops).toHaveLength(1);
      expect(ops[0].seq).toBe(1);
      guest.sendOps('pg1', [{ t: 'set', ids: ['e1'], patch: { x: 7 } }]);
      await tick();
      expect(guestEvents.filter((e) => e.type === 'ops')).toHaveLength(1); // own echo not re-applied
      host.leave();
      guest.leave();
      await tick();
    } finally {
      globalThis.WebSocket = realWebSocket;
    }
  });
});

describe('the rejoin merge', () => {
  it('lets a deletion beat an edit', () => {
    const mineDoc = { id: 'd', updatedAt: 100, pages: [{ id: 'p1', elements: [rect('e1', 0, 0), rect('e2', 10, 10)] }] };
    const mine = { doc: mineDoc, tombstones: [] };
    mine.doc.pages[0].elements[1].x = 99; // e2 edited here while away
    const theirs = {
      doc: { id: 'd', updatedAt: 90, pages: [{ id: 'p1', elements: [rect('e1', 0, 0)] }] },
      tombstones: ['e2'], // e2 deleted there
    };
    const { doc } = mergeDocs(mine, theirs);
    expect(doc.pages[0].elements.map((e) => e.id)).toEqual(['e1']);
  });

  it('unions what each side has and adopts their new page', () => {
    const docOf = (updatedAt) => ({ id: 'd', updatedAt, pages: [{ id: 'p1', elements: [rect('e1', 0, 0)] }] });
    const mine = { doc: docOf(100), tombstones: [] };
    const theirsDoc = docOf(90);
    theirsDoc.pages[0].elements.push(rect('e3', 30, 30));
    theirsDoc.pages.push({ id: 'p2', elements: [rect('e4', 40, 40)] });
    const theirs = { doc: theirsDoc, tombstones: [] };
    const { doc, changed } = mergeDocs(mine, theirs);
    expect(doc.pages.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(doc.pages[0].elements.map((e) => e.id)).toEqual(['e1', 'e3']);
    expect(changed.some((c) => c.id === 'e3' && c.from === 'theirs')).toBe(true);
    expect(changed.some((c) => c.id === 'p2' && c.page)).toBe(true);
  });

  it('picks the newer copy when both sides edited the same element', () => {
    const docOf = (updatedAt, x) => ({ id: 'd', updatedAt, pages: [{ id: 'p1', elements: [rect('e1', x, 0)] }] });
    const mine = { doc: docOf(100, 11), tombstones: [] };
    const theirs = { doc: docOf(200, 22), tombstones: [] };
    const { doc, changed } = mergeDocs(mine, theirs);
    expect(doc.pages[0].elements[0].x).toBe(22);
    expect(changed).toEqual([{ id: 'e1', from: 'theirs' }]);
    // And the other way round: this side's newer edit wins, and is said so.
    const again = mergeDocs({ doc: docOf(300, 33), tombstones: [] }, { doc: docOf(200, 22), tombstones: [] });
    expect(again.doc.pages[0].elements[0].x).toBe(33);
    expect(again.changed).toEqual([{ id: 'e1', from: 'mine' }]);
  });
});
describe('pages and scoped patches from a peer', () => {
  const page = (over = {}) => ({
    id: 'p2', name: 'Two', width: 800, height: 600, background: '#00ffff',
    elements: [newElement('rect', { x: 0, y: 0, w: 10, h: 10 })],
    ...over,
  });

  it('accepts a real page on pageAdd: elements cleaned, sizes clamped, pattern dropped', () => {
    const op = validateMessage({ t: 'pageAdd', page: page({ pattern: { x: 1 } }) }, 'op');
    expect(op).toBeTruthy();
    expect(op.t).toBe('pageAdd');
    expect(op.page.id).toBe('p2');
    expect(op.page.name).toBe('Two');
    expect(op.page.width).toBe(800);
    expect(op.page.height).toBe(600);
    expect(op.page.background).toBe('#00ffff');
    expect(op.page.elements).toHaveLength(1);
    expect(op.page.elements[0].type).toBe('rect');
    expect(op.page.pattern).toBeUndefined();
  });

  it('clamps an out-of-range page size and drops a bad element, keeping the page', () => {
    const op = validateMessage({
      t: 'pageAdd',
      page: page({ width: 1e9, height: 1, elements: [newElement('rect', {}), { nonsense: true }] }),
    }, 'op');
    expect(op).toBeTruthy();
    expect(op.page.width).toBe(PAGE_MAX);
    expect(op.page.height).toBe(PAGE_MIN);
    expect(op.page.elements).toHaveLength(1);
  });

  it('refuses a page with no usable identity', () => {
    expect(validateMessage({ t: 'pageAdd', page: { name: 'X', elements: [] } }, 'op')).toBe(null);
    expect(validateMessage({ t: 'pageAdd', page: page({ name: 'x'.repeat(121) }) }, 'op')).toBe(null);
  });

  it('docSet keeps only the name', () => {
    const op = validateMessage({ t: 'docSet', patch: { name: 'Renamed', createdAt: 5, updatedAt: 6 } }, 'op');
    expect(op).toBeTruthy();
    expect(op.patch).toEqual({ name: 'Renamed' });
  });

  it('pageSet keeps only the page fields a peer may change', () => {
    const gradient = { kind: 'linear', to: '#ffffff', angle: 45 };
    const op = validateMessage({
      t: 'pageSet', pageId: 'p1',
      patch: { name: 'N', background: '#eeeeee', width: 500, height: 400, gradient, pattern: null, id: 'p1', createdAt: 1 },
    }, 'op');
    expect(op).toBeTruthy();
    expect(op.patch).toEqual({ name: 'N', background: '#eeeeee', width: 500, height: 400, gradient, pattern: null });
  });

  it('pageSet clamps the size, takes a pattern only when it is removed, and refuses a patch with nothing allowed', () => {
    const big = validateMessage({ t: 'pageSet', pageId: 'p1', patch: { width: 1e9 } }, 'op');
    expect(big).toBeTruthy();
    expect(big.patch.width).toBe(PAGE_MAX);
    expect(validateMessage({ t: 'pageSet', pageId: 'p1', patch: { pattern: { x: 1 } } }, 'op')).toBe(null);
    expect(validateMessage({ t: 'pageSet', pageId: 'p1', patch: { elements: [] } }, 'op')).toBe(null);
    expect(validateMessage({ t: 'pageSet', pageId: 'p1', patch: { createdAt: 1 } }, 'op')).toBe(null);
    expect(validateMessage({ t: 'docSet', patch: { createdAt: 1 } }, 'op')).toBe(null);
  });
});
