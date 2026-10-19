# Home Studio

A free, open-source graphic design editor that runs entirely in your browser.
Make a design at a size you set, add text, shapes and images, then move,
resize, rotate, align and group them. Everything saves on your own device:
no accounts, no network features, no paid anything.

## The editor

- **Canvas.** One page at a time, at any zoom. Pan with space-drag, two
  fingers, or the scroll wheel; zoom with Ctrl + scroll, the − / + buttons,
  or tap the percentage to fit the page to the window.
- **Elements.** Text, rectangles, ellipses, lines and images (from your own
  device). Drag to move, square handles to resize (Shift keeps proportions),
  round handles just outside each corner to rotate (Shift snaps to 15°).
  Double-tap a text to type in it.
- **Arrange.** Multi-select with Shift-tap or a marquee drag; group and
  ungroup; align edges or centre lines (against the page with one item,
  against the selection with several) and space three or more evenly.
- **Snapping and guides.** Live pink lines appear while dragging when an
  edge or centre lines up with the page, another element or a guide. Guides
  can be dragged, and dragged off the page to remove them. Alt drags freely.
- **Layers.** The panel lists every element, topmost first. Tap to select,
  drag to reorder, double-tap to rename.
- **Properties.** Position, size, angle and opacity; fills, strokes and
  corners for shapes; font, size, weight, alignment and colour for text.
  With nothing selected it edits the page itself: name, size, background.
- **Pages.** Any number, each with its own name, size and background.
- **Undo, redo, autosave.** One history entry per finished gesture; designs
  autosave to IndexedDB on this device about a second after each change.

## Architecture

React 18 and Vite 5, plain JavaScript, Tailwind 3 for styling. The canvas is
rendered by the app itself (absolutely-positioned DOM inside a scaled page
div), so the selection handles and guides need no rendering library.

| Module | What it does |
| --- | --- |
| `web/src/doc/model.js` | Factories, ids, element geometry (rotated bounds), tree walking |
| `web/src/doc/store.js` | The reducer (document, selection, tool, history) and the pure document transforms |
| `web/src/doc/history.js` | Undo/redo snapshots, one per finished gesture |
| `web/src/tools/snap.js` | Pure snapping math (6 screen-px threshold, rotation-aware) |
| `web/src/tools/align.js` | Align and distribute math |
| `web/src/tools/shortcuts.js` | The pure key-event → action table |
| `web/src/render/Canvas.jsx` | The page, elements, selection frame and handles, guides, and every pointer gesture |
| `web/src/ui/` | `App.jsx` (shell, toolbar, page tabs, shortcuts, autosave wiring, states), `panels.jsx` (layers, inspector), `dialogs.jsx`, `icons.jsx` |
| `web/src/persist/db.js` | IndexedDB stores (`designs`, images as Blobs), the 800 ms debounced autosave |
| `web/src/demo.js` | Staging demo designs (`?demo=1` on staging only, separate `home-studio-demo` database) |

Document model: a design has pages; a page has `elements` (bottom first) and
`guides`. An element has id, type (text, rect, ellipse, line, image, group),
name, x, y, w, h, rotation, opacity, plus type-specific fields. Groups hold
their children with coordinates relative to the group's own origin.

## Development

```sh
npm install
npm run build   # vite build → dist/
npm test        # vitest: model, history, snapping, alignment, shortcuts
npm start       # serves dist/ (the built app) on :3000
```

On staging, `GET /api/env` reports `{ staging: true }` and `?demo=1` opens
sample designs in a separate database; in production it does nothing.

## Licences

All dependencies are permissively licensed: react and react-dom (MIT),
vite and @vitejs/plugin-react (MIT), idb (ISC), vitest (MIT), tailwindcss,
postcss and autoprefixer (MIT), express (MIT), pg (MIT), jsonwebtoken (MIT).
This app is free and open source; no paid features, no watermarks, no
artificial quotas, no mandatory accounts.