// Styling: fills, gradients, borders, shadows, text effects and presets,
// image crop, masks and adjustments, and the page background.

import { describe, it, expect } from 'vitest';
import {
  fillCss, gradientCss, borderCss, dashArray, shadowCss, hexToRgba, adjustFilter, FILTER_PRESETS, ADJUST_DEFAULTS,
  normalizeCrop, cropLayout, croppedHeight, MASKS, SHAPES, textStyles, TEXT_EFFECTS, textEffectOf, TEXT_PRESETS,
  pageBackgroundStyle,
} from '../web/src/doc/style.js';
import { newElement } from '../web/src/doc/model.js';
import { fontStack } from '../web/src/assets/fonts.js';
import { docReducer, initialDocState, updateElements } from '../web/src/doc/store.js';
import { newDesign } from '../web/src/doc/model.js';

describe('fills, borders and shadows', () => {
  it('draws a solid fill or a gradient', () => {
    expect(fillCss({ fill: '#ff0000' })).toBe('#ff0000');
    expect(fillCss({ fill: '#ff0000', gradient: { kind: 'linear', angle: 45, to: '#0000ff' } })).toBe('linear-gradient(45deg, #ff0000, #0000ff)');
    expect(gradientCss('#fff', { kind: 'radial', to: '#000' })).toBe('radial-gradient(circle at center, #fff, #000)');
  });

  it('draws borders in three styles, and none at zero width', () => {
    expect(borderCss({ stroke: '#000000', strokeWidth: 4, strokeStyle: 'dashed' })).toBe('4px dashed #000000');
    expect(borderCss({ stroke: '#000000', strokeWidth: 2 })).toBe('2px solid #000000');
    expect(borderCss({ stroke: '#000000', strokeWidth: 0 })).toBeUndefined();
    expect(dashArray('dashed', 2)).toBe('6 4');
    expect(dashArray('dotted', 3)).toBe('0 6');
    expect(dashArray('solid', 3)).toBeUndefined();
  });

  it('turns a shadow into CSS with its strength as alpha', () => {
    expect(hexToRgba('#102030', 0.5)).toBe('rgba(16,32,48,0.5)');
    expect(shadowCss({ x: 2, y: 4, blur: 6, color: '#000000', alpha: 0.3 })).toBe('2px 4px 6px rgba(0,0,0,0.3)');
    expect(shadowCss(null)).toBe('');
  });

  it('every shape has a path', () => {
    for (const s of Object.values(SHAPES)) expect(s.d).toMatch(/^M[\d .LCQZ]+$/);
  });
});

