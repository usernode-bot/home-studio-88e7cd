// Remote cursors: where the other people in the room are pointing, drawn
// over the page surface in their own colors, plus a box around what they
// have selected. Position and selection come from presence messages
// (throttled in session.js); the drawing is a portal into the page
// surface, so cursors live in page coordinates and pan and zoom with it.

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export default function RemoteCursors({ session, page, zoom, peers, selection }) {
  const [art, setArt] = useState(null);
  const live = useRef({ session, page, selection });
  live.current = { session, page, selection };

  // The page surface node (it exists while a design is open).
  useEffect(() => {
    const node = document.querySelector('[data-canvas] .art');
    if (node !== art) setArt(node);
  });

  // My pointer: page coordinates from the pointer position, sent as
  // presence (throttled to 10/s in the session).
  useEffect(() => {
    const canvas = document.querySelector('[data-canvas]');
    if (!canvas || !session) return undefined;
    const toPage = (e) => {
      const node = canvas.querySelector('.art');
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return null;
      const x = ((e.clientX - rect.left) / rect.width) * page.width;
      const y = ((e.clientY - rect.top) / rect.height) * page.height;
      if (x < 0 || y < 0 || x > page.width || y > page.height) return null;
      return { x, y };
    };
    const onMove = (e) => {
      const pt = toPage(e);
      if (pt) session.sendPresence({ ...pt, pageId: page.id, selection: live.current.selection });
    };
    const onLeave = () => {
      const node = canvas.querySelector('.art');
      if (!node) return;
      session.sendPresence({ x: -9999, y: -9999, pageId: page.id, selection: [], done: true });
    };
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', onLeave);
    return () => {
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
    };
  }, [session, page]);

  if (!art || !session) return null;
  const shown = peers.filter((p) => p.state === 'open' && p.presence
    && p.presence.pageId === page.id && !p.presence.done);

  return createPortal(
    <>
      {shown.map((p) => {
        const color = `rgb(var(--${p.color}))`;
        return (
          <React.Fragment key={p.peerId}>
            {(p.presence.selection || []).map((id) => {
              const el = page.elements.find((e) => e.id === id);
              if (!el) return null;
              return (
                <div key={id} className="remote-select" style={{
                  left: el.x, top: el.y, width: el.w, height: el.h,
                  borderColor: color,
                }} />
              );
            })}
            <div className="remote-cursor" style={{
              left: p.presence.x, top: p.presence.y,
              transform: `scale(${1 / (zoom || 1)})`,
              color,
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 2l7 17 2.5-6.5L20 10z" fill="currentColor" stroke="rgb(var(--surface))" strokeWidth="1.5" strokeLinejoin="round" />
              </svg>
              <span className="remote-cursor-name" style={{ background: color }}>{p.name}</span>
            </div>
          </React.Fragment>
        );
      })}
    </>,
    art,
  );
}