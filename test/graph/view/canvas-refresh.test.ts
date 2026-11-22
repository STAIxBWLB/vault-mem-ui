/**
 * Refresh accounting against the real graphology graph and a Sigma stub that records each refresh and models the
 * program index of Sigma 3.0.3: a full refresh empties the edge half of it, process() refills that on the frame a
 * scheduled refresh defers, the node half is never emptied, and a skipIndexation repaint over a node or edge without
 * an index entry throws exactly as Sigma does. Camera-only changes do no work unless LOD flips, reducer changes
 * repaint without re-indexing, and a layout batch is one graph-wide update.
 */

import { describe, expect, test } from "bun:test";
import { MultiDirectedGraph } from "graphology";
import { buildGraphModel } from "../../../src/graph/model";
import { mountGraphCanvas, programIndicesCover, type CanvasDeps, type GraphLike, type SigmaLike } from "../../../src/graph/view/canvas";
import { LOD_EDGE_THRESHOLD } from "../../../src/graph/view/lod";
import { createGraphViewStore } from "../../../src/graph/view/state";
import type { GraphInput } from "../../../src/graph/types";

type RefreshOpts = Parameters<SigmaLike["refresh"]>[0];

function harness(input: GraphInput) {
  const refreshes: RefreshOpts[] = [];
  const settings: Record<string, unknown> = {};
  const graph = new MultiDirectedGraph();
  const events: string[] = [];
  graph.on("nodeAttributesUpdated", () => events.push("node"));
  graph.on("eachNodeAttributesUpdated", () => events.push("each"));
  graph.on("eachEdgeAttributesUpdated", () => events.push("eachEdge"));
  // Sigma's two program indices, kept apart because 3.0.3 empties them differently: a full refresh resets the edge
  // index (clearEdgeIndices, and clearNodeIndices, which also resets the *edge* one) and process() refills it one edge
  // at a time, while nodeProgramIndex is never emptied.
  const nodeIndex = new Set<string>();
  const edgeIndex = new Set<string>();
  const fillEdges = () => { for (const e of graph.edges()) edgeIndex.add(e); };
  const model = buildGraphModel(input, 0);
  const sigma: SigmaLike = {
    on: () => undefined,
    getCamera: () => ({ getState: () => ({ ratio: 1 }), on: () => undefined, animate: () => undefined }),
    getNodeDisplayData: () => undefined,
    // setSetting schedules a full refresh: that re-indexes now and leaves the edge index empty until its frame.
    setSetting: (key, value) => { settings[key] = value; sigma.refresh({ schedule: true }); },
    refresh: (opts) => {
      refreshes.push(opts);
      if (!opts?.partialGraph) {
        edgeIndex.clear();
        // An unscheduled full refresh runs process() in the same call; a scheduled one waits for its frame.
        if (!opts?.schedule) fillEdges();
        return;
      }
      if (!opts.skipIndexation) return;
      for (const node of opts.partialGraph.nodes ?? []) {
        if (!nodeIndex.has(node)) throw new Error(`Sigma: node "${node}" can't be repaint`);
      }
      for (const edge of opts.partialGraph.edges ?? []) {
        if (!edgeIndex.has(edge)) throw new Error(`Sigma: edge "${edge}" can't be repaint`);
      }
    },
    hasProgramIndices: () => nodeIndex.size === graph.order && edgeIndex.size === graph.size,
    kill: () => undefined,
  };
  // Sigma's constructor binds these two to the graph, and they are why a theme pass needs no refresh of its own: a bulk
  // attribute update repaints through skipIndexation, except a node batch that moved x, y, zIndex or type, which sigma
  // re-indexes instead (3.0.3 bindGraphHandlers: LAYOUT_IMPACTING_FIELDS). Bound here too, so a pass over an emptied
  // index fails with Sigma's own message instead of passing quietly. graphology reports the changed attributes as
  // strings or numbers, and sigma decides the branch by set membership, so the set is typed the same way.
  const LAYOUT_FIELDS = new Set<string | number>(["x", "y", "zIndex", "type"]);
  graph.on("eachNodeAttributesUpdated", (event: { hints?: { attributes?: (string | number)[] } }) => {
    const fields = event.hints?.attributes;
    const layoutChanged = !fields || fields.some((field) => LAYOUT_FIELDS.has(field));
    sigma.refresh({ partialGraph: { nodes: graph.nodes() }, skipIndexation: !layoutChanged, schedule: true });
  });
  graph.on("eachEdgeAttributesUpdated", () => { sigma.refresh({ partialGraph: { edges: graph.edges() }, skipIndexation: true, schedule: true }); });
  const deps: CanvasDeps = {
    createGraph: () => graph as unknown as GraphLike,
    // Like Sigma's constructor: the first refresh is synchronous, so the mount starts with both indices filled.
    createSigma: () => { for (const n of graph.nodes()) nodeIndex.add(n); fillEdges(); return sigma; },
  };
  const store = createGraphViewStore(model);
  const canvas = mountGraphCanvas({} as HTMLElement, model, store.getState(), {}, { onHover: () => {}, onClick: () => {}, onCamera: () => {} }, deps);
  const step = (fn: () => void) => { fn(); canvas.update(store.getState()); };
  const full = () => refreshes.filter((o) => !o?.partialGraph).length;
  const light = () => refreshes.filter((o) => o?.partialGraph && o.skipIndexation).length;
  // A partial repaint that re-indexes instead of skipping: what sigma does for a batch that moved a layout field.
  const reindex = () => refreshes.filter((o) => o?.partialGraph && !o.skipIndexation).length;
  return { store, canvas, step, refreshes, full, light, reindex, graph, events, model, settings, sigma };
}

