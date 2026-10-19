// The collaborate dialog: host a room or join one, over copy-paste
// connection codes (works anywhere, two people) or a self-hosted node's
// signaling address (many people, same room key). Once connected the
// dialog shows who is in the room; the editor shows the collaboration
// strip and remote cursors while the dialog is closed.

import React, { useEffect, useRef, useState } from 'react';
import { Scrim } from './dialogs.jsx';
import { icons } from './icons.jsx';
import { codeFrom, objFromCode } from '../net/signaling-manual.js';
import { newRoomKey, looksLikeRoomKey } from '../net/signaling.js';
import { newPeerId } from '../net/protocol.js';
import { openNodeSignaling } from '../net/signaling-node.js';
import { createSession } from '../net/session.js';
import { PUBLIC_STUN } from '../net/webrtc.js';

const MANUAL_PEER_HOST = 'host';
const MANUAL_PEER_GUEST = 'guest';
const TURN_KEY = 'home-studio:turn'; // the person's own relay setting

const readTurn = () => {
  try { return JSON.parse(localStorage.getItem(TURN_KEY) || 'null') || {}; } catch { return {}; }
};

export default function CollaborateDialog({ onClose, onStart, activeSession, onLeave, onAppEvent }) {
  const [screen, setScreen] = useState(activeSession ? 'live' : 'choose');
  const [nodeMode, setNodeMode] = useState(false);
  const [name, setName] = useState('');
  const [nodeUrl, setNodeUrl] = useState('');
  const [roomKey, setRoomKey] = useState('');
  const [myRoomKey, setMyRoomKey] = useState('');
  const [outCode, setOutCode] = useState('');
  const [inCode, setInCode] = useState('');
  const [peers, setPeers] = useState([]);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const [turnUrl, setTurnUrl] = useState(() => (readTurn().url || ''));
  const [turnUser, setTurnUser] = useState(() => (readTurn().username || ''));
  const [turnPass, setTurnPass] = useState(() => (readTurn().credential || ''));
  const sessionRef = useRef(null);
  const activeRef = useRef(activeSession);
  activeRef.current = activeSession;

  // The relay setting is the person's own, kept on this device: host
  // candidates and the public STUN server connect most rooms without it.
  const saveTurn = (url, user, pass) => {
    try {
      if (url.trim()) localStorage.setItem(TURN_KEY, JSON.stringify({ url: url.trim(), username: user.trim(), credential: pass }));
      else localStorage.removeItem(TURN_KEY);
    } catch { /* storage refused: the field still applies to this session */ }
  };
  const iceServers = () => {
    const ice = [{ urls: PUBLIC_STUN }];
    if (turnUrl.trim()) {
      ice.push({
        urls: turnUrl.trim().split(',').map((u) => u.trim()).filter(Boolean),
        username: turnUser.trim() || undefined,
        credential: turnPass || undefined,
      });
    }
    return ice;
  };

  useEffect(() => () => {
    // Unmount only: if the dialog goes away with a session that never
    // connected and the app has not adopted, clean it up. Re-running on
    // every activeSession change would tear down the session the app just
    // adopted (the null → session transition).
    const s = sessionRef.current;
    if (s && !s.connected && !activeRef.current) s.leave();
  }, []);

  const wireSession = (session) => {
    sessionRef.current = session;
    onStart(session);
    return session;
  };

  const onEvent = (e) => {
    if (e.type === 'signal-out') {
      // Only the initial offer/answer bundle becomes a code; a late
      // candidate has no channel to travel over and must not overwrite
      // the code someone is about to copy.
      if (e.msg.type === 'candidate') return;
      setOutCode(codeFrom(e.msg));
      if (sessionRef.current && sessionRef.current.role === 'host') setScreen('host-code');
      else setScreen('join-answer');
    } else if (e.type === 'peers') {
      setPeers(e.peers);
      if (sessionRef.current && sessionRef.current.connected) setScreen('live');
    } else if (e.type === 'notice' && e.text) {
      setError(e.text);
    }
    // Every event also goes to the app, which applies the edits, greets
    // people who join and shows notices once the dialog is closed.
    if (onAppEvent) onAppEvent(e);
  };

  const cleanName = () => name.trim().slice(0, 24);

  // ── Host, manual ───────────────────────────────────────────────────────
  const hostManual = () => {
    setError('');
    const session = wireSession(createSession({
      role: 'host', peerId: MANUAL_PEER_HOST, name: cleanName() || 'Host',
      signaling: null, iceServers: iceServers(), onEvent,
    }));
    session.admit(MANUAL_PEER_GUEST, 'Guest'); // creates the offer code
  };

  // ── Guest, manual ──────────────────────────────────────────────────────
  const joinManual = () => {
    setError('');
    let msg;
    try { msg = objFromCode(inCode); } catch (err) { setError(err.message); return; }
    if (!msg || msg.type !== 'offer') { setError('That code is not a host invitation.'); return; }
    const session = wireSession(createSession({
      role: 'guest', peerId: MANUAL_PEER_GUEST, name: cleanName() || 'Guest',
      signaling: null, iceServers: iceServers(), onEvent,
    }));
    void session.signalIn(msg);
  };

  // ── Node signaling ─────────────────────────────────────────────────────
  const openNode = (role, key) => {
    setError('');
    const url = nodeUrl.trim().replace(/\/+$/, '');
    if (!/^wss?:\/\//.test(url)) { setError('Enter the node signaling address, starting with ws:// or wss://.'); return; }
    if (role === 'guest' && !looksLikeRoomKey(key)) { setError('Enter the room key from the person hosting.'); return; }
    // One identity for the signaling socket and the session: peers are
    // admitted by their signaling id, so the session must answer to it.
    const pid = newPeerId();
    const sig = openNodeSignaling({
      url, roomKey: key, peerId: pid, name: cleanName() || (role === 'host' ? 'Host' : 'Guest'),
      onmessage: (msg) => { void sessionRef.current && sessionRef.current.signalIn(msg); },
      onstatechange: (state, why) => {
        if (state === 'closed' && !sessionRef.current?.connected) {
          setError(why || 'The signaling connection closed. Check the address and try again.');
        }
      },
    });
    wireSession(createSession({ role, peerId: pid, name: cleanName(), signaling: sig, iceServers: iceServers(), onEvent }));
    setScreen(role === 'host' ? 'host-wait' : 'join-wait');
  };

  const copy = (text, tag) => {
    try { void navigator.clipboard.writeText(text); } catch { /* selection copy still works */ }
    setCopied(tag);
    setTimeout(() => setCopied(''), 1500);
  };

  const leave = () => {
    const s = sessionRef.current || activeSession;
    if (s) s.leave();
    sessionRef.current = null;
    onLeave();
    onClose();
  };

  // ── Screens ────────────────────────────────────────────────────────────
  const who = (
    <label className="block" style={{ marginBottom: 8 }}>
      <span className="section-label" style={{ display: 'block' }}>Your name (shown to others)</span>
      <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sam" maxLength={24} />
    </label>
  );

  const modePick = (
    <>
      <label className="block" style={{ marginBottom: 8 }}>
        <span className="section-label" style={{ display: 'block' }}>How to connect</span>
        <select className="field" data-collab-mode value={nodeMode ? 'node' : 'manual'} onChange={(e) => setNodeMode(e.target.value === 'node')}>
          <option value="manual">Copy-paste codes (two people, works anywhere)</option>
          <option value="node">A self-hosted node (several people, one room key)</option>
        </select>
      </label>
      {nodeMode && (
        <label className="block" style={{ marginBottom: 8 }}>
          <span className="section-label" style={{ display: 'block' }}>Node signaling address</span>
          <input className="field" value={nodeUrl} onChange={(e) => setNodeUrl(e.target.value)} placeholder="e.g. wss://studio.example.com/signal" />
        </label>
      )}
      {nodeMode && (
        <label className="block" style={{ marginBottom: 8 }}>
          <span className="section-label" style={{ display: 'block' }}>TURN relay (optional)</span>
          <input className="field" value={turnUrl}
            onChange={(e) => { setTurnUrl(e.target.value); saveTurn(e.target.value, turnUser, turnPass); }}
            placeholder="e.g. turn:relay.example.com:3478" />
          {turnUrl.trim() && (
            <>
              <input className="field" style={{ marginTop: 4 }} value={turnUser}
                onChange={(e) => { setTurnUser(e.target.value); saveTurn(turnUrl, e.target.value, turnPass); }}
                placeholder="TURN username (optional)" />
              <input className="field" style={{ marginTop: 4 }} type="password" value={turnPass}
                onChange={(e) => { setTurnPass(e.target.value); saveTurn(turnUrl, turnUser, e.target.value); }}
                placeholder="TURN password (optional)" />
            </>
          )}
          <span className="sub" style={{ display: 'block', marginTop: 4 }}>Rooms connect without a relay on the same network or through the public STUN server. Add one only if connections keep failing across networks.</span>
        </label>
      )}
    </>
  );

  const codeBox = (tag) => (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span className="section-label" style={{ flex: 1 }}>Connection code</span>
        <button className="btn-secondary" style={{ minHeight: 36 }} onClick={() => copy(outCode, tag)}>
          {copied === tag ? 'Copied' : 'Copy'}
        </button>
      </div>
      <textarea className="field" data-collab-code readOnly value={outCode} rows={5}
        style={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}
        onFocus={(e) => e.target.select()} />
      <p className="sub">Send this code to the other person, and paste the code they send back below.</p>
    </div>
  );

  return (
    <Scrim onClose={onClose} labelledBy="collab-title" escape className="dialog-wide">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        {icons.users({ width: 20, height: 20 })}
        <h2 className="text-heading" id="collab-title" style={{ flex: 1 }}>Collaborate</h2>
        <button className="btn-secondary" onClick={onClose} aria-label="Close">Close</button>
      </div>

      {screen === 'choose' && (
        <div data-collab-choose>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button className="btn-primary" style={{ flex: 1 }} data-collab-host
              onClick={() => { setNodeMode(false); setMyRoomKey(newRoomKey()); setScreen('host-setup'); }}>
              Host a room
            </button>
            <button className="btn-secondary" style={{ flex: 1 }} data-collab-join
              onClick={() => { setNodeMode(false); setScreen('join-setup'); setInCode(''); }}>
              Join a room
            </button>
          </div>
          <p className="sub">Collaboration is optional and off by default. Nothing leaves this device until you host or join a room. Edits from everyone in the room are applied to this design; a copy of the design as it was is kept in version history.</p>
        </div>
      )}

      {screen === 'host-setup' && (
        <div>
          {who}
          {modePick}
          {nodeMode && (
            <div style={{ marginBottom: 8 }}>
              <span className="section-label" style={{ display: 'block' }}>Room key</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="field" value={myRoomKey} readOnly onFocus={(e) => e.target.select()} style={{ fontFamily: 'monospace' }} data-collab-room-key />
                <button className="btn-secondary" style={{ minHeight: 44 }} onClick={() => copy(myRoomKey, 'room')}>{copied === 'room' ? 'Copied' : 'Copy'}</button>
              </div>
              <p className="sub">People joining need this key and the node address.</p>
            </div>
          )}
          {error && <p className="state-error">{error}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-secondary" style={{ flex: 1 }} onClick={() => setScreen('choose')}>Back</button>
            <button className="btn-primary" style={{ flex: 1 }} data-collab-start
              onClick={() => {
                if (nodeMode) {
                  const key = myRoomKey || newRoomKey();
                  setMyRoomKey(key);
                  openNode('host', key);
                } else hostManual();
              }}>
              Start the room
            </button>
          </div>
        </div>
      )}

      {screen === 'join-setup' && (
        <div>
          {who}
          {modePick}
          {!nodeMode && (
            <label className="block" style={{ marginBottom: 8 }}>
              <span className="section-label" style={{ display: 'block' }}>Invitation code</span>
              <textarea className="field" data-collab-code-in value={inCode} rows={5} placeholder="Paste the code the person hosting sent you"
                style={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }} onChange={(e) => setInCode(e.target.value)} />
            </label>
          )}
          {nodeMode && (
            <label className="block" style={{ marginBottom: 8 }}>
              <span className="section-label" style={{ display: 'block' }}>Room key</span>
              <input className="field" value={roomKey} onChange={(e) => setRoomKey(e.target.value.toUpperCase())} placeholder="e.g. ABCDE-FGHIJ-KLMNO-PQRST-UVWXY" style={{ fontFamily: 'monospace' }} />
            </label>
          )}
          {error && <p className="state-error">{error}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-secondary" style={{ flex: 1 }} onClick={() => setScreen('choose')}>Back</button>
            <button className="btn-primary" style={{ flex: 1 }} disabled={!nodeMode && !inCode.trim()} data-collab-connect
              onClick={() => { if (nodeMode) openNode('guest', roomKey.trim()); else joinManual(); }}>
              {nodeMode ? 'Join the room' : 'Continue'}
            </button>
          </div>
        </div>
      )}

      {screen === 'host-code' && (
        <div data-collab-host-code>
          {codeBox('offer')}
          {error && <p className="state-error">{error}</p>}
          <label className="block" style={{ marginBottom: 8 }}>
            <span className="section-label" style={{ display: 'block' }}>Paste the reply code</span>
            <textarea className="field" value={inCode} rows={4} placeholder="Paste the code that comes back"
              style={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }} onChange={(e) => setInCode(e.target.value)} />
          </label>
          <button className="btn-primary" style={{ width: '100%' }} disabled={!inCode.trim()}
            onClick={() => {
              try {
                const msg = objFromCode(inCode);
                if (!msg || msg.type !== 'answer') throw new Error('That code is not the reply to your invitation.');
                void sessionRef.current.signalIn(msg);
                setScreen('host-wait');
              } catch (err) { setError(err.message); }
            }}>
            Connect
          </button>
        </div>
      )}

      {screen === 'join-answer' && (
        <div data-collab-join-answer>
          <p className="sub" style={{ marginBottom: 8 }}>Almost there. Send this reply code back to the person hosting.</p>
          {codeBox('answer')}
        </div>
      )}

      {(screen === 'host-wait' || screen === 'join-wait') && (
        <div>
          <p className="sub" data-collab-wait>Waiting for the other person to connect…</p>
          {error && <p className="state-error">{error}</p>}
          <button className="btn-secondary" style={{ width: '100%' }} onClick={leave}>Cancel</button>
        </div>
      )}

      {screen === 'live' && (
        <div data-collab-live>
          <p className="sub" style={{ marginBottom: 8 }}>In the room. Every person's edits apply to this design, and yours to theirs.</p>
          <ul className="list" style={{ marginBottom: 12 }}>
            <li className="list-row">
              <span className="dot" style={{ background: `rgb(var(--${activeSession ? activeSession.myColor : 'accent'}))` }} />
              <span style={{ flex: 1 }}>You</span>
              <span className="sub">{activeSession ? (activeSession.role === 'host' ? 'hosting' : 'guest') : ''}</span>
            </li>
            {peers.map((p) => (
              <li key={p.peerId} className="list-row">
                <span className="dot" style={{ background: `rgb(var(--${p.color}))` }} />
                <span style={{ flex: 1 }}>{p.name}</span>
                <span className="sub">{p.state === 'open' ? 'connected' : 'connecting'}</span>
              </li>
            ))}
          </ul>
          <button className="btn-secondary" style={{ width: '100%' }} data-collab-leave onClick={leave}>Leave the room</button>
        </div>
      )}
    </Scrim>
  );
}