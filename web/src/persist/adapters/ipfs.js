// The IPFS adapter: talks Kubo RPC (the API port of an IPFS node —
// "ipfs add" / "ipfs cat" over HTTP), so it works with a local IPFS
// Desktop node, a self-hosted Kubo, or anything speaking the same API.
// Stores are content-addressed: put() returns the CID, and the sync layer
// keeps the design-id-to-CID map (in prefs), because IPFS has no listing.

import { readCapped, cleanConfig, cleanBaseUrl } from './interface.js';
import { cidOfBytes } from '../../io/cid.js';

const FIELDS = [
  { key: 'url', label: 'Kubo RPC address', placeholder: 'http://127.0.0.1:5001' },
  { key: 'pin', label: 'Pin what you add (recommended)', placeholder: 'yes', secret: false },
];

// Kubo's /api/v0 endpoints take arguments as query params and answer
// JSON (add) or raw bytes (cat).
const url = (cfg, path, params) => {
  const qs = new URLSearchParams(params || '');
  return cfg.url + '/api/v0' + path + (qs.toString() ? '?' + qs.toString() : '');
};

export default {
  describe: () => ({
    kind: 'ipfs',
    label: 'IPFS (Kubo RPC)',
    hint: 'The RPC API of an IPFS node (port 5001). Content-addressed: every design gets a CID.',
    fields: FIELDS,
  }),
  normalize: (cfg) => {
    const out = cleanConfig(cfg, ['url']);
    out.url = cleanBaseUrl(out.url);
    if (!out.url) throw new Error('Enter the Kubo RPC address, starting with http://');
    out.pin = !cfg || cfg.pin !== 'no';
    return out;
  },
  ping: async (cfg) => {
    const res = await fetch(url(cfg, '/id'));
    const data = await res.json();
    if (!res.ok || !data.ID) throw new Error('That address did not answer as a Kubo RPC API.');
    return { ok: true, name: 'IPFS node ' + String(data.ID).slice(0, 8) };
  },
  // No listing on a content store: the CID map lives in this device's
  // prefs (see adapters/sync.js).
  get: async (cfg, cid) => {
    const res = await fetch(url(cfg, '/cat', { arg: cid }));
    return readCapped(res, 'The design');
  },
  put: async (cfg, _id, bytes) => {
    const cid = await cidOfBytes(bytes);
    const form = new FormData();
    form.append('file', new Blob([bytes]), cid);
    const res = await fetch(url(cfg, '/add', { pin: cfg.pin ? 'true' : 'false', cidVersion: 1, rawLeaves: 'true' }), {
      method: 'POST', body: form,
    });
    const data = await res.json();
    if (!res.ok || !data.Hash) throw new Error('The IPFS node refused the design.');
    return { cid: data.Hash };
  },
  delete: async (cfg, cid) => {
    await fetch(url(cfg, '/pin/rm', { arg: cid }), { method: 'POST' });
  },
  async putBlob(cfg, bytes) {
    const out = await this.put(cfg, null, bytes);
    return { cid: out.cid };
  },
  getBlob: async (cfg, cid) => {
    const res = await fetch(url(cfg, '/cat', { arg: cid }));
    return readCapped(res, 'The file');
  },
};