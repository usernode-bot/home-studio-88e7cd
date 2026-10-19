// Signaling: how two peers find each other before they can talk. Two
// ways, both key-addressed with the same room key:
//   manual  — the offer and answer travel as codes a person copies and
//             pastes (works with zero infrastructure, one guest at a time)
//   node    — a WebSocket on the self-hosted Home Studio node relays
//             messages for the whole room (host plus guests)
// The room key never travels through the signaling channel: it addresses
// it. Whoever has the key can join the room — that is the whole design,
// so the key is long and shown as groups.

import { bytesToBase32Shorts, randomKeyBytes, base32ShortsToBytes } from './key.js';

export function newRoomKey() {
  // 128 bits drawn, 25 base32 chars used (125 bits), shown as 5-char
  // groups: long enough to be the room's address, still typeable.
  const bytes = randomKeyBytes(16);
  const chars = bytesToBase32Shorts(bytes).slice(0, 25);
  return (chars.match(/.{1,5}/g) || []).join('-').toUpperCase();
}

export function roomKeyBytes(key) {
  const chars = String(key || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  if (chars.length < 25) throw new Error('That room key is too short.');
  return base32ShortsToBytes(chars.slice(0, 25));
}

// Whether a typed key could be a room key (does not check existence).
export function looksLikeRoomKey(key) {
  return /^[A-Z2-7](?:[-]?[A-Z2-7]){19,}$/.test(String(key || '').toUpperCase().replace(/\s+/g, ''));
}

// Signaling messages: { type: 'join'|'peers'|'offer'|'answer'|'candidate'|'bye', from, to?, ... }.
export function cleanSignal(m) {
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