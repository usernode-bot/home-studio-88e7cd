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
- **Properties.** Position, size, angle and opacity, then a section per
  kind of element:
  - **Text:** 14 fonts (4 system, 10 free bundled, plus your own), size,
    weight from Thin to Black, italic, underline, strikethrough, alignment
    including justify, case, line height, letter spacing, and one-tap text
    presets (Heading, Subheading, Body, Caption, Label).
  - **Effects:** Shadow, Lift, Neon, Outline, Hollow and Highlight, and
    gradient text.
  - **Fill:** a solid colour or a linear or radial gradient, for shapes,
    text and the page background.
  - **Border:** colour, width, solid, dashed or dotted, and corner radius.
  - **Shadow:** offset, blur, colour and strength, on any element.
  - **Images:** crop from each edge (keeping proportions), masks (circle,
    rounded, arch, triangle, diamond, hexagon, star), flips, seven filters
    and seven adjustment sliders.
  - **Graphics:** SVG icons and imported SVGs, recolourable when drawn in
    one colour.
  With nothing selected it edits the page itself: name, size, background
  colour or gradient, and removing a pattern.
- **Library.** Templates for social media, posters, flyers, presentations,
  thumbnails, invitations, logos and documents, plus icons, shapes,
  illustrations, backgrounds and fonts, searchable and by category. Star
  anything to keep it under Favourites. Using a template makes a normal
  design of your own. Your files holds images, SVGs and fonts you import;
  Save as component keeps a selection to reuse. Opens at `#library`.
- **Designs.** Create from a size preset or your own size, open, rename,
  duplicate (with its own copies of its images) and delete.
- **Pages.** Any number, each with its own name, size and background.
- **Undo, redo, autosave.** One history entry per finished gesture; designs
  autosave to IndexedDB on this device about a second after each change.

## Getting work out (and back in)

- **Export.** The Export button opens a dialog with format (PNG, JPEG, SVG,
  PDF), page choice (this page or all pages), size (1×–4×, capped at what
  browsers can draw), JPEG quality, an optional transparent background for
  PNG and SVG, and DPI with printed size for PDF. Every file is verified
  (signature, size, decode) before it downloads; several pages of one raster
  or SVG format arrive as one ZIP. No watermarks, no limits.
- **Project files.** Download a design as a `.homestudio` file (a ZIP with
  the design and its images and fonts) from the designs sheet; import it on
  any device to get an editable copy with fresh ids. Importing an image or
  SVG makes a new design at the picture's size; project and backup files
  are recognised by their contents, never by extension alone.
- **Backups.** "Back up everything" writes one `.homestudio-backup` file
  with all designs, images, fonts and favourites; restoring it adds
  anything the device is missing and copies (never overwrites) designs that
  differ — identical ones are skipped, nothing is deleted.
- **Version history.** The clock button lists restore points: one kept
  every 5 minutes while you edit (30 per design) and one taken before any
  restore, so a restore can itself be undone by restoring forward.
- **Crash recovery.** The app marks each session; if it was closed without
  saving cleanly, the next visit reopens the design from its last autosave
  and says so.
- **Storage.** The designs sheet shows how much space the browser allows
  and offers "Keep my designs" (persistent storage) when it's on offer.
- **Offline.** After one visit, the app's own code is cached by a service
  worker and the app opens offline; your designs stay in IndexedDB. It
  never caches anything from `/api/` and works fine without the worker.

## Architecture

React 18 and Vite 5, plain JavaScript, Tailwind 3 for styling. The canvas is
rendered by the app itself (absolutely-positioned DOM inside a scaled page
div), so the selection handles and guides need no rendering library.

