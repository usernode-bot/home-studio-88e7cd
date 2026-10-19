// The adapter registry: one place that knows every store kind, so the
// dialog and the sync engine can describe and normalize by kind without
// importing each adapter.

import local from './local.js';
import remote from './remote.js';
import ipfs from './ipfs.js';

export const ADAPTERS = { local, node: remote, ipfs };

export function getAdapter(kind) {
  return ADAPTERS[kind] || null;
}

export function describeAdapter(kind) {
  const a = ADAPTERS[kind];
  return a ? a.describe() : null;
}