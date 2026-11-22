// Sigma 3 canvas for the graph view. Adapted from STAIxBWLB/maru@b33341df src/components/graph/GraphCanvas.tsx
// (graph building, node/edge reducers for hover, selection, path and dimming, hash fallback positions), without the
// SVG fallback, export, reference focus, favourites or React. The view drives it imperatively.
//
// Sigma is passed in (or loaded lazily by the view) because importing it touches WebGLRenderingContext at module
// load; that must not happen in the layout worker, which runs this same panel module.

import type { GraphModel } from "../model";
import { graphEdgeVisibilityKey } from "../model";
import { isUsableCoordinate } from "../positions";
import { communityColor, edgeColor, graphTheme, nodeColor, nodeRadius, refreshGraphTheme } from "../style";
import { drawNodeHover, drawNodeLabel } from "../labels";
import type { GraphDisplaySettings } from "../types";
import type { GraphViewState } from "./state";
import { pathEdgeKeys } from "./state";
import { prefersReducedMotion } from "./motion";

/** The part of a Sigma instance the canvas uses; tests supply a fake. */
export interface SigmaLike {
  on(event: string, handler: (payload: { node?: string }) => void): unknown;
  getCamera(): { getState(): { ratio: number }; on(event: "updated", handler: (s: { ratio: number }) => void): unknown; animate(state: Partial<{ x: number; y: number; ratio: number }>, opts?: { duration?: number }): unknown };
  getNodeDisplayData(node: string): { x: number; y: number } | undefined;
  setSetting(key: string, value: unknown): unknown;
  refresh(opts?: { partialGraph?: { nodes?: string[]; edges?: string[] }; skipIndexation?: boolean; schedule?: boolean }): unknown;
  /** Whether Sigma's program index covers every node and edge right now. A scheduled full refresh (window resize,
   *  setSetting) empties the edge half until its frame runs, and a skipIndexation repaint throws until then. */
  hasProgramIndices(): boolean;
  kill(): void;
}
export interface GraphLike {
  addNode(id: string, attrs: Record<string, unknown>): unknown;
  addEdgeWithKey(key: string, source: string, target: string, attrs: Record<string, unknown>): unknown;
  hasNode(id: string): boolean;
  getNodeAttribute(id: string, name: string): unknown;
  /** One pass over every node; graphology emits a single eachNodeAttributesUpdated that Sigma handles itself. */
  updateEachNodeAttributes(updater: (node: string, attrs: Record<string, unknown>) => Record<string, unknown>, hints?: { attributes?: string[] }): void;
  /** One pass over every edge; graphology emits a single eachEdgeAttributesUpdated that Sigma handles itself. */
  updateEachEdgeAttributes(updater: (key: string, attrs: Record<string, unknown>) => Record<string, unknown>, hints?: { attributes?: string[] }): void;
}
export interface CanvasDeps {
  createGraph(): GraphLike;
  createSigma(graph: GraphLike, container: HTMLElement, settings: Record<string, unknown>): SigmaLike;
}

export const DISPLAY: GraphDisplaySettings = { arrows: "typed", labels: "balanced", colorMode: "neutral", relationColors: false, nodeScale: 1, edgeScale: 1 };

/** Deterministic spiral position for a node with no cached coordinates (maru's hashPosition). */
export function hashPosition(id: string, index: number): [number, number] {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const angle = ((hash >>> 0) / 0xffffffff) * Math.PI * 2;
  const radius = 20 + Math.sqrt(index + 1) * 18;
  return [Math.cos(angle) * radius, Math.sin(angle) * radius];
}

export interface GraphCanvasHandle {
  /** Re-applies reducers after a state change. */
  update(state: GraphViewState): void;
  /** Applies a layout batch (model node order). */
  applyPositions(positions: ArrayLike<number>): void;
  focusNode(id: string): void;
  /** Centre the camera on the extent of the selected nodes. */
  focusNodes(ids: readonly string[]): void;
  /** Re-reads the graph colours from the container's computed tokens (after a host or person theme change) and redraws. */
  refreshTheme(): void;
  /** The node's current graph coordinates, or null. */
  positionOf(id: string): [number, number] | null;
  destroy(): void;
}

