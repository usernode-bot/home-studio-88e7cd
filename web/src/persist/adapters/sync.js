// The sync engine: decide what to push and pull between this device and a
// remote adapter, then do it. The plan is a pure function over three
// inputs — the local designs, the remote index, and what this device last
// synced (kept in prefs as the 'sync' pref) — so it is testable without a
// network. One rule decides every conflict: the copy updated most
// recently wins, and the other copy is kept, renamed, so nothing is ever
// lost. Offline edits queue in the outbox and flush first.

import { serializeProject, parseHomeStudioFile, freshCopy, PROJECT_SUFFIX } from '../../io/project.js';
import { safeFileName } from '../../io/binary.js';
import { putDesign, getDesign, putImage, deleteDesign, getPref, setPref, collectProject } from '../db.js';
import { listOutbox, flushOutbox, enqueue, clearDesign } from './queue.js';

export const SYNC_PREF = 'sync';

// prefs['sync'] = { kind, config, syncedAt: { [designId]: ts },
//                   manifest: { [designId]: cid }, outboxPaused? }
export async function loadSyncPref(db) {
  return (await getPref(db, SYNC_PREF)) || { kind: 'local', config: {}, syncedAt: {}, manifest: {} };
}

export async function saveSyncPref(db, pref) {
  await setPref(db, SYNC_PREF, pref);
}

// ── The plan (pure) ──────────────────────────────────────────────────────

// local: [{ id, name, updatedAt }]; remote: [{ id, name, updatedAt }];
// synced: { [id]: lastSyncedUpdatedAt }. Returns per-design actions:
//   push          this device has the newer copy (or the remote lacks it)
//   pull          the remote has the newer copy (or this device lacks it)
//   both          both changed since the last sync: keep both
//   even          nothing to do
export function planSync(local, remote, synced) {
  const remoteById = new Map(remote.map((d) => [d.id, d]));
  const localById = new Map(local.map((d) => [d.id, d]));
  const plan = [];
  for (const d of local) {
    const last = synced[d.id] || 0;
    const r = remoteById.get(d.id);
    if (!r) {
      if (d.updatedAt > last) plan.push({ id: d.id, name: d.name, action: 'push' });
      continue;
    }
    const localChanged = d.updatedAt > last;
    const remoteChanged = r.updatedAt > last;
    if (localChanged && remoteChanged) plan.push({ id: d.id, name: d.name, action: 'both', localUpdatedAt: d.updatedAt, remoteUpdatedAt: r.updatedAt });
    else if (localChanged) plan.push({ id: d.id, name: d.name, action: 'push' });
    else if (remoteChanged) plan.push({ id: d.id, name: d.name, action: 'pull' });
  }
  for (const r of remote) {
    if (!localById.has(r.id) && (synced[r.id] || 0) < r.updatedAt) plan.push({ id: r.id, name: r.name, action: 'pull' });
  }
  return plan;
}

// The renamed copy a conflict keeps: the losing side is never deleted.
export const conflictCopyName = (name, updatedAt) => `${name} (kept copy, ${new Date(updatedAt).toLocaleDateString()})`;

// ── Running the plan ─────────────────────────────────────────────────────

// The bytes one design travels as: the same file Download project file
// makes. `access` reads blobs (fileAccess from the app, so it works even
// when storage is broken).
export async function designBytes(design, access, date = new Date()) {
  return serializeProject(await collectProject(design, access), date);
}

// A design from the remote's bytes, into this device's database: the same
// whitelist as an opened file. When the design already exists here and is
// older, it is replaced; when both changed, `rename` gives the incoming
// copy a kept-copy name and a fresh id instead.
async function importFromBytes(db, bytes, { rename } = {}) {
  const parsed = parseHomeStudioFile(new TextDecoder().decode(bytes));
  if (parsed.kind !== 'project') throw new Error('The remote sent something that is not a design.');
  if (rename) {
    const { design, images } = freshCopy(parsed);
    design.name = rename;
    for (const img of images) await putImage(db, img.id, new Blob([img.bytes], { type: img.type }));
    await putDesign(db, design);
    return design;
  }
  const here = await getDesign(db, parsed.design.id);
  if (here && here.updatedAt >= parsed.design.updatedAt) return null; // already have it
  for (const img of parsed.images) await putImage(db, img.id, new Blob([img.bytes], { type: img.type }));
  await putDesign(db, parsed.design);
  return parsed.design;
}

