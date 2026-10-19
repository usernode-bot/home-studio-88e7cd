// The "this device" adapter: designs already live in IndexedDB here, so
// there is nothing to fetch and nothing to send. It exists so the sync
// dialog can show where designs are, and so the sync engine can treat
// "not set up yet" as an adapter like any other.

import { cleanConfig } from './interface.js';

export default {
  describe: () => ({
    kind: 'local',
    label: 'This device only',
    hint: 'Designs are saved in this browser. No account, no network.',
    fields: [],
  }),
  normalize: (cfg) => cleanConfig(cfg, []),
  ping: async () => ({ ok: true, name: 'This device' }),
  // There is no remote list and nothing to send: the sync engine checks
  // `remote` support before using these.
};