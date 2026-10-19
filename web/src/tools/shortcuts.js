// Keyboard shortcuts: a pure key-event -> action-name map, so the same
// table the app uses is the one the tests check. `mod` is Ctrl or Cmd.
// Returns null when the key is nothing this app acts on.

export const TOOL_KEYS = { v: 'select', t: 'text', r: 'rect', e: 'ellipse', l: 'line' };

export function shortcutFor(event) {
  const mod = event.ctrlKey || event.metaKey;
  const key = event.key;
  const lower = typeof key === 'string' ? key.toLowerCase() : '';

  if (mod && lower === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (mod && lower === 'y') return 'redo';
  if (mod && lower === 'd') return 'duplicate';
  if (mod && lower === 'g') return event.shiftKey ? 'ungroup' : 'group';
  if (mod && lower === 'a') return 'select-all';
  if (mod && (key === '+' || key === '=')) return 'zoom-in';
  if (mod && key === '-') return 'zoom-out';
  if (mod && key === '0') return 'zoom-reset';
  if (event.altKey) return null;
  if (key === 'Delete' || key === 'Backspace') return 'delete';
  if (key === 'Escape') return 'escape';
  if (!mod && TOOL_KEYS[lower]) return 'tool:' + TOOL_KEYS[lower];
  if (!mod && lower === 'g') return 'add-guide';
  return null;
}

// Arrow nudge: how far one keypress moves the selection.
export function nudgeStep(event) {
  return event.shiftKey ? 10 : 1;
}

export function arrowDelta(event) {
  const step = nudgeStep(event);
  if (event.key === 'ArrowLeft') return { dx: -step, dy: 0 };
  if (event.key === 'ArrowRight') return { dx: step, dy: 0 };
  if (event.key === 'ArrowUp') return { dx: 0, dy: -step };
  if (event.key === 'ArrowDown') return { dx: 0, dy: step };
  return null;
}
