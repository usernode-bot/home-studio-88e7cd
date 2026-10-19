# Storage adapters

A design is saved on **this device** (IndexedDB) by default. Sync is
opt-in: the person picks a remote store, and the app pushes and pulls
design files to it. The store side is pluggable — an **adapter** is a
small set of async functions, and three kinds ship:

| Kind | Where | What it is |
|---|---|---|
| `local` | this device | The default. No network, no adapter calls beyond a ping |
| `node` | a Home Studio node | A self-hosted server ([`selfhost/store.js`](../selfhost/store.js)); designs sync as project files |
| `ipfs` | an IPFS-compatible store | A Kubo RPC API (or anything speaking it). Content-addressed: every file gets a CID |

## The interface

An adapter is a plain object of async functions over a config object
(`web/src/persist/adapters/`). It never touches the database and holds no
state between calls:

```js
describe()            // { kind, label, hint, fields: [{ key, label, placeholder?, secret? }] }
normalize(cfg)        // trimmed config with defaults, or throws with a readable message
ping(cfg)             // { ok, name? } — the connection works
list(cfg)             // [{ id, updatedAt }] — what the store holds (ipfs: nothing; the map lives in prefs)
get(cfg, id)          // Uint8Array — a design file's bytes
put(cfg, id, bytes)   // { updatedAt } (node) or { cid } (ipfs)
delete(cfg, id)       // remove a design
putBlob(cfg, bytes)   // { cid } — store loose bytes (optional)
getBlob(cfg, cid)     // Uint8Array (optional)
```

Rules the adapters keep:

- **Everything fetched is untrusted.** Responses are size-capped
  (`MAX_REMOTE_BYTES`, 64 MB) before parsing, and design bytes go through
  the same import whitelist as an opened file
  ([`io/project.js`](../web/src/io/project.js)).
- **Config is sanitized, never trusted.** `cleanConfig` keeps only the
  fields an adapter declares, trimmed and length-capped; `cleanBaseUrl`
  accepts only plain `http(s)` URLs, since a config value goes straight
  into `fetch()`.
- **A missing optional capability is `undefined`**, never a throwing
  stub, so callers can feature-detect.

Adding a kind is registering it in `ADAPTER_KINDS` and dropping an object
in `web/src/persist/adapters/`; the Remote storage dialog and the sync
engine pick it up from the registry.

## How sync works

One design, two copies (here and on the store), the last-synced time and
a manifest per design in this device's prefs. `planSync` decides from the
timestamps:

| Local newer | Remote newer | Action |
|---|---|---|
| yes | no | push |
| no | yes | pull |
| yes | yes | push and pull — a real edit conflict |
| neither changed | | even: nothing to do |

A real edit conflict (both copies edited since the last sync) keeps **both
versions**: yours stays under the design's own name, theirs is added
beside it as a kept copy (`"Poster" (kept copy, 2026-10-19)`) — nothing
is silently overwritten in either direction. A push that fails leaves the
change **queued**: one pending row per design, retried on the next sync.

For the `ipfs` kind there is no listing — content stores answer by
address — so the design-id-to-CID map lives in this device's prefs, and a
design that was synced from another device is opened by pasting its CID.

## CIDs

Bytes stored on IPFS-compatible stores are addressed by a CIDv1, raw
codec, base32 (`bafkrei…`), computed with the browser's own crypto
([`io/cid.js`](../web/src/io/cid.js)) — the address is decided by the
bytes and nothing else. The self-hosted node uses the same addressing for
its blob store, so a design synced to either place addresses its images
the same way.