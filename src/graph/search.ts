// Ported from STAIxBWLB/maru@b33341df src/lib/graph/search.ts.
// Search ranking for the graph toolbar combobox. Searches the CURRENT
// filtered graph (visibleModel nodes); ranking: exact label → label prefix →
// label substring → relPath substring, ties broken alphabetically for stable
// arrow-key navigation.

export interface GraphSearchResult {
  id: string;
  label: string;
  relPath: string | null;
}

export const GRAPH_SEARCH_LIMIT = 20;

/** The same match category used by ranked search, or null when the node does not match. */
export function graphSearchRank(node: { label: string; relPath: string | null }, query: string): number | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const label = node.label.toLowerCase();
  if (label === q) return 0;
  if (label.startsWith(q)) return 1;
  if (label.includes(q)) return 2;
  if (node.relPath && node.relPath.toLowerCase().includes(q)) return 3;
  return null;
}

export function graphNodeMatchesSearch(
  node: { label: string; relPath: string | null },
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return node.label.toLowerCase().includes(q)
    || Boolean(node.relPath?.toLowerCase().includes(q));
}

export function rankGraphSearch(
  nodes: readonly { id: string; label: string; relPath: string | null }[],
  query: string,
  limit: number = GRAPH_SEARCH_LIMIT,
): GraphSearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: { node: GraphSearchResult; rank: number }[] = [];
  for (const node of nodes) {
    const rank = graphSearchRank(node, q);
    if (rank == null) continue;
    scored.push({ node: { id: node.id, label: node.label, relPath: node.relPath }, rank });
  }
  scored.sort(
    (a, b) => a.rank - b.rank || a.node.label.localeCompare(b.node.label) || a.node.id.localeCompare(b.node.id),
  );
  return scored.slice(0, limit).map((entry) => entry.node);
}