| Module | What it does |
| --- | --- |
| `web/src/doc/model.js` | Factories, ids, element geometry (rotated bounds), tree walking |
| `web/src/doc/store.js` | The reducer (document, selection, tool, history) and the pure document transforms |
| `web/src/doc/history.js` | Undo/redo snapshots, one per finished gesture |
| `web/src/doc/style.js` | Pure style → CSS: gradients, borders, shadows, text effects and presets, image crop, masks and filters, shapes |
| `web/src/assets/` | `catalog.js` (bundled assets, licences, search), `templates.js`, `fonts.js` (lazy font loading, imported fonts), `svg.js` (SVG cleaning), `imports.js` (files from this device), `presets.js` (sizes) |
| `web/src/tools/snap.js` | Pure snapping math (6 screen-px threshold, rotation-aware) |
| `web/src/tools/align.js` | Align and distribute math |
| `web/src/tools/shortcuts.js` | The pure key-event → action table |
| `web/src/render/Canvas.jsx` | The page, selection frame and handles, guides, and every pointer gesture |
| `web/src/render/ElementView.jsx` | Draws one element with all its styles; memoised so an edit redraws only what changed |
| `web/src/render/PagePreview.jsx` | Library previews, drawn only once scrolled into view |
| `web/src/ui/` | `App.jsx` (shell, toolbar, page tabs, shortcuts, autosave wiring, import, backup, restore points, states), `panels.jsx` (layers, inspector), `styleControls.jsx` (inspector style sections), `Library.jsx` (its own lazily loaded chunk), `ExportDialog.jsx` (lazy), `dialogs.jsx` (designs sheet, version history), `icons.jsx` |
| `web/src/export/` | `svgPage.js` (the one page → SVG serialiser), `textLayout.js` (the wrap rule shared with the editor), `raster.js` (SVG → PNG/JPEG with size caps), `pdf.js` (PDF via pdf-lib), `verify.js` (byte and decode checks), `fontsInline.js` (@font-face embedding), `index.js` (`runExport`, file naming, ZIPs) |
| `web/src/project/format.js` | `.homestudio` project files and `.homestudio-backup` backups (ZIPs via fflate), with versioned JSON and the restore rules |
| `web/src/doc/validate.js` | `normalizeDesign`: sanitises any design read from disk or a file before it enters the store |
| `web/src/persist/db.js` | IndexedDB stores (`designs`, `images` as Blobs, `assets` for imports, `components`, `prefs` for favourites, `versions` for restore points), duplication, the 800 ms debounced autosave, whole-library export/import |
| `web/src/offline/` | `register.js` registers the service worker in production builds |
| `web/sw.js` | The service worker; `vite.config.js` injects the precache list of built assets at build time |
| `web/src/demo.js` | Staging demo designs (`?demo=1` on staging only, separate `home-studio-demo` database), including sample restore points |

Document model: a design has pages; a page has `elements` (bottom first) and
`guides`. An element has id, type (text, rect, ellipse, line, shape, image, svg, group),
name, x, y, w, h, rotation, opacity, plus type-specific fields. Groups hold
their children with coordinates relative to the group's own origin.

## Development

```sh
npm install
npm run build   # vite build → dist/
npm test        # vitest: model, history, snapping, alignment, shortcuts, styles, assets, storage, export, project files
npm start       # serves dist/ (the built app) on :3000
```

On staging, `GET /api/env` reports `{ staging: true }` and `?demo=1` opens
sample designs in a separate database; in production it does nothing.

## Licences

Bundled assets, each with its licence and attribution recorded in
`web/src/assets/` and shown in the library under Licences:

- Icons: [Lucide](https://lucide.dev), ISC License.
- Fonts: Inter, Montserrat, Playfair Display, Merriweather, Oswald, Bebas
  Neue, Lobster, Pacifico, Caveat and Space Mono, via Fontsource, each under
  the SIL Open Font License 1.1 with its authors' copyright.
- Templates, shapes, illustrations and backgrounds: drawn for Home Studio
  and dedicated to the public domain (CC0 1.0).

All dependencies are permissively licensed: react and react-dom (MIT),
vite and @vitejs/plugin-react (MIT), idb (ISC), vitest (MIT), tailwindcss,
postcss and autoprefixer (MIT), express (MIT), pg (MIT), jsonwebtoken (MIT),
lucide (ISC), the @fontsource packages (OFL 1.1), fake-indexeddb (Apache 2.0,
tests only), fflate (MIT) and pdf-lib (MIT), both recorded with their
licences in `web/src/assets/catalog.js` `LIBRARIES`.
This app is free and open source; no paid features, no watermarks, no
artificial quotas, no mandatory accounts.