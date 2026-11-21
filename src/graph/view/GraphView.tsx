/**
 * Graph panel: Sigma canvas, layout worker, toolbar and keyboard. Adapted from STAIxBWLB/maru@b33341df
 * src/components/graph/GraphView.tsx (toolbar, local view, path, pins, layout status), reduced to what the
 * vmem provider can supply. Data arrives as `reply.graph` in GraphInput shape; until vault-mem #266 defines the
 * provider's graph snapshot this panel states that the graph is not available instead of guessing a wire format.
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Empty, Notice } from "../../client/components.tsx";
import type { ViewProps } from "../../client/views/common.ts";
import { startLayout, type LayoutHandle } from "../layout/client";
import { buildGraphModel, type GraphModel } from "../model";
import type { GraphInput } from "../types";
import { hashPosition, loadCanvasDeps, mountGraphCanvas, type CanvasDeps, type GraphCanvasHandle } from "./canvas";
import type { CacheStorage } from "./cache";
import { LOD_EDGE_THRESHOLD } from "./lod";
import { createGraphViewStore, type GraphViewStore, type LayoutStatus } from "./state";

/** A GraphInput when `value` has the shape; anything else is null (the panel then explains why there is no graph).
 *  Edges to absent nodes are kept: buildGraphModel turns their endpoints into unresolved ghost nodes. */
export function readGraphInput(value: unknown): GraphInput | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<GraphInput>;
  if (!Array.isArray(v.nodes) || !Array.isArray(v.edges)) return null;
  const nodes = v.nodes.filter((n) => n && typeof n.id === "string" && typeof n.label === "string");
  const edges = v.edges.filter((e) => e && typeof e.source === "string" && typeof e.target === "string" && typeof e.relation === "string");
  return { nodes: nodes.map((n) => ({ ...n, relPath: typeof n.relPath === "string" ? n.relPath : null })), edges: edges.map((e) => ({ ...e, fromFrontmatter: e.fromFrontmatter === true })), ...(v.communities ? { communities: v.communities } : {}) };
}

export interface GraphEnv {
  /** The panel module URL the layout worker starts from. */
  moduleUrl?: URL | string;
  workerAllowed?: boolean;
  storage?: CacheStorage;
  canvasDeps?: () => Promise<CanvasDeps>;
  createWorker?: (url: URL | string, options: WorkerOptions) => Worker;
}

let env: GraphEnv = {};
/** Set once by the panel entry (`new URL(import.meta.url)`); tests set fakes. */
export function configureGraph(next: GraphEnv): void {
  env = next;
}

function browserStorage(): CacheStorage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function layoutLabel(status: LayoutStatus): string {
  switch (status.kind) {
    case "idle": return "Layout not started";
    case "running": return `Laying out (${status.iterations} iterations)`;
    case "paused": return `Layout paused at ${status.iterations} iterations`;
    case "settled": return `Layout settled after ${status.iterations} iterations`;
    case "cached-only": return status.reason;
    case "error": return `Layout stopped: ${status.message}. Reload the panel to try again.`;
  }
}

export function GraphPanel({ reply, navigate, theme }: ViewProps) {
  const input = useMemo(() => readGraphInput(reply.graph), [reply.graph]);
  const model = useMemo(() => (input ? buildGraphModel(input) : null), [input]);
  if (!model) {
    const reason = typeof reply.unavailable === "string" ? reply.unavailable : "this vmem provider does not send a graph snapshot yet (vault-mem #266); update @staix/vault-mem, then reload this panel";
    return <Empty title="Graph not available" hint={reason.charAt(0).toUpperCase() + reason.slice(1) + "."} />;
  }
  if (model.nodes.length === 0) return <Empty title="No notes to graph" hint="Add notes or links to the vault, then reload this panel." />;
  return <GraphCanvasView key={model.nodes.length + ":" + model.edges.length} model={model} navigate={navigate} themeKey={theme ? theme.mode + JSON.stringify(theme.tokens ?? {}) : ""} />;
}

