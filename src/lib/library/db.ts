/**
 * IndexedDB persistence (component 5 in ARCHITECTURE.md, COMPOSER.md §7).
 *
 * One object store per record kind — `scores`, `settings`, `progress`,
 * `arrangements` — keyed by id, plus two bookkeeping stores for sync:
 * `outbox` (records changed locally and not yet pushed) and `meta` (sync
 * cursor and the like). Raw MusicXML is stored; OSMD re-parses it on open.
 *
 * Deleting never removes a record: it becomes a tombstone (`deleted: true`)
 * so other devices learn about the deletion. Readers filter tombstones out.
 */
import {
  RECORD_KINDS,
  type AnyRecord,
  type Entry,
  type LocalStore,
  type ProgressRecord,
  type RecordKind,
  type RecordOf,
  type ScoreRecord,
  type SettingsRecord,
  type SettingsValues
} from '../sync/types';

export type { ScoreRecord } from '../sync/types';

export const DB_NAME = 'piano-tutor';
export const DB_VERSION = 2;
const OUTBOX = 'outbox';
const META = 'meta';

/** localStorage prefix of the per-piece settings kept before version 2. */
export const LEGACY_SETTINGS_PREFIX = 'piano-tutor:piece:';

interface OutboxEntry {
  key: string;
  kind: RecordKind;
  id: string;
  updatedAt: number;
}

let connection: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => upgrade(req.result, req.transaction!, event.oldVersion);
    req.onsuccess = () => {
      const db = req.result;
      // Another tab is upgrading: step aside, reopen on next use.
      db.onversionchange = () => {
        db.close();
        connection = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      connection = null;
      reject(req.error);
    };
    req.onblocked = () => {
      connection = null;
      reject(new Error('Close the app in other tabs to finish updating its storage.'));
    };
  });
  return connection;
}

/** Close the shared connection (tests, or before deleting the database). */
export async function closeDb(): Promise<void> {
  const c = connection;
  connection = null;
  if (c) (await c.catch(() => null))?.close();
}

function upgrade(db: IDBDatabase, tx: IDBTransaction, oldVersion: number): void {
  for (const kind of RECORD_KINDS) {
    if (!db.objectStoreNames.contains(kind)) db.createObjectStore(kind, { keyPath: 'id' });
  }
  if (!db.objectStoreNames.contains(OUTBOX)) db.createObjectStore(OUTBOX, { keyPath: 'key' });
  if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);

  if (oldVersion >= 1 && oldVersion < 2) {
    // v1 → v2: scores gain `updatedAt`; per-piece settings move in from localStorage.
    const scores = tx.objectStore('scores');
    const outbox = tx.objectStore(OUTBOX);
    scores.openCursor().onsuccess = function () {
      const cursor = this.result;
      if (!cursor) return;
      const record = cursor.value as ScoreRecord;
      if (typeof record.updatedAt !== 'number') {
        record.updatedAt = record.importedAt || Date.now();
        cursor.update(record);
      }
      outbox.put(outboxEntry('scores', record));
      cursor.continue();
    };
    for (const { kind, record } of legacySettings()) {
      tx.objectStore(kind).put(record);
      outbox.put(outboxEntry(kind, record));
    }
  }
}

/**
 * Per-piece settings as stored in localStorage before version 2, split into a
 * settings and a progress record each. Left in localStorage (harmless) so an
 * older build of the app still finds them.
 */
export function legacySettings(): Entry[] {
  const out: Entry[] = [];
  try {
    const now = Date.now();
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(LEGACY_SETTINGS_PREFIX)) continue;
      const id = key.slice(LEGACY_SETTINGS_PREFIX.length);
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(localStorage.getItem(key) ?? '{}');
      } catch {
        continue;
      }
      if (!parsed || typeof parsed !== 'object') continue;
      const { lastPractised, best, ...rest } = parsed;
      const progress: ProgressRecord = { id, updatedAt: now };
      if (typeof lastPractised === 'number') progress.lastPractised = lastPractised;
      if (typeof best === 'number') progress.best = best;
      const values: SettingsValues = {};
      const stamps: SettingsRecord['stamps'] = {};
      for (const [f, v] of Object.entries(rest)) {
        if (v === undefined || v === null) continue;
        (values as Record<string, unknown>)[f] = v;
        (stamps as Record<string, number>)[f] = now;
      }
      if (Object.keys(values).length) out.push({ kind: 'settings', record: { id, updatedAt: now, values, stamps } });
      if (progress.lastPractised !== undefined || progress.best !== undefined) {
        out.push({ kind: 'progress', record: progress });
      }
    }
  } catch {
    /* no localStorage: nothing to migrate */
  }
  return out;
}

function outboxEntry(kind: RecordKind, record: AnyRecord): OutboxEntry {
  return { key: `${kind}/${record.id}`, kind, id: record.id, updatedAt: record.updatedAt };
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
  });
}

async function read<T>(store: string, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return promisify(fn(db.transaction(store, 'readonly').objectStore(store)));
}

