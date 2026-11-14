/**
 * Reactive sync state and scheduling for the UI (COMPOSER.md §7).
 *
 * Only loaded when a Google OAuth client ID is configured. Syncs on start, when
 * the app becomes visible or focused, when it is hidden (so leaving the tablet
 * uploads the last changes), when the network comes back, and every minute
 * while open.
 */
import { idbLocalStore } from '../library/db';
import { SyncEngine, type SyncResult } from './engine';
import { DriveProvider } from './drive';
import { AuthRequiredError, GoogleAuth } from './googleAuth';
import type { RecordKind } from './types';

export type SyncStatus = 'signed-out' | 'signing-in' | 'syncing' | 'synced' | 'offline' | 'error';

const ENABLED_KEY = 'piano-tutor:sync-enabled';
const INTERVAL_MS = 60_000;
/** Don't sync more often than this on focus/visibility bursts. */
const MIN_GAP_MS = 5_000;

export class SyncController {
  status = $state<SyncStatus>('signed-out');
  lastSynced = $state<number | null>(null);
  error = $state<string | null>(null);

  #auth: GoogleAuth;
  #engine: SyncEngine;
  #timer: ReturnType<typeof setInterval> | null = null;
  #lastAttempt = 0;
  #onChange: (kinds: Set<RecordKind>) => void | Promise<void>;

  constructor(clientId: string, onChange: (kinds: Set<RecordKind>) => void | Promise<void>) {
    this.#auth = new GoogleAuth(clientId);
    this.#engine = new SyncEngine(idbLocalStore, new DriveProvider(() => this.#token()));
    this.#onChange = onChange;
  }

  get signedIn(): boolean {
    return enabled() && this.status !== 'signed-out' && this.status !== 'signing-in';
  }

  /** Resume syncing if the user signed in before. No UI is shown. */
  start(): void {
    if (!enabled()) return;
    this.#listen();
    void this.syncNow();
  }

  /** "Sign in to sync" — call from a click so Google's popup is allowed. */
  async signIn(): Promise<void> {
    this.status = 'signing-in';
    this.error = null;
    try {
      await this.#auth.token(true);
    } catch (err) {
      this.status = 'signed-out';
      this.error = message(err);
      return;
    }
    setEnabled(true);
    this.#listen();
    await this.syncNow(true);
  }

  async signOut(): Promise<void> {
    setEnabled(false);
    this.#unlisten();
    await this.#auth.signOut();
    // Next sign-in (maybe another account) starts with a full sync; local data stays.
    await this.#engine.reset().catch(() => {});
    this.status = 'signed-out';
    this.error = null;
    this.lastSynced = null;
  }

  async syncNow(force = false): Promise<void> {
    if (!enabled()) return;
    const now = Date.now();
    if (!force && now - this.#lastAttempt < MIN_GAP_MS) return;
    this.#lastAttempt = now;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.status = 'offline';
      return;
    }
    this.status = 'syncing';
    try {
      let result: SyncResult;
      try {
        result = await this.#engine.sync();
      } catch (err) {
        if (!(err instanceof AuthRequiredError)) throw err;
        // Token rejected: renew once (silently) and retry.
        this.#auth.invalidate();
        result = await this.#engine.sync();
      }
      if (result.changed.size > 0) await this.#onChange(result.changed);
      this.status = 'synced';
      this.lastSynced = Date.now();
      this.error = null;
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        // Couldn't renew without the user: wait for a tap on "Sign in to sync".
        this.status = 'signed-out';
        this.error = null;
      } else {
        this.status = typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'error';
        this.error = message(err);
      }
    }
  }

  #token(): Promise<string> {
    return this.#auth.token(false);
  }

  #onVisibility = () => void this.syncNow(document.visibilityState === 'hidden');
  #onFocus = () => void this.syncNow();
  #onOnline = () => void this.syncNow(true);

  #listen(): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => {
      if (document.visibilityState === 'visible') void this.syncNow();
    }, INTERVAL_MS);
    document.addEventListener('visibilitychange', this.#onVisibility);
    window.addEventListener('focus', this.#onFocus);
    window.addEventListener('online', this.#onOnline);
  }

  #unlisten(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    document.removeEventListener('visibilitychange', this.#onVisibility);
    window.removeEventListener('focus', this.#onFocus);
    window.removeEventListener('online', this.#onOnline);
  }
}

function enabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}

function setEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(ENABLED_KEY, '1');
    else localStorage.removeItem(ENABLED_KEY);
  } catch {
    /* ignore */
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