function GraphCanvasView({ model, navigate, themeKey }: { model: GraphModel; navigate: ViewProps["navigate"]; themeKey: string }) {
  const store = useMemo<GraphViewStore>(() => createGraphViewStore(model, { storage: env.storage ?? browserStorage() }), [model]);
  const state = useSyncExternalStore((l) => store.subscribe(l), () => store.getState(), () => store.getState());
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<GraphCanvasHandle | null>(null);
  const layoutRef = useRef<LayoutHandle | null>(null);
  const [canvasError, setCanvasError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let lastSave = 0;
    const host = hostRef.current;
    if (!host) return;
    (env.canvasDeps ?? loadCanvasDeps)()
      .then((deps) => {
        if (cancelled) return;
        canvasRef.current = mountGraphCanvas(host, model, store.getState(), store.cachedPositions(), {
          onHover: (id) => store.hover(id),
          onClick: (id) => store.select(id),
          onCamera: (ratio) => store.setCamera(ratio),
        }, deps);
        return startLayout({
          moduleUrl: env.moduleUrl ?? "",
          workerAllowed: env.moduleUrl ? env.workerAllowed : false,
          createWorker: env.createWorker,
          graph: store.layoutGraph(hashPosition),
          onPositions(positions, iterations) {
            canvasRef.current?.applyPositions(positions);
            const now = Date.now();
            if (now - lastSave > 2_000) { lastSave = now; store.savePositions(positions); }
            const kind = store.getState().layout.kind;
            if (kind !== "paused") store.setLayout({ kind: "running", iterations });
          },
          onState(s) {
            const iterations = "iterations" in store.getState().layout ? (store.getState().layout as { iterations: number }).iterations : 0;
            if (s === "paused") store.setLayout({ kind: "paused", iterations });
            if (s === "done" || s === "stopped") store.setLayout({ kind: "settled", iterations });
          },
          onError: (message) => store.setLayout({ kind: "error", message }),
        }).then((handle) => {
          if (cancelled) { if (handle.state === "running") handle.teardown(); return; }
          if (handle.state === "cached-only") store.setLayout({ kind: "cached-only", reason: handle.reason });
          else { layoutRef.current = handle; store.setLayout({ kind: "running", iterations: 0 }); }
        });
      })
      .catch((error: unknown) => {
        if (!cancelled) setCanvasError(`the graph canvas could not start (${error instanceof Error ? error.message : String(error)}); this browser may lack WebGL. Try another browser or enable hardware acceleration.`);
      });
    return () => {
      cancelled = true;
      layoutRef.current?.teardown();
      layoutRef.current = null;
      canvasRef.current?.destroy();
      canvasRef.current = null;
    };
  }, [model, store]);

  useEffect(() => { canvasRef.current?.update(state); }, [state]);
  // The theme reaches the canvas through the container's computed tokens; re-read them after React applied the
  // new data-theme (this effect runs after commit).
  useEffect(() => { canvasRef.current?.refreshTheme(); }, [themeKey]);

  const togglePin = (id: string) => {
    const wasPinned = store.getState().pinned.has(id);
    store.togglePin(id);
    const index = model.nodes.findIndex((n) => n.id === id);
    const live = canvasRef.current?.positionOf(id) ?? undefined;
    layoutRef.current?.fix([{ index, fixed: !wasPinned, ...(live ? { position: live } : {}) }]);
    if (store.getState().layout.kind === "settled" && layoutRef.current) {
      store.setLayout({ kind: "running", iterations: (store.getState().layout as { iterations: number }).iterations });
    }
  };

  const selected = state.selectedId ? model.nodes.find((n) => n.id === state.selectedId) ?? null : null;
  const running = state.layout.kind === "running";
  const paused = state.layout.kind === "paused";

  const onKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const key = event.key;
    if (key === "ArrowRight" || key === "ArrowDown") store.step(1);
    else if (key === "ArrowLeft" || key === "ArrowUp") store.step(-1);
    else if (key === "Enter" && state.selectedId) openNote(state.selectedId);
    else if (key === "l" && state.selectedId) store.openLocal(state.selectedId);
    else if (key === "p" && state.selectedId) store.pathTo(state.selectedId);
    else if (key === "Escape") { store.pathTo(null); store.openLocal(null); store.select(null); }
    else return;
    event.preventDefault();
    const id = store.getState().selectedId;
    if (id && key.startsWith("Arrow")) canvasRef.current?.focusNode(id);
  };
  const openNote = (id: string) => {
    const node = model.nodes.find((n) => n.id === id);
    if (node?.relPath) navigate("note", { path: node.relPath });
  };

  return (
    <section className="vmem-graph" aria-label="Vault graph">
      <div className="vmem-graph-bar" role="toolbar" aria-label="Graph controls">
        <span className="vmem-sub">{state.derived.visibleModel.nodes.length} notes · {state.derived.visibleModel.edges.length} links{model.edges.length > LOD_EDGE_THRESHOLD ? " · large graph, detail reduced while moving" : ""}</span>
        {state.mode === "local" ? <button type="button" className="vmem-button" onClick={() => store.openLocal(null)}>Global view</button> : null}
        <button type="button" className="vmem-button" disabled={!selected} onClick={() => selected && store.openLocal(selected.id)}>Local view</button>
        <button type="button" className="vmem-button" disabled={!selected} aria-pressed={state.pathSourceId !== null && !state.path} onClick={() => selected && store.pathTo(selected.id)}>
          {state.pathSourceId && !state.path ? "Path to…" : "Path from"}
        </button>
        <button type="button" className="vmem-button" disabled={!selected} aria-pressed={selected ? state.pinned.has(selected.id) : false} onClick={() => selected && togglePin(selected.id)}>Pin</button>
        {model.enriched ? <button type="button" className="vmem-button" aria-pressed={state.colorByCommunity} onClick={() => store.setColorByCommunity(!state.colorByCommunity)}>Communities</button> : null}
        {running || paused ? <button type="button" className="vmem-button" onClick={() => (paused ? layoutRef.current?.resume() : layoutRef.current?.pause())}>{paused ? "Resume layout" : "Pause layout"}</button> : null}
      </div>
      <p className="vmem-sub vmem-graph-status" role="status">{layoutLabel(state.layout)}</p>
      {canvasError ? <Notice tone="err">{canvasError}</Notice> : null}
      {state.derived.focusMissing ? <Notice tone="warn">The focused note is not in this graph. Choose Global view.</Notice> : null}
      {state.pathMissing ? <Notice tone="warn">No path connects these notes. Pick another endpoint.</Notice> : null}
      <div
        ref={hostRef}
        className="vmem-graph-canvas"
        tabIndex={0}
        role="application"
        aria-label="Graph canvas. Arrow keys move between linked notes, Enter opens, L opens the local view, P picks path endpoints, Escape clears."
        aria-describedby="vmem-graph-selected"
        onKeyDown={onKey}
      />
      <p id="vmem-graph-selected" className="vmem-sub" aria-live="polite">
        {selected ? `${selected.label}${selected.relPath ? "" : " (unresolved link)"} · ${selected.degree} links${state.path ? ` · path of ${state.path.length - 1} steps` : ""}` : "No note selected"}
      </p>
    </section>
  );
}
