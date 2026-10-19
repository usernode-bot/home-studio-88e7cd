// WebRTC peers: one RTCPeerConnection per remote peer, with one reliable
// ordered DataChannel for the protocol. The default ICE policy pairs host
// candidates with a public STUN server, so same-network connections work
// with no service at all and cross-network ones work without setup; a
// TURN relay can be added by the person in the collaborate dialog.

import { encodeFrame, parseFrame } from './transport.js';

export const PUBLIC_STUN = 'stun:stun.l.google.com:19302';

const RTC_CONFIG = { iceServers: [{ urls: PUBLIC_STUN }], iceCandidatePoolSize: 0 };

// Wait for ICE gathering to finish (bounded) so a description carries all
// its candidates. Copy-paste signaling has no channel for trickle, so the
// codes must be complete; over node signaling the same wait is harmless.
const waitIce = (pc) => new Promise((resolve) => {
  if (pc.iceGatheringState === 'complete') return resolve();
  const done = () => { cleanup(); resolve(); };
  const timer = setTimeout(done, 1500);
  const cleanup = () => {
    clearTimeout(timer);
    pc.removeEventListener('icegatheringstatechange', onChange);
  };
  const onChange = () => {
    if (pc.iceGatheringState === 'complete') done();
  };
  pc.addEventListener('icegatheringstatechange', onChange);
});

// One peer connection. Events come back through the callbacks:
//   onmessage(obj)  a validated protocol message
//   onstate(state)  'connecting' | 'open' | 'closed'
export function createPeer({ initiator, peerId, iceServers, onmessage, onstate, onsignal }) {
  let pc;
  let dc = null;
  let state = 'connecting';
  const setState = (s) => {
    if (state === s) return;
    state = s;
    if (onstate) onstate(s);
  };

  try {
    pc = new RTCPeerConnection({ ...RTC_CONFIG, ...(iceServers ? { iceServers } : {}) });
  } catch {
    setState('closed');
    return { state: 'closed', send: () => {}, close: () => {}, signal: async () => {} };
  }

  const wire = (channel) => {
    dc = channel;
    channel.onopen = () => setState('open');
    channel.onclose = () => setState('closed');
    channel.onmessage = (e) => {
      const msg = parseFrame(e.data);
      if (msg && onmessage) onmessage(msg);
    };
  };

  if (initiator) wire(pc.createDataChannel('home-studio', { ordered: true }));

  pc.ondatachannel = (e) => wire(e.channel);
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') { /* the channel decides 'open' */ }
    else if (pc.connectionState === 'failed' || pc.connectionState === 'closed' || pc.connectionState === 'disconnected') setState('closed');
  };
  pc.onicecandidate = (e) => {
    // Candidates that surface after the waitIce bundle is already out
    // cannot reach a copy-paste peer (there is no channel to carry them),
    // so the session decides whether they are worth signalling at all.
    if (e.candidate && onsignal) onsignal({ type: 'candidate', to: peerId, candidate: JSON.stringify(e.candidate) });
  };

  const send = (obj) => {
    if (state !== 'open' || !dc || dc.readyState !== 'open') return false;
    try {
      dc.send(encodeFrame(obj));
      return true;
    } catch {
      return false;
    }
  };

  // Apply a signaling message from the remote peer (answer or candidate).
  // The offer itself is made here, when this peer initiates.
  const signal = async (msg) => {
    try {
      if (msg.type === 'offer') {
        await pc.setRemoteDescription(JSON.parse(msg.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await waitIce(pc);
        if (onsignal) onsignal({ type: 'answer', to: peerId, sdp: JSON.stringify(pc.localDescription) });
      } else if (msg.type === 'answer') {
        if (pc.signalingState !== 'stable') await pc.setRemoteDescription(JSON.parse(msg.sdp));
      } else if (msg.type === 'candidate') {
        await pc.addIceCandidate(JSON.parse(msg.candidate));
      }
    } catch { /* a bad candidate or a raced answer: the channel state decides */ }
  };

  const connect = async () => {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitIce(pc);
      if (onsignal) onsignal({ type: 'offer', to: peerId, sdp: JSON.stringify(pc.localDescription) });
    } catch {
      setState('closed');
    }
  };

  return {
    get state() { return state; },
    send,
    signal,
    connect,
    close() {
      try { if (dc) dc.close(); } catch { /* already closed */ }
      try { pc.close(); } catch { /* already closed */ }
      setState('closed');
    },
  };
}