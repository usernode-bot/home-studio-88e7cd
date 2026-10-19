// A small, non-interactive picture of a page, for the library's template
// cards and the designs list. It draws nothing until it scrolls into view,
// then loads the fonts its text uses, so a long list stays quick to open.

import React, { useEffect, useRef, useState } from 'react';
import ElementView from './ElementView.jsx';
import { pageBackgroundStyle } from '../doc/style.js';
import { ensureFont, fontsUsed } from '../assets/fonts.js';

export default function PagePreview({ page, width = 160, images }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  const scale = width / page.width;
  const height = Math.round(page.height * scale);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return undefined; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setVisible(true); io.disconnect(); }
    }, { rootMargin: '200px' });
    io.observe(node);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (visible) fontsUsed([page]).forEach(ensureFont);
  }, [visible, page]);

  return (
    <div ref={ref} className="preview" aria-hidden="true" style={{ width, height }}>
      {visible ? (
        <div style={{ position: 'absolute', left: 0, top: 0, width: page.width, height: page.height, overflow: 'hidden',
          transform: `scale(${scale})`, transformOrigin: '0 0', pointerEvents: 'none', ...pageBackgroundStyle(page) }}>
          {page.elements.map((el) => <ElementView key={el.id} el={el} images={images} />)}
        </div>
      ) : (
        <div className="skeleton" style={{ width: '100%', height: '100%', borderRadius: 0 }} />
      )}
    </div>
  );
}
