// Remote storage: the sync plan, the outbox queue, CIDs, and the
// adapters' field cleaning. All pure or IndexedDB-backed, no network.

import 'fake-indexeddb/auto';
import { describe, it, expect, vi } from 'vitest';
import { planSync, conflictCopyName, loadSyncPref, saveSyncPref, queueChange, SYNC_PREF } from '../web/src/persist/adapters/sync.js';
import { enqueue, listOutbox, clearDesign, flushOutbox } from '../web/src/persist/adapters/queue.js';
import { getAdapter, describeAdapter, ADAPTERS } from '../web/src/persist/adapters/index.js';
import { cidOfBytes, cidOfText, looksLikeCid } from '../web/src/io/cid.js';
import { openDesignsDb, putDesign, getDesign, setPref, getPref } from '../web/src/persist/db.js';
import { newDesign } from '../web/src/doc/model.js';
import { utf8 } from '../web/src/io/binary.js';

let n = 0;
const freshDb = () => openDesignsDb(false, 'test-ad-' + n++);

describe('sync plan', () => {
  it('pushes when only this device changed', () => {
    const plan = planSync(
      [{ id: 'a', name: 'A', updatedAt: 10 }],
      [],
      { a: 5 },
    );
    expect(plan).toEqual([{ id: 'a', name: 'A', action: 'push' }]);
  });

  it('pulls when only the remote changed, and when the design is new there', () => {
    const plan = planSync(
      [{ id: 'a', name: 'A', updatedAt: 10 }],
      [{ id: 'a', name: 'A', updatedAt: 20 }, { id: 'b', name: 'B', updatedAt: 3 }],
      { a: 10 },
    );
    expect(plan.map((p) => [p.id, p.action]).sort()).toEqual([['a', 'pull'], ['b', 'pull']]);
  });

  it('keeps both copies when both sides changed', () => {
    const plan = planSync(
      [{ id: 'a', name: 'A', updatedAt: 20 }],
      [{ id: 'a', name: 'A', updatedAt: 15 }],
      { a: 10 },
    );
    expect(plan).toHaveLength(1);
    expect(plan[0].action).toBe('both');
    expect(plan[0].localUpdatedAt).toBe(20);
    expect(plan[0].remoteUpdatedAt).toBe(15);
  });

  it('does nothing when nothing changed', () => {
    const plan = planSync(
      [{ id: 'a', name: 'A', updatedAt: 10 }],
      [{ id: 'a', name: 'A', updatedAt: 10 }],
      { a: 10 },
    );
    expect(plan).toEqual([]);
  });

  it('names a kept copy with its date', () => {
    const name = conflictCopyName('Poster', 1700000000000);
    expect(name.startsWith('Poster (kept copy, ')).toBe(true);
    expect(name.endsWith(')')).toBe(true);
  });
});

describe('cid', () => {
  it('makes a v1 raw base32 CID that validates', async () => {
    const cid = await cidOfBytes(utf8('hello home studio'));
    expect(looksLikeCid(cid)).toBe(true);
    expect(cid.startsWith('bafkrei')).toBe(true);
    await expect(cidOfText('hello home studio')).resolves.toBe(cid);
  });

  it('differs for different bytes and matches for the same', async () => {
    const a = await cidOfBytes(utf8('one'));
    const b = await cidOfBytes(utf8('two'));
    const a2 = await cidOfBytes(utf8('one'));
    expect(a).not.toEqual(b);
    expect(a).toEqual(a2);
  });

  it('rejects a string that is not a CID', () => {
    expect(looksLikeCid('hello')).toBe(false);
    expect(looksLikeCid('')).toBe(false);
    expect(looksLikeCid('bafkrei!!!not-base32')).toBe(false);
  });
});

describe('adapters', () => {
  it('registers local, node and ipfs with their field lists', () => {
    expect(Object.keys(ADAPTERS).sort()).toEqual(['ipfs', 'local', 'node']);
    const local = describeAdapter('local');
    expect(local.kind).toBe('local');
    expect(getAdapter('node').describe().kind).toBe('node');
    const ipfs = getAdapter('ipfs').describe();
    expect(ipfs.kind).toBe('ipfs');
    expect(ipfs.fields.map((f) => f.key).sort()).toEqual(['pin', 'url']);
    expect(getAdapter('nope')).toBe(null);
    expect(describeAdapter('nope')).toBe(null);
  });

  it('the local adapter answers the questions without any remote', async () => {
    const local = getAdapter('local');
    expect(local.normalize({})).toEqual({});
    expect(local.describe().fields).toEqual([]);
    expect(await local.ping({})).toEqual({ ok: true, name: 'This device' });
    expect(local.put).toBeUndefined();
  });

  it('the node adapter needs an http url; the key is optional and trimmed', () => {
    const node = getAdapter('node');
    expect(() => node.normalize({ url: 'ftp://x', key: 'k' })).toThrow();
    expect(() => node.normalize({ url: '' })).toThrow();
    const cfg = node.normalize({ url: 'https://studio.example.com/', key: 'k' });
    expect(cfg.url).toBe('https://studio.example.com');
    expect(node.normalize({ url: 'https://studio.example.com', key: ' ' }).key).toBe('');
  });

  it('the ipfs adapter needs an http url and takes a yes/no pin', () => {
    const ipfs = getAdapter('ipfs');
    expect(() => ipfs.normalize({ url: 'nope', pin: 'yes' })).toThrow();
    const cfg = ipfs.normalize({ url: 'http://127.0.0.1:5001', pin: 'no' });
    expect(cfg.pin).toBe(false);
    expect(ipfs.normalize({ url: 'http://127.0.0.1:5001' }).pin).toBe(true);
  });
});

