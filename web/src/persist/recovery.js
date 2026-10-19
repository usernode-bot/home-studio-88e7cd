// Crash recovery: a write-ahead copy of the open design in localStorage.
// localStorage writes finish before the call returns, so a copy survives a
// tab that crashes or is closed between an edit and the next autosave, and
// it holds the work when IndexedDB refuses a save (a full disk). It is
// cleared once the same change is safely in IndexedDB. On the next start,
// a copy newer than the stored design is offered back.

const key = (dbName) => `home-studio:unsaved:${dbName}`;

// Store `doc` as the unsaved copy. Resolves false when there was no room.
export function writeJournal(storage, dbName, doc) {
  try {
    storage.setItem(key(dbName), JSON.stringify({ at: Date.now(), doc }));
    return true;
  } catch {
    return false;
  }
}

export function readJournal(storage, dbName) {
  try {
    const raw = storage.getItem(key(dbName));
    if (!raw) return null;
    const j = JSON.parse(raw);
    return j && j.doc && Array.isArray(j.doc.pages) && j.doc.id ? j : null;
  } catch {
    return null;
  }
}

// Clear the copy once a save of the same (or a later) change succeeded.
export function clearJournal(storage, dbName, savedDoc) {
  const j = readJournal(storage, dbName);
  if (!j) return;
  if (!savedDoc || (j.doc.id === savedDoc.id && j.doc.updatedAt <= savedDoc.updatedAt)) {
    try { storage.removeItem(key(dbName)); } catch { /* nothing to clear */ }
  }
}

// The design to offer back, or null: the copy is offered when the stored
// design is missing or older than it.
export function recoveryOffer(journal, stored) {
  if (!journal) return null;
  if (stored && !(journal.doc.updatedAt > stored.updatedAt)) return null;
  return journal.doc;
}
