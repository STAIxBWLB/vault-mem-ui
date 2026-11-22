// Ported from STAIxBWLB/maru@b33341df src/lib/graph/decisionChains.ts.
// Decision-chain lanes (maru-vault-graph-spec §3 F3(c)). Deterministic — NOT
// force-directed: supersedes edges group type=decision notes into chains,
// each chain renders as one horizontal timeline lane (oldest → newest);
// isolated decisions go to a side rail.

import type { GraphModel, GraphNode } from "./model";

export interface DecisionChain {
  /** Chain members, older before newer; dates and ids break ties. */
  nodes: GraphNode[];
}

export interface DecisionChainLayout {
  chains: DecisionChain[];
  /** Decisions with no supersedes relation — side rail, date descending. */
  isolated: GraphNode[];
}

const SUPERSEDES_RELATIONS = new Set(["supersedes", "superseded_by"]);

function compareByDate(a: GraphNode, b: GraphNode): number {
  if (a.date && b.date) return a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
  if (a.date) return -1;
  if (b.date) return 1;
  return a.id.localeCompare(b.id);
}

/** Topological chronology with deterministic date/id ties; malformed cycles fall back to date/id for their remainder. */
function orderChain(nodes: GraphNode[], forward: Map<string, Set<string>>): GraphNode[] {
  const members = new Map(nodes.map((node) => [node.id, node]));
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  for (const node of nodes) for (const next of forward.get(node.id) ?? []) if (members.has(next)) indegree.set(next, indegree.get(next)! + 1);
  const heap: GraphNode[] = [];
  const push = (node: GraphNode) => {
    heap.push(node); let index = heap.length - 1;
    while (index > 0) { const parent = Math.floor((index - 1) / 2); if (compareByDate(heap[parent]!, node) <= 0) break; heap[index] = heap[parent]!; index = parent; }
    heap[index] = node;
  };
  const pop = (): GraphNode => {
    const first = heap[0]!, last = heap.pop()!;
    if (heap.length) {
      let index = 0;
      while (index * 2 + 1 < heap.length) {
        let child = index * 2 + 1;
        if (child + 1 < heap.length && compareByDate(heap[child + 1]!, heap[child]!) < 0) child++;
        if (compareByDate(last, heap[child]!) <= 0) break;
        heap[index] = heap[child]!; index = child;
      }
      heap[index] = last;
    }
    return first;
  };
  for (const node of nodes) if (indegree.get(node.id) === 0) push(node);
  const ordered: GraphNode[] = [];
  while (heap.length) {
    const node = pop(); ordered.push(node); indegree.delete(node.id);
    for (const next of forward.get(node.id) ?? []) {
      const degree = indegree.get(next);
      if (degree === undefined) continue;
      indegree.set(next, degree - 1);
      if (degree === 1) push(members.get(next)!);
    }
  }
  return ordered.concat([...indegree.keys()].map((id) => members.get(id)!).sort(compareByDate));
}

/** Group decision notes into supersedes chains. Cycle-safe: connected
 *  components over the (undirected) supersedes relation, so a malformed
 *  A→B→A loop still terminates and lands in one chain. */
export function buildDecisionChains(model: GraphModel): DecisionChainLayout {
  const decisions = new Map(
    model.nodes.filter((n) => n.type === "decision").map((n) => [n.id, n]),
  );

  const adjacency = new Map<string, Set<string>>();
  const forward = new Map<string, Set<string>>();
  for (const edge of model.edges) {
    if (!SUPERSEDES_RELATIONS.has(edge.relation)) continue;
    if (!decisions.has(edge.source) || !decisions.has(edge.target)) continue;
    const [older, newer] = edge.relation === "superseded_by" ? [edge.source, edge.target] : [edge.target, edge.source];
    (forward.get(older) ?? forward.set(older, new Set()).get(older)!).add(newer);
    (adjacency.get(edge.source) ?? adjacency.set(edge.source, new Set()).get(edge.source)!)
      .add(edge.target);
    (adjacency.get(edge.target) ?? adjacency.set(edge.target, new Set()).get(edge.target)!)
      .add(edge.source);
  }

  const visited = new Set<string>();
  const chains: DecisionChain[] = [];
  for (const id of adjacency.keys()) {
    if (visited.has(id)) continue;
    const members: GraphNode[] = [];
    const stack = [id];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (visited.has(current)) continue; // cycle guard
      visited.add(current);
      const node = decisions.get(current);
      if (node) members.push(node);
      for (const neighbor of adjacency.get(current) ?? []) {
        if (!visited.has(neighbor)) stack.push(neighbor);
      }
    }
    if (members.length > 1) {
      chains.push({ nodes: orderChain(members, forward) });
    } else if (members.length === 1) {
      // A supersedes edge whose partner isn't a decision note — treat as isolated.
      visited.add(members[0].id);
    }
  }

  const chained = new Set(chains.flatMap((chain) => chain.nodes.map((node) => node.id)));
  const isolated = [...decisions.values()]
    .filter((n) => !chained.has(n.id))
    .sort((a, b) => compareByDate(b, a));

  chains.sort(
    (a, b) => compareByDate(b.nodes[b.nodes.length - 1], a.nodes[a.nodes.length - 1]),
  );
  return { chains, isolated };
}
