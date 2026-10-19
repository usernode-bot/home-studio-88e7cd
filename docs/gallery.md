# The community gallery

The gallery lets a person browse designs other people chose to publish,
open one, and remix it into their own copy — all opt-in, all
local-first. Nothing is fetched until the gallery is opened, and nothing
is published without the person aiming it at a destination.

## Sources

A gallery source is a place items come from. Two kinds:

- **A Home Studio node** (`kind: 'node'`) — a self-hosted node's
  `/api/gallery` routes. Adding one to the app takes its address, e.g.
  `https://studio.example.com`. The built-in demo source (below) is a
  node-shaped stand-in.
- **A demo source** (`kind: 'demo'`) — built into the app, only on the
  staging demo (`?demo=1`), no network at all.

Sources are kept in this device's prefs; the demo source is built in and
cannot be removed. Adding a source accepts only http(s) addresses, and
refuses a duplicate. Nothing in a listing row is trusted: titles, authors
and tags are cleaned and capped when read, and a row that cannot be read
is skipped, never fatal.

An item is read as bytes and parsed with the same front door everything
else goes through: the envelope is validated, the design inside goes
through the project-file import whitelist, and anything the reader does
not understand comes back as a warning, not a crash.

## The item envelope

A published item is one JSON document
([`io/gallery.js`](../web/src/io/gallery.js)):

```json
{
  "format": "home-studio+json", "kind": "gallery-item", "version": 1,
  "app": { "name": "Home Studio" }, "exportedAt": "…",
  "item": {
    "id": "g-…", "title": "…", "author": "…",
    "licence": "CC0-1.0", "tags": ["poster"],
    "description": "…", "createdAt": 0
  },
  "project": {
    "format": "home-studio+json", "kind": "project", "version": 1,
    "design": { … the design … },
    "images": [ { "id": "…", "type": "image/png", "data": "<base64>" } ],
    "fonts":  [ { "id": "…", "name": "…", "type": "font/…", "data": "<base64>" } ]
  }
}
```

The `project` part is byte for byte a project file's design, images and
fonts, so opening an item reuses the whole project-file reader and its
import whitelist. That also means the images ride **inside** the item:
what was published is exactly what opens, with nothing to fetch later
(and the 25 MB cap on item bytes is where heavy designs stop).

Metadata is cleaned and capped at build time: title 120, author 80, tags
10 × 24 (lowercased), description 600. **A title and one of three
licences are required** — `CC0-1.0`, `CC-BY-4.0`, `CC-BY-SA-4.0`. An
author who leaves their name out publishes as Anonymous. A remixed item
carries the design's `credit` line untouched, so the person before them
keeps the attribution they asked for.

## Publishing

The Publish dialog in the gallery offers the destinations the device has:

- **A node's gallery** — `PUT /api/gallery` with the item bytes and the
  node's admin key in `x-home-studio-admin`. A node without its admin key
  set refuses all publishing (403); a wrong key is refused too (401).
- **An IPFS-compatible store** — the device must already have the store
  connected under Remote storage. The item's bytes are stored and the
  returned **CID is the item's address**; anything that has the CID can
  read the item.

Either way the bytes are exactly what `buildGalleryItem` made, so what
was reviewed is what was published.

## Moderation

On a self-hosted node, moderation is the runner, by hand: publish needs
the admin key, and removing an item is deleting its file and index row
([self-hosting.md](./self-hosting.md) has the details). The app does not
curate; a source is only as moderated as whoever runs it.

## The demo gallery

The staging demo (`?demo=1`) ships a built-in source with six items,
authored "Demo Person" under a listed licence, built as **real gallery
envelopes** through the same builder and parser as everything else — so
browsing, opening and remixing are exercised end to end with no network.