export interface CanvasCallbacks {
  onHover(id: string | null): void;
  onClick(id: string | null): void;
  onCamera(ratio: number): void;
}

export function mountGraphCanvas(
  container: HTMLElement,
  model: GraphModel,
  initial: GraphViewState,
  cached: Record<string, [number, number]>,
  callbacks: CanvasCallbacks,
  deps: CanvasDeps,
): GraphCanvasHandle {
  const graph = deps.createGraph();
  const display = DISPLAY;
  refreshGraphTheme(container);
  model.nodes.forEach((node, index) => {
    const fallback = hashPosition(node.id, index);
    const seed = cached[node.id];
    graph.addNode(node.id, {
      x: isUsableCoordinate(seed?.[0]) ? seed![0] : fallback[0],
      y: isUsableCoordinate(seed?.[1]) ? seed![1] : fallback[1],
      size: nodeRadius(node.degree),
      label: node.label,
      color: nodeColor(node, model.enriched, "neutral"),
      forceLabel: node.isGodNode,
    });
  });
  model.edges.forEach((edge, index) => {
    graph.addEdgeWithKey(`e${index}`, edge.source, edge.target, {
      size: edge.fromFrontmatter ? 0.55 : 0.35,
      color: edgeColor(edge, display),
      type: edge.fromFrontmatter ? "arrow" : "line",
      index,
      sourceId: edge.source,
      targetId: edge.target,
      visibilityKey: graphEdgeVisibilityKey(edge),
    });
  });

  const nodeById = new Map(model.nodes.map((n) => [n.id, n]));
  const nodeIndex = new Map(model.nodes.map((n, i) => [n.id, i]));
  let state = initial;
  let pathNodes = new Set<string>(state.path ?? []);
  let pathEdges = pathEdgeKeys(state.path);
  let neighbours = new Set<string>();


  const sigma = deps.createSigma(graph, container, {
    allowInvalidContainer: true,
    labelFont: "system-ui, sans-serif",
    labelSize: 11,
    labelWeight: "500",
    labelDensity: state.lod.labelDensity,
    renderLabels: state.lod.renderLabels,
    defaultDrawNodeLabel: drawNodeLabel,
    defaultDrawNodeHover: drawNodeHover,
    hideLabelsOnMove: true,
    minCameraRatio: 0.02,
    maxCameraRatio: 8,
    stagePadding: 36,
    nodeReducer: (node: string, data: Record<string, unknown>) => {
      const s = state;
      if (!s.derived.visibleNodeIds.has(node)) return { ...data, hidden: true };
      const theme = graphTheme();
      const patch: Record<string, unknown> = {};
      const model = nodeById.get(node);
      if (s.colorByCommunity && model?.community != null) patch.color = communityColor(model.community);
      const dimByHover = s.hoverId !== null && node !== s.hoverId && !neighbours.has(node);
      const dimByPath = pathNodes.size > 0 && !pathNodes.has(node);
      const dimByChain = s.chainFocusIds.size > 0 && !s.chainFocusIds.has(node);
      if (dimByHover || dimByPath || dimByChain) patch.color = theme.dimNode;
      if (pathNodes.has(node) || s.chainFocusIds.has(node) || node === s.pathSourceId) { patch.forceLabel = true; patch.highlighted = true; }
      if (node === s.selectedId || node === s.focusId || node === s.hoverId) {
        patch.forceLabel = true;
        patch.highlighted = true;
        patch.size = (data.size as number) * 1.18;
        if (node === s.selectedId) patch.color = theme.accent;
      }
      if (s.pinned.has(node)) patch.forceLabel = true;
      return { ...data, ...patch };
    },
    edgeReducer: (_edge: string, data: Record<string, unknown>) => {
      const s = state;
      const src = data.sourceId as string, dst = data.targetId as string;
      if (!s.derived.visibleNodeIds.has(src) || !s.derived.visibleNodeIds.has(dst)) return { ...data, hidden: true };
      if (!s.derived.visibleEdgeKeys.has(data.visibilityKey as string)) return { ...data, hidden: true };
      const theme = graphTheme();
      const key = src < dst ? `${src}\u0000${dst}` : `${dst}\u0000${src}`;
      const onPath = pathEdges.has(key);
      const onChain = s.chainFocusIds.has(src) && s.chainFocusIds.has(dst) && s.mode === "chains";
      const hovered = s.hoverId !== null && (src === s.hoverId || dst === s.hoverId);
      const focus = s.selectedId;
      const touchesFocus = focus !== null && (src === focus || dst === focus);
      // LOD: on a reduced view keep a stride sample, but never drop edges the person is looking at.
      if (s.lod.edgeStride > 1 && !onPath && !onChain && !hovered && !touchesFocus && (data.index as number) % s.lod.edgeStride !== 0) {
        return { ...data, hidden: true };
      }
      if (onPath || onChain || hovered || touchesFocus) return { ...data, color: theme.accent, size: Math.max(1.4, data.size as number) };
      if (pathEdges.size > 0 || s.chainFocusIds.size > 0 || s.hoverId !== null) return { ...data, color: theme.edgeDim };
      return data;
    },
  });

  sigma.on("enterNode", ({ node }) => callbacks.onHover(node ?? null));
  sigma.on("leaveNode", () => callbacks.onHover(null));
  sigma.on("clickNode", ({ node }) => callbacks.onClick(node ?? null));
  sigma.on("clickStage", () => callbacks.onClick(null));
  sigma.getCamera().on("updated", (s) => callbacks.onCamera(s.ratio));

  let lastLod = state.lod;
  // Reducer-only repaint: re-run reducers and reprocess the programs for every node and edge without re-indexing
  // (Sigma's skipIndexation needs an explicit partialGraph; a bare refresh() always re-indexes everything).
  const everything = { nodes: model.nodes.map((n) => n.id), edges: model.edges.map((_, i) => `e${i}`) };
  const repaint = () => {
    // A scheduled full refresh (window resize, setSetting) empties the edge program index until its frame runs, and
    // skipIndexation throws on the first edge then. Rebuild in the same call instead of waiting for that frame.
    if (!sigma.hasProgramIndices()) { sigma.refresh(); return; }
    sigma.refresh({ partialGraph: everything, skipIndexation: true, schedule: true });
  };
  return {
    update(next) {
      const prev = state;
      state = next;
      const lodChanged = next.lod !== lastLod;
      const reducersChanged = prev.selectedId !== next.selectedId || prev.hoverId !== next.hoverId || prev.focusId !== next.focusId
        || prev.path !== next.path || prev.pathSourceId !== next.pathSourceId || prev.pinned !== next.pinned
        || prev.colorByCommunity !== next.colorByCommunity || prev.chainFocusIds !== next.chainFocusIds;
      const visibilityChanged = prev.derived !== next.derived;
      // A camera move, a layout iteration count or a pause only changes what the reducers read when LOD flips.
      if (!lodChanged && !reducersChanged && !visibilityChanged) return;
      pathNodes = new Set(next.path ?? []);
      pathEdges = pathEdgeKeys(next.path);
      neighbours = new Set();
      if (next.hoverId) for (const edge of next.derived.visibleModel.edges) {
        if (edge.source === next.hoverId) neighbours.add(edge.target);
        if (edge.target === next.hoverId) neighbours.add(edge.source);
      }
      let settingsChanged = false;
      if (lodChanged) {
        if (next.lod.labelDensity !== lastLod.labelDensity) { sigma.setSetting("labelDensity", next.lod.labelDensity); settingsChanged = true; }
        if (next.lod.renderLabels !== lastLod.renderLabels) { sigma.setSetting("renderLabels", next.lod.renderLabels); settingsChanged = true; }
        lastLod = next.lod;
      }
      // setSetting schedules a full refresh, which leaves the program index empty until its frame. Run that
      // refresh synchronously so the reducers below (and the labels for the new LOD) are applied in this update.
      if (settingsChanged) { sigma.refresh(); return; }
      // Hiding or showing nodes (local view) changes the label grid, which only a full refresh rebuilds.
      if (visibilityChanged) sigma.refresh();
      else repaint();
    },
    applyPositions(positions) {
      if (positions.length !== model.nodes.length * 2) return;
      const index = nodeIndex;
      graph.updateEachNodeAttributes((node, attrs) => {
        const i = index.get(node);
        if (i === undefined) return attrs;
        const x = positions[i * 2]!, y = positions[i * 2 + 1]!;
        if (isUsableCoordinate(x) && isUsableCoordinate(y)) { attrs.x = x; attrs.y = y; }
        return attrs;
      }, { attributes: ["x", "y"] });
    },
    focusNode(id) {
      const d = sigma.getNodeDisplayData(id);
      if (!d) return;
      sigma.getCamera().animate({ x: d.x, y: d.y, ratio: Math.min(sigma.getCamera().getState().ratio, 0.5) }, { duration: prefersReducedMotion() ? 0 : 300 });
    },
    focusNodes(ids) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const id of ids) {
        const point = sigma.getNodeDisplayData(id);
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
        minX = Math.min(minX, point.x); minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
      }
      if (!Number.isFinite(minX)) return;
      const span = Math.max(maxX - minX, maxY - minY);
      sigma.getCamera().animate({ x: (minX + maxX) / 2, y: (minY + maxY) / 2, ratio: span ? Math.max(0.1, Math.min(8, span * 1.5)) : 0.5 }, { duration: prefersReducedMotion() ? 0 : 300 });
    },
    refreshTheme() {
      refreshGraphTheme(container);
      // Sigma's own graph listeners repaint an attributes batch with skipIndexation; rebuild first when a
      // scheduled full refresh emptied the edge program index, or those repaints throw.
      if (!sigma.hasProgramIndices()) sigma.refresh();
      // One pass per kind: graphology emits one each*AttributesUpdated, and Sigma's own listener already recomputes
      // the reducers and rewrites the programs for it. A refresh() after these passes would be a third one.
      graph.updateEachNodeAttributes((node, attrs) => {
        const n = nodeById.get(node);
        return n ? { ...attrs, color: nodeColor(n, model.enriched, "neutral") } : attrs;
      }, { attributes: ["color"] });
      graph.updateEachEdgeAttributes((_key, attrs) => {
        const edge = model.edges[attrs.index as number];
        return edge ? { ...attrs, color: edgeColor(edge, display) } : attrs;
      }, { attributes: ["color"] });
    },
    positionOf(id) {
      if (!graph.hasNode(id)) return null;
      const x = graph.getNodeAttribute(id, "x"), y = graph.getNodeAttribute(id, "y");
      return typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
    },
    destroy() { sigma.kill(); },
  };
}

