// The inspector's style sections: shape, typography, fill and gradient,
// text effects, image (crop, mask, flip, filters, adjustments), border,
// shadow, and the page background. Every control writes straight to the
// selected elements; sliders record one history entry per drag.

import React, { useEffect, useRef, useState } from 'react';
import {
  SHAPES, MASKS, FILTER_PRESETS, ADJUSTMENTS, ADJUST_DEFAULTS, TEXT_EFFECTS, TEXT_PRESETS, FONT_WEIGHTS,
  textEffectOf, normalizeCrop, croppedHeight,
} from '../doc/style.js';
import { SYSTEM_LABELS, BUNDLED_FONTS, listUserFonts, fontLabel, ensureFont, fontStack } from '../assets/fonts.js';
import { isRecolorable } from '../assets/svg.js';
import { DOWNLOAD_MB } from '../bgremove/info.js';

const HEX = /^#[0-9a-fA-F]{6}$/;

export function NumField({ label, value, onCommit, style, step }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => {
    const n = parseFloat(v);
    if (Number.isFinite(n) && n !== value) onCommit(n);
    else setV(value);
  };
  return (
    <label className="f" style={style}>
      <b>{label}</b>
      <input className="num" inputMode="decimal" value={v} step={step}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); e.stopPropagation(); }} />
    </label>
  );
}

// A colour drag inside the picker fires a stream of change events: the
// first records history, the rest only preview, so one drag undoes in one
// step (the same contract as RangeField). The session ends when the picker
// closes (the input's native change event) or the field blurs.
export function ColorField({ label, value, onCommit }) {
  const session = useRef(false);
  const inputRef = useRef(null);
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return undefined;
    const end = () => { session.current = false; };
    el.addEventListener('change', end);
    return () => el.removeEventListener('change', end);
  }, []);
  return (
    <label className="f">
      <b>{label}</b>
      <input ref={inputRef} type="color" className="color" value={HEX.test(value || '') ? value : '#000000'}
        onPointerDown={() => { session.current = false; }}
        onBlur={() => { session.current = false; }}
        onChange={(e) => { onCommit(e.target.value, !session.current); session.current = true; }} />
    </label>
  );
}

function SelectField({ label, value, onChange, children, wide }) {
  return (
    <label className="f" style={wide ? { gridColumn: 'span 2' } : undefined}>
      <b>{label}</b>
      <select className="num" value={value} onChange={(e) => onChange(e.target.value)}>{children}</select>
    </label>
  );
}

// A slider whose first move in a drag records history and the rest only
// preview, so one drag undoes in one step.
function RangeField({ label, value, min, max, step = 1, unit = '', onLive }) {
  const dragging = useRef(false);
  const end = () => { dragging.current = false; };
  return (
    <label className="f range" style={{ gridColumn: 'span 2' }}>
      <b>{label}</b>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => { onLive(Number(e.target.value), !dragging.current); dragging.current = true; }}
        onPointerUp={end} onKeyUp={end} onBlur={end} onKeyDown={(e) => e.stopPropagation()} />
      <span className="range-val">{value}{unit}</span>
    </label>
  );
}

