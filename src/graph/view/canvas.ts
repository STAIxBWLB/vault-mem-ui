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
  refresh(): unknown;
  kill(): void;
}
export interface GraphLike {
  addNode(id: string, attrs: Record<string, unknown>): unknown;
  addEdgeWithKey(key: string, source: string, target: string, attrs: Record<string, unknown>): unknown;
  setNodeAttribute(id: string, name: string, value: unknown): unknown;
  hasNode(id: string): boolean;
  setEdgeAttribute(key: string, name: string, value: unknown): unknown;
  getNodeAttribute(id: string, name: string): unknown;
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
  let state = initial;
  let pathNodes = new Set<string>(state.path ?? []);
  let pathEdges = pathEdgeKeys(state.path);
  let neighbours = new Set<string>();
  const adjacency = new Map<string, Set<string>>();
  for (const e of model.edges) {
    (adjacency.get(e.source) ?? adjacency.set(e.source, new Set()).get(e.source)!).add(e.target);
    (adjacency.get(e.target) ?? adjacency.set(e.target, new Set()).get(e.target)!).add(e.source);
  }

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
      if (dimByHover || dimByPath) patch.color = theme.dimNode;
      if (pathNodes.has(node) || node === s.pathSourceId) { patch.forceLabel = true; patch.highlighted = true; }
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
      const hovered = s.hoverId !== null && (src === s.hoverId || dst === s.hoverId);
      const focus = s.selectedId;
      const touchesFocus = focus !== null && (src === focus || dst === focus);
      // LOD: on a reduced view keep a stride sample, but never drop edges the person is looking at.
      if (s.lod.edgeStride > 1 && !onPath && !hovered && !touchesFocus && (data.index as number) % s.lod.edgeStride !== 0) {
        return { ...data, hidden: true };
      }
      if (onPath || hovered || touchesFocus) return { ...data, color: theme.accent, size: Math.max(1.4, data.size as number) };
      if (pathEdges.size > 0 || s.hoverId !== null) return { ...data, color: theme.edgeDim };
      return data;
    },
  });

  sigma.on("enterNode", ({ node }) => callbacks.onHover(node ?? null));
  sigma.on("leaveNode", () => callbacks.onHover(null));
  sigma.on("clickNode", ({ node }) => callbacks.onClick(node ?? null));
  sigma.on("clickStage", () => callbacks.onClick(null));
  sigma.getCamera().on("updated", (s) => callbacks.onCamera(s.ratio));

  let lastLod = state.lod;
  return {
    update(next) {
      state = next;
      pathNodes = new Set(next.path ?? []);
      pathEdges = pathEdgeKeys(next.path);
      neighbours = next.hoverId ? (adjacency.get(next.hoverId) ?? new Set()) : new Set();
      if (next.lod !== lastLod) {
        if (next.lod.labelDensity !== lastLod.labelDensity) sigma.setSetting("labelDensity", next.lod.labelDensity);
        if (next.lod.renderLabels !== lastLod.renderLabels) sigma.setSetting("renderLabels", next.lod.renderLabels);
        lastLod = next.lod;
      }
      sigma.refresh();
    },
    applyPositions(positions) {
      if (positions.length !== model.nodes.length * 2) return;
      model.nodes.forEach((node, i) => {
        const x = positions[i * 2]!, y = positions[i * 2 + 1]!;
        if (isUsableCoordinate(x) && isUsableCoordinate(y)) {
          graph.setNodeAttribute(node.id, "x", x);
          graph.setNodeAttribute(node.id, "y", y);
        }
      });
    },
    focusNode(id) {
      const d = sigma.getNodeDisplayData(id);
      if (!d) return;
      sigma.getCamera().animate({ x: d.x, y: d.y, ratio: Math.min(sigma.getCamera().getState().ratio, 0.5) }, { duration: prefersReducedMotion() ? 0 : 300 });
    },
    refreshTheme() {
      refreshGraphTheme(container);
      model.nodes.forEach((node) => graph.setNodeAttribute(node.id, "color", nodeColor(node, model.enriched, "neutral")));
      model.edges.forEach((edge, index) => graph.setEdgeAttribute(`e${index}`, "color", edgeColor(edge, display)));
      sigma.refresh();
    },
    positionOf(id) {
      if (!graph.hasNode(id)) return null;
      const x = graph.getNodeAttribute(id, "x"), y = graph.getNodeAttribute(id, "y");
      return typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
    },
    destroy() { sigma.kill(); },
  };
}

/** Real Sigma and graphology, loaded on first use so module evaluation stays WebGL- and DOM-free. */
export async function loadCanvasDeps(): Promise<CanvasDeps> {
  const [{ default: Sigma }, { MultiDirectedGraph }] = await Promise.all([import("sigma"), import("graphology")]);
  return {
    createGraph: () => new MultiDirectedGraph() as unknown as GraphLike,
    createSigma: (g, c, s) => new Sigma(g as never, c, s as never) as unknown as SigmaLike,
  };
}
