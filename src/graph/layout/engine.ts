// ForceAtlas2 engine over persistent matrices, built straight from index arrays (no graphology instance in the
// worker). Matrix layout and settings merge follow graphology-layout-forceatlas2 0.10.1 helpers.graphToByteArrays and
// index.js; one step is that library's own `iterate`, so the arithmetic matches its public `assign`.
// The stock FA2 worker supervisor is not used: it starts its worker from a blob: URL, which the panel CSP blocks.

import DEFAULTS from "graphology-layout-forceatlas2/defaults";
import iterate from "graphology-layout-forceatlas2/iterate";
import type { ForceAtlas2Settings, LayoutGraph } from "./protocol";

const PPN = 10; // floats per node in FA2's NodeMatrix
const PPE = 3; // floats per edge in FA2's EdgeMatrix

export interface LayoutEngine {
  readonly nodeCount: number;
  readonly iterations: number;
  /** Runs `n` ForceAtlas2 iterations. */
  step(n?: number): void;
  /** Spike 2's movement proxy for the last iteration: sqrt(sum |dp|^2 / sum |p|^2); 0 before the first step. */
  readonly movement: number;
  /** Current coordinates as a fresh x0,y0,x1,y1,... array (safe to transfer). */
  positions(): Float32Array;
  /** Sets or clears node `index`'s fixed flag, optionally moving it first. Out-of-range or non-finite input is ignored. */
  setFixed(index: number, fixed: boolean, position?: [number, number]): void;
}

/** Validates the graph and returns the cause of the first problem, or null. */
export function layoutGraphProblem(graph: LayoutGraph): string | null {
  const n = graph.nodeCount;
  if (!Number.isInteger(n) || n < 0) return `nodeCount must be a whole number, got ${n}`;
  if (graph.positions.length !== n * 2) return `positions has ${graph.positions.length} values, expected ${n * 2} (x,y per node)`;
  if (graph.sources.length !== graph.targets.length) return `sources (${graph.sources.length}) and targets (${graph.targets.length}) differ in length`;
  for (let i = 0; i < graph.sources.length; i += 1) {
    if (graph.sources[i]! >= n || graph.targets[i]! >= n) return `edge ${i} points at node ${Math.max(graph.sources[i]!, graph.targets[i]!)}, but there are only ${n} nodes`;
  }
  if (graph.sizes && graph.sizes.length !== n) return `sizes has ${graph.sizes.length} values, expected ${n}`;
  if (graph.fixed && graph.fixed.length !== n) return `fixed has ${graph.fixed.length} values, expected ${n}`;
  return null;
}

export function createLayoutEngine(graph: LayoutGraph, settings: ForceAtlas2Settings): LayoutEngine {
  const problem = layoutGraphProblem(graph);
  if (problem) throw new Error(problem);
  const n = graph.nodeCount;
  const m = graph.sources.length;
  const nodes = new Float32Array(n * PPN);
  const edges = new Float32Array(m * PPE);
  for (let i = 0; i < n; i += 1) {
    const j = i * PPN;
    nodes[j] = graph.positions[i * 2]!;
    nodes[j + 1] = graph.positions[i * 2 + 1]!;
    nodes[j + 6] = 1; // mass, incremented by weighted degree below
    nodes[j + 7] = 1; // convergence
    nodes[j + 8] = graph.sizes?.[i] || 1;
    nodes[j + 9] = graph.fixed?.[i] ? 1 : 0;
  }
  for (let e = 0; e < m; e += 1) {
    const sj = graph.sources[e]! * PPN;
    const tj = graph.targets[e]! * PPN;
    nodes[sj + 6] += 1;
    nodes[tj + 6] += 1;
    edges[e * PPE] = sj;
    edges[e * PPE + 1] = tj;
    edges[e * PPE + 2] = 1;
  }
  const merged = { ...DEFAULTS, ...settings };
  let iterations = 0;
  let movement = 0;
  const prev = new Float32Array(n * 2);
  return {
    nodeCount: n,
    get iterations() { return iterations; },
    get movement() { return movement; },
    step(count = 1) {
      if (n === 0) return;
      for (let k = 0; k < count; k += 1) {
        for (let i = 0; i < n; i += 1) { prev[i * 2] = nodes[i * PPN]!; prev[i * 2 + 1] = nodes[i * PPN + 1]!; }
        iterate(merged, nodes, edges);
        let moved = 0, extent = 0;
        for (let i = 0; i < n; i += 1) {
          const x = nodes[i * PPN]!, y = nodes[i * PPN + 1]!;
          const dx = x - prev[i * 2]!, dy = y - prev[i * 2 + 1]!;
          moved += dx * dx + dy * dy;
          extent += x * x + y * y;
        }
        movement = extent > 0 ? Math.sqrt(moved / extent) : (moved > 0 ? Infinity : 0);
      }
      iterations += count;
    },
    positions() {
      const out = new Float32Array(n * 2);
      for (let i = 0; i < n; i += 1) {
        out[i * 2] = nodes[i * PPN]!;
        out[i * 2 + 1] = nodes[i * PPN + 1]!;
      }
      return out;
    },
    setFixed(index, fixed, position) {
      if (!Number.isInteger(index) || index < 0 || index >= n) return;
      const j = index * PPN;
      if (position && Number.isFinite(position[0]) && Number.isFinite(position[1])) {
        nodes[j] = position[0];
        nodes[j + 1] = position[1];
      }
      nodes[j + 9] = fixed ? 1 : 0;
    },
  };
}