const ring = (n: number, chords = 0): GraphInput => ({
  nodes: Array.from({ length: n }, (_, i) => ({ id: `n${i}`, label: `N${i}`, relPath: `notes/n${i}.md` })),
  // Distinct pairs (the model merges duplicates): node i links to i+1, i+2, ... until the edge count is reached.
  edges: Array.from({ length: n + chords }, (_, k) => {
    const i = k % n, hop = 1 + Math.floor(k / n);
    return { source: `n${i}`, target: `n${(i + hop) % n}`, relation: "wiki_link", fromFrontmatter: false, inferred: false };
  }),
});

test("ten zoom steps on a small graph do no refresh at all", () => {
  const h = harness(ring(50));
  for (let i = 0; i < 10; i += 1) h.step(() => h.store.setCamera(0.2 + i * 0.3));
  expect(h.refreshes).toEqual([]);
});

test("on a large graph, zoom refreshes only when LOD flips, and a flip rebuilds the index in the same update", () => {
  const h = harness(ring(1_000, LOD_EDGE_THRESHOLD));
  expect(h.model.edges.length).toBeGreaterThan(LOD_EDGE_THRESHOLD);
  h.step(() => h.store.setCamera(0.3)); // fitted (reduced) to zoomed in: LOD flips once
  // setSetting schedules a full refresh (which empties Sigma's program index) and the canvas then runs one
  // synchronously, so the reducers are repainted in this update rather than throwing on the missing index.
  expect(h.full()).toBe(2);
  expect(h.light()).toBe(0);
  expect(h.settings.labelDensity).toBe(0.55);
  for (let i = 0; i < 9; i += 1) h.step(() => h.store.setCamera(0.3 - i * 0.02)); // stays zoomed in
  expect(h.full()).toBe(2);
  expect(h.light()).toBe(0);
  h.step(() => h.store.setCamera(2)); // zoomed out: flips back
  expect(h.full()).toBe(4);
});

test("a LOD flip followed by a selection in the same frame repaints without throwing", () => {
  const h = harness(ring(1_000, LOD_EDGE_THRESHOLD));
  h.step(() => h.store.setCamera(0.3));
  // The synchronous rebuild left the index filled, so the reducer-only repaint is safe.
  expect(() => h.step(() => h.store.select("n1"))).not.toThrow();
  expect(h.light()).toBe(1);
  expect(h.full()).toBe(2);
});

