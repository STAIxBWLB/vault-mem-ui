// Graph view state, independent of Sigma and React so it is testable on its own.
// Rewritten for this package; behaviour follows STAIxBWLB/maru@b33341df src/components/graph/GraphView.tsx (mode,
// focus, selection, hover, path, pins and layout status), without app state, i18n or export.

import { applyGraphSearch, deriveGraphView, type DerivedGraph } from "../derive";
import { shortestPath } from "../insights";
import { buildAdjacency, graphEdgeVisibilityKey, type GraphModel } from "../model";
import { graphTopologySignature } from "../style";
import type { GraphFilterProfile } from "../types";
import type { LayoutGraph } from "../layout/protocol";
import { readLayoutCache, writeLayoutCache, type CacheStorage } from "./cache";
import { lodFor, type Lod } from "./lod";

export type ViewMode = "global" | "local";
export type LayoutStatus =
  | { kind: "idle" }
  | { kind: "running"; iterations: number }
  | { kind: "paused"; iterations: number }
  | { kind: "settled"; iterations: number }
  | { kind: "cached-only"; reason: string }
  | { kind: "error"; message: string };

export interface GraphViewState {
  mode: ViewMode;
  /** Local view centre; also the node the keyboard moves from. */
  focusId: string | null;
  /** Fixed centre of the local view, independent of keyboard selection. */
  localCenterId: string | null;
  localDepth: 1 | 2 | 3;
  selectedId: string | null;
  hoverId: string | null;
  /** First endpoint chosen for a shortest path, then the found path (inclusive) or null when none exists. */
  pathSourceId: string | null;
  path: string[] | null;
  pathMissing: boolean;
  colorByCommunity: boolean;
  pinned: Set<string>;
  layout: LayoutStatus;
  cameraRatio: number;
  derived: DerivedGraph;
  profile: GraphFilterProfile;
  search: string;
  lod: Lod;
}

export const OPEN_PROFILE: GraphFilterProfile = {
  domains: [], origins: [], types: [], relations: [], community: null,
  showUnresolved: true, showGenerated: true, minVisibleNeighbors: 0,
};

export interface GraphViewStore {
  getState(): GraphViewState;
  subscribe(listener: () => void): () => void;
  readonly model: GraphModel;
  /** Cache key for this graph's positions and pins. */
  readonly cacheKey: string;
  select(id: string | null): void;
  hover(id: string | null): void;
  /** Local view around a node; null goes back to the global view. */
  openLocal(id: string | null, depth?: 1 | 2 | 3): void;
  /** First call picks the source, second finds the path; a call with null clears it. */
  pathTo(id: string | null): void;
  togglePin(id: string): void;
  setColorByCommunity(on: boolean): void;
  setProfile(profile: GraphFilterProfile): void;
  setSearch(search: string): void;
  setCamera(ratio: number): void;
  setLayout(status: LayoutStatus): void;
  /** Moves the selection to the next/previous visible neighbour (keyboard). */
  step(direction: 1 | -1): void;
  /** Layout input in model node order, seeded from the cache, with pins fixed. */
  layoutGraph(fallback: (id: string, index: number) => [number, number]): LayoutGraph;
  /** Stores the layout's latest positions (model order) and pins. */
  savePositions(positions: ArrayLike<number>): boolean;
  cachedPositions(): Record<string, [number, number]>;
}