// One full sync run: flush the outbox, then push/pull/keep-both per the
// plan. Returns counts for the dialog. `onNote` reports progress lines.
export async function runSync(db, adapter, access, opts = {}) {
  const pref = await loadSyncPref(db);
  if (!adapter || adapter.describe().kind === 'local') return { skipped: true, sent: 0, pulled: 0, kept: 0, failed: 0 };
  const cfg = adapter.normalize(pref.config);
  const { onNote = () => {} } = opts;

  // Queued offline edits go first, newest state wins: flush sends each
  // queued design in its collected shape, read with this device's access.
  const queued = await flushOutbox(db, async (row) => {
    if (row.kind === 'delete') {
      await adapter.delete(cfg, row.designId);
      delete pref.syncedAt[row.designId];
      delete pref.manifest[row.designId];
      return;
    }
    const bytes = await designBytes(row.payload.design, access);
    const out = await adapter.put(cfg, row.designId, bytes);
    if (out.cid) pref.manifest[row.designId] = out.cid;
    // Remember what was just pushed, or the plan reads the design as
    // changed on both sides and keeps a needless conflict copy.
    pref.syncedAt[row.designId] = typeof out.updatedAt === 'number'
      ? out.updatedAt
      : (row.payload.design.updatedAt || Date.now());
  });
  if (queued.sent) onNote(`Sent ${queued.sent} change${queued.sent === 1 ? '' : 's'} that waited for a connection.`);

  const local = (await db.getAll('designs')).map((d) => ({ id: d.id, name: d.name, updatedAt: d.updatedAt }));
  let remote = [];
  if (typeof adapter.list === 'function') {
    try {
      remote = await adapter.list(cfg);
    } catch (err) {
      // A store that cannot say what it holds must not look like an empty
      // one: the plan would push local copies over newer remote ones.
      throw new Error('The design list could not be read, so nothing was synced. ' + (err.message || ''));
    }
  } else {
    // CID-backed stores cannot list; use the manifest of what this
    // device itself has put there.
    for (const id of Object.keys(pref.manifest)) {
      const d = await getDesign(db, id);
      if (d) remote.push({ id, name: d.name, updatedAt: d.updatedAt });
    }
  }
  const plan = planSync(local, remote, pref.syncedAt);
  let sent = 0;
  let pulled = 0;
  let kept = 0;
  let failed = 0;
  for (const step of plan) {
    try {
      if (step.action === 'push' || step.action === 'both') {
        const d = await getDesign(db, step.id);
        if (!d) continue;
        // Both sides changed: read the remote's copy BEFORE overwriting
        // it, so the other device's work is kept (renamed) here.
        const rbytes = step.action === 'both' ? await adapter.get(cfg, pref.manifest[step.id] || step.id) : null;
        const bytes = await designBytes(d, access);
        const out = await adapter.put(cfg, step.id, bytes);
        if (out.cid) pref.manifest[step.id] = out.cid;
        sent += 1;
        if (rbytes) {
          await importFromBytes(db, rbytes, { rename: conflictCopyName(step.name, step.remoteUpdatedAt) });
          kept += 1;
        }
        pref.syncedAt[step.id] = d.updatedAt;
        onNote(`Sent "${step.name}" to the remote store.`);
      } else {
        const bytes = await adapter.get(cfg, pref.manifest[step.id] || step.id);
        const design = await importFromBytes(db, bytes);
        if (design) {
          pulled += 1;
          onNote(`Brought "${design.name}" over from the remote store.`);
        }
        pref.syncedAt[step.id] = (remote.find((r) => r.id === step.id) || {}).updatedAt || Date.now();
      }
    } catch (err) {
      failed += 1;
      onNote(`"${step.name}" could not be synced: ${err.message || 'it did not go through'}.`);
    }
  }
  await saveSyncPref(db, pref);
  return { skipped: false, sent, pulled, kept, failed, queued: queued.sent };
}

// Queue a finished edit for the outbox (called by the app right after an
// autosave, when a remote store is set up). Deleted designs queue a
// delete. Failures here never block editing.
export async function queueChange(db, design, access, deleted = false) {
  const pref = await loadSyncPref(db);
  if (!pref.kind || pref.kind === 'local') return;
  // One pending row per design: the latest state wins, so a burst of
  // edits does not queue a row apiece.
  await clearDesign(db, design.id);
  if (deleted) {
    await enqueue(db, 'delete', design.id, null);
    delete pref.syncedAt[design.id];
    delete pref.manifest[design.id];
  } else {
    await enqueue(db, 'design', design.id, { design: structuredClone(design) });
  }
  await saveSyncPref(db, pref);
}

export { PROJECT_SUFFIX, safeFileName, listOutbox, flushOutbox };