describe('text', () => {
  const t = () => newElement('text', { x: 0, y: 0, w: 300, h: 40 }, { color: '#112233' });

  it('maps typography fields to CSS', () => {
    const el = { ...t(), font: 'playfair', italic: true, underline: true, strike: true, letterSpacing: 2, lineHeight: 1.5, textCase: 'upper', align: 'justify' };
    const { box } = textStyles(el, fontStack(el.font));
    expect(box).toMatchObject({
      fontFamily: '"Playfair Display", serif', fontStyle: 'italic', textDecoration: 'underline line-through',
      letterSpacing: '2px', lineHeight: 1.5, textTransform: 'uppercase', textAlign: 'justify',
    });
  });

  it('applies each effect and switching clears the previous one', () => {
    let el = t();
    for (const [key, fx] of Object.entries(TEXT_EFFECTS)) {
      el = { ...el, ...fx.patch(el) };
      expect(textEffectOf(el), key).toBe(key);
    }
    el = { ...el, ...TEXT_EFFECTS.outline.patch(el) };
    expect(textStyles(el, 'x').span.WebkitTextStroke).toBe('3px #1c1917');
    expect(el.highlight).toBe('');
    el = { ...el, ...TEXT_EFFECTS.hollow.patch(el) };
    expect(textStyles(el, 'x').span.color).toBe('transparent');
    expect(textStyles(el, 'x').span.WebkitTextStroke).toMatch(/#112233$/);
    el = { ...el, ...TEXT_EFFECTS.highlight.patch(el) };
    expect(textStyles(el, 'x').span.backgroundColor).toBe('#fde047');
    el = { ...el, ...TEXT_EFFECTS.neon.patch(el) };
    expect(textStyles(el, 'x').span.textShadow).toContain('rgba(17,34,51,0.9)');
  });

  it('gradient text clips the gradient to the letters', () => {
    const { span } = textStyles({ ...t(), gradient: { kind: 'linear', angle: 90, to: '#ffffff' } }, 'x');
    expect(span).toMatchObject({ backgroundImage: 'linear-gradient(90deg, #112233, #ffffff)', backgroundClip: 'text', color: 'transparent' });
  });

  it('presets set size and weight together', () => {
    expect(TEXT_PRESETS.heading.patch).toMatchObject({ size: 96, weight: 700 });
    expect(TEXT_PRESETS.label.patch.textCase).toBe('upper');
  });
});

describe('images', () => {
  it('builds a filter string from adjustments, omitting defaults', () => {
    expect(adjustFilter(ADJUST_DEFAULTS)).toBe('');
    expect(adjustFilter({ brightness: 120, blur: 2, hue: -30 })).toBe('brightness(120%) hue-rotate(-30deg) blur(2px)');
    expect(adjustFilter(FILTER_PRESETS.mono.adjust)).toBe('contrast(110%) grayscale(100%)');
  });

  it('keeps crops in range and at least a tenth visible', () => {
    expect(normalizeCrop({ l: -1, t: 0.2, r: 0.95, b: 'x' })).toEqual({ l: 0, t: 0.2, r: 0.9, b: 0 });
    expect(normalizeCrop({ l: 0.6, r: 0.6 })).toMatchObject({ l: 0.6, r: expect.closeTo(0.3, 5) });
  });

  it('places the image so only the cropped region shows', () => {
    expect(cropLayout(null)).toEqual({ width: '100%', height: '100%', left: '0%', top: '0%' });
    expect(cropLayout({ l: 0.25, r: 0.25, t: 0, b: 0.5 })).toEqual({ width: '200%', height: '200%', left: '-50%', top: '0%' });
  });

  it('keeps the cropped region undistorted', () => {
    const el = { w: 400, h: 300, natW: 800, natH: 600 };
    expect(croppedHeight(el, { l: 0.5 })).toBe(600); // half the width shows: twice as tall per pixel
    expect(croppedHeight(el, null)).toBe(300);
    expect(croppedHeight({ w: 400, h: 123 }, { l: 0.5 })).toBe(123); // no natural size known
  });

  it('every mask has a clip path except none', () => {
    for (const [k, m] of Object.entries(MASKS)) {
      if (k === 'none') expect(m.clip).toBeUndefined();
      else expect(m.clip).toMatch(/^(ellipse|inset|polygon)\(/);
    }
  });
});

describe('page background', () => {
  it('layers a pattern over a gradient over the colour', () => {
    const style = pageBackgroundStyle({
      background: '#ffffff', gradient: { kind: 'linear', angle: 90, to: '#000000' }, pattern: { size: 20, svg: '<svg/>' },
    });
    expect(style.backgroundColor).toBe('#ffffff');
    expect(style.backgroundImage).toMatch(/^url\("data:image\/svg\+xml,%3Csvg%2F%3E"\), linear-gradient/);
    expect(style.backgroundSize).toBe('20px 20px, 100% 100%');
    expect(pageBackgroundStyle({ background: '#eeeeee' })).toEqual({ backgroundColor: '#eeeeee' });
  });
});

describe('editing workflow', () => {
  it('a style change is one undoable step, slider drags preview without history', () => {
    const design = newDesign('T', 500, 500);
    const pid = design.pages[0].id;
    design.pages[0].elements.push(newElement('rect', { x: 0, y: 0, w: 10, h: 10 }, { id: 'r1' }));
    let st = docReducer(initialDocState(), { type: 'load', doc: design });
    st = docReducer(st, { type: 'apply', history: true, fn: (d) => updateElements(d, pid, ['r1'], { gradient: { kind: 'linear', angle: 90, to: '#000000' } }) });
    st = docReducer(st, { type: 'apply', history: true, fn: (d) => updateElements(d, pid, ['r1'], { adjust: { brightness: 110 } }) });
    st = docReducer(st, { type: 'apply', history: false, fn: (d) => updateElements(d, pid, ['r1'], { adjust: { brightness: 150 } }) });
    expect(st.past).toHaveLength(2);
    expect(st.doc.pages[0].elements[0].adjust.brightness).toBe(150);
    st = docReducer(st, { type: 'undo' });
    expect(st.doc.pages[0].elements[0].adjust).toBeUndefined();
    expect(st.doc.pages[0].elements[0].gradient.to).toBe('#000000');
    st = docReducer(st, { type: 'undo' });
    expect(st.doc.pages[0].elements[0].gradient).toBeUndefined();
  });
});
