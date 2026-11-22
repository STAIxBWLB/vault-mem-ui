/** Decode the provider's revision-bound columnar pages without reading vault files. */
import type { GraphSnapshotPage, GraphPanelPage, GraphNodeColumns, GraphEdgeColumns, SemanticGraphPage } from "@staix/vault-mem/ui-plugin";
import type { Host, SnapshotReply } from "../../client/host.ts";
import type { GraphInput } from "../types";

const CHANGED = /restart from the first page/i;
const MAX_NODES = 10_000, MAX_EDGES = 100_000;
export const SEMANTIC_DEFAULTS = { k: 8, minScore: 0.75 } as const;
export interface SemanticEdge { source: number; target: number; score: number }

/** Semantic springs refer to the original node columns and never enter the graph's visible edges. */
export async function assembleSemanticPages(snapshot: Host["snapshot"], vault: string, revision: string, nodeCount: number, active: () => boolean = () => true): Promise<{ edges: SemanticEdge[] } | { error: string }> {
  const edges: SemanticEdge[] = [], seen = new Set<string>();
  let pageToken: string | undefined;
  for (;;) {
    const reply = await snapshot({ panel: "graph", vault, semantic: SEMANTIC_DEFAULTS, ...(pageToken ? { page: pageToken } : {}) });
    if (!active()) return { error: "Semantic layout request was cancelled." };
    if (typeof reply.error === "string") return { error: reply.error };
    const page = reply as unknown as SemanticGraphPage;
    if (page.schema !== 1 || page.kind !== "semantic" || page.vault !== vault || page.revision !== revision) return { error: "Graph changed while loading semantic layout; restart from the first page." };
    const c = page.semantic;
    if (!Number.isSafeInteger(page.offset) || page.offset !== edges.length || !Number.isSafeInteger(page.count) || page.count < 0 || !c || ![c.source, c.target, c.score].every((column) => Array.isArray(column) && column.length === page.count)) return { error: "Semantic graph page is invalid; restart from the first page." };
    if (edges.length + page.count > nodeCount * SEMANTIC_DEFAULTS.k) return { error: "Semantic graph page exceeds the supported number of similarity pairs; update @staix/vault-mem or report its version." };
    for (let i = 0; i < page.count; i++) {
      const source = c.source[i]!, target = c.target[i]!, score = c.score[i]!;
      if (!Number.isSafeInteger(source) || source < 0 || source >= nodeCount || !Number.isSafeInteger(target) || target < 0 || target >= nodeCount || typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 1) return { error: "Semantic graph page is invalid; restart from the first page." };
      edges.push({ source, target, score });
    }
    if (page.next === null) return { edges };
    if (typeof page.next !== "string" || !page.next || seen.has(page.next) || !page.count) return { error: "Semantic graph page is invalid; restart from the first page." };
    seen.add(page.next); pageToken = page.next;
  }
}

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
  const enrichment = start.enrichment;
  if (enrichment !== undefined && (!enrichment || typeof enrichment !== "object" || Array.isArray(enrichment) || !(enrichment.model === null || typeof enrichment.model === "string") || !Number.isSafeInteger(enrichment.embedded) || !Number.isSafeInteger(enrichment.total) || enrichment.embedded < 0 || enrichment.total < 0 || enrichment.embedded > enrichment.total))
    return { error: "Graph provider returned invalid enrichment metadata; update @staix/vault-mem or report its version." };
  if (typeof start.revision !== "string" || !start.revision.trim())
    return { error: "Graph provider returned a missing or invalid revision; update @staix/vault-mem or report its version." };
  if (!start.totals || !Number.isSafeInteger(start.totals.nodes) || !Number.isSafeInteger(start.totals.edges) || start.totals.nodes < 0 || start.totals.edges < 0)
    return { error: "Graph provider returned malformed totals; update @staix/vault-mem or report its version." };
  if (start.totals.nodes > MAX_NODES || start.totals.edges > MAX_EDGES)
    return { error: `Graphs larger than ${MAX_NODES.toLocaleString("en-US")} notes or ${MAX_EDGES.toLocaleString("en-US")} links are not supported in this panel yet; use Search instead.` };
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
      const tags = c.confidence_tag;
      if (!(typeof tags === "string" && (tags === "EXTRACTED" || tags === "INFERRED")) && !(Array.isArray(tags) && tags.length === page.count && Array.from(tags).every((tag) => tag === "EXTRACTED" || tag === "INFERRED"))) return { error: "Graph confidence tag is invalid or unsupported; update @staix/vault-mem-ui." };
      for (let i = 0; i < page.count; i++) {
        const source = c.source[i]!, target = c.target[i]!, relationIndex = c.relation[i]!;
        if (!Number.isSafeInteger(source) || !Number.isSafeInteger(target) || !Number.isSafeInteger(relationIndex) || !nodes[source] || !nodes[target] || typeof c.relations[relationIndex] !== "string") return { error: "Graph edge references are invalid; restart from the first page." };
        const kind = c.relations[relationIndex]!;
        // Both declarations describe newer superseding older; normalize before the model deduplicates reciprocal edges.
        const reverse = kind === "supersedes" && c.field[i] === "superseded_by";
        edges.push({ source: nodes[reverse ? target : source]!.id, target: nodes[reverse ? source : target]!.id, relation: kind === "wiki_link" ? c.rel[i] || "wiki_link" : kind === "supersedes" ? "supersedes" : c.field[i] || kind, fromFrontmatter: kind !== "wiki_link", inferred: (typeof tags === "string" ? tags : tags[i]) === "INFERRED" });
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
  // The reply is rebuilt from its pages, so a field the host put on the first page that is not page data has to be
  // carried over explicitly: the provider's declared actions are what the link control reads.
  const capabilities = first.capabilities;
  return { graph: { nodes, edges, ...(Object.keys(communities).length ? { communities } : {}) }, graphStats: { pages, bytes, revision: start.revision, cursor: start.cursor, vault: start.vault, placeholdersOmitted: start.totals.placeholdersOmitted }, ...(enrichment !== undefined ? { enrichment } : {}), ...(capabilities !== null && typeof capabilities === "object" ? { capabilities } : {}) };
}