export function createGraphViewStore(model: GraphModel, options: { storage?: CacheStorage } = {}): GraphViewStore {
  const listeners = new Set<() => void>();
  const cacheKey = graphTopologySignature(model.nodes, model.edges);
  const cached = readLayoutCache(options.storage, cacheKey);
  const ids = new Set(model.nodes.map((n) => n.id));
  const derive = (mode: ViewMode, focusId: string | null, depth: 1 | 2 | 3, profile: GraphFilterProfile) => deriveGraphView({
    model, profile, generatedPatterns: [], mode, focusNodeId: focusId,
    localDepth: depth, localDirection: "both", search: "", searchAsFilter: false,
  });
  let analysis = derive("global", null, 2, OPEN_PROFILE);
  let state: GraphViewState = {
    mode: "global", focusId: null, localCenterId: null, localDepth: 2, selectedId: null, hoverId: null,
    pathSourceId: null, path: null, pathMissing: false, colorByCommunity: model.enriched,
    pinned: new Set(cached.pinned.filter((id) => ids.has(id))),
    layout: { kind: "idle" }, cameraRatio: 1,
    profile: { ...OPEN_PROFILE }, search: "",
    derived: analysis,
    lod: lodFor(model.edges.length, { ratio: 1, layoutRunning: false }),
  };
  let positions = cached.positions;

  const set = (patch: Partial<GraphViewState>) => {
    const next = { ...state, ...patch };
    if ("cameraRatio" in patch || "layout" in patch) {
      next.lod = lodFor(model.edges.length, { ratio: next.cameraRatio, layoutRunning: next.layout.kind === "running" });
    }
    state = next;
    for (const l of listeners) l();
  };
  const known = (id: string | null) => id === null || ids.has(id);
  const visible = (id: string | null) => id === null || state.derived.visibleNodeIds.has(id);
  // Filtering changes which nodes and edges can be acted on. A path must remain valid in the visible graph.
  const reconcile = (derived: DerivedGraph): Partial<GraphViewState> => {
    const has = (id: string | null) => id !== null && derived.visibleNodeIds.has(id);
    const selectedId = has(state.selectedId) ? state.selectedId : null;
    const hoverId = has(state.hoverId) ? state.hoverId : null;
    const focusId = has(state.focusId) ? state.focusId : null;
    const sourceVisible = has(state.pathSourceId);
    let pathValid = sourceVisible;
    if (state.path) {
      const remaining = pathEdgeKeys(state.path);
      for (const edge of derived.visibleModel.edges) {
        const [a, b] = edge.source < edge.target ? [edge.source, edge.target] : [edge.target, edge.source];
        remaining.delete(`${a}\u0000${b}`);
        if (!remaining.size) break;
      }
      pathValid = sourceVisible && state.path.every((id) => has(id)) && remaining.size === 0;
    }
    return { derived, selectedId, hoverId, focusId, pathSourceId: pathValid ? state.pathSourceId : null,
      path: pathValid ? state.path : null, pathMissing: pathValid ? state.pathMissing : false };
  };

  return {
    model,
    cacheKey,
    getState: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    select(id) { if (known(id) && visible(id)) set({ selectedId: id, focusId: id ?? state.focusId }); },
    hover(id) { if (known(id) && visible(id) && id !== state.hoverId) set({ hoverId: id }); },
    openLocal(id, depth = state.localDepth) {
      if (!known(id) || !visible(id)) return;
      const mode: ViewMode = id === null ? "global" : "local";
      analysis = derive(mode, id, depth, state.profile);
      const derived = applyGraphSearch(analysis, state.search);
      set({ ...reconcile(derived), mode, focusId: id, localCenterId: id, localDepth: depth, selectedId: id ?? (state.selectedId && derived.visibleNodeIds.has(state.selectedId) ? state.selectedId : null) });
    },
    pathTo(id) {
      if (id === null) return set({ pathSourceId: null, path: null, pathMissing: false });
      if (!known(id) || !visible(id)) return;
      if (state.pathSourceId === null || state.path) return set({ pathSourceId: id, path: null, pathMissing: false });
      const path = shortestPath(state.derived.visibleModel, state.pathSourceId, id);
      set({ path, pathMissing: path === null });
    },
    togglePin(id) {
      if (!known(id)) return;
      const pinned = new Set(state.pinned);
      if (pinned.has(id)) pinned.delete(id); else pinned.add(id);
      set({ pinned });
      writeLayoutCache(options.storage, cacheKey, { positions, pinned: [...pinned] });
    },
    setColorByCommunity(on) { set({ colorByCommunity: on && model.enriched }); },
    setProfile(profile) {
      analysis = derive(state.mode, state.localCenterId, state.localDepth, profile);
      set({ profile, ...reconcile(applyGraphSearch(analysis, state.search)) });
    },
    setSearch(search) {
      set({ search, ...reconcile(applyGraphSearch(analysis, search)) });
    },
    setCamera(ratio) { if (Number.isFinite(ratio) && ratio > 0 && ratio !== state.cameraRatio) set({ cameraRatio: ratio }); },
    setLayout(layout) { set({ layout }); },
    step(direction) {
      const visible = state.derived.visibleModel.nodes;
      if (visible.length === 0) return;
      // The anchor (focus) stays put while the selection cycles through its neighbours; with no anchor, or one
      // without neighbours, the selection cycles through every visible node.
      const anchor = state.focusId;
      const neighbours = anchor ? buildAdjacency(state.derived.visibleModel).get(anchor) : undefined;
      const pool = neighbours && neighbours.size > 0 ? [...neighbours].sort() : visible.map((n) => n.id).sort();
      const at = state.selectedId ? pool.indexOf(state.selectedId) : -1;
      const next = at < 0 && direction < 0 ? pool[pool.length - 1]! : pool[(at + direction + pool.length) % pool.length]!;
      set({ selectedId: next });
    },
    layoutGraph(fallback) {
      const n = model.nodes.length;
      const index = new Map(model.nodes.map((node, i) => [node.id, i]));
      const pos = new Float32Array(n * 2);
      const fixed = new Uint8Array(n);
      model.nodes.forEach((node, i) => {
        const p = positions[node.id] ?? fallback(node.id, i);
        pos[i * 2] = p[0];
        pos[i * 2 + 1] = p[1];
        fixed[i] = state.pinned.has(node.id) ? 1 : 0;
      });
      const sources = new Uint32Array(model.edges.length);
      const targets = new Uint32Array(model.edges.length);
      model.edges.forEach((e, i) => { sources[i] = index.get(e.source)!; targets[i] = index.get(e.target)!; });
      return { nodeCount: n, positions: pos, sources, targets, fixed };
    },
    savePositions(flat) {
      if (flat.length !== model.nodes.length * 2) return false;
      const next: Record<string, [number, number]> = {};
      model.nodes.forEach((node, i) => { next[node.id] = [flat[i * 2]!, flat[i * 2 + 1]!]; });
      positions = next;
      return writeLayoutCache(options.storage, cacheKey, { positions, pinned: [...state.pinned] });
    },
    cachedPositions: () => positions,
  };
}

/** Edge keys on the current path, for highlighting (undirected, NUL-joined like style.edgeKey). */
export function pathEdgeKeys(path: string[] | null): Set<string> {
  const keys = new Set<string>();
  if (!path) return keys;
  for (let i = 0; i + 1 < path.length; i += 1) {
    const [a, b] = [path[i]!, path[i + 1]!];
    keys.add(a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);
  }
  return keys;
}

export { graphEdgeVisibilityKey };
