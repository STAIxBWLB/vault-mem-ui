/**
 * Refresh accounting against the real graphology graph and a Sigma stub that records each refresh: camera-only
 * changes do no work unless LOD flips, reducer changes repaint without re-indexing, a layout batch is one
 * graph-wide update (one event) and no Sigma refresh from the canvas.
 */

import { expect, test } from "bun:test";
import { MultiDirectedGraph } from "graphology";
import { buildGraphModel } from "../../../src/graph/model";
import { mountGraphCanvas, type CanvasDeps, type GraphLike, type SigmaLike } from "../../../src/graph/view/canvas";
import { LOD_EDGE_THRESHOLD } from "../../../src/graph/view/lod";
import { createGraphViewStore } from "../../../src/graph/view/state";
import type { GraphInput } from "../../../src/graph/types";

type RefreshOpts = Parameters<SigmaLike["refresh"]>[0];

function harness(input: GraphInput) {
  const refreshes: RefreshOpts[] = [];
  const graph = new MultiDirectedGraph();
  const events: string[] = [];
  graph.on("nodeAttributesUpdated", () => events.push("node"));
  graph.on("eachNodeAttributesUpdated", () => events.push("each"));
  const sigma: SigmaLike = {
    on: () => undefined,
    getCamera: () => ({ getState: () => ({ ratio: 1 }), on: () => undefined, animate: () => undefined }),
    getNodeDisplayData: () => undefined, setSetting: () => undefined,
    refresh: (opts) => { refreshes.push(opts); }, kill: () => undefined,
  };
  const deps: CanvasDeps = { createGraph: () => graph as unknown as GraphLike, createSigma: () => sigma };
  const model = buildGraphModel(input, 0);
  const store = createGraphViewStore(model);
  const canvas = mountGraphCanvas({} as HTMLElement, model, store.getState(), {}, { onHover: () => {}, onClick: () => {}, onCamera: () => {} }, deps);
  const step = (fn: () => void) => { fn(); canvas.update(store.getState()); };
  const full = () => refreshes.filter((o) => !o?.partialGraph).length;
  const light = () => refreshes.filter((o) => o?.partialGraph && o.skipIndexation).length;
  return { store, canvas, step, refreshes, full, light, graph, events, model };
}

const ring = (n: number, chords = 0): GraphInput => ({
  nodes: Array.from({ length: n }, (_, i) => ({ id: `n${i}`, label: `N${i}`, relPath: `notes/n${i}.md` })),
  // Distinct pairs (the model merges duplicates): node i links to i+1, i+2, ... until the edge count is reached.
  edges: Array.from({ length: n + chords }, (_, k) => {
    const i = k % n, hop = 1 + Math.floor(k / n);
    return { source: `n${i}`, target: `n${(i + hop) % n}`, relation: "wiki_link", fromFrontmatter: false };
  }),
});

test("ten zoom steps on a small graph do no refresh at all", () => {
  const h = harness(ring(50));
  for (let i = 0; i < 10; i += 1) h.step(() => h.store.setCamera(0.2 + i * 0.3));
  expect(h.refreshes).toEqual([]);
});

test("on a large graph, zoom refreshes only when LOD flips, and then without re-indexing", () => {
  const h = harness(ring(1_000, LOD_EDGE_THRESHOLD));
  expect(h.model.edges.length).toBeGreaterThan(LOD_EDGE_THRESHOLD);
  h.step(() => h.store.setCamera(0.3)); // fitted (reduced) to zoomed in: LOD flips once
  for (let i = 0; i < 9; i += 1) h.step(() => h.store.setCamera(0.3 - i * 0.02)); // stays zoomed in
  expect(h.full()).toBe(0);
  expect(h.light()).toBe(1);
  h.step(() => h.store.setCamera(2)); // zoomed out: flips back
  expect(h.light()).toBe(2);
});

test("selection, hover and path repaint without re-indexing; local view re-indexes once", () => {
  const h = harness(ring(50));
  h.step(() => h.store.select("n1"));
  h.step(() => h.store.hover("n2"));
  h.step(() => h.store.pathTo("n3"));
  expect(h.full()).toBe(0);
  expect(h.light()).toBe(3);
  expect(h.refreshes.every((o) => !o?.partialGraph || o.partialGraph.nodes!.length === 50)).toBe(true);
  h.step(() => h.store.openLocal("n1", 1));
  expect(h.full()).toBe(1);
});

test("a layout batch is one graph-wide update, never one event per coordinate, and no canvas refresh", () => {
  const h = harness(ring(200));
  const positions = new Float32Array(400).map((_, i) => i);
  h.canvas.applyPositions(positions);
  expect(h.events).toEqual(["each"]);
  expect(h.refreshes).toEqual([]);
  expect(h.graph.getNodeAttributes("n7")).toMatchObject({ x: 14, y: 15 });
  // The status line's iteration count changes on every batch; that must not refresh Sigma either.
  for (let i = 1; i <= 5; i += 1) h.step(() => h.store.setLayout({ kind: "running", iterations: i }));
  expect(h.refreshes).toEqual([]);
});

test("non-finite coordinates in a batch leave that node where it was", () => {
  const h = harness(ring(3));
  const before = { ...h.graph.getNodeAttributes("n1") };
  h.canvas.applyPositions(new Float32Array([1, 2, Number.NaN, 5, 6, 7]));
  expect(h.graph.getNodeAttributes("n1")).toMatchObject({ x: before.x, y: before.y });
  expect(h.graph.getNodeAttributes("n2")).toMatchObject({ x: 6, y: 7 });
});
