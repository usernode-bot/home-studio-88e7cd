// Gallery sources: where the community gallery lists designs from. One
// source ships in the app (the staging demo, so the screen can be
// reviewed without any server); people add self-hosted nodes by their
// address. The list lives in the 'gallery-sources' pref, so it stays on
// this device like everything else.

import { getPref, setPref } from '../persist/db.js';

export const GALLERY_SOURCES_PREF = 'gallery-sources';
export const DEMO_SOURCE_ID = 'demo';

// The built-in source: kind 'demo' reads from the demo source built in
// demo.js (client-side, ?demo=1 only) — no server, no network.
export const builtInSources = () => [
  { id: DEMO_SOURCE_ID, kind: 'demo', name: 'Demo gallery', builtIn: true },
];

const cleanSource = (raw) => {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.id === DEMO_SOURCE_ID) return null; // the demo source is not storable
  if (raw.kind !== 'node') return null;
  const url = typeof raw.url === 'string' ? raw.url.trim().replace(/\/+$/, '') : '';
  if (!/^https?:\/\//.test(url)) return null;
  return {
    id: typeof raw.id === 'string' && raw.id.length <= 60 ? raw.id : null,
    kind: 'node',
    name: String(raw.name || '').trim().slice(0, 80) || url.replace(/^https?:\/\//, '').slice(0, 80),
    url,
    addedAt: typeof raw.addedAt === 'number' ? raw.addedAt : Date.now(),
  };
};

export async function loadSources(db) {
  const stored = ((await getPref(db, GALLERY_SOURCES_PREF)) || []).map(cleanSource).filter(Boolean);
  for (const s of stored) if (!s.id) s.id = `node-${s.addedAt.toString(36)}`;
  return [...builtInSources(), ...stored];
}

export async function saveSources(db, sources) {
  await setPref(db, GALLERY_SOURCES_PREF, sources.filter((s) => s.kind === 'node'));
}

// Add a node source. Returns the source, or throws with a person-actionable
// message when the address is not usable.
export async function addSource(db, { url, name }) {
  const clean = cleanSource({ kind: 'node', url, name });
  if (!clean) throw new Error('Enter the gallery address of a Home Studio node, starting with http:// or https://.');
  const sources = await loadSources(db);
  if (sources.some((s) => s.url === clean.url)) throw new Error('That gallery is already in the list.');
  clean.id = `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  await saveSources(db, [...sources, clean]);
  return clean;
}

export async function removeSource(db, id) {
  const sources = await loadSources(db);
  await saveSources(db, sources.filter((s) => s.id !== id));
}