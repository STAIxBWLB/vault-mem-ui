/**
 * Graph panel: Sigma canvas, layout worker, toolbar and keyboard. Adapted from STAIxBWLB/maru@b33341df
 * src/components/graph/GraphView.tsx (toolbar, local view, path, pins, layout status), reduced to what the
 * vmem provider can supply. The client store assembles provider pages into `reply.graph` before rendering.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Empty, Notice } from "../../client/components.tsx";
import { GraphExportButton } from "../../client/graph-export.tsx";
import type { GraphPositions } from "../export.ts";
import type { SnapshotReply } from "../../client/host.ts";
import { vaultParam, type ViewProps } from "../../client/views/common.ts";
import { linkAction } from "../../client/write.ts";
import { startLayout, type LayoutHandle } from "../layout/client";
import { withSemanticSprings } from "../layout/semantic";
import { buildGraphModel, type GraphModel } from "../model";
import type { GraphInput } from "../types";
import { hashPosition, loadCanvasDeps, mountGraphCanvas, type CanvasDeps, type GraphCanvasHandle } from "./canvas";
import type { CacheStorage } from "./cache";
import { LOD_EDGE_THRESHOLD } from "./lod";
import { GraphChainsPanel, GraphFilterPanel, GraphInspector, GraphInsightsPanel, GraphLegend, type LinkProposal, type SimilarNotes } from "./SidePanels";
import { createGraphViewStore, type GraphViewStore, type LayoutStatus } from "./state";
import { OPEN_PROFILE } from "./state";
import { assembleSemanticPages, type SemanticEdge } from "./graph-snapshot";

/** A GraphInput when `value` has the shape; anything else is null (the panel then explains why there is no graph).
 *  Edges to absent nodes are kept: buildGraphModel turns their endpoints into unresolved ghost nodes. */
export function readGraphInput(value: unknown): GraphInput | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<GraphInput>;
  if (!Array.isArray(v.nodes) || !Array.isArray(v.edges)) return null;
  const nodes = v.nodes.filter((n) => n && typeof n.id === "string" && typeof n.label === "string");
  const edges = v.edges.filter((e) => e && typeof e.source === "string" && typeof e.target === "string" && typeof e.relation === "string");
  return { nodes: nodes.map((n) => ({ ...n, relPath: typeof n.relPath === "string" ? n.relPath : null })), edges: edges.map((e) => ({ ...e, fromFrontmatter: e.fromFrontmatter === true, inferred: e.inferred === true })), ...(v.communities ? { communities: v.communities } : {}) };
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
    // Worker and client messages already name the cause and the next step.
    case "error": return status.message;
  }
}

/** Exact serialized content of a graph input: equal for a resent identical graph, different for any change. */
export function graphContent(input: GraphInput): string {
  return JSON.stringify(input);
}

/** The actions the provider declared for this panel, as its manifest's `capabilities.actions` reached the reply. */
export function declaredActions(reply: SnapshotReply): string[] {
  const capabilities = reply.capabilities;
  if (!capabilities || typeof capabilities !== "object") return [];
  const actions = (capabilities as { actions?: unknown }).actions;
  return Array.isArray(actions) ? actions.filter((action): action is string => typeof action === "string") : [];
}

