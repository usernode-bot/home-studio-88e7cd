// The Home Studio node adapter: a small server you (or your group) run —
// see selfhost/ in this repo. Designs go up as Home Studio project files,
// byte for byte what File > Download project file makes, so the node is a
// dumb, inspectable store. A bearer key guards writes when the node has
// one; reads stay open, so another device only needs the address.

import { readCapped, cleanConfig, cleanBaseUrl, fetchTimed } from './interface.js';

const FIELDS = [
  { key: 'url', label: 'Node address', placeholder: 'https://studio.example.com' },
  { key: 'key', label: 'Access key (optional)', placeholder: 'a long key from the node', secret: true },
];

const headers = (cfg, body) => {
  const h = body ? { 'content-type': 'application/octet-stream' } : {};
  if (cfg.key) h.authorization = 'Bearer ' + cfg.key;
  return h;
};

export default {
  describe: () => ({
    kind: 'node',
    label: 'A Home Studio node',
    hint: 'A small server you run yourself (selfhost/ in the repository). Designs sync as project files.',
    fields: FIELDS,
  }),
  normalize: (cfg) => {
    const out = cleanConfig(cfg, FIELDS.map((f) => f.key));
    out.url = cleanBaseUrl(out.url);
    if (!out.url) throw new Error('Enter the node address, starting with https://');
    return out;
  },
  ping: async (cfg) => {
    const res = await fetchTimed(cfg.url + '/api/v1/ping', { headers: headers(cfg) });
    // The ok check comes first: an error page is not JSON, and the status
    // is the message worth keeping.
    if (!res.ok) throw new Error('The node answered, but not as a Home Studio node (' + res.status + ').');
    const data = await res.json();
    if (data.ok !== true) throw new Error('The node answered, but not as a Home Studio node.');
    return { ok: true, name: data.name || 'Home Studio node' };
  },
  list: async (cfg) => {
    const res = await fetchTimed(cfg.url + '/api/v1/designs', { headers: headers(cfg) });
    if (!res.ok) throw new Error('The design list could not be read (' + res.status + ').');
    const data = await res.json();
    if (!Array.isArray(data.designs)) throw new Error('The design list could not be read.');
    return data.designs.filter((d) => d && typeof d.id === 'string' && typeof d.updatedAt === 'number');
  },
  get: async (cfg, id) => {
    const res = await fetchTimed(cfg.url + '/api/v1/designs/' + encodeURIComponent(id), { headers: headers(cfg) });
    return readCapped(res, 'The design');
  },
  put: async (cfg, id, bytes) => {
    const res = await fetchTimed(cfg.url + '/api/v1/designs/' + encodeURIComponent(id), {
      method: 'PUT', headers: headers(cfg, true), body: bytes,
    });
    if (!res.ok) throw new Error('The node refused the design (' + res.status + ').');
    const data = await res.json();
    return { updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : Date.now() };
  },
  delete: async (cfg, id) => {
    const res = await fetchTimed(cfg.url + '/api/v1/designs/' + encodeURIComponent(id), {
      method: 'DELETE', headers: headers(cfg),
    });
    if (!res.ok && res.status !== 404) throw new Error('The node refused to delete it (' + res.status + ').');
  },
  putBlob: async (cfg, bytes) => {
    const cid = (await import('../../io/cid.js')).cidOfBytes(bytes);
    const res = await fetchTimed(cfg.url + '/api/v1/blobs/' + cid, {
      method: 'PUT', headers: headers(cfg, true), body: bytes,
    });
    if (!res.ok) throw new Error('The node refused the file (' + res.status + ').');
    return { cid };
  },
  getBlob: async (cfg, cid) => {
    const res = await fetchTimed(cfg.url + '/api/v1/blobs/' + encodeURIComponent(cid), { headers: headers(cfg) });
    return readCapped(res, 'The file');
  },
};