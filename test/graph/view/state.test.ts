import { describe, expect, test } from "bun:test";
import { buildGraphModel } from "../../../src/graph/model";
import { readLayoutCache, writeLayoutCache, type CacheStorage } from "../../../src/graph/view/cache";
import { LOD_EDGE_STRIDE, LOD_EDGE_THRESHOLD, LOD_ZOOMED_OUT_RATIO, lodFor } from "../../../src/graph/view/lod";
import { createGraphViewStore, pathEdgeKeys } from "../../../src/graph/view/state";
import { readGraphInput, layoutLabel } from "../../../src/graph/view/GraphView.tsx";
import type { GraphInput } from "../../../src/graph/types";

function memory(): CacheStorage & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
}

// a - b - c   d (isolated), e unresolved linked from c
const input: GraphInput = {
  nodes: [
    { id: "a", label: "A", relPath: "notes/a.md" },
    { id: "b", label: "B", relPath: "notes/b.md" },
    { id: "c", label: "C", relPath: "notes/c.md" },
    { id: "d", label: "D", relPath: "notes/d.md" },
    { id: "e", label: "E", relPath: null },
  ],
  edges: [
    { source: "a", target: "b", relation: "wiki_link", fromFrontmatter: false },
    { source: "b", target: "c", relation: "related", fromFrontmatter: true },
    { source: "c", target: "e", relation: "wiki_link", fromFrontmatter: false },
  ],
};

describe("lodFor", () => {
  test("a graph at or under the threshold always draws everything", () => {
    expect(lodFor(LOD_EDGE_THRESHOLD, { ratio: 5, layoutRunning: true })).toMatchObject({ reduced: false, edgeStride: 1, renderLabels: true });
  });
  test("above the threshold, a running layout or a zoomed-out camera reduces detail", () => {
    const big = LOD_EDGE_THRESHOLD + 1;
    expect(lodFor(big, { ratio: 0.1, layoutRunning: true })).toMatchObject({ reduced: true, edgeStride: LOD_EDGE_STRIDE, renderLabels: false });
    expect(lodFor(big, { ratio: LOD_ZOOMED_OUT_RATIO + 0.1, layoutRunning: false })).toMatchObject({ reduced: true, renderLabels: true });
    expect(lodFor(big, { ratio: LOD_ZOOMED_OUT_RATIO, layoutRunning: false }).reduced).toBe(false);
  });
});

describe("layout cache", () => {
  test("round-trips positions by node id and pins, dropping non-finite coordinates", () => {
    const s = memory();
    expect(writeLayoutCache(s, "k", { positions: { a: [1, 2], b: [Number.NaN, 0] }, pinned: ["a"] })).toBe(true);
    expect(readLayoutCache(s, "k")).toEqual({ positions: { a: [1, 2] }, pinned: ["a"] });
  });
  test("missing, malformed or refusing storage is an empty cache, never an error", () => {
    expect(readLayoutCache(undefined, "k")).toEqual({ positions: {}, pinned: [] });
    const bad = memory();
    bad.data["vmem-ui:graph:k"] = "{not json";
    expect(readLayoutCache(bad, "k")).toEqual({ positions: {}, pinned: [] });
    const throwing: CacheStorage = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("quota"); } };
    expect(readLayoutCache(throwing, "k")).toEqual({ positions: {}, pinned: [] });
    expect(writeLayoutCache(throwing, "k", { positions: {}, pinned: [] })).toBe(false);
  });
});

