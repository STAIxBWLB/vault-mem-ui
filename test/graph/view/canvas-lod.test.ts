/** The edge reducer applies LOD: a stride sample when reduced, but never drops edges on the path, hovered or touching the selection. */

import { expect, test } from "bun:test";
import { buildGraphModel } from "../../../src/graph/model";
import { mountGraphCanvas, type CanvasDeps, type GraphLike, type SigmaLike } from "../../../src/graph/view/canvas";
import { LOD_EDGE_STRIDE, LOD_EDGE_THRESHOLD } from "../../../src/graph/view/lod";
import { createGraphViewStore } from "../../../src/graph/view/state";
import type { GraphInput } from "../../../src/graph/types";

type Reducer = (key: string, data: Record<string, unknown>) => Record<string, unknown>;

function harness(input: GraphInput) {
  const edges: [string, Record<string, unknown>][] = [];
  let settings: Record<string, unknown> = {};
  const graph: GraphLike = {
    addNode: () => undefined,
    addEdgeWithKey: (k, _s, _t, a) => { edges.push([k, a]); },
    setNodeAttribute: () => undefined, getNodeAttribute: () => undefined, setEdgeAttribute: () => undefined, hasNode: () => true, updateEachNodeAttributes: () => undefined,
  };
  const sigma: SigmaLike = {
    on: () => undefined,
    getCamera: () => ({ getState: () => ({ ratio: 1 }), on: () => undefined, animate: () => undefined }),
    getNodeDisplayData: () => undefined, setSetting: () => undefined, refresh: () => undefined, kill: () => undefined,
  };
  const deps: CanvasDeps = { createGraph: () => graph, createSigma: (_g, _c, s) => { settings = s; return sigma; } };
  const model = buildGraphModel(input, 0);
  const store = createGraphViewStore(model);
  const canvas = mountGraphCanvas({} as HTMLElement, model, store.getState(), {}, { onHover: () => {}, onClick: () => {}, onCamera: () => {} }, deps);
  const visible = () => edges.filter(([k, a]) => !(settings.edgeReducer as Reducer)(k, a).hidden).map(([, a]) => a.index as number);
  return { store, canvas, visible };
}

// A star with LOD_EDGE_THRESHOLD + 1 edges, so LOD applies.
const n = LOD_EDGE_THRESHOLD + 2;
const star: GraphInput = {
  nodes: Array.from({ length: n }, (_, i) => ({ id: `n${i}`, label: `N${i}`, relPath: `notes/n${i}.md` })),
  edges: Array.from({ length: n - 1 }, (_, i) => ({ source: `n${i + 1}`, target: i % 2 ? "n0" : `n${(i + 2) % n}`, relation: "wiki_link", fromFrontmatter: false })),
};

test("a reduced view draws a stride sample but keeps edges the person is looking at", () => {
  const { store, canvas, visible } = harness(star);
  store.setCamera(0.3); // zoomed in, settled: full detail
  canvas.update(store.getState());
  expect(visible()).toHaveLength(star.edges.length);
  store.setLayout({ kind: "running", iterations: 1 });
  canvas.update(store.getState());
  const sampled = visible();
  expect(sampled.every((i) => i % LOD_EDGE_STRIDE === 0)).toBe(true);
  expect(sampled.length).toBe(Math.ceil(star.edges.length / LOD_EDGE_STRIDE));
  store.select("n6"); // edge index 4 (n5 -> n6) and 5 (n6 -> n0) touch n6
  canvas.update(store.getState());
  expect(visible()).toEqual(expect.arrayContaining([4, 5]));
  store.setLayout({ kind: "settled", iterations: 2 });
  canvas.update(store.getState());
  expect(visible()).toHaveLength(star.edges.length);
});
