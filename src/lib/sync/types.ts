/**
 * Records and ports shared by local storage and sync (COMPOSER.md §7).
 *
 * Everything that follows the user across devices is a record in one of four
 * kinds. Every record carries `updatedAt` (epoch ms of its last local change);
 * a deletion keeps the record as a tombstone (`deleted: true`) so the deletion
 * itself can be synced.
 */

export type RecordKind = 'scores' | 'settings' | 'progress' | 'arrangements';

export const RECORD_KINDS: readonly RecordKind[] = ['scores', 'settings', 'progress', 'arrangements'];

export interface BaseRecord {
  id: string;
  updatedAt: number;
  deleted?: boolean;
}

/** An imported piece. `xml` is absent on a tombstone. */
export interface ScoreRecord extends BaseRecord {
  title: string;
  composer: string;
  importedAt: number;
  xml: string;
  /** Number of bars (absent for scores imported before this was recorded). */
  bars?: number;
}

/** Per-piece practice preferences. */
export interface SettingsValues {
  /** HandOption id: 'right' | 'left' | 'both' | 'staff-N'. */
  hand?: string;
  bpm?: number;
  view?: 'both' | 'notes' | 'piano';
  guide?: boolean;
  /** Last practice range in bar numbers, and whether it loops. */
  from?: number;
  to?: number;
  loop?: boolean;
  /** Show the score's non-piano parts (e.g. a vocal line) while practising the piano. */
  otherParts?: boolean;
  /** Backing band for Listen: 'none' or a band preset id. */
  band?: string;
}

/**
 * Settings merge per field: each field remembers when it was last changed, so
 * changing the tempo on the tablet and the hand on the desktop keeps both.
 */
export interface SettingsRecord extends BaseRecord {
  values: SettingsValues;
  stamps: Partial<Record<keyof SettingsValues, number>>;
}

/** Practice results; merged by max, so a result is never lost to an older device. */
export interface ProgressRecord extends BaseRecord {
  /** Epoch ms of the last time practice was started. */
  lastPractised?: number;
  /** Best accuracy (%) of a complete run through the whole piece. */
  best?: number;
}

/** Composer arrangement (COMPOSER.md §1). Opaque to storage/sync: last writer wins. */
export interface ArrangementRecord extends BaseRecord {
  scoreId: string;
  [field: string]: unknown;
}

export interface RecordOf {
  scores: ScoreRecord;
  settings: SettingsRecord;
  progress: ProgressRecord;
  arrangements: ArrangementRecord;
}

export type AnyRecord = RecordOf[RecordKind];

/** A record together with its kind, as it travels through the sync engine. */
export interface Entry<K extends RecordKind = RecordKind> {
  kind: K;
  record: RecordOf[K];
}

/** What a remote change listing reports about one record, without its body. */
export interface RemoteRef {
  kind: RecordKind;
  id: string;
  /** `updatedAt` of the remote copy; absent when the remote copy was removed outright. */
  updatedAt?: number;
  deleted?: boolean;
  /** The remote copy is gone entirely (purged), not just tombstoned. */
  removed?: boolean;
}

/**
 * Port to a remote store (Google Drive, later maybe Dropbox/WebDAV). Records
 * are opaque JSON to the provider; it only has to find them by kind + id and
 * report what changed since a cursor it hands out.
 */
export interface SyncProvider {
  /**
   * Records changed since `cursor` (everything when `cursor` is null), plus the
   * cursor to pass next time.
   */
  listChanges(cursor: string | null): Promise<{ changes: RemoteRef[]; cursor: string }>;
  get<K extends RecordKind>(kind: K, id: string): Promise<RecordOf[K] | null>;
  put(entry: Entry): Promise<void>;
  /** Remove a record entirely (used to purge old tombstones). */
  delete(kind: RecordKind, id: string): Promise<void>;
}

/** Port to this device's storage, as the sync engine needs it. */
export interface LocalStore {
  get<K extends RecordKind>(kind: K, id: string): Promise<RecordOf[K] | undefined>;
  all(kind: RecordKind): Promise<AnyRecord[]>;
  /**
   * Store a record that came from (or was merged with) the remote side. With
   * `expected`, only if the stored copy is still the one the merge was based on
   * (its `updatedAt`, or null for "absent") — a change the app made meanwhile
   * wins and is merged on the next sync.
   */
  put(entry: Entry, opts: { dirty: boolean; expected?: number | null }): Promise<void>;
  remove(kind: RecordKind, id: string): Promise<void>;
  /** Records changed locally and not yet pushed. */
  dirty(): Promise<{ kind: RecordKind; id: string; updatedAt: number }[]>;
  /** Mark pushed — but only if the record hasn't changed again since (`updatedAt` matches). */
  clearDirty(kind: RecordKind, id: string, updatedAt: number): Promise<void>;
  getMeta(key: string): Promise<string | undefined>;
  setMeta(key: string, value: string | undefined): Promise<void>;
}
