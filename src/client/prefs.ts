/** Per-viewer preferences kept in browser storage, and everything that happens when storage is unavailable. */

export type ThemePref = "system" | "light" | "dark";

export interface Prefs {
  theme: ThemePref;
  lastPanel: string;
}

export const PANEL_IDS = ["overview", "notes", "note", "promote", "lint", "log", "graph", "settings", "proposals", "assertions", "history"] as const;
export type PanelId = (typeof PANEL_IDS)[number];

export const DEFAULT_PREFS: Prefs = { theme: "system", lastPanel: "overview" };

const KEY = "vmem-ui:prefs";
const THEMES: readonly ThemePref[] = ["system", "light", "dark"];

/** The part of `Storage` the client uses; a stub is enough in tests. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

/** The panel id when it is one of ours, so a stored or hand-edited value cannot select a panel that does not exist. */
export function isPanelId(value: unknown): value is PanelId {
  return typeof value === "string" && (PANEL_IDS as readonly string[]).includes(value);
}

function checked(raw: unknown): Prefs {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const theme = THEMES.includes(value.theme as ThemePref) ? (value.theme as ThemePref) : DEFAULT_PREFS.theme;
  const lastPanel = isPanelId(value.lastPanel) ? value.lastPanel : DEFAULT_PREFS.lastPanel;
  return { theme, lastPanel };
}

/** Stored preferences, or the defaults. Unreadable or malformed storage is the default, never an error. */
export function readPrefs(storage?: StorageLike): Prefs {
  if (!storage) return DEFAULT_PREFS;
  try {
    const text = storage.getItem(KEY);
    return text ? checked(JSON.parse(text)) : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

/** Store preferences; a storage that refuses the write leaves the session working with what it already has. */
export function writePrefs(prefs: Prefs, storage?: StorageLike): Prefs {
  const value = checked(prefs);
  if (!storage) return value;
  try {
    storage.setItem(KEY, JSON.stringify(value));
  } catch {
    // Quota, private mode or a disabled store: the preference applies to this view only.
  }
  return value;
}

/**
 * `localStorage` when the browser lets this page use it. Reading the property itself throws in some
 * configurations (third-party cookie blocking, sandboxed frames), so the access is guarded.
 */
export function browserStorage(source?: StorageLike | null): StorageLike | undefined {
  if (source) return source;
  try {
    const storage = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (!storage) return undefined;
    const probe = `${KEY}:probe`;
    storage.setItem(probe, "1");
    storage.removeItem?.(probe);
    return storage;
  } catch {
    return undefined;
  }
}
