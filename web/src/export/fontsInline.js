// Collecting the @font-face CSS a design needs, so bundled and imported
// fonts travel inside the SVG file. System fonts are left to the viewer.

import { BUNDLED_FONTS, fontStack, userFontFamily } from '../assets/fonts.js';

const cssFamilyOf = (key) => fontStack(key).split(',')[0].replace(/"/g, '').trim();

// The @font-face block for the font keys `pages` use, as one CSS string.
// Bundled font files are fetched from their stylesheet URLs (the service
// worker cache serves them offline); imported fonts come from their blobs.
export async function fontsInlineCss(pages, getAsset) {
  const keys = new Set();
  const visit = (els) => {
    for (const el of els) {
      if (el.type === 'text' && el.font) keys.add(el.font);
      if (el.children) visit(el.children);
    }
  };
  for (const p of pages) visit(p.elements);

  const rules = [];
  for (const key of keys) {
    if (typeof key !== 'string') continue;
    if (key.startsWith('user:')) {
      const asset = await getAsset(key.slice(5));
      if (!asset || !asset.blob) continue;
      const url = await blobToDataUrl(asset.blob);
      rules.push(`@font-face{font-family:"${userFontFamily(key.slice(5))}";src:url(${url}) format('truetype');}`);
      continue;
    }
    const b = BUNDLED_FONTS[key];
    if (!b) continue; // system font: the viewer supplies it
    const family = cssFamilyOf(key);
    for (const sheet of document.styleSheets) {
      let list;
      try { list = sheet.cssRules; } catch { continue; }
      for (const rule of list) {
        if (rule instanceof CSSFontFaceRule && rule.style.getPropertyValue('font-family').replace(/"/g, '').trim() === family) {
          const src = rule.style.getPropertyValue('src');
          const m = src && src.match(/url\(([^)]+)\)/);
          if (!m) continue;
          let u = m[1].replace(/["']/g, '');
          if (!u.startsWith('data:')) {
            try {
              const res = await fetch(u);
              u = await blobToDataUrl(await res.blob());
            } catch { continue; }
          }
          rules.push(`@font-face{font-family:"${family}";src:url(${u})${rule.style.getPropertyValue('font-weight') ? `;font-weight:${rule.style.getPropertyValue('font-weight')}` : ''}${rule.style.getPropertyValue('font-style') ? `;font-style:${rule.style.getPropertyValue('font-style')}` : ''};}`);
        }
      }
    }
  }
  return rules.join('');
}

async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("A font file couldn't be read."));
    r.readAsDataURL(blob);
  });
}