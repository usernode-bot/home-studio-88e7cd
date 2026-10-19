// How much of this device's storage Home Studio uses, whether the browser
// has promised to keep it, and the warnings that follow from both.

export const LOW_SHARE = 0.8;
export const FULL_SHARE = 0.95;

// 'ok' | 'low' | 'full' for a usage and quota in bytes (unknown is 'ok').
export function quotaLevel(usage, quota) {
  if (!quota || !Number.isFinite(usage)) return 'ok';
  const share = usage / quota;
  return share >= FULL_SHARE ? 'full' : share >= LOW_SHARE ? 'low' : 'ok';
}

export function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return `${v >= 100 ? Math.round(v) : Math.round(v * 10) / 10} ${units[u]}`;
}

export function isQuotaError(err) {
  if (!err) return false;
  return err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED' || err.code === 22
    || Boolean(err.inner && isQuotaError(err.inner));
}

// { usage, quota, persisted, level } or null where the browser can't say.
export async function storageStatus() {
  const s = typeof navigator !== 'undefined' && navigator.storage;
  if (!s || !s.estimate) return null;
  try {
    const { usage = 0, quota = 0 } = await s.estimate();
    const persisted = s.persisted ? await s.persisted() : false;
    return { usage, quota, persisted, level: quotaLevel(usage, quota) };
  } catch {
    return null;
  }
}

// Ask the browser to keep this site's storage. Resolves true when granted.
export async function askToPersist() {
  const s = typeof navigator !== 'undefined' && navigator.storage;
  if (!s || !s.persist) return false;
  try { return await s.persist(); } catch { return false; }
}
