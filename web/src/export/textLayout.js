// Text layout for export: the same word-wrap rule the editor uses, held in
// one place so measureTextHeight and the SVG serialiser agree on line breaks.

// Wrap a text element to its own width. `measure(el, text)` returns the
// width of `text` in the element's font, letter spacing included. Returns
// one array of lines per paragraph (a '\n' starts a new one).
export function wrapLines(el, measure) {
  const spacing = el.letterSpacing || 0;
  const width = (s) => measure(el, s) + spacing * s.length;
  const out = [];
  for (const para of String(el.text ?? '').split('\n')) {
    const lines = [];
    let line = '';
    for (const word of para.split(' ')) {
      const next = line ? line + ' ' + word : word;
      if (line && width(next) > el.w) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    lines.push(line);
    out.push(lines);
  }
  return out;
}

// The canvas measure the editor uses: one measuring context, reused.
export function canvasMeasure() {
  const ctx = document.createElement('canvas').getContext('2d');
  return (el, s) => {
    ctx.font = `${el.italic ? 'italic ' : ''}${el.weight || 400} ${el.size}px ${el._fontStack || 'sans-serif'}`;
    return ctx.measureText(s).width;
  };
}