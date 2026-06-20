/**
 * IndexedDB persistence for imported scores (component 5 in ARCHITECTURE.md).
 *
 * One object store keyed by id. Raw MusicXML is stored (OSMD stays the single
 * source of truth and re-parses on open). Files are kilobytes, so a simple
 * open-per-operation wrapper is plenty; no need for a connection pool.
 */

const DB_NAME = 'piano-tutor';
const DB_VERSION = 1;
const STORE = 'scores';

export interface ScoreRecord {
  id: string;
  title: string;
  composer: string;
  importedAt: number;
  xml: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb();
  try {
    return await promisify(fn(db.transaction(STORE, mode).objectStore(STORE)));
  } finally {
    db.close();
  }
}

export function addScore(record: ScoreRecord): Promise<unknown> {
  return withStore('readwrite', (store) => store.put(record));
}

export function getAllScores(): Promise<ScoreRecord[]> {
  return withStore('readonly', (store) => store.getAll() as IDBRequest<ScoreRecord[]>);
}

export function getScore(id: string): Promise<ScoreRecord | undefined> {
  return withStore('readonly', (store) => store.get(id) as IDBRequest<ScoreRecord | undefined>);
}

export function deleteScore(id: string): Promise<unknown> {
  return withStore('readwrite', (store) => store.delete(id));
}
