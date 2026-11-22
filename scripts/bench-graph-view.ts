/**
 * Synthetic 10k nodes / 100k edges measurement of the graph canvas update paths (run by hand, not in CI):
 *   bun run scripts/bench-graph-view.ts
 * These numbers price the canvas logic only: the real graphology graph is used, but Sigma is a stub that counts
 * refresh calls, so Sigma's own indexing, reduce and program cost is not measured and WebGL is not touched at all.
 * The "before" rows replay what the canvas did before this change: one setNodeAttribute per coordinate and a full
 * refresh per store update.
 */

import { MultiDirectedGraph } from "graphology";
import { buildGraphModel } from "../src/graph/model";
import { mountGraphCanvas, type GraphLike, type SigmaLike } from "../src/graph/view/canvas";
import { createGraphViewStore } from "../src/graph/view/state";

const N = 10_000, E = 100_000;
const input = {
  nodes: Array.from({ length: N }, (_, i) => ({ id: `n${i}`, label: `Note ${i}`, relPath: `notes/n${i}.md` })),
  edges: Array.from({ length: E }, (_, k) => {
    const i = k % N, hop = 1 + Math.floor(k / N);
    return { source: `n${i}`, target: `n${(i + hop) % N}`, relation: "wiki_link", fromFrontmatter: false };
  }),
};
const model = buildGraphModel(input, 0);
const graph = new MultiDirectedGraph();
let full = 0, light = 0, events = 0;
graph.on("nodeAttributesUpdated", () => { events += 1; });
graph.on("eachNodeAttributesUpdated", () => { events += 1; });
const sigma: SigmaLike = {
  on: () => undefined,
  getCamera: () => ({ getState: () => ({ ratio: 1 }), on: () => undefined, animate: () => undefined }),
  getNodeDisplayData: () => undefined, kill: () => undefined,
  // Sigma's setSetting calls scheduleRefresh(), i.e. a full re-index whose process() waits for the next frame.
  setSetting: () => { full += 1; },
  refresh: (o) => { if (o?.partialGraph) light += 1; else full += 1; },
  // Always covered, so every path here takes the reducer-only repaint this bench is pricing; Sigma's own index
  // bookkeeping is what the stub does not model.
  hasProgramIndices: () => true,
};
const store = createGraphViewStore(model);
const canvas = mountGraphCanvas({} as HTMLElement, model, store.getState(), {}, { onHover: () => {}, onClick: () => {}, onCamera: () => {} },
  { createGraph: () => graph as unknown as GraphLike, createSigma: () => sigma });

const time = (label: string, runs: number, fn: (i: number) => void) => {
  full = 0; light = 0; events = 0;
  const t = performance.now();
  for (let i = 0; i < runs; i += 1) fn(i);
  const ms = (performance.now() - t) / runs;
  console.log(`${label.padEnd(44)} ${ms.toFixed(2).padStart(8)} ms/op   full refresh ${full / runs}   light ${light / runs}   graph events ${events / runs}`);
};

console.log(`graph: ${model.nodes.length} nodes, ${model.edges.length} edges`);
console.log("canvas logic only: real graphology, a counting Sigma stub — Sigma's indexing, reducers, programs and WebGL are not measured.");
const batch = new Float32Array(N * 2).map((_, i) => (i % 97) - 48);
time("batch: per-coordinate setNodeAttribute (before)", 10, () => {
  model.nodes.forEach((node, i) => { graph.setNodeAttribute(node.id, "x", batch[i * 2]!); graph.setNodeAttribute(node.id, "y", batch[i * 2 + 1]!); });
});
time("batch: updateEachNodeAttributes (after)", 10, () => canvas.applyPositions(batch));
time("zoom step, LOD unchanged (after)", 50, (i) => { store.setCamera(0.3 + (i % 5) * 0.01); canvas.update(store.getState()); });
time("LOD flip (after)", 20, (i) => { store.setCamera(i % 2 === 0 ? 0.3 : 2); canvas.update(store.getState()); });
time("iteration count change while running (after)", 50, (i) => { store.setLayout({ kind: "running", iterations: i + 1 }); canvas.update(store.getState()); });
time("selection change (after)", 20, (i) => { store.select(`n${i}`); canvas.update(store.getState()); });