/**
 * Sigma 3.0.3 keeps its program index in private fields and exposes no accessor. A full refresh empties it all at
 * once (`clearEdgeIndices`, and `clearNodeIndices`, which resets the *edge* index) and `process()` refills it all at
 * once, one entry per edge, on the frame a scheduled refresh defers. The rebuild is therefore all-or-nothing, so one
 * key answers for the whole index in O(1): this canvas names its edges `e0..e{size-1}`, and a graph without edges
 * needs no entry. A Sigma without the field answers false, which only costs a full refresh.
 *
 * `nodeProgramIndex` needs no probe: nothing in 3.0.3 empties it (only `removeNode` deletes an entry, and this canvas
 * never removes a node), so once `process()` has run it stays complete.
 */
export function programIndicesCover(sigma: object, graph: object): boolean {
  const s = sigma as { edgeProgramIndex?: Record<string, unknown> };
  const g = graph as { size?: number };
  if (!s.edgeProgramIndex || g.size === undefined) return false;
  return g.size === 0 || `e${g.size - 1}` in s.edgeProgramIndex;
}

/** Real Sigma and graphology, loaded on first use so module evaluation stays WebGL- and DOM-free. */
export async function loadCanvasDeps(): Promise<CanvasDeps> {
  const [{ default: Sigma }, { MultiDirectedGraph }] = await Promise.all([import("sigma"), import("graphology")]);
  return {
    createGraph: () => new MultiDirectedGraph() as unknown as GraphLike,
    createSigma: (g, c, s) => {
      const sigma = new Sigma(g as never, c, s as never);
      const like = sigma as unknown as SigmaLike;
      // Sigma's constructor refreshes synchronously, so the index is populated by the time this returns.
      like.hasProgramIndices = () => programIndicesCover(sigma, g);
      return like;
    },
  };
}
