/** One store for the panel: the active panel, its snapshot, the theme and the write flow. */

import type { ActionInput, Host, SnapshotReply, Theme } from "./host.ts";
import { browserStorage, readPrefs, writePrefs, type Prefs, type StorageLike, type ThemePref } from "./prefs.ts";
import { confirmWrite, startWrite, type WriteState } from "./write.ts";
import { assembleGraphPages } from "../graph/view/graph-snapshot.ts";

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
  /** Time before a pending confirmation can be dismissed. */
  confirmWaitMs?: number;
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
  // The write flow that owns the dialog right now. A pending preview or confirmation may only land while its ticket
  // is still current, so a reply cannot reopen a write on a panel or view the person already left, or after Cancel.
  let ticket = 0;
  let hostWritePending = false;
  // A write changes what the graph pages say, so the cursor the panel holds may predate it. Until the provider sends
  // the graph itself (not a cursor-only `changed: false` stub), it is asked for its first page instead of
  // `after: cursor`, which would answer `changed: false` and keep the graph the person just changed.
  let freshGraph = false;
  const acceptSnapshot = async (reply: SnapshotReply, seq: number, panel: string, params: Record<string, string>) => {
    if (seq !== asked) return;
    const stats = state.reply?.graphStats as { cursor?: unknown; vault?: unknown; revision?: unknown } | undefined;
    if (panel === "graph" && state.reply?.graph && stats && reply.schema === 1 && reply.kind === "nodes" && reply.offset === 0 && typeof reply.cursor === "number" && Number.isSafeInteger(reply.cursor) && reply.cursor >= 0 && reply.vault === stats.vault && reply.revision === stats.revision) {
      // The same revision as the graph the panel holds, so no first-page read is owed any more.
      freshGraph = false;
      if (reply.cursor !== stats.cursor) set({ reply: { ...state.reply, graphStats: { ...stats, cursor: reply.cursor } }, phase: "ready", error: undefined });
      else if (state.phase !== "ready" || state.error) set({ phase: "ready", error: undefined });
      return;
    }
    const assembled = panel === "graph" ? await assembleGraphPages((input) => host.snapshot(input), reply, params, () => seq === asked) : reply;
    if (seq !== asked) return;
    if (assembled.changed === false && state.reply) {
      // A stub carries no graph, so the first-page demand stands for the next refresh.
      if (state.phase !== "ready" || state.error) set({ phase: "ready", error: undefined });
      return;
    }
    if (panel === "graph") freshGraph = false;
    set({ reply: assembled, phase: "ready", error: undefined });
  };
  const own = (write: WriteState) => {
    ticket += 1;
    set({ write });
  };

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
      ticket += 1;
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
      const stats = state.reply?.graphStats as { cursor?: unknown } | undefined;
      const input = { panel: state.panel, ...state.params, ...(state.panel === "graph" && state.reply?.graph && !freshGraph && typeof stats?.cursor === "number" ? { after: stats.cursor } : {}) };
      try {
        const reply = await host.snapshot(input);
        await acceptSnapshot(reply, seq, input.panel, state.params);
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
      if (state.write.phase === "confirming") return;
      // Closing or replacing the dialog also supersedes whatever is still being asked for.
      own(write);
    },
    async beginWrite(input) {
      if (state.write.phase === "confirming" || state.write.phase === "waiting" || hostWritePending) return;
      const mine = ++ticket;
      if (host.confirm === "host") hostWritePending = true;
      const result = await startWrite(host, input).finally(() => { hostWritePending = false; });
      // The person moved to another panel, another note or another write while this preview was in flight.
      if (mine !== ticket) return;
      // A host that owns the confirmation already told the person through its own notification (`quiet`), so the
      // panel keeps no dialog state for it; anything else is shown here.
      set({ write: result.phase === "done" && result.quiet ? { phase: "idle" } : result });
      if (result.phase === "done") {
        if (state.panel === "graph") freshGraph = true;
        void store.refresh();
      }
    },
    async confirmWriteNow() {
      const current = state.write;
      if (current.phase !== "preview") return;
      const mine = ++ticket;
      set({ write: { phase: "confirming", verb: current.verb } });
      const timer = setTimeout(() => {
        if (mine === ticket) set({ write: { phase: "waiting", message: "Still waiting for the vault. It may already be applied; reload the panel to see the current state." } });
      }, options.confirmWaitMs ?? 30_000);
      const result = await confirmWrite(host, current);
      clearTimeout(timer);
      if (mine !== ticket) return;
      set({ write: result });
      if (result.phase === "done") {
        if (state.panel === "graph") freshGraph = true;
        void store.refresh();
      }
    },
    start() {
      const stops: (() => void)[] = [];
      if (host.subscribe) stops.push(host.subscribe((reply) => {
        const seq = ++asked, panel = state.panel, params = state.params;
        void acceptSnapshot(reply, seq, panel, params).catch((error) => {
          if (seq === asked) set({ phase: "error", error: error instanceof Error ? error.message : String(error) });
        });
      }));
      else {
        // A background tab must not keep a standalone server alive indefinitely.
        const page = typeof document !== "undefined" && typeof document.addEventListener === "function" && typeof document.removeEventListener === "function" ? document : undefined;
        let hidden = page?.hidden ?? false;
        const timer = setInterval(() => { if (!page?.hidden) void store.refresh(); }, options.intervalMs ?? 5000);
        const visibility = () => {
          const wasHidden = hidden;
          hidden = page?.hidden ?? false;
          if (wasHidden && !hidden) void store.refresh();
        };
        page?.addEventListener("visibilitychange", visibility);
        stops.push(() => { clearInterval(timer); page?.removeEventListener("visibilitychange", visibility); });
      }
      if (host.onTheme) stops.push(host.onTheme((theme) => set({ theme: resolveTheme(state.prefs.theme, theme) })));
      return () => {
        for (const stop of stops) stop();
      };
    },
  };
  return store;
}
