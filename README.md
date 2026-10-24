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
  - **Remove background:** cuts the subject out of a photo, on your own
    device, with a preview to Apply or Cancel; Undo brings the background
    back. The first time it downloads a helper of about 16 MB (the U²-Net-p
    model, Apache-2.0, and the onnxruntime-web engine, MIT) from this app
    itself; after that it works offline. Export as PNG with Transparent
    background for a transparent file.
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
  autosave to IndexedDB on this device about a second after each change, and
  straight away when the page is hidden or closed.
- **File menu** (the document button in the header):
  - **Export** PNG, JPEG, SVG or PDF: all pages, this page or chosen pages
    (several images come as one ZIP); PNG and JPEG at 0.5× to 4× with the
    DPI written into the file; transparent backgrounds for PNG and SVG;
    JPEG and PDF quality; PDF at 96, 150 or 300 DPI, and print-ready PDF
    (300 DPI, 3 mm bleed, trim and bleed boxes, crop marks). A PDF can carry
    an editable copy of the design, so Home Studio reopens it as a design.
  - **Open a file:** images (PNG, JPEG, GIF, WebP; AVIF, BMP, ICO, HEIC and
    TIFF where the browser can read them, turned into PNG), SVGs (cleaned),
    PDFs (each page a picture, via pdf.js) and Home Studio files.
  - **Download project file:** one `.homestudio.json` file with the design's
    pages, layers, images, imported fonts and metadata, versioned and checked
    field by field when it is opened again.
  - **Version history:** a version every 10 minutes while editing (the newest
    30 kept), versions you save yourself, and going back to any of them (undo
    brings back what you had).
  - **Backup and storage:** every design, image, version and library item in
    one `.homestudio-backup.json` file; restoring adds what is missing and
    keeps the newer copy of a design; space used, a warning when it runs low,
    and asking the browser to keep the designs.
- **Crash recovery.** Each change is also copied to localStorage at once, so
  work from a tab that crashed before the autosave is offered back on the
  next start.
- **Offline.** After the first visit a service worker keeps the app's files
  (and the bundled fonts' Latin files), so the editor opens and works with no
  connection.

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
| `web/src/ui/` | `App.jsx` (shell, toolbar, page tabs, shortcuts, autosave wiring, states), `panels.jsx` (layers, inspector), `styleControls.jsx` (inspector style sections), `Library.jsx` (its own lazily loaded chunk), `dialogs.jsx`, `icons.jsx` |
| `web/src/persist/db.js` | IndexedDB stores (`designs`, `images` as Blobs, `assets` for imports, `components`, `prefs` for favourites, `versions`), duplication, the 800 ms debounced autosave, version history, gathering and restoring projects and backups |
| `web/src/persist/recovery.js`, `storage.js` | The crash-recovery copy in localStorage; space used and the low-space warning |
| `web/src/export/` | `svg.js` (a page as standalone SVG: the one renderer behind every export), `render.js` (fonts and images embedded, drawn onto a canvas, each file read back before it is offered), `pdf.js` (the PDF writer: pages, bleed, crop marks, attached design), `imagemeta.js` (PNG and JPEG DPI), `options.js` (sizes, limits, file names) |
| `web/src/io/` | `project.js` (the versioned file format and its validation), `zip.js`, `binary.js` (base64, CRC-32), `download.js` |
| `web/src/import/pdf.js` | Opening PDFs with pdf.js, loaded only when a PDF is opened |
| `web/sw.js`, `build/sw-plugin.js` | The service worker and the build step that writes its list of files into `dist/sw.js` |
| `web/src/demo.js` | Staging demo designs (`?demo=1` on staging only, separate `home-studio-demo` database) |

Document model: a design has pages; a page has `elements` (bottom first) and
`guides`. An element has id, type (text, rect, ellipse, line, shape, image, svg, group),
name, x, y, w, h, rotation, opacity, plus type-specific fields. Groups hold
their children with coordinates relative to the group's own origin.

## Development

```sh
npm install
npm run build   # vite build → dist/
npm test        # vitest, including exports reopened with an XML parser, pdf.js and zlib
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
lucide (ISC), the @fontsource packages (OFL 1.1), pdf.js (pdfjs-dist,
Apache 2.0, bundled into the PDF-opening chunk), fake-indexeddb (Apache 2.0,
tests only), @xmldom/xmldom (MIT, tests only).
This app is free and open source; no paid features, no watermarks, no
artificial quotas, no mandatory accounts.