/**
 * Browser-only Google sign-in for Drive sync, via the Google Identity Services
 * token client (no backend, so no refresh tokens — COMPOSER.md §7).
 *
 * Access tokens last about an hour. The current one is kept in localStorage
 * (it can only reach this app's own hidden Drive folder) so reopening the app
 * within the hour needs nothing. After that a silent renewal is tried; when
 * the browser blocks it (no user gesture) the UI shows "Sign in to sync" and a
 * tap renews it — usually without any dialog once consent was given.
 */

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const STORAGE_KEY = 'piano-tutor:google-token';
/** Renew this long before the token actually expires. */
const MARGIN_MS = 2 * 60 * 1000;

interface TokenResponse {
  access_token?: string;
  expires_in?: number | string;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void;
}

interface GoogleOauth2 {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    callback: (r: TokenResponse) => void;
    error_callback?: (e: { type: string; message?: string }) => void;
  }): TokenClient;
  hasGrantedAllScopes(r: TokenResponse, ...scopes: string[]): boolean;
  revoke(token: string, done?: () => void): void;
}

declare global {
  interface Window {
    google?: { accounts: { oauth2: GoogleOauth2 } };
  }
}

export class AuthRequiredError extends Error {
  constructor(message = 'Sign in to sync.') {
    super(message);
    this.name = 'AuthRequiredError';
  }
}

let gisLoading: Promise<GoogleOauth2> | null = null;

function loadGis(): Promise<GoogleOauth2> {
  gisLoading ??= new Promise<GoogleOauth2>((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve(window.google.accounts.oauth2);
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () =>
      window.google?.accounts?.oauth2
        ? resolve(window.google.accounts.oauth2)
        : reject(new Error('Google sign-in failed to load.'));
    script.onerror = () => {
      gisLoading = null;
      script.remove();
      reject(new Error("Couldn't reach Google sign-in (offline?)."));
    };
    document.head.appendChild(script);
  });
  return gisLoading;
}

export class GoogleAuth {
  #token: { value: string; expiresAt: number } | null = readStored();
  #client: TokenClient | null = null;
  #pending: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null;

  constructor(private clientId: string) {}

  /** A token that's still valid for a while, without any network or UI. */
  get current(): string | null {
    return this.#token && this.#token.expiresAt - MARGIN_MS > Date.now() ? this.#token.value : null;
  }

  /**
   * A valid access token. `interactive` must only be true inside a user
   * gesture (a click); otherwise a renewal is attempted silently and an
   * `AuthRequiredError` means the user has to tap "Sign in".
   */
  async token(interactive = false): Promise<string> {
    const current = this.current;
    if (current) return current;
    return this.#request(interactive ? 'consent-if-needed' : 'silent');
  }

  /** The stored token was rejected (401): drop it. */
  invalidate(): void {
    this.#token = null;
    writeStored(null);
  }

  async signOut(): Promise<void> {
    const t = this.#token?.value;
    this.invalidate();
    if (!t) return;
    try {
      (await loadGis()).revoke(t);
    } catch {
      /* offline: the token simply expires */
    }
  }

  async #request(mode: 'silent' | 'consent-if-needed'): Promise<string> {
    const oauth2 = await loadGis();
    this.#client ??= oauth2.initTokenClient({
      client_id: this.clientId,
      scope: DRIVE_SCOPE,
      callback: (r) => {
        const p = this.#pending;
        this.#pending = null;
        if (!p) return;
        if (r.error || !r.access_token) {
          return p.reject(new AuthRequiredError(r.error_description || r.error || 'Sign-in was cancelled.'));
        }
        if (!oauth2.hasGrantedAllScopes(r, DRIVE_SCOPE)) {
          return p.reject(new AuthRequiredError('Allow access to the app’s Drive folder to sync.'));
        }
        this.#token = { value: r.access_token, expiresAt: Date.now() + Number(r.expires_in ?? 3600) * 1000 };
        writeStored(this.#token);
        p.resolve(r.access_token);
      },
      error_callback: (e) => {
        const p = this.#pending;
        this.#pending = null;
        p?.reject(
          new AuthRequiredError(
            e.type === 'popup_closed' ? 'Sign-in was cancelled.' : e.type === 'popup_failed_to_open' ? 'Sign in to sync.' : (e.message ?? e.type)
          )
        );
      }
    });
    this.#pending?.reject(new AuthRequiredError('Superseded by a newer sign-in.'));
    return new Promise<string>((resolve, reject) => {
      this.#pending = { resolve, reject };
      // '' = no prompt if already granted; Google still shows the account
      // chooser / consent when it has to.
      this.#client!.requestAccessToken({ prompt: mode === 'silent' ? 'none' : '' });
    });
  }
}

function readStored(): { value: string; expiresAt: number } | null {
  try {
    const t = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    return t && typeof t.value === 'string' && typeof t.expiresAt === 'number' ? t : null;
  } catch {
    return null;
  }
}

function writeStored(t: { value: string; expiresAt: number } | null): void {
  try {
    if (t) localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* token lasts for this session only */
  }
}
