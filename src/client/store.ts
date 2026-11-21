/** One store for the panel: the active panel, its snapshot, the theme and the write flow. */

import type { ActionInput, Host, SnapshotReply, Theme } from "./host.ts";
import { browserStorage, readPrefs, writePrefs, type Prefs, type StorageLike, type ThemePref } from "./prefs.ts";
import { confirmWrite, startWrite, type WriteState } from "./write.ts";

export interface ClientState {
  panel: string;
  params: Record<string, string>;
  reply: SnapshotReply | null;
  phase: "loading" | "ready" | "error";
  error?: string;
  prefs: Prefs;
  theme: Theme;
  write: WriteState;
}

export interface StoreOptions {
  storage?: StorageLike;
  /** Poll interval when the host does not push snapshots. */
  intervalMs?: number;
  initialPanel?: string;
}

export interface ClientStore {
  getState(): ClientState;
  subscribe(listener: (state: ClientState) => void): () => void;
  show(panel: string, params?: Record<string, string>): void;
  navigate(panel: string, params?: Record<string, string>): void;
  refresh(): Promise<void>;
  setTheme(theme: ThemePref): void;
  setWrite(state: WriteState): void;
  beginWrite(input: ActionInput): Promise<void>;
  confirmWriteNow(): Promise<void>;
  start(): () => void;
}

/** `system` follows the host's mode; `light` and `dark` are the person's own choice for this panel. */
export function resolveTheme(pref: ThemePref, hostTheme: Theme): Theme {
  return pref === "system" ? hostTheme : { mode: pref, tokens: hostTheme.tokens };
}

export function createStore(host: Host, options: StoreOptions = {}): ClientStore {
  const storage = browserStorage(options.storage);
  const prefs = readPrefs(storage);
  const listeners = new Set<(state: ClientState) => void>();
  let state: ClientState = {
    panel: options.initialPanel ?? prefs.lastPanel,
    params: {},
    reply: null,
    phase: "loading",
    prefs,
    theme: resolveTheme(prefs.theme, host.theme()),
    write: { phase: "idle" },
  };
  const set = (next: Partial<ClientState>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener(state);
  };
  let asked = 0;

  const store: ClientStore = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    show(panel, params = {}) {
      // A panel the browser stored, or an unknown id from a link, falls back to the first panel.
      const next = panel.trim() || "overview";
      if (next !== state.prefs.lastPanel) set({ prefs: writePrefs({ ...state.prefs, lastPanel: next }, storage) });
      // The reply belongs to the panel and parameters it was asked for: keeping it would show the previous note's
      // content, and let its delete or move run under the newly chosen vault. An open preview goes with it, since
      // its input carries the old path.
      set({ panel: next, params, phase: "loading", error: undefined, reply: null, write: { phase: "idle" } });
      void store.refresh();
    },
    navigate(panel, params = {}) {
      if (host.navigate) host.navigate(panel, params);
      else store.show(panel, params);
    },
    async refresh() {
      // Every request gets a number, and only the newest one may land: a slow reply must not overwrite the panel
      // the person already moved to, nor the same panel asked with different parameters.
      const seq = ++asked;
      const input = { panel: state.panel, ...state.params };
      try {
        const reply = await host.snapshot(input);
        if (seq !== asked) return;
        set({ reply, phase: "ready", error: undefined });
      } catch (error) {
        if (seq !== asked) return;
        const cause = error instanceof Error ? error.message : String(error ?? "");
        set({ phase: "error", error: cause ? `Could not load this panel: ${cause}. Retry, or check the host connection.` : "Could not load this panel. Retry, or check the host connection." });
      }
    },
    setTheme(theme) {
      set({ prefs: writePrefs({ ...state.prefs, theme }, storage), theme: resolveTheme(theme, host.theme()) });
    },
    setWrite(write) {
      set({ write });
    },
    async beginWrite(input) {
      const result = await startWrite(host, input);
      // A host that owns the confirmation already told the person through its own notification (`quiet`), so the
      // panel keeps no dialog state for it; anything else is shown here.
      set({ write: result.phase === "done" && result.quiet ? { phase: "idle" } : result });
      if (result.phase === "done") void store.refresh();
    },
    async confirmWriteNow() {
      const current = state.write;
      if (current.phase !== "preview") return;
      const result = await confirmWrite(host, current);
      set({ write: result });
      if (result.phase === "done") void store.refresh();
    },
    start() {
      const stops: (() => void)[] = [];
      if (host.subscribe) stops.push(host.subscribe((reply) => set({ reply, phase: "ready", error: undefined })));
      else {
        const timer = setInterval(() => void store.refresh(), options.intervalMs ?? 5000);
        stops.push(() => clearInterval(timer));
      }
      if (host.onTheme) stops.push(host.onTheme((theme) => set({ theme: resolveTheme(state.prefs.theme, theme) })));
      return () => {
        for (const stop of stops) stop();
      };
    },
  };
  return store;
}
