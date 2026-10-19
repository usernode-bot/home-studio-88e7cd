// Publishing a design to a gallery. Two destinations: a self-hosted node
// that moderates with an admin key, or an IPFS-compatible store the
// device is already synced to (the item's CID is its address). Both take
// the same item bytes from io/gallery.js. Nothing publishes from this
// device without the person choosing to.

import { buildGalleryItem } from '../io/gallery.js';

// itemBytes: the envelope from buildGalleryItem(). Returns the node's
// answer ({ id }).
export async function publishToNode({ url, adminKey, itemBytes }) {
  const base = String(url || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(base)) throw new Error('Enter the gallery address of a Home Studio node, starting with http:// or https://.');
  if (!adminKey) throw new Error('This gallery needs its admin key to publish. Ask whoever runs the node.');
  const res = await fetch(`${base}/api/gallery`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'x-home-studio-admin': adminKey },
    body: itemBytes,
  });
  if (res.status === 401 || res.status === 403) throw new Error('The admin key was not accepted by that node.');
  if (res.status === 413) throw new Error('That gallery refused the item: it is too large.');
  if (!res.ok) throw new Error(`The gallery answered ${res.status}.`);
  const data = await res.json();
  return { id: data && typeof data.id === 'string' ? data.id : null, url: base };
}

// Publish to an IPFS-compatible adapter this device already has a
// connection to (set up under Remote storage). The CID comes back as the
// item's address; a node gallery can then index it by that CID.
export async function publishToIpfs({ adapter, cfg, design, images, fonts, item }) {
  if (!adapter || adapter.describe().kind !== 'ipfs') throw new Error('Set up an IPFS-compatible store under Remote storage first.');
  const bytes = buildGalleryItem({ design, images, fonts, item });
  const out = await adapter.putBlob(cfg, bytes);
  if (!out || !out.cid) throw new Error('The store did not return an address for the item.');
  return { cid: out.cid, bytes };
}

// Build item bytes for the current design (shared by both destinations).
export function itemBytesFor({ design, images, fonts, item }, date = new Date()) {
  return buildGalleryItem({ design, images, fonts, item }, date);
}