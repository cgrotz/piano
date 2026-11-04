/**
 * Per-piece practice preferences and results, remembered on this device.
 *
 * Stored in localStorage (keyed by library entry id): these are conveniences —
 * if storage is unavailable or cleared, every piece simply opens with defaults.
 */
export interface PieceSettings {
  /** HandOption id: 'right' | 'left' | 'both' | 'staff-N'. */
  hand?: string;
  bpm?: number;
  view?: 'both' | 'notes' | 'piano';
  guide?: boolean;
  /** Last practice range in bar numbers, and whether it loops. */
  from?: number;
  to?: number;
  loop?: boolean;
  /** Epoch ms of the last time practice was started. */
  lastPractised?: number;
  /** Best accuracy (%) of a complete run through the whole piece. */
  best?: number;
}

const PREFIX = 'piano-tutor:piece:';

export function loadSettings(id: string): PieceSettings {
  try {
    const raw = localStorage.getItem(PREFIX + id);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as PieceSettings) : {};
  } catch {
    return {};
  }
}

/** Merge `patch` into the stored settings for `id`. Silently a no-op without storage. */
export function saveSettings(id: string, patch: PieceSettings): void {
  try {
    localStorage.setItem(PREFIX + id, JSON.stringify({ ...loadSettings(id), ...patch }));
  } catch {
    /* storage full/blocked: preferences just won't persist */
  }
}

export function forgetSettings(id: string): void {
  try {
    localStorage.removeItem(PREFIX + id);
  } catch {
    /* ignore */
  }
}
