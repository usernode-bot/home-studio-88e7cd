# Self-hosting a Home Studio node

Home Studio is a local-first editor: designs live in the browser's own
storage, and nothing leaves the device unless a person aims it somewhere.
A self-hosted node is one of those places. It is three small programs in
[`selfhost/`](../selfhost/), none of which know anything about you:

| Program | Port | What it does |
|---|---|---|
| `store.js` | 8787 | Stores design project files and content-addressed blobs, and serves the community gallery |
| `signal.js` | 8788 | Relays WebRTC signaling so several browsers can find each other for collaboration |
| `gallery.js` | (mounted by `store.js`) | The gallery's index and moderation routes |

The node holds **only what people send it**: design files, image blobs,
published gallery items, and (for a moment, during connection setup)
signaling descriptions. There are no accounts, no tracking, and no
analytics.

## Running it

With Node 18 or later:

```sh
cd selfhost
npm install
node store.js     # the store and the gallery, on :8787
node signal.js    # collaboration signaling, on :8788 (optional)
```

With Docker:

```sh
cd selfhost
docker build -t home-studio-node .
docker run -p 8787:8787 -v home-studio-data:/data home-studio-node
# collaboration signaling, if you want it:
docker run -p 8788:8788 home-studio-node node signal.js
```

## Configuration

Everything is environment variables; there is no config file.

| Variable | Used by | Default | Meaning |
|---|---|---|---|
| `PORT` | both | `8787` / `8788` | The port to listen on |
| `HOME_STUDIO_DATA` | `store.js` | `./data` | Where designs, blobs and gallery items are written |
| `HOME_STUDIO_KEY` | `store.js` | *(unset)* | A bearer key. When set, **writes** (saving, deleting, storing blobs) need `Authorization: Bearer <key>`; reads stay open. When unset, anyone who can reach the node can write to it |
| `HOME_STUDIO_ADMIN_KEY` | `store.js` | *(unset)* | The gallery's moderation key. When set, publishing to `/api/gallery` needs it in `x-home-studio-admin`. When unset, publishing is refused entirely |

Pick a long random key (`openssl rand -hex 24`, for example). The app
never needs the node's keys: a person pastes the node's **address** (and,
if the node has one, the access key) into the app's Remote storage
dialog, and the gallery's admin key only when publishing to its gallery.

## TLS and reverse proxy

Browsers open `wss://` sockets from secure pages and fetch cross-origin
without trouble, but run TLS in front of the node anyway. Any reverse
proxy works; the node speaks plain HTTP and WebSocket and sets permissive
CORS headers (`*`) because the app is a page on a different origin.
Example nginx locations:

```nginx
location / {           # store.js
    proxy_pass http://127.0.0.1:8787;
    client_max_body_size 64m;   # designs and blobs are capped at 64 MB
}
location /signal {     # signal.js, if you terminate the path here
    proxy_pass http://127.0.0.1:8788;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

## What each part stores

Under `HOME_STUDIO_DATA`:

- `designs/<id>.hsproj` — design project files, byte for byte what the
  app's File > Download project file writes. The id is the design's id in
  the person's browser.
- `blobs/<cid>` — image files, addressed by their
  [CID](./storage-adapters.md) (the SHA-256 of the bytes). Anything else
  is refused at the door.
- `gallery/<id>.json` and `gallery/index.json` — published gallery items
  and the index built from them.

All of it is plain files: back the directory up like any other folder,
and inspect a design with any JSON viewer.

## Moderating the gallery

Publishing is off until you set `HOME_STUDIO_ADMIN_KEY`; then anyone with
the key can publish, and the item appears in the index at once. To remove
an item, delete its `gallery/<id>.json` and drop its row from
`gallery/index.json`. Moderation is deliberately manual: you are the
moderator, and the node does not decide what may be shown.

## Cross-network collaboration

WebRTC connects browsers on the same network with no outside help (the
app gathers host candidates only). For people behind different networks,
add STUN/TURN to the node's reach by editing
[`web/src/net/webrtc.js`](../web/src/net/webrtc.js)'s `RTC_CONFIG`
(`iceServers`) — the app hands whatever ICE servers a session is given to
its connections. A TURN server is the only component that can relay media
for peers who cannot connect directly; everything else stays
peer-to-peer.