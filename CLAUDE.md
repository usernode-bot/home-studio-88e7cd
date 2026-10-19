# Home Studio — notes for Claude Code

This app runs on **Homeroom**. The platform conventions are the single
source of truth for platform-wide behavior (auth model, `USERNODE_ENV`,
public/private tables, "don't `git push`", etc.):

**Platform conventions (authoritative, always current):**
https://app.onhomeroom.com/claude.md

**Inside Homeroom** (its dev chat, and Homeroom bot's builds), do not
fetch that URL: what applies to your change is already in your
instructions, and the `homeroom` MCP server's
`get_platform_conventions` reads any one section of the conventions
when you need it. The two sections below are for working outside
Homeroom; skip them there.

**Anywhere else** (Claude Code run against this repo locally, or another
harness), fetch it at the start of each session. The hosted copy is
updated in place when platform rules change, so fetching it gives you
today's rules, not a stale snapshot.

## Connector permission prompts (outside Homeroom)

This repo ships `.claude/settings.json`, which allows the **read-only**
Homeroom connector calls (`mcp__homeroom__get_*`,
`…__list_*`, `…__whoami`) once you accept the workspace trust dialog.
See `.claude/README.md` for the whole story, including what to do if you
are still being prompted.

## Check that this checkout is current

You may be working in a fork of this app whose `main` is behind the app's
canonical repository, and nothing in the checkout says so: `git fetch origin`
compares the fork with itself. This matters before you **read** code to answer
a question about how the app behaves now, not only before you edit it.

The canonical repository is named in `.claude/homeroom-canonical-repo`. Check against
it, not against `origin`:

```sh
git fetch "$(cat .claude/homeroom-canonical-repo)" main
git merge-base --is-ancestor FETCH_HEAD HEAD && echo current || echo behind
```

`behind` means this checkout does not contain the canonical `main`. To answer
a question, read the canonical code instead (`git show FETCH_HEAD:<path>`,
`git grep <pattern> FETCH_HEAD`). To change code, start from the exact base
commit your Homeroom work order gives, and never merge or rebase onto the
canonical `main` yourself: which commit a change is diffed against decides
what the group votes on. With the Homeroom connector, `get_checkout_status`
answers the same question.

A session-start hook (`.claude/hooks/homeroom-freshness.sh`, see `.claude/README.md`) runs
this check for you and tells you when you are behind. It is silent offline, so
its silence is not proof the checkout is current. Inside Homeroom (its dev
chat, and Homeroom bot's builds) the platform fixes the base commit, and none
of this applies.

## Starter template

The screen this app currently ships — the "Starter template" hero with
the app's thumbnail tile and the plain-English note on how the app gets
built (by asking Homeroom bot) — is placeholder content from the
Homeroom starter template, not product intent.

When the user asks for their first real feature, REPLACE the template
screen rather than building alongside it:

- remove the `usernode-starter-notice@1` block in `public/index.html`
  (both sentinel comments and everything between them),
- rewrite `README.md` to describe the actual app.

Keep the `usernode-dev-console@1` forwarder `<script>` when rewriting the
HTML — that block is platform infrastructure, not template content. So is
the bridge `<script>`. The design kit is not placeholder either: build the
real app with it, and fill in "## Design" below.

The screen has a light and a dark look and follows the viewer's Homeroom
theme, switching live when they change it: the theme `<script>` right after
the bridge tag sets a `dark` class on `<html>`. Keep that script, and give
everything you build both looks (the design kit's colour tokens carry both), unless one
fixed look is the point of this app, like a game's own scene; then say so
under "## Design" below. Unless a request asks for one, add
no theme picker: the viewer's Homeroom setting is the control. "The
platform's light/dark theme inside the app frame" in the platform
conventions has the details.

If a rule below this line conflicts with the hosted conventions, the
hosted conventions win. This file is **app-specific** — write down
things about *this* app that belong in the repo: product intent,
data-model quirks, style preferences, opt-in policies (e.g. which
tables you've marked private), etc.

---

## About Home Studio

A free, open-source graphic design editor that runs entirely in the browser.
People make a design at a size they set, add text, shapes and images, then
move, resize, rotate, align and group them, across pages, with undo and
autosave to their own device (IndexedDB only). Phase 1 is the core editor:
exporting, templates, sharing and sync come in later phases. No accounts,
no network features, no paid anything.

## Design

The workspace is a quiet neutral grey with a dotted canvas board, so the
white page and its colours stand out. The action colour is a clear blue,
used for selection, handles, the active tool and the primary button. A pink
guide colour appears only for live alignment lines and their position tags,
the way design tools have long marked guides.

- **Palette:** neutrals warm grey (`ground` 244 244 242 light / 22 22 21
  dark, `surface` white / 34 34 32, `raised` 236 236 233 / 46 46 43);
  accent clear blue (`accent` 37 84 214 / 125 160 255, with `on-accent`
  white / deep blue 12 26 72); guide pink (`guide` 219 39 119 / 244 114 182)
  used only for snap lines and their tags.
- **Signature element:** the selection frame — square resize handles on the
  edges and round rotation handles just outside each corner, with the pink
  guides that appear live while dragging.
- **Type scale:** `text-title`, `text-heading`, `text-body`, `text-small`,
  system-ui throughout.
- Both looks follow the viewer's Homeroom theme; the page keeps its own
  background colour in both. The editor is a full-window app (not a
  `page-column` screen): canvas centre, layers one side, properties the
  other, tools along the top; on a phone the panels stack below the canvas.

## App-specific conventions

- Elements live in a flat bottom-first array per page; groups nest children
  with coordinates relative to the group's own origin.
- One history entry per finished gesture (or discrete edit), never per
  pointer move; drag gestures preview through the reducer without history
  and push a `push-before` snapshot when the gesture ends.
- Images are Blobs in a separate IndexedDB store keyed by id; deleting a
  design deletes its images.
- The staging demo seeds a separate `home-studio-demo` database, only when
  `GET /api/env` says staging and the URL has `?demo=1`.
- Style fields are optional on every element (`gradient`, `shadow`,
  `strokeStyle`, text effects, image `crop`/`mask`/`adjust`), so older
  designs render unchanged; `doc/style.js` turns them into CSS.
- Bundle only assets under a licence listed in `assets/catalog.js`
  `LICENSES` (CC0, ISC, OFL today), each with its source and attribution;
  `tests/assets.test.js` checks every item. Home Studio's own drawings are CC0.
- Imported files, components and favourites live in the `assets`,
  `components` and `prefs` stores. Anything placed on a page gets its own
  copy of its image blob, so deleting a design never breaks the library or
  another design.
- The library is its own lazily loaded chunk, and bundled fonts load only
  when something uses them; keep both that way.

The kit is in `styles/tailwind-input.css`: colour tokens with a light and
a dark value (named in `tailwind.config.js`), and a few components
(`page-column`, `btn-primary`, `btn-secondary`, `field`, `list`, `list-row`,
`card`, `section-label`, `skeleton`, `state-empty`, `state-error`).
Re-theme by changing the token values there, keeping every text pair at
4.5:1 or more in both looks.

- Colour comes only from the tokens (`bg-ground`, `bg-surface`,
  `text-fg`, `text-muted`, `border-line`, `bg-accent` with
  `text-on-accent`, ...): never a raw hex value or a stock palette class.
- Tap targets are at least 44 px; the buttons and fields already are.
- A field's label says what it is; its placeholder, if any, is an example
  that says so ("e.g. 5.0"), never a bare value that could pass for one
  already entered.
- Each screen sits in `page-column`, one centred column on a wide window.
- Every screen that loads data has honest loading, empty and error states.
  Never show the empty state while loading or after a failure; an error says
  what failed, what still works, and offers Retry. Loading has the content's
  own shape (its rows, with `skeleton` bars for their text).
- Seed obviously fake staging demo data so the populated screen can be seen
  ("Staging mock data" in the platform conventions).
- No cards in cards, no uppercase eyebrows, no emoji as icons.
- A header that shows the app's own mark shows the project's icon there
  (the emoji in `dapp.json`'s `icon` block) or no mark at all: never an
  empty tile, and never `brand/icon.png`, which the app does not serve.

## App-specific conventions

_(optional — e.g. "all currency values stored as integer cents, not
floats"; "the `posts` table is append-only"; "avoid adding new
dependencies"; etc.)_
