// Graph model for the graph view.
// Ported from STAIxBWLB/maru@b33341df src/lib/graph/model.ts. The maru version derived the graph from
// VaultEntry[] and overlaid communities from reports/vault-graph.json; here the graph comes only from the
// provider's graph snapshot, through GraphInput (see ./types.ts), so buildGraphModel replaces buildVaultGraph
// and enrichGraph, and the knowledge-root/VaultGraphFile helpers are gone.

import type { GraphInput } from "./types";

/** Where a node came from. "unknown" = ghost (no path to classify). */
export type GraphNodeOrigin = "workspace" | "knowledge" | "unknown";
/** The pair an edge connects; "cross" spans the workspace/knowledge boundary. */
export type GraphEdgeOrigin = "workspace" | "knowledge" | "cross";

export interface GraphNode {
  id: string;
  label: string;
  /** null = ghost (unresolved wikilink target — F3(b)'s input). */
  relPath: string | null;
  ownerWorkspacePath?: string | null;
  origin: GraphNodeOrigin;
  type: string;
  domain: string | null;
  degree: number;
  community: number | null;
  isGodNode: boolean;
  /** frontmatter created/decided_date/date — decision-chain lane ordering. */
  date: string | null;
  /** Last modification time (ISO) — stale-note detection; null for ghosts. */
  updatedAt: string | null;
}

export interface GraphEdge {
  source: string;
  target: string;
  /** frontmatter field name, or "wiki_link" for body links. */
  relation: string;
  fromFrontmatter: boolean;
  inferred: boolean;
  origin: GraphEdgeOrigin;
}

export interface GraphModel {
  nodes: GraphNode[];
  edges: GraphEdge[];
  enriched: boolean;
  builtAt: number;
}

/** Stable visibility identity for an edge. The model de-duplicates identical
 * source/target/relation tuples, so this key can mask relation-filtered edges
 * without rebuilding the Sigma topology. */
export function graphEdgeVisibilityKey(
  edge: Pick<GraphEdge, "source" | "target" | "relation" | "fromFrontmatter">,
): string {
  return JSON.stringify([edge.source, edge.target, edge.relation, edge.fromFrontmatter]);
}

/** Recompute incident-edge degree for a derived model. Graph consumers must
 * not keep displaying the full-vault degree after relation/local pruning. */
export function withGraphDegrees(model: GraphModel): GraphModel {
  const degrees = new Map(model.nodes.map((node) => [node.id, 0]));
  for (const edge of model.edges) {
    degrees.set(edge.source, (degrees.get(edge.source) ?? 0) + 1);
    degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + 1);
  }
  return {
    ...model,
    nodes: model.nodes.map((node) => ({ ...node, degree: degrees.get(node.id) ?? 0 })),
  };
}

const GOD_NODE_COUNT = 10;

/** Edge class from its endpoints. A ghost endpoint is not evidence of a
 *  crossing, so "unknown" inherits the known side instead of counting as cross. */
export function edgeOrigin(
  a: GraphNodeOrigin,
  b: GraphNodeOrigin,
): GraphEdgeOrigin {
  if (a === "unknown") return b === "unknown" ? "workspace" : b;
  if (b === "unknown" || a === b) return a;
  return "cross";
}

/** Build the model from the provider graph input. Self loops and duplicate source/target/relation triples are
 *  dropped, edge targets that are not in the input become unresolved ("ghost") nodes, degrees are counted and the
 *  ten best-connected non-MOC notes are marked as god nodes. `enriched` is true when communities were supplied. */
