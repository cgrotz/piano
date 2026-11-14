/**
 * Per-piece practice preferences and results.
 *
 * Stored in IndexedDB as two records per piece — `settings` (merged per field
 * when syncing) and `progress` (merged by max) — and mirrored in memory so the
 * player can read them synchronously. `hydrateSettings()` fills the mirror at
 * startup and after a sync pull. Writes update the mirror at once and persist
 * in the background: if storage is unavailable, preferences last for the
 * session and every piece otherwise opens with defaults.
 */
import { getAllRecords, putRecord, tombstone } from './db';
import type { ProgressRecord, SettingsRecord, SettingsValues } from '../sync/types';

export interface PieceSettings extends SettingsValues {
  /** Epoch ms of the last time practice was started. */
  lastPractised?: number;
  /** Best accuracy (%) of a complete run through the whole piece. */
  best?: number;
}

const settingsCache = new Map<string, SettingsRecord>();
const progressCache = new Map<string, ProgressRecord>();

/** Load every piece's settings and progress into memory. Never rejects. */
export async function hydrateSettings(): Promise<void> {
  try {
    await queue;
    const [settings, progress] = await Promise.all([getAllRecords('settings'), getAllRecords('progress')]);
    // A change made while reading is newer than what was read: keep it.
    const apply = <T extends { id: string; updatedAt: number }>(cache: Map<string, T>, rows: T[]) => {
      for (const r of rows) {
        const cur = cache.get(r.id);
        if (!cur || r.updatedAt >= cur.updatedAt) cache.set(r.id, r);
      }
    };
    apply(settingsCache, settings);
    apply(progressCache, progress);
  } catch {
    /* no IndexedDB: in-memory only */
  }
}

export function loadSettings(id: string): PieceSettings {
  const s = settingsCache.get(id);
  const p = progressCache.get(id);
  const out: PieceSettings = s && !s.deleted ? { ...s.values } : {};
  if (p && !p.deleted) {
    if (p.lastPractised !== undefined) out.lastPractised = p.lastPractised;
    if (p.best !== undefined) out.best = p.best;
  }
  return out;
}

/**
 * Merge `patch` into the stored settings for `id`. Only fields whose value
 * actually changed get a new timestamp, so syncing merges per field.
 */
export function saveSettings(id: string, patch: PieceSettings): void {
  const now = Date.now();
  const { lastPractised, best, ...values } = patch;

  const prevS = settingsCache.get(id);
  const live = prevS && !prevS.deleted ? prevS : undefined;
  const nextS: SettingsRecord = {
    id,
    updatedAt: live?.updatedAt ?? 0,
    values: { ...live?.values },
    stamps: { ...live?.stamps }
  };
  let changedS = false;
  // The player saves the defaults it opened with the first time a piece is
  // opened. Those aren't choices: stamp them 0 so real choices made on another
  // device win the per-field merge.
  const stamp = live ? now : 0;
  for (const [f, v] of Object.entries(values) as [keyof SettingsValues, unknown][]) {
    if (v === undefined || nextS.values[f] === v) continue;
    (nextS.values as Record<string, unknown>)[f] = v;
    nextS.stamps[f] = stamp;
    changedS = true;
  }
  if (changedS) {
    nextS.updatedAt = Math.max(now, (prevS?.updatedAt ?? 0) + 1);
    settingsCache.set(id, nextS);
    persist(() => putRecord('settings', nextS));
  }

  const prevP = progressCache.get(id);
  const liveP = prevP && !prevP.deleted ? prevP : undefined;
  const nextP: ProgressRecord = { id, updatedAt: liveP?.updatedAt ?? 0 };
  if (liveP?.lastPractised !== undefined) nextP.lastPractised = liveP.lastPractised;
  if (liveP?.best !== undefined) nextP.best = liveP.best;
  let changedP = false;
  if (lastPractised !== undefined && lastPractised !== nextP.lastPractised) {
    nextP.lastPractised = lastPractised;
    changedP = true;
  }
  if (best !== undefined && best !== nextP.best) {
    nextP.best = best;
    changedP = true;
  }
  if (changedP) {
    nextP.updatedAt = Math.max(now, (prevP?.updatedAt ?? 0) + 1);
    progressCache.set(id, nextP);
    persist(() => putRecord('progress', nextP));
  }
}

/** Forget a deleted piece's settings and progress (as tombstones, so it syncs). */
export function forgetSettings(id: string): void {
  const s = settingsCache.get(id);
  if (s && !s.deleted) {
    const t = tombstone('settings', s);
    settingsCache.set(id, t);
    persist(() => putRecord('settings', t));
  }
  const p = progressCache.get(id);
  if (p && !p.deleted) {
    const t = tombstone('progress', p);
    progressCache.set(id, t);
    persist(() => putRecord('progress', t));
  }
}

// Writes are queued so they reach IndexedDB in the order they were made.
let queue: Promise<void> = Promise.resolve();
function persist(write: () => Promise<void>): void {
  queue = queue.then(write).catch(() => {
    /* storage full/blocked: preferences just won't persist */
  });
}

/** Resolves once every write made so far has reached storage. */
export function settingsFlushed(): Promise<void> {
  return queue;
}