export function GraphPanel({ reply, params, navigate, theme, beginWrite, graphSnapshot }: ViewProps) {
  // Every poll or push hands over a new reply object; only a changed graph may rebuild the view (and its worker).
  // Content is compared exactly (no hash, so no collisions); the generation counter is the React key.
  const parsed = useMemo(() => readGraphInput(reply.graph), [reply.graph]);
  // Derived state (React's "store information from previous renders" pattern): a changed content bumps the
  // generation during render; no ref is written while rendering.
  const [seen, setSeen] = useState<{ content: string | null; generation: number }>({ content: null, generation: 0 });
  const content = parsed ? graphContent(parsed) : null;
  if (content !== seen.content) setSeen({ content, generation: seen.generation + 1 });
  const generation = content !== seen.content ? seen.generation + 1 : seen.generation;
  const model = useMemo(() => (parsed ? buildGraphModel(parsed) : null), [generation]); // keyed on content, not identity
  if (typeof reply.error === "string") return <><Notice tone="err">{reply.error}</Notice>{/restart from the first page/i.test(reply.error) && <button type="button" className="vmem-button" onClick={() => navigate("graph", vaultParam(params))}>First page</button>}</>;
  if (!model) {
    const reason = typeof reply.unavailable === "string" ? reply.unavailable : "this vmem provider does not send a graph snapshot yet (vault-mem #266); update @staix/vault-mem, then reload this panel";
    return <Empty title="Graph not available" hint={reason.charAt(0).toUpperCase() + reason.slice(1) + "."} />;
  }
  if (model.nodes.length === 0) return <Empty title="No notes to graph" hint="Add notes or links to the vault, then reload this panel." />;
  const stats = reply.graphStats as { revision?: string; vault?: string; placeholdersOmitted?: number } | undefined;
  return <>{Number(stats?.placeholdersOmitted) > 0 && <Notice tone="warn">Some unresolved links were omitted by the provider because the graph reached its size limit.</Notice>}<GraphCanvasView key={generation} model={model} params={params} navigate={navigate} beginWrite={beginWrite} graphSnapshot={graphSnapshot} enrichment={reply.enrichment !== undefined} vault={stats?.vault} revision={stats?.revision} canLink={declaredActions(reply).includes("link")} themeKey={theme ? theme.mode + JSON.stringify(theme.tokens ?? {}) : ""} /></>;
}