// ---- Records ----------------------------------------------------------------

/** One record, tombstones included. */
export function getRecord<K extends RecordKind>(kind: K, id: string): Promise<RecordOf[K] | undefined> {
  return read(kind, (s) => s.get(id) as IDBRequest<RecordOf[K] | undefined>);
}

/** All records of a kind, tombstones included. */
export function getAllRecords<K extends RecordKind>(kind: K): Promise<RecordOf[K][]> {
  return read(kind, (s) => s.getAll() as IDBRequest<RecordOf[K][]>);
}

/**
 * Store a record. A local change (`dirty`, the default) is queued for the next
 * sync push in the same transaction, so a crash can't lose the queue entry.
 */
export async function putRecord<K extends RecordKind>(
  kind: K,
  record: RecordOf[K],
  { dirty = true }: { dirty?: boolean } = {}
): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([kind, OUTBOX], 'readwrite');
  tx.objectStore(kind).put(record);
  if (dirty) tx.objectStore(OUTBOX).put(outboxEntry(kind, record));
  await done(tx);
}

/** Turn a record into a tombstone, keeping only what identifies it. */
export async function deleteRecord(kind: RecordKind, id: string): Promise<void> {
  const existing = await getRecord(kind, id);
  if (!existing || existing.deleted) return;
  await putRecord(kind, tombstone(kind, existing));
}

export function tombstone<K extends RecordKind>(kind: K, record: RecordOf[K], now = Date.now()): RecordOf[K] {
  const base = { id: record.id, updatedAt: Math.max(now, record.updatedAt + 1), deleted: true as const };
  switch (kind) {
    case 'scores': {
      const s = record as ScoreRecord;
      return { ...base, title: s.title, composer: s.composer, importedAt: s.importedAt, xml: '' } as RecordOf[K];
    }
    case 'settings':
      return { ...base, values: {}, stamps: {} } as unknown as RecordOf[K];
    case 'arrangements':
      return { ...base, scoreId: (record as RecordOf['arrangements']).scoreId } as RecordOf[K];
    default:
      return base as RecordOf[K];
  }
}

// ---- Scores (library) -------------------------------------------------------

export function addScore(record: Omit<ScoreRecord, 'updatedAt'> & { updatedAt?: number }): Promise<void> {
  return putRecord('scores', { ...record, updatedAt: record.updatedAt ?? Date.now() });
}

/** Live (not deleted) scores. */
export async function getAllScores(): Promise<ScoreRecord[]> {
  return (await getAllRecords('scores')).filter((r) => !r.deleted);
}

export async function getScore(id: string): Promise<ScoreRecord | undefined> {
  const r = await getRecord('scores', id);
  return r && !r.deleted ? r : undefined;
}

export function deleteScore(id: string): Promise<void> {
  return deleteRecord('scores', id);
}

// ---- Sync's view of local storage -------------------------------------------

export const idbLocalStore: LocalStore = {
  get: getRecord,
  all: (kind) => getAllRecords(kind) as Promise<AnyRecord[]>,
  async put({ kind, record }, { dirty, expected }) {
    if (expected === undefined) return putRecord(kind, record, { dirty });
    const db = await openDb();
    const tx = db.transaction([kind, OUTBOX], 'readwrite');
    const store = tx.objectStore(kind);
    store.get(record.id).onsuccess = function () {
      const current = this.result as AnyRecord | undefined;
      if ((current?.updatedAt ?? null) !== expected) return; // changed meanwhile: keep it
      store.put(record);
      if (dirty) tx.objectStore(OUTBOX).put(outboxEntry(kind, record));
    };
    await done(tx);
  },
  async remove(kind, id) {
    const db = await openDb();
    const tx = db.transaction([kind, OUTBOX], 'readwrite');
    tx.objectStore(kind).delete(id);
    tx.objectStore(OUTBOX).delete(`${kind}/${id}`);
    await done(tx);
  },
  async dirty() {
    const all = await read(OUTBOX, (s) => s.getAll() as IDBRequest<OutboxEntry[]>);
    return all.map(({ kind, id, updatedAt }) => ({ kind, id, updatedAt }));
  },
  async clearDirty(kind, id, updatedAt) {
    const db = await openDb();
    const tx = db.transaction(OUTBOX, 'readwrite');
    const store = tx.objectStore(OUTBOX);
    const key = `${kind}/${id}`;
    store.get(key).onsuccess = function () {
      const entry = this.result as OutboxEntry | undefined;
      if (entry && entry.updatedAt === updatedAt) store.delete(key);
    };
    await done(tx);
  },
  getMeta: (key) => read(META, (s) => s.get(key) as IDBRequest<string | undefined>),
  async setMeta(key, value) {
    const db = await openDb();
    const tx = db.transaction(META, 'readwrite');
    if (value === undefined) tx.objectStore(META).delete(key);
    else tx.objectStore(META).put(value, key);
    await done(tx);
  }
};
