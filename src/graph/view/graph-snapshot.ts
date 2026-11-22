/** Decode the provider's revision-bound columnar pages without reading vault files. */
import type { GraphSnapshotPage, GraphPanelPage, GraphNodeColumns, GraphEdgeColumns } from "@staix/vault-mem/ui-plugin";
import type { Host, SnapshotReply } from "../../client/host.ts";
import type { GraphInput } from "../types";

const CHANGED = /restart from the first page/i;
const MAX_NODES = 10_000, MAX_EDGES = 100_000;

/** Assemble one revision. Never expose partial pages; retry an expired revision once. */
export async function assembleGraphPages(snapshot: Host["snapshot"], initial: SnapshotReply, params: Record<string, string>, active: () => boolean = () => true): Promise<SnapshotReply> {
  let first = initial;
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await assemble(first, snapshot, params, active);
    if (!active() || typeof result.error !== "string" || !CHANGED.test(result.error) || attempt === 1) return result;
    first = await snapshot({ panel: "graph", ...params, ...(typeof first.vault === "string" ? { vault: first.vault } : {}) });
  }
  return first;
}

async function assemble(first: SnapshotReply, snapshot: Host["snapshot"], params: Record<string, string>, active: () => boolean): Promise<SnapshotReply> {
  if (first.error || first.unavailable || first.changed === false || first.schema !== 1) return first;
  const start = first as unknown as GraphPanelPage;
  if (!start.totals || !Number.isSafeInteger(start.totals.nodes) || !Number.isSafeInteger(start.totals.edges) || start.totals.nodes < 0 || start.totals.edges < 0 || start.totals.nodes > MAX_NODES || start.totals.edges > MAX_EDGES)
    return { error: "Graph exceeds the supported size or has invalid totals; reload the first page." };
  const nodes: GraphInput["nodes"] = [], edges: GraphInput["edges"] = [];
  const communities: Record<string, number> = Object.create(null);
  const seen = new Set<string>();
  let page: GraphSnapshotPage = start, bytes = 0, pages = 0, edgesStarted = false;
  for (;;) {
    if (!active()) return { cancelled: true };
    if (page.schema !== 1 || page.vault !== start.vault || page.revision !== start.revision || page.totals?.nodes !== start.totals.nodes || page.totals?.edges !== start.totals.edges || !Number.isSafeInteger(page.count) || page.count < 0)
      return { error: "Graph pages changed or are invalid; restart from the first page." };
    pages++; bytes += new TextEncoder().encode(JSON.stringify(page)).length;
    if (page.kind === "nodes") {
      if (edgesStarted || page.offset !== nodes.length) return { error: "Graph node pages are out of order; restart from the first page." };
      const c = page.columns as GraphNodeColumns;
      if (!c || ![c.id, c.label, c.type, c.domain, c.source_file, c.community, c.updated, c.date, c.placeholder].every((a) => Array.isArray(a) && a.length === page.count)) return { error: "Graph node columns are invalid; restart from the first page." };
      for (let i = 0; i < page.count; i++) {
        if (typeof c.id[i] !== "string" || typeof c.label[i] !== "string" || typeof c.placeholder[i] !== "boolean") return { error: "Graph node columns are invalid; restart from the first page." };
        const id = c.id[i]!;
        nodes.push({ id, label: c.label[i]!, relPath: c.placeholder[i] ? null : c.source_file[i] ?? null, type: c.type[i], domain: c.domain[i], date: c.date[i], updatedAt: c.updated[i] });
        if (typeof c.community[i] === "number" && Number.isFinite(c.community[i])) communities[id] = c.community[i]!;
      }
    } else if (page.kind === "edges") {
      edgesStarted = true;
      if (nodes.length !== start.totals.nodes || page.offset !== edges.length) return { error: "Graph edge pages are out of order; restart from the first page." };
      const c = page.columns as GraphEdgeColumns;
      if (!c || !Array.isArray(c.relations) || ![c.source, c.target, c.relation, c.field, c.rel].every((a) => Array.isArray(a) && a.length === page.count)) return { error: "Graph edge columns are invalid; restart from the first page." };
      for (let i = 0; i < page.count; i++) {
        const source = c.source[i]!, target = c.target[i]!, relationIndex = c.relation[i]!;
        if (!Number.isSafeInteger(source) || !Number.isSafeInteger(target) || !Number.isSafeInteger(relationIndex) || !nodes[source] || !nodes[target] || typeof c.relations[relationIndex] !== "string") return { error: "Graph edge references are invalid; restart from the first page." };
        const kind = c.relations[relationIndex]!;
        edges.push({ source: nodes[source]!.id, target: nodes[target]!.id, relation: kind === "wiki_link" ? c.rel[i] || "wiki_link" : c.field[i] || kind, fromFrontmatter: kind !== "wiki_link" });
      }
    } else return { error: "Graph page kind is invalid; restart from the first page." };
    if (nodes.length > start.totals.nodes || edges.length > start.totals.edges) return { error: "Graph page totals are invalid; restart from the first page." };
    if (page.next === null) break;
    if (typeof page.next !== "string" || !page.next || seen.has(page.next) || page.count === 0) return { error: "Graph page cursor is invalid; restart from the first page." };
    seen.add(page.next);
    const next = await snapshot({ panel: "graph", ...params, vault: start.vault, page: page.next });
    if (next.error) return next;
    page = next as unknown as GraphSnapshotPage;
  }
  if (nodes.length !== start.totals.nodes || edges.length !== start.totals.edges) return { error: "Graph pages are incomplete; restart from the first page." };
  return { graph: { nodes, edges, ...(Object.keys(communities).length ? { communities } : {}) }, graphStats: { pages, bytes, revision: start.revision, cursor: start.cursor, vault: start.vault, placeholdersOmitted: start.totals.placeholdersOmitted } };
}
