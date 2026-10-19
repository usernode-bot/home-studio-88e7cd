// The outbox: changes waiting to go to the remote store, kept in
// IndexedDB (the `outbox` store) so they survive a reload and flush the
// moment the connection is back. Each row is one finished edit: what to
// send, collected at the moment it was made. Nothing here is ever sent
// for a 'local' adapter — the outbox only exists when a remote store is
// set up.

import { uid } from '../../doc/model.js';

// kinds: 'design' (the whole design as a project payload) | 'delete'.
// Rows carry the payload they need; `tries` grows when the store refuses.
// payload for 'design': { design, images: [{ id, type, bytes }] } —
// exactly what collectProject returns; serialization happens at flush
// time so a format fix reaches queued rows too.

export async function enqueue(db, kind, designId, payload) {
  const row = { id: uid(), kind, designId, payload, queuedAt: Date.now(), tries: 0 };
  await db.put('outbox', row);
  return row;
}

export async function listOutbox(db) {
  if (!db) return [];
  const rows = await db.getAll('outbox');
  return rows.sort((a, b) => a.queuedAt - b.queuedAt);
}

export async function outboxCount(db) {
  if (!db) return 0;
  return db.count('outbox');
}

export async function removeQueued(db, id) {
  await db.delete('outbox', id);
}

// Drop rows for a design that no longer exists anywhere.
export async function clearDesign(db, designId) {
  for (const row of await listOutbox(db)) {
    if (row.designId === designId) await db.delete('outbox', row.id);
  }
}

// Flush: send every row to the adapter, oldest first, one at a time.
// A row that fails stays queued (tries grows); the rest keep going.
// `send(row)` is the adapter call, provided by the sync engine. Resolves
// { sent, failed }.
export async function flushOutbox(db, send) {
  let sent = 0;
  let failed = 0;
  for (const row of await listOutbox(db)) {
    try {
      await send(row);
      await db.delete('outbox', row.id);
      sent += 1;
    } catch {
      await db.put('outbox', { ...row, tries: row.tries + 1 });
      failed += 1;
    }
  }
  return { sent, failed };
}