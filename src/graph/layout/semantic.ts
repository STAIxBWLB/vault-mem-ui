import type { SemanticEdge } from "../view/graph-snapshot";
import type { LayoutGraph } from "./protocol";

/** Add weighted springs only to the worker input, leaving the visible graph and export untouched. */
export function withSemanticSprings(graph: LayoutGraph, semantic: readonly SemanticEdge[]): LayoutGraph {
  if (!semantic.length) return graph;
  const count = graph.sources.length, size = count + semantic.length;
  const sources = new Uint32Array(size), targets = new Uint32Array(size), weights = new Float32Array(size);
  sources.set(graph.sources); targets.set(graph.targets);
  if (graph.weights) weights.set(graph.weights); else weights.fill(1, 0, count);
  semantic.forEach((edge, index) => { sources[count + index] = edge.source; targets[count + index] = edge.target; weights[count + index] = edge.score; });
  return { ...graph, sources, targets, weights };
}