describe('outbox and queueing', () => {
  it('keeps queued rows until a flush sends them', async () => {
    const db = await freshDb();
    await enqueue(db, 'design', 'd1', { design: { id: 'd1' } });
    await enqueue(db, 'delete', 'd2', null);
    let rows = await listOutbox(db);
    expect(rows).toHaveLength(2);
    expect(rows[0].kind).toBe('design');
    expect(rows[1].kind).toBe('delete');
    const sent = [];
    const r = await flushOutbox(db, async (row) => { sent.push(row.designId); });
    expect(r).toEqual({ sent: 2, failed: 0 });
    expect(sent).toEqual(['d1', 'd2']);
    expect(await listOutbox(db)).toHaveLength(0);
    rows = await listOutbox(db);
    expect(rows).toHaveLength(0);
  });

  it('keeps insertion order for rows queued in the same millisecond', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
    try {
      const db = await freshDb();
      for (const id of ['a', 'b', 'c', 'd']) await enqueue(db, 'design', id, { v: id });
      const rows = await listOutbox(db);
      expect(rows.map((x) => x.designId)).toEqual(['a', 'b', 'c', 'd']);
      const seqs = rows.map((x) => x.seq);
      expect(seqs.every((s, i) => Number.isFinite(s) && (i === 0 || s > seqs[i - 1]))).toBe(true);
      const sent = [];
      await flushOutbox(db, async (row) => { sent.push(row.designId); });
      expect(sent).toEqual(['a', 'b', 'c', 'd']);
    } finally {
      now.mockRestore();
    }
  });

  it('a failing row stays queued while the rest go out', async () => {
    const db = await freshDb();
    await enqueue(db, 'design', 'd1', null);
    await enqueue(db, 'design', 'd2', null);
    const r = await flushOutbox(db, async (row) => { if (row.designId === 'd1') throw new Error('no'); });
    expect(r).toEqual({ sent: 1, failed: 1 });
    const left = await listOutbox(db);
    expect(left.map((x) => x.designId)).toEqual(['d1']);
    expect(left[0].tries).toBe(1);
  });

  it('clearDesign drops every row for one design, latest-wins queueing', async () => {
    const db = await freshDb();
    await enqueue(db, 'design', 'd1', { v: 1 });
    await enqueue(db, 'design', 'd1', { v: 2 });
    await enqueue(db, 'design', 'd2', { v: 1 });
    await clearDesign(db, 'd1');
    expect((await listOutbox(db)).map((x) => x.designId)).toEqual(['d2']);
  });

  it('queueChange stores nothing for the local kind, one row per design otherwise', async () => {
    const db = await freshDb();
    const d = newDesign('Poster', 400, 400);
    const access = { getImage: async () => null, getAsset: async () => null, getFontBlob: async () => null };
    await queueChange(db, d, access);
    expect(await listOutbox(db)).toHaveLength(0);
    await saveSyncPref(db, { kind: 'node', config: { url: 'https://x.example.com', key: 'k' }, syncedAt: {}, manifest: {} });
    await queueChange(db, d, access);
    await queueChange(db, d, access);
    const rows = await listOutbox(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].payload.design.name).toBe('Poster');
    const pref = await getPref(db, SYNC_PREF);
    expect(pref.kind).toBe('node');
  });

  it('queueChange queues a delete for a removed design', async () => {
    const db = await freshDb();
    const d = newDesign('Gone soon', 400, 400);
    await putDesign(db, d);
    const access = { getImage: async () => null, getAsset: async () => null, getFontBlob: async () => null };
    await saveSyncPref(db, { kind: 'node', config: {}, syncedAt: {}, manifest: {} });
    await queueChange(db, d, access);
    await queueChange(db, { id: d.id, name: d.name }, access, true);
    const rows = await listOutbox(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('delete');
    expect(rows[0].designId).toBe(d.id);
    const pref = await loadSyncPref(db);
    expect(pref.syncedAt[d.id]).toBeUndefined();
  });

  it('the sync pref persists round the db', async () => {
    const db = await freshDb();
    expect((await loadSyncPref(db)).kind).toBe('local');
    await setPref(db, 'sync', { kind: 'ipfs', config: { url: 'http://x' }, syncedAt: {}, manifest: {} });
    expect((await loadSyncPref(db)).kind).toBe('ipfs');
  });
});