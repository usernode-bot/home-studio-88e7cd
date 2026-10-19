// The storage adapter interface: what every remote store answers to, so
// designs can live on this device, on a self-hosted node, or on an
// IPFS-compatible store without the app caring which. An adapter is a set
// of async functions over a config object; it never touches the database
// and never holds state between calls.

// kinds: 'local' (this device only), 'node' (a Home Studio node), 'ipfs'
// (Kubo RPC or compatible). Config fields each adapter declares itself.
export const ADAPTER_KINDS = ['local', 'node', 'ipfs'];

// Every adapter answers the same questions:
//   describe()      -> { kind, label, hint, fields: [{ key, label, placeholder?, secret? }] }
//   normalize(cfg)  -> config with defaults and trimmed values, or throws
//   ping(cfg)       -> { ok, name?, detail? } — the connection works
//   list(cfg)       -> [{ id, name, updatedAt }] — what the store holds
//   get(cfg, id)    -> Uint8Array — a design file's bytes
//   put(cfg, id, bytes) -> { updatedAt } or { cid } — store a design file
//   delete(cfg, id) -> removes a design from the store
//   putBlob(cfg, bytes) -> { cid } — store loose bytes (optional)
//   getBlob(cfg, cid)   -> Uint8Array (optional)
// A missing optional capability is `undefined`, never a throwing stub.
//
// Everything an adapter fetches is untrusted: sizes are capped before the
// JSON is parsed, and the parsed file goes through the same whitelist as
// an opened file (io/project.js).

export const MAX_REMOTE_BYTES = 64 * 1024 * 1024;

// Read a fetch response as bytes, refusing anything oversized or empty.
export async function readCapped(res, what) {
  if (!res.ok) throw new Error(what + ' failed (' + res.status + ')');
  const len = Number(res.headers.get('content-length') || 0);
  if (len > MAX_REMOTE_BYTES) throw new Error(what + ' is too large to read');
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_REMOTE_BYTES) throw new Error(what + ' is too large to read');
  if (!buf.byteLength) throw new Error(what + ' came back empty');
  return new Uint8Array(buf);
}

// A config is only ever these fields, with sane lengths — it came from a
// form or from a prefs row, and it is about to go into a fetch URL.
// Fields are given as { key } objects or plain key strings.
export function cleanConfig(cfg, fields) {
  const out = {};
  for (const f of fields) {
    const key = typeof f === 'string' ? f : f.key;
    const v = cfg ? cfg[key] : undefined;
    out[key] = typeof v === 'string' ? v.trim().slice(0, 500) : '';
  }
  return out;
}

// A base URL a person typed: keep it, without a trailing slash. Refuses
// anything that is not a plain http(s) URL — it goes into fetch().
export function cleanBaseUrl(v) {
  const s = String(v || '').trim().replace(/\/+$/, '');
  if (!s) return '';
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.origin + u.pathname.replace(/\/+$/, '');
  } catch {
    return '';
  }
}