test("a scheduled refresh (a window resize) empties the index, so the next hover rebuilds instead of throwing", () => {
  const h = harness(ring(1_000, LOD_EDGE_THRESHOLD));
  h.step(() => h.store.setCamera(0.3));
  // Sigma's own window resize handler calls scheduleRefresh(): the re-index happens now, process() next frame.
  h.sigma.refresh({ schedule: true });
  expect(h.sigma.hasProgramIndices()).toBe(false);
  const full = h.full();
  expect(() => h.step(() => h.store.hover("n2"))).not.toThrow();
  expect(h.full()).toBe(full + 1);
  expect(h.light()).toBe(0);
  expect(h.sigma.hasProgramIndices()).toBe(true);
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
  // One graph-wide update: Sigma's own listener then re-indexes it once (x and y are layout fields) and the canvas asks
  // for nothing.
  expect(h.events).toEqual(["each"]);
  expect(h.full()).toBe(0);
  expect(h.light()).toBe(0);
  expect(h.reindex()).toBe(1);
  expect(h.graph.getNodeAttributes("n7")).toMatchObject({ x: 14, y: 15 });
  // The status line's iteration count changes on every batch; that must not refresh Sigma either.
  for (let i = 1; i <= 5; i += 1) h.step(() => h.store.setLayout({ kind: "running", iterations: i }));
  expect(h.full()).toBe(0);
  expect(h.light()).toBe(0);
  expect(h.reindex()).toBe(1);
  expect(h.events).toEqual(["each"]);
});

test("non-finite coordinates in a batch leave that node where it was", () => {
  const h = harness(ring(3));
  const before = { ...h.graph.getNodeAttributes("n1") };
  h.canvas.applyPositions(new Float32Array([1, 2, Number.NaN, 5, 6, 7]));
  expect(h.graph.getNodeAttributes("n1")).toMatchObject({ x: before.x, y: before.y });
  expect(h.graph.getNodeAttributes("n2")).toMatchObject({ x: 6, y: 7 });
});

test("a theme change repaints through Sigma's own attribute listeners and adds no full refresh of its own", () => {
  const h = harness(ring(50));
  h.canvas.refreshTheme();
  // Sigma's each*AttributesUpdated listeners repaint with skipIndexation, so the two passes are the whole cost.
  expect(h.events).toEqual(["each", "eachEdge"]);
  expect(h.full()).toBe(0);
  expect(h.light()).toBe(2);
  expect(h.sigma.hasProgramIndices()).toBe(true);

  // A scheduled refresh empties the edge index until its frame, so the guard rebuilds once before the passes.
  h.sigma.refresh({ schedule: true });
  expect(h.sigma.hasProgramIndices()).toBe(false);
  const rebuilds = h.full();
  const repaints = h.light();
  expect(() => h.canvas.refreshTheme()).not.toThrow();
  expect(h.full()).toBe(rebuilds + 1);
  expect(h.light()).toBe(repaints + 2);
  expect(h.sigma.hasProgramIndices()).toBe(true);
});

describe("programIndicesCover", () => {
  test("judges the emptied edge index from its last key, and answers false without the field or the size", () => {
    const sigma = (edgeProgramIndex: Record<string, unknown>) => ({ edgeProgramIndex });
    // Filled by process(): every edge, so the last key is there.
    expect(programIndicesCover(sigma({ e0: 0, e1: 1, e2: 2 }), { size: 3 })).toBe(true);
    // Emptied wholesale by clearEdgeIndices, and half refilled by a partial repaint: both are not covered.
    expect(programIndicesCover(sigma({}), { size: 3 })).toBe(false);
    expect(programIndicesCover(sigma({ e0: 0, e1: 1 }), { size: 3 })).toBe(false);
    // A graph without edges needs no entry, so an empty index covers it.
    expect(programIndicesCover(sigma({}), { size: 0 })).toBe(true);
    // A Sigma that does not expose the field, or a graph without a size, answers false and pays a full refresh.
    expect(programIndicesCover({}, { size: 3 })).toBe(false);
    expect(programIndicesCover(sigma({ e0: 0 }), {})).toBe(false);
  });
});