function GraphCanvasView({ model, params, navigate, beginWrite, graphSnapshot, enrichment, vault, revision, canLink, themeKey }: { model: GraphModel; params: Record<string, string>; navigate: ViewProps["navigate"]; beginWrite: ViewProps["beginWrite"]; graphSnapshot: ViewProps["graphSnapshot"]; enrichment: boolean; vault?: string; revision?: string; canLink: boolean; themeKey: string }) {
  const store = useMemo<GraphViewStore>(() => createGraphViewStore(model, { storage: env.storage ?? browserStorage() }), [model]);
  const hasSupersedes = useMemo(() => model.edges.some((edge) => edge.relation === "supersedes" || edge.relation === "superseded_by"), [model]);
  const subscribe = useCallback((listener: () => void) => store.subscribe(listener), [store]);
  const state = useSyncExternalStore(subscribe, store.getState, store.getState);
  const selectedTextId = useId();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<GraphCanvasHandle | null>(null);
  const layoutRef = useRef<LayoutHandle | null>(null);
  const [canvasError, setCanvasError] = useState<string | null>(null);
  const [canvasReady, setCanvasReady] = useState(false);
  const [semanticOn, setSemanticOn] = useState(false);
  const [semanticEdges, setSemanticEdges] = useState<SemanticEdge[] | null>(null);
  const [semanticError, setSemanticError] = useState<string | null>(null);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const [similar, setSimilar] = useState<{ path?: string; loading: boolean; hits: { path: string; title: string; score: number }[]; error?: string }>({ loading: false, hits: [] });
  const selected = state.selectedId ? state.derived.visibleModel.nodes.find((n) => n.id === state.selectedId) ?? null : null;

  useEffect(() => {
    let active = true;
    setSemanticEdges(null); setSemanticLoading(false);
    if (semanticOn && enrichment && vault && revision && graphSnapshot) {
      setSemanticError(null); setSemanticLoading(true);
      void assembleSemanticPages((input) => graphSnapshot(input), vault, revision, model.nodes.length, () => active)
        .then((result) => { if (!active) return; setSemanticLoading(false); if ("error" in result) { setSemanticOn(false); setSemanticError(result.error); } else setSemanticEdges(result.edges); })
        .catch((error: unknown) => { if (active) { setSemanticLoading(false); setSemanticOn(false); setSemanticError(error instanceof Error ? error.message : String(error)); } });
    }
    return () => { active = false; };
  }, [semanticOn, enrichment, vault, revision, graphSnapshot, model]);

  useEffect(() => {
    let active = true;
    if (!enrichment || !vault || !graphSnapshot || !selected?.relPath) { setSimilar({ loading: false, hits: [] }); return () => { active = false; }; }
    const path = selected.relPath;
    setSimilar({ path, loading: true, hits: [] });
    void graphSnapshot({ vault, similar: path, limit: 10 }).then((reply) => {
      if (!active) return;
      if (typeof reply.error === "string") { setSimilar({ path, loading: false, hits: [], error: reply.error }); return; }
      const hits = Array.isArray(reply.similar) ? reply.similar.filter((item): item is { path: string; title: string; score: number } => Boolean(item && typeof item === "object" && typeof item.path === "string" && typeof item.title === "string" && typeof item.score === "number" && Number.isFinite(item.score))) : [];
      setSimilar({ path, loading: false, hits });
    }).catch((error: unknown) => { if (active) setSimilar({ path, loading: false, hits: [], error: error instanceof Error ? error.message : String(error) }); });
    return () => { active = false; };
  }, [enrichment, vault, graphSnapshot, selected?.relPath]);

  useEffect(() => {
    setCanvasReady(false);
    setCanvasError(null);
    let cancelled = false;
    let lastSave = 0;
    let initialFixed: Uint8Array = new Uint8Array(0);
    let latest: Float32Array | null = null;
    const save = () => { if (latest) { store.savePositions(latest); lastSave = Date.now(); } };
    const host = hostRef.current;
    if (!host) return;
    let stage: "canvas" | "layout" = "canvas";
    (env.canvasDeps ?? loadCanvasDeps)()
      .then((deps) => {
        if (cancelled) return;
        canvasRef.current = mountGraphCanvas(host, model, store.getState(), store.cachedPositions(), {
          onHover: (id) => store.hover(id),
          onClick: (id) => store.select(id),
          onCamera: (ratio) => store.setCamera(ratio),
        }, deps);
        setCanvasReady(true);
        stage = "layout";
        const initial = withSemanticSprings(store.layoutGraph(hashPosition), semanticEdges ?? []);
        initialFixed = initial.fixed ?? new Uint8Array(model.nodes.length);
        return startLayout({
          moduleUrl: env.moduleUrl ?? "",
          workerAllowed: env.moduleUrl ? env.workerAllowed : false,
          createWorker: env.createWorker,
          graph: initial,
          onPositions(positions, iterations) {
            canvasRef.current?.applyPositions(positions);
            latest = positions;
            if (Date.now() - lastSave > 2_000) save();
            if (store.getState().layout.kind !== "paused") store.setLayout({ kind: "running", iterations });
          },
          onState(s) {
            const current = store.getState().layout;
            const iterations = "iterations" in current ? current.iterations : 0;
            if (s === "running") store.setLayout({ kind: "running", iterations });
            if (s === "paused") store.setLayout({ kind: "paused", iterations });
            if (s === "done" || s === "stopped") { save(); store.setLayout({ kind: "settled", iterations }); }
          },
          onError: (message) => store.setLayout({ kind: "error", message }),
        }).then((handle) => {
          if (cancelled) { if (handle.state === "running") handle.teardown(); return; }
          if (handle.state === "cached-only") store.setLayout({ kind: "cached-only", reason: handle.reason });
          else {
            layoutRef.current = handle;
            // Pins toggled between init and ready were only in the store; bring the worker up to date now.
            const drift = model.nodes.flatMap((node, index) => {
              const pinned = store.getState().pinned.has(node.id);
              if (pinned === (initialFixed[index] === 1)) return [];
              const live = canvasRef.current?.positionOf(node.id);
              return [{ index, fixed: pinned, ...(live ? { position: live } : {}) }];
            });
            if (drift.length) handle.fix(drift);
            store.setLayout({ kind: "running", iterations: 0 });
          }
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const detail = error instanceof Error ? error.message : String(error);
        if (stage === "canvas") setCanvasError(`the graph canvas could not start (${detail}); this browser may lack WebGL. Try another browser or enable hardware acceleration.`);
        else store.setLayout({ kind: "error", message: `the graph layout could not start (${detail}); the canvas keeps the cached positions. Reload the panel to try again.` });
      });
    return () => {
      cancelled = true;
      save();
      layoutRef.current?.teardown();
      layoutRef.current = null;
      canvasRef.current?.destroy();
      canvasRef.current = null;
    };
  }, [model, store, semanticEdges]);

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

  const readVisiblePositions = (): GraphPositions => {
    const positions: Record<string, [number, number]> = Object.create(null);
    for (const node of state.derived.visibleModel.nodes) {
      const point = canvasRef.current?.positionOf(node.id);
      if (point) positions[node.id] = point;
    }
    return positions;
  };
  const running = state.layout.kind === "running";
  const paused = state.layout.kind === "paused";

  const onKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // Leave browser and host shortcuts (Ctrl/Cmd+P, Ctrl+L, Alt+arrows) alone.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key;
    if (key === "ArrowRight" || key === "ArrowDown") store.step(1);
    else if (key === "ArrowLeft" || key === "ArrowUp") store.step(-1);
    else if (key === "Enter" && state.selectedId) openNote(state.selectedId);
    else if (key === "l" && state.selectedId) store.openLocal(state.selectedId);
    else if (key === "p" && state.selectedId) store.pathTo(state.selectedId);
    else if (key === "Escape") { store.pathTo(null); if (state.mode === "chains") store.clearChainFocus(); else { store.openLocal(null); store.select(null); } }
    else return;
    event.preventDefault();
    const id = store.getState().selectedId;
    if (id && key.startsWith("Arrow")) canvasRef.current?.focusNode(id);
  };
  const openNote = useCallback((id: string) => {
    const node = model.nodes.find((n) => n.id === id);
    if (node?.relPath) navigate("note", { path: node.relPath, ...vaultParam(params) });
  }, [model, navigate, params]);
  const focusChain = useCallback((ids: string[]) => { store.focusChain(ids); canvasRef.current?.focusNodes(ids); }, [store]);
  const similarNode = (path: string) => model.nodes.find((item) => item.relPath === (path.startsWith("notes/") ? path : `notes/${path}`));
  const similarNotes: SimilarNotes | undefined = enrichment && selected?.relPath ? { ...(similar.path === selected.relPath ? similar : { loading: true, hits: [] }), select: (path) => {
    const node = similarNode(path);
    if (!node) return;
    if (!store.getState().derived.visibleNodeIds.has(node.id)) { store.setMode("global"); store.setProfile({ ...OPEN_PROFILE }); store.setSearch(""); }
    store.select(node.id); canvasRef.current?.focusNode(node.id);
  }, contains: (path) => Boolean(similarNode(path)) } : undefined;
  let exportDisabledReason: string | undefined;
  if (canvasError) exportDisabledReason = "Export unavailable: the graph canvas could not start.";
  else if (!canvasReady) exportDisabledReason = "Export is available when the graph canvas is ready.";
  else if (!state.derived.visibleModel.nodes.length && state.mode === "chains") exportDisabledReason = "No decision nodes match; choose Global view to export.";
  else if (!state.derived.visibleModel.nodes.length) exportDisabledReason = "No nodes match; clear filters or search to export.";
  // A proposed link is a write like any other: the store previews it through the provider's two-step action and the
  // shared dialog confirms it, so the control is only offered when the provider declares that action.
  const link = useMemo<LinkProposal | undefined>(() => (canLink ? { propose: (input) => beginWrite(linkAction({ ...input, ...vaultParam(params) })) } : undefined), [canLink, beginWrite, params]);

  return (
    <section className="vmem-graph" aria-label="Vault graph">
      <div className="vmem-graph-bar" role="toolbar" aria-label="Graph controls">
        <span className="vmem-sub">{state.derived.visibleModel.nodes.length} notes · {state.derived.visibleModel.edges.length} links{model.edges.length > LOD_EDGE_THRESHOLD ? " · large graph, detail reduced while moving" : ""}</span>
        <GraphExportButton model={state.derived.visibleModel} positions={readVisiblePositions} disabledReason={exportDisabledReason} />
        <button type="button" className="vmem-button" aria-pressed={state.mode === "global"} onClick={() => store.setMode("global")}>Global view</button>
        <button type="button" className="vmem-button" aria-pressed={state.mode === "local"} disabled={!selected} onClick={() => selected && store.openLocal(selected.id)}>Local view</button>
        <button type="button" className="vmem-button" aria-pressed={state.mode === "chains"} onClick={() => store.setMode("chains")}>Decision chains</button>
        {enrichment && graphSnapshot && <button type="button" className="vmem-button" aria-pressed={semanticOn} onClick={() => { setSemanticError(null); setSemanticOn(!semanticOn); }}>Semantic layout</button>}
        <button type="button" className="vmem-button" disabled={!selected} aria-pressed={state.pathSourceId !== null && !state.path} onClick={() => selected && store.pathTo(selected.id)}>
          {state.pathSourceId && !state.path ? "Path to…" : "Path from"}
        </button>
        <button type="button" className="vmem-button" disabled={!selected} aria-pressed={selected ? state.pinned.has(selected.id) : false} onClick={() => selected && togglePin(selected.id)}>Pin</button>
        {model.enriched ? <button type="button" className="vmem-button" aria-pressed={state.colorByCommunity} onClick={() => store.setColorByCommunity(!state.colorByCommunity)}>Communities</button> : null}
        {running || paused ? <button type="button" className="vmem-button" onClick={() => (paused ? layoutRef.current?.resume() : layoutRef.current?.pause())}>{paused ? "Resume layout" : "Pause layout"}</button> : null}
      </div>
      <p className="vmem-sub vmem-graph-status" role="status">{layoutLabel(state.layout)}</p>
      {canvasError ? <Notice tone="err">{canvasError}</Notice> : null}
      {semanticLoading && <p role="status">Loading semantic layout...</p>}
      {semanticError && <><Notice tone="err">{semanticError}</Notice>{/restart from the first page/i.test(semanticError) && <button type="button" className="vmem-button" onClick={() => navigate("graph", vault ? { vault } : vaultParam(params))}>First page</button>}</>}
      {state.derived.focusMissing ? <Notice tone="warn">The focused note is not in this graph. Choose Global view.</Notice> : null}
      {state.pathMissing ? <Notice tone="warn">No path connects these notes. Pick another endpoint.</Notice> : null}
      <div
        ref={hostRef}
        className="vmem-graph-canvas"
        tabIndex={0}
        role="application"
        aria-label="Graph canvas. Arrow keys move between linked notes, Enter opens, L opens the local view, P picks path endpoints, Escape clears."
        aria-describedby={selectedTextId}
        onKeyDown={onKey}
      />
      <aside className="vmem-graph-sidebar" aria-label="Graph details">
        {state.mode === "chains" && <GraphChainsPanel model={model} visibleIds={state.derived.visibleNodeIds} chainFocusIds={state.chainFocusIds} hasSupersedes={hasSupersedes} search={state.search} focus={focusChain} open={openNote} />}
        <GraphFilterPanel state={state} store={store} />
        <GraphLegend state={state} themeKey={themeKey} />
        <GraphInspector node={state.derived.visibleModel.nodes.find((node) => node.id === state.selectedId) ?? null} model={state.derived.visibleModel} open={openNote} link={link} similar={similarNotes} />
        <GraphInsightsPanel model={state.derived.analysisModel} visibleIds={state.derived.visibleNodeIds} select={(id) => store.select(id)} />
      </aside>
      <p id={selectedTextId} className="vmem-sub" aria-live="polite">
        {selected ? `${selected.label}${selected.relPath ? "" : " (unresolved link)"} · ${selected.degree} links${state.path ? ` · path of ${state.path.length - 1} steps` : ""}` : "No note selected"}
      </p>
    </section>
  );
}
