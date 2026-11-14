/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Google OAuth client ID for Drive sync; sync is hidden when unset. */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}
