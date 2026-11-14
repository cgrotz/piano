/**
 * Conflict resolution between two copies of one record (COMPOSER.md §7).
 *
 * - scores, arrangements: last writer wins per record;
 * - settings: last writer wins per field;
 * - progress: max of each value (best accuracy, last practised);
 * - a tombstone against a live copy: whichever is newer wins (a tie deletes).
 *
 * Pure and symmetric up to tie-breaks, which are deterministic so two devices
 * merging the same pair end up with the same result.
 */
import type { AnyRecord, ProgressRecord, RecordKind, RecordOf, SettingsRecord, SettingsValues } from './types';

export function mergeRecords<K extends RecordKind>(
  kind: K,
  local: RecordOf[K] | undefined | null,
  remote: RecordOf[K] | undefined | null
): RecordOf[K] | undefined {
  if (!local) return remote ?? undefined;
  if (!remote) return local;
  if (local.deleted || remote.deleted) {
    if (local.updatedAt !== remote.updatedAt) return local.updatedAt > remote.updatedAt ? local : remote;
    return local.deleted ? local : remote;
  }
  switch (kind) {
    case 'settings':
      return mergeSettings(local as SettingsRecord, remote as SettingsRecord) as RecordOf[K];
    case 'progress':
      return mergeProgress(local as ProgressRecord, remote as ProgressRecord) as RecordOf[K];
    default:
      if (local.updatedAt !== remote.updatedAt) return local.updatedAt > remote.updatedAt ? local : remote;
      return stableJson(local) >= stableJson(remote) ? local : remote;
  }
}

function mergeSettings(a: SettingsRecord, b: SettingsRecord): SettingsRecord {
  const values: Record<string, unknown> = {};
  const stamps: Record<string, number> = {};
  const fields = new Set([...Object.keys(a.stamps), ...Object.keys(b.stamps)]) as Set<keyof SettingsValues>;
  for (const f of fields) {
    const sa = a.stamps[f] ?? -1;
    const sb = b.stamps[f] ?? -1;
    const fromA = sa !== sb ? sa > sb : stableJson(a.values[f] ?? null) >= stableJson(b.values[f] ?? null);
    const src = fromA ? a : b;
    stamps[f] = Math.max(sa, sb);
    if (src.values[f] !== undefined) values[f] = src.values[f];
  }
  return {
    id: a.id,
    updatedAt: Math.max(a.updatedAt, b.updatedAt),
    values: values as SettingsValues,
    stamps: stamps as SettingsRecord['stamps']
  };
}

function mergeProgress(a: ProgressRecord, b: ProgressRecord): ProgressRecord {
  const out: ProgressRecord = { id: a.id, updatedAt: Math.max(a.updatedAt, b.updatedAt) };
  const lastPractised = maxDefined(a.lastPractised, b.lastPractised);
  const best = maxDefined(a.best, b.best);
  if (lastPractised !== undefined) out.lastPractised = lastPractised;
  if (best !== undefined) out.best = best;
  return out;
}

function maxDefined(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.max(a, b);
}

/** Same content, regardless of key order. */
export function sameRecord(a: AnyRecord | undefined | null, b: AnyRecord | undefined | null): boolean {
  if (!a || !b) return !a && !b;
  return stableJson(a) === stableJson(b);
}

export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)))
      : v
  );
}