export function buildGraphModel(input: GraphInput, builtAt: number = Date.now()): GraphModel {
  const communities = input.communities;
  const nodes = new Map<string, GraphNode>();
  for (const n of input.nodes) {
    if (nodes.has(n.id)) continue;
    // Invariant: a node without a path is a ghost, whatever type the input claims; filters, chains and insights
    // classify ghosts by type === "unresolved".
    const type = n.relPath === null ? "unresolved" : (n.type?.trim() || "untyped");
    nodes.set(n.id, {
      id: n.id,
      label: n.label,
      relPath: n.relPath,
      ownerWorkspacePath: n.ownerWorkspacePath ?? null,
      origin: n.relPath === null ? "unknown" : (n.origin ?? "knowledge"),
      type,
      domain: n.domain?.trim() || null,
      degree: 0,
      // Own properties only: an id such as `constructor` must not read Object.prototype.
      community: communities && Object.hasOwn(communities, n.id) && Number.isFinite(communities[n.id]) ? communities[n.id]! : null,
      isGodNode: false,
      date: n.date ?? null,
      updatedAt: n.relPath === null ? null : (n.updatedAt ?? null),
    });
  }
  const ensure = (id: string) => {
    if (nodes.has(id)) return;
    nodes.set(id, {
      id, label: id, relPath: null, ownerWorkspacePath: null, origin: "unknown", type: "unresolved",
      domain: null, degree: 0, community: null, isGodNode: false, date: null, updatedAt: null,
    });
  };

  const edges: GraphEdge[] = [];
  const seenEdges = new Map<string, GraphEdge>();
  for (const e of input.edges) {
    if (e.source === e.target) continue;
    const key = `${e.source}\u0000${e.target}\u0000${e.relation}`;
    const existing = seenEdges.get(key);
    if (existing) { if (e.inferred !== true) existing.inferred = false; continue; }
    ensure(e.source);
    ensure(e.target);
    const edge: GraphEdge = {
      source: e.source,
      target: e.target,
      relation: e.relation,
      fromFrontmatter: e.fromFrontmatter,
      inferred: e.inferred === true,
      origin: edgeOrigin(nodes.get(e.source)!.origin, nodes.get(e.target)!.origin),
    };
    seenEdges.set(key, edge);
    edges.push(edge);
  }

  for (const edge of edges) {
    nodes.get(edge.source)!.degree += 1;
    nodes.get(edge.target)!.degree += 1;
  }

  const godCandidates = [...nodes.values()]
    .filter((n) => n.type !== "moc" && n.type !== "unresolved")
    .sort((a, b) => b.degree - a.degree)
    .slice(0, GOD_NODE_COUNT);
  for (const node of godCandidates) {
    if (node.degree > 0) node.isGodNode = true;
  }

  return { nodes: [...nodes.values()], edges, enriched: communities !== undefined, builtAt };
}

/** Precomputed 1-hop adjacency for hover highlighting. Cached per model so
 *  the 3-4 callers in a render cycle (insights + focusSubgraph) share one build
 *  instead of each rebuilding O(E). A new model identity (vault edit / enrich)
 *  misses and rebuilds; keyed weakly so old models get collected. */
const adjacencyCache = new WeakMap<GraphModel, Map<string, Set<string>>>();

export function buildAdjacency(model: GraphModel): Map<string, Set<string>> {
  const cached = adjacencyCache.get(model);
  if (cached) return cached;
  const adjacency = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    let set = adjacency.get(a);
    if (!set) {
      set = new Set();
      adjacency.set(a, set);
    }
    set.add(b);
  };
  for (const edge of model.edges) {
    add(edge.source, edge.target);
    add(edge.target, edge.source);
  }
  adjacencyCache.set(model, adjacency);
  return adjacency;
}

/** k-hop subgraph around a focus node (focus mode, k=2 per spec). */
export function focusSubgraph(
  model: GraphModel,
  focusId: string,
  k: number = 2,
  direction: "both" | "incoming" | "outgoing" = "both",
): GraphModel {
  const adjacency = direction === "both" ? buildAdjacency(model) : new Map<string, Set<string>>();
  if (direction !== "both") {
    for (const edge of model.edges) {
      const from = direction === "outgoing" ? edge.source : edge.target;
      const to = direction === "outgoing" ? edge.target : edge.source;
      if (!adjacency.has(from)) adjacency.set(from, new Set());
      adjacency.get(from)!.add(to);
    }
  }
  const keep = new Set<string>([focusId]);
  let frontier = [focusId];
  for (let hop = 0; hop < k; hop += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const neighbor of adjacency.get(id) ?? []) {
        if (!keep.has(neighbor)) {
          keep.add(neighbor);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
  }
  return {
    ...model,
    nodes: model.nodes.filter((n) => keep.has(n.id)),
    edges: model.edges.filter((e) => keep.has(e.source) && keep.has(e.target)),
  };
}

/** Generated content: notes whose relPath matches a configured generated
 *  pattern (trailing "/" = prefix match, otherwise exact filename match),
 *  both case-insensitive. Untyped notes are visible authored content — they
 *  are NOT generated. Ghosts (`relPath: null`, type "unresolved") are governed
 *  by the showUnresolved filter, not here. */
export function isGeneratedNode(node: GraphNode, patterns: readonly string[]): boolean {
  if (node.type === "unresolved") return false;
  if (!node.relPath) return false;
  const relPath = node.relPath.toLowerCase();
  const fileName = relPath.split("/").pop() ?? relPath;
  return patterns.some((raw) => {
    const pattern = raw.toLowerCase();
    return pattern.endsWith("/") ? relPath.startsWith(pattern) : fileName === pattern;
  });
}