function Toggles({ items, label }) {
  return (
    <div className="toggles" role="group" aria-label={label} style={{ gridColumn: 'span 2' }}>
      {items.map((it) => (
        <button key={it.key} type="button" className={'chip' + (it.on ? ' on' : '')}
          aria-pressed={typeof it.on === 'boolean' ? it.on : undefined} onClick={it.onClick}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

function Section({ title, children, data }) {
  return (
    <>
      <div className="section-label" style={{ marginTop: 12 }}>{title}</div>
      <div className="list" data-section={data}><div className="grid">{children}</div></div>
    </>
  );
}

// ── Fill: solid colour or a two-colour gradient ──────────────────────────
function FillSection({ title = 'Fill', from, gradient, setFrom, setGradient }) {
  const kind = gradient ? gradient.kind : 'solid';
  return (
    <Section title={title} data="fill">
      <SelectField label="Type" value={kind} wide onChange={(k) => setGradient(k === 'solid' ? null : {
        kind: k, angle: gradient?.angle ?? 90, to: gradient?.to || (from === '#ffffff' ? '#2554d6' : '#ffffff'),
      })}>
        <option value="solid">Solid colour</option>
        <option value="linear">Linear gradient</option>
        <option value="radial">Radial gradient</option>
      </SelectField>
      <ColorField label={gradient ? 'From' : 'Colour'} value={from} onCommit={(v, first) => setFrom(v, first)} />
      {gradient && <ColorField label="To" value={gradient.to} onCommit={(to, first) => setGradient({ ...gradient, to }, first)} />}
      {gradient && gradient.kind === 'linear' && (
        <NumField label="Angle" value={gradient.angle ?? 90} onCommit={(a) => setGradient({ ...gradient, angle: ((a % 360) + 360) % 360 })} />
      )}
    </Section>
  );
}

function BorderSection({ el, set, live }) {
  const isLine = el.type === 'line';
  return (
    <Section title={isLine ? 'Line' : 'Border'} data="border">
      <ColorField label="Colour" value={el.stroke || '#000000'}
        onCommit={(v, first) => live({ stroke: v, strokeWidth: el.strokeWidth || (isLine ? 2 : 4) }, first)} />
      <NumField label="Width" value={el.strokeWidth || 0} onCommit={(v) => set({ strokeWidth: Math.max(isLine ? 1 : 0, v), stroke: el.stroke || '#1c1917' })} />
      <SelectField label="Style" value={el.strokeStyle || 'solid'} onChange={(v) => set({ strokeStyle: v })}>
        <option value="solid">Solid</option>
        <option value="dashed">Dashed</option>
        <option value="dotted">Dotted</option>
      </SelectField>
      {(el.type === 'rect' || el.type === 'image') && (
        <NumField label="Corner" value={el.radius || 0} onCommit={(v) => set({ radius: Math.max(0, v) })} />
      )}
    </Section>
  );
}

const SHADOW_ON = { x: 0, y: 8, blur: 16, color: '#000000', alpha: 0.3 };
function ShadowSection({ el, set, live }) {
  const s = el.shadow;
  const patch = (p) => set({ shadow: { ...s, ...p } });
  return (
    <Section title={el.type === 'text' ? 'Shadow and glow' : 'Shadow'} data="shadow">
      <label className="f" style={{ gridColumn: 'span 2' }}>
        <b>Show a shadow</b>
        <input type="checkbox" className="check" checked={!!s} onChange={(e) => set({ shadow: e.target.checked ? { ...SHADOW_ON } : null })} />
      </label>
      {s && (
        <>
          <NumField label="X" value={s.x} onCommit={(v) => patch({ x: v })} />
          <NumField label="Y" value={s.y} onCommit={(v) => patch({ y: v })} />
          <NumField label="Blur" value={s.blur} onCommit={(v) => patch({ blur: Math.max(0, v) })} />
          <NumField label="Strength %" value={Math.round((s.alpha ?? 0.35) * 100)} onCommit={(v) => patch({ alpha: Math.min(1, Math.max(0, v / 100)) })} />
          <ColorField label="Colour" value={s.color} onCommit={(v, first) => live({ shadow: { ...s, color: v } }, first)} />
        </>
      )}
    </Section>
  );
}

// ── Text ─────────────────────────────────────────────────────────────────
function TypographySection({ el, setText }) {
  const users = listUserFonts();
  const known = SYSTEM_LABELS[el.font] || BUNDLED_FONTS[el.font] || users.some((u) => u.key === el.font);
  const pickFont = (key) => {
    setText({ font: key });
    // Measure again once the font's files are in, without a history entry.
    ensureFont(key).then((loaded) => { if (loaded) setText({}, false); });
  };
  return (
    <Section title="Text" data="typography">
      <label className="f" style={{ gridColumn: 'span 2' }}>
        <b>Font</b>
        <select className="num" value={el.font} onChange={(e) => pickFont(e.target.value)} style={{ fontFamily: fontStack(el.font) }}>
          <optgroup label="On this device">
            {Object.entries(SYSTEM_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </optgroup>
          <optgroup label="Free fonts">
            {Object.entries(BUNDLED_FONTS).map(([k, f]) => <option key={k} value={k}>{f.family}</option>)}
          </optgroup>
          {(users.length > 0 || !known) && (
            <optgroup label="Your fonts">
              {users.map((u) => <option key={u.key} value={u.key}>{u.name}</option>)}
              {!known && <option value={el.font}>{fontLabel(el.font)}</option>}
            </optgroup>
          )}
        </select>
      </label>
      <NumField label="Size" value={el.size} onCommit={(v) => setText({ size: Math.max(4, v) })} />
      <SelectField label="Weight" value={String(el.weight)} onChange={(v) => setText({ weight: Number(v) })}>
        {FONT_WEIGHTS.map(([w, l]) => <option key={w} value={w}>{l}</option>)}
      </SelectField>
      <Toggles label="Text style" items={[
        { key: 'i', label: 'Italic', on: !!el.italic, onClick: () => setText({ italic: !el.italic }) },
        { key: 'u', label: 'Underline', on: !!el.underline, onClick: () => setText({ underline: !el.underline }) },
        { key: 's', label: 'Strikethrough', on: !!el.strike, onClick: () => setText({ strike: !el.strike }) },
      ]} />
      <SelectField label="Align" value={el.align} onChange={(v) => setText({ align: v })}>
        <option value="left">Left</option>
        <option value="center">Centre</option>
        <option value="right">Right</option>
        <option value="justify">Justify</option>
      </SelectField>
      <SelectField label="Case" value={el.textCase || 'none'} onChange={(v) => setText({ textCase: v })}>
        <option value="none">As typed</option>
        <option value="upper">Uppercase</option>
        <option value="lower">Lowercase</option>
        <option value="title">Title Case</option>
      </SelectField>
      <NumField label="Line height" value={el.lineHeight || 1.25} onCommit={(v) => setText({ lineHeight: Math.min(4, Math.max(0.6, v)) })} />
      <NumField label="Spacing" value={el.letterSpacing || 0} onCommit={(v) => setText({ letterSpacing: Math.min(100, Math.max(-20, v)) })} />
      <Toggles label="Text presets" items={Object.entries(TEXT_PRESETS).map(([k, p]) => ({
        key: k, label: p.label, onClick: () => setText({ textCase: 'none', ...p.patch }),
      }))} />
    </Section>
  );
}

function TextEffectsSection({ el, set, live }) {
  const current = textEffectOf(el);
  return (
    <Section title="Effects" data="effects">
      <Toggles label="Text effects" items={Object.entries(TEXT_EFFECTS).map(([k, fx]) => ({
        key: k, label: fx.label, on: current === k, onClick: () => set(fx.patch(el)),
      }))} />
      {el.outline && (
        <>
          <ColorField label="Outline" value={el.outline.color} onCommit={(v, first) => live({ outline: { ...el.outline, color: v } }, first)} />
          <NumField label="Outline width" value={el.outline.width} onCommit={(v) => set({ outline: { ...el.outline, width: Math.max(0, v) } })} />
        </>
      )}
      {el.highlight && <ColorField label="Highlight" value={el.highlight} onCommit={(v, first) => live({ highlight: v }, first)} />}
    </Section>
  );
}

// ── Images ───────────────────────────────────────────────────────────────
function ImageSection({ el, set, live, onRemoveBackground }) {
  const crop = normalizeCrop(el.crop);
  const setCrop = (k, pct) => {
    const next = normalizeCrop({ ...crop, [k]: pct / 100 });
    set({ crop: next, h: croppedHeight(el, next) });
  };
  const adjust = { ...ADJUST_DEFAULTS, ...(el.adjust || {}) };
  const presetOn = Object.keys(FILTER_PRESETS).find((k) =>
    ADJUSTMENTS.every(([a]) => adjust[a] === ({ ...ADJUST_DEFAULTS, ...FILTER_PRESETS[k].adjust })[a]));
  return (
    <>
      {onRemoveBackground && el.imageId && (
        <Section title="Background" data="background">
          <button type="button" className="btn-secondary" style={{ gridColumn: 'span 2' }} onClick={() => onRemoveBackground(el)} data-remove-bg>
            Remove background
          </button>
          <p className="sub" style={{ gridColumn: 'span 2', margin: '0 4px' }}>
            Works on your device. The first time downloads a helper of about {DOWNLOAD_MB} MB.
          </p>
        </Section>
      )}
      <Section title="Crop and mask" data="crop">
        <NumField label="Left %" value={Math.round(crop.l * 100)} onCommit={(v) => setCrop('l', v)} />
        <NumField label="Right %" value={Math.round(crop.r * 100)} onCommit={(v) => setCrop('r', v)} />
        <NumField label="Top %" value={Math.round(crop.t * 100)} onCommit={(v) => setCrop('t', v)} />
        <NumField label="Bottom %" value={Math.round(crop.b * 100)} onCommit={(v) => setCrop('b', v)} />
        <SelectField label="Mask" value={el.mask || 'none'} wide onChange={(v) => set({ mask: v })}>
          {Object.entries(MASKS).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
        </SelectField>
        <Toggles label="Crop and flip" items={[
          { key: 'reset', label: 'Reset crop', onClick: () => set({ crop: null, h: croppedHeight(el, null) }) },
          { key: 'fx', label: 'Flip horizontal', on: !!el.flipX, onClick: () => set({ flipX: !el.flipX }) },
          { key: 'fy', label: 'Flip vertical', on: !!el.flipY, onClick: () => set({ flipY: !el.flipY }) },
        ]} />
      </Section>
      <Section title="Filters and adjustments" data="filters">
        <Toggles label="Filters" items={Object.entries(FILTER_PRESETS).map(([k, p]) => ({
          key: k, label: p.label, on: presetOn === k, onClick: () => set({ adjust: { ...ADJUST_DEFAULTS, ...p.adjust } }),
        }))} />
        {ADJUSTMENTS.map(([key, label, min, max, unit]) => (
          <RangeField key={key} label={label} min={min} max={max} unit={unit} value={adjust[key]}
            onLive={(v, first) => live({ adjust: { ...adjust, [key]: v } }, first)} />
        ))}
      </Section>
    </>
  );
}

// Everything below the position grid for one selected element.
export function StyleSections({ el, set, live, setText, onRemoveBackground }) {
  const t = el.type;
  const filled = t === 'rect' || t === 'ellipse' || t === 'shape';
  return (
    <>
      {t === 'shape' && (
        <Section title="Shape" data="shape">
          <SelectField label="Shape" value={el.shape} wide onChange={(v) => set({ shape: v })}>
            {Object.entries(SHAPES).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
          </SelectField>
        </Section>
      )}
      {t === 'text' && <TypographySection el={el} setText={setText} />}
      {filled && (
        <FillSection from={el.fill} gradient={el.gradient}
          setFrom={(v, first) => live({ fill: v }, first)} setGradient={(g, first) => live(g, first)} />
      )}
      {t === 'text' && (
        <FillSection title="Colour" from={el.color} gradient={el.gradient}
          setFrom={(v, first) => live({ color: v }, first)} setGradient={(g, first) => live(g, first)} />
      )}
      {t === 'text' && <TextEffectsSection el={el} set={set} live={live} />}
      {t === 'svg' && isRecolorable(el.svg) && (
        <Section title="Colour" data="svg-colour">
          <ColorField label="Colour" value={el.color} onCommit={(v, first) => live({ color: v }, first)} />
        </Section>
      )}
      {t === 'image' && <ImageSection el={el} set={set} live={live} onRemoveBackground={onRemoveBackground} />}
      {(filled || t === 'line' || t === 'image') && <BorderSection el={el} set={set} live={live} />}
      <ShadowSection el={el} set={set} live={live} />
    </>
  );
}

// The page's background beyond its colour: a gradient, and any pattern a
// library background brought.
export function BackgroundSection({ page, apply }) {
  const setPage = (patch, first = true) => apply((doc) => { Object.assign(doc.pages.find((p) => p.id === page.id), patch); doc.updatedAt = Date.now(); }, first);
  return (
    <>
      <FillSection title="Background" from={page.background} gradient={page.gradient || null}
        setFrom={(v, first) => setPage({ background: v }, first)} setGradient={(g, first) => setPage(g, first)} />
      {page.pattern && (
        <button type="button" className="btn-secondary" style={{ width: '100%', marginTop: 8 }} onClick={() => setPage({ pattern: null })}>
          Remove pattern
        </button>
      )}
    </>
  );
}
