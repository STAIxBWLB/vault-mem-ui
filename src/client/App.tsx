/**
 * The panel: `PanelView` renders one client state and is pure (so a test can render it as static markup);
 * `App` wires it to a store, the keyboard shortcuts and the reduced-motion switch.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { globalKey, prefersReducedMotion } from "./a11y.ts";
import { Notice, WriteDialog } from "./components.tsx";
import type { ActionInput, Host } from "./host.ts";
import { PANEL_IDS, type ThemePref } from "./prefs.ts";
import { createStore, type ClientStore, type ClientState } from "./store.ts";
import { LintView } from "./views/lint.tsx";
import { LogView } from "./views/log.tsx";
import { NoteView } from "./views/note.tsx";
import { NotesView } from "./views/notes.tsx";
import { OverviewView } from "./views/overview.tsx";
import { PromoteView } from "./views/promote.tsx";

const TITLES: Record<string, string> = {
  overview: "Overview",
  notes: "Search",
  note: "Note",
  promote: "Promote",
  lint: "Lint",
  log: "Log",
};

const VIEWS = {
  overview: OverviewView,
  notes: NotesView,
  note: NoteView,
  promote: PromoteView,
  lint: LintView,
  log: LogView,
};

export type Navigate = (panel: string, params?: Record<string, string>) => void;

export interface PanelViewProps {
  state: ClientState;
  onNavigate: Navigate;
  onWrite(input: ActionInput): void;
  onTheme(theme: ThemePref): void;
  onConfirm(): void;
  onCancel(): void;
  reducedMotion: boolean;
  onToggleMotion(): void;
}

/** One rendered panel. No store, no effects: every action is a prop. */
export function PanelView(props: PanelViewProps) {
  const state = props.state;
  const View = VIEWS[state.panel as keyof typeof VIEWS] ?? OverviewView;
  return (
    <div className="vmem" data-theme={state.theme.mode} data-motion={props.reducedMotion ? "reduced" : undefined}>
      <header className="vmem-head">
        <nav className="vmem-nav" aria-label="Vault panels">
          {PANEL_IDS.map((id) => (
            <button
              key={id}
              type="button"
              className={`vmem-nav-item${id === state.panel ? " vmem-nav-current" : ""}`}
              aria-current={id === state.panel ? "page" : undefined}
              onClick={() => props.onNavigate(id)}
            >
              {TITLES[id]}
            </button>
          ))}
        </nav>
        <div className="vmem-tools">
          <label className="vmem-label" htmlFor="vmem-theme">
            Theme
          </label>
          <select
            id="vmem-theme"
            className="vmem-input"
            value={state.prefs.theme}
            onChange={(event) => props.onTheme(event.currentTarget.value as ThemePref)}
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
          <button type="button" className="vmem-button" aria-pressed={props.reducedMotion} onClick={props.onToggleMotion}>
            {props.reducedMotion ? "Motion off" : "Reduce motion"}
          </button>
        </div>
      </header>
      <p className="vmem-sub vmem-hint">
        Arrow keys move through a list, Enter opens, <kbd>/</kbd> focuses search, <kbd>Esc</kbd> closes a dialog.
      </p>
      <main className="vmem-main">
        {state.phase === "error" && state.error ? <Notice tone="err">{state.error}</Notice> : null}
        {state.phase === "loading" && !state.reply ? <p className="vmem-sub">Loading {TITLES[state.panel] ?? state.panel}…</p> : null}
        {state.reply ? (
          <View reply={state.reply} params={state.params} navigate={props.onNavigate} beginWrite={props.onWrite} />
        ) : null}
      </main>
      <WriteDialog state={state.write} onConfirm={props.onConfirm} onCancel={props.onCancel} />
    </div>
  );
}

export function App({ store }: { store: ClientStore }) {
  const state = useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.getState(),
    () => store.getState(),
  );
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [reduced, setReduced] = useState(() => prefersReducedMotion());
  const openWrite = state.write.phase !== "idle";

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const action = globalKey(event.key, store.getState().write.phase !== "idle");
      if (action === "close") store.setWrite({ phase: "idle" });
      if (action === "search") {
        const field = rootRef.current?.querySelector<HTMLInputElement>('input[type="search"]');
        if (field) {
          event.preventDefault();
          field.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [store, openWrite]);

  return (
    <div ref={rootRef}>
      <PanelView
        state={state}
        onNavigate={(panel, params) => store.navigate(panel, params)}
        onWrite={(input) => void store.beginWrite(input)}
        onTheme={(theme) => store.setTheme(theme)}
        onConfirm={() => void store.confirmWriteNow()}
        onCancel={() => store.setWrite({ phase: "idle" })}
        reducedMotion={reduced}
        onToggleMotion={() => setReduced((value) => !value)}
      />
    </div>
  );
}

export function createClient(host: Host, options: { initialPanel?: string } = {}): ClientStore {
  return createStore(host, options);
}