describe("graph view store", () => {
  const model = buildGraphModel(input, 0);

  test("selection ignores ids that are not in the graph", () => {
    const store = createGraphViewStore(model);
    store.select("zzz");
    expect(store.getState().selectedId).toBeNull();
    store.select("b");
    expect(store.getState()).toMatchObject({ selectedId: "b", focusId: "b" });
  });

  test("local view narrows to the neighbourhood and goes back to global", () => {
    const store = createGraphViewStore(model);
    store.openLocal("a", 1);
    expect(store.getState().mode).toBe("local");
    expect([...store.getState().derived.visibleNodeIds].sort()).toEqual(["a", "b"]);
    store.openLocal(null);
    expect(store.getState().mode).toBe("global");
    expect(store.getState().derived.visibleNodeIds.size).toBe(5);
  });

  test("shortest path picks a source, then finds the path or reports none", () => {
    const store = createGraphViewStore(model);
    store.pathTo("a");
    expect(store.getState()).toMatchObject({ pathSourceId: "a", path: null });
    store.pathTo("e");
    expect(store.getState().path).toEqual(["a", "b", "c", "e"]);
    store.pathTo("d"); // a found path starts a new pick
    store.pathTo("a");
    expect(store.getState()).toMatchObject({ path: null, pathMissing: true });
    store.pathTo(null);
    expect(store.getState()).toMatchObject({ pathSourceId: null, path: null, pathMissing: false });
    expect([...pathEdgeKeys(["a", "b", "c"])]).toEqual(["a\u0000b", "b\u0000c"]);
  });

  test("keyboard steps cycle through the anchor's neighbours and keep the anchor", () => {
    const store = createGraphViewStore(model);
    store.select("b");
    store.step(1);
    expect(store.getState()).toMatchObject({ selectedId: "a", focusId: "b" });
    store.step(1);
    expect(store.getState().selectedId).toBe("c");
    store.step(1);
    expect(store.getState().selectedId).toBe("a");
    store.step(-1);
    expect(store.getState().selectedId).toBe("c");
    const loose = createGraphViewStore(model);
    loose.step(-1);
    expect(loose.getState().selectedId).toBe("e");
  });

  test("pins and positions persist per graph and fix pinned nodes in the layout input", () => {
    const storage = memory();
    const store = createGraphViewStore(model, { storage });
    store.togglePin("c");
    expect(store.savePositions(new Float32Array([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]))).toBe(true);
    const again = createGraphViewStore(model, { storage });
    expect(again.getState().pinned.has("c")).toBe(true);
    const graph = again.layoutGraph(() => [0, 0]);
    const ci = model.nodes.findIndex((n) => n.id === "c");
    expect(graph.fixed![ci]).toBe(1);
    expect([graph.positions[ci * 2], graph.positions[ci * 2 + 1]]).toEqual(model.nodes.map((_, i) => [i + 1, i + 1])[ci]!);
    expect(graph.sources.length).toBe(model.edges.length);
    expect(again.savePositions([1, 2])).toBe(false);
  });

  test("a different graph does not reuse another graph's cache", () => {
    const storage = memory();
    const store = createGraphViewStore(model, { storage });
    store.togglePin("a");
    const other = createGraphViewStore(buildGraphModel({ ...input, edges: input.edges.slice(0, 1) }, 0), { storage });
    expect(other.cacheKey).not.toBe(store.cacheKey);
    expect(other.getState().pinned.size).toBe(0);
  });

  test("camera and layout changes recompute LOD; community colour needs an enriched graph", () => {
    const store = createGraphViewStore(model);
    store.setCamera(3);
    expect(store.getState().lod.reduced).toBe(false); // small graph
    store.setColorByCommunity(true);
    expect(store.getState().colorByCommunity).toBe(false);
    const enriched = createGraphViewStore(buildGraphModel({ ...input, communities: { a: 0, b: 0, c: 1, d: 2, e: 1 } }, 0));
    expect(enriched.getState().colorByCommunity).toBe(true);
  });
});

describe("readGraphInput", () => {
  test("anything without node and edge arrays is no graph", () => {
    expect(readGraphInput(undefined)).toBeNull();
    expect(readGraphInput({ nodes: [] })).toBeNull();
  });
  test("drops malformed nodes and edges but keeps edges to absent nodes for ghost creation", () => {
    const got = readGraphInput({ nodes: [{ id: "a", label: "A" }, { id: 3 }], edges: [{ source: "a", target: "x", relation: "r" }, { source: "a", target: 5, relation: "r" }] });
    expect(got).toEqual({ nodes: [{ id: "a", label: "A", relPath: null }], edges: [{ source: "a", target: "x", relation: "r", fromFrontmatter: false }] });
    const model = buildGraphModel(readGraphInput({ nodes: [{ id: "a", label: "A", relPath: "notes/a.md" }], edges: [{ source: "a", target: "missing", relation: "wiki_link", fromFrontmatter: false }] })!, 0);
    expect(model.edges).toHaveLength(1);
    expect(model.nodes.find((n) => n.id === "missing")).toMatchObject({ relPath: null });
  });
});

test("layout status labels name the cause and next step on failure", () => {
  expect(layoutLabel({ kind: "error", message: "boom" })).toContain("Reload the panel");
  expect(layoutLabel({ kind: "cached-only", reason: "live layout is unavailable: x" })).toContain("unavailable");
  expect(layoutLabel({ kind: "settled", iterations: 12 })).toContain("12");
});
