/** Read-only controls adapted from STAIxBWLB/maru@b33341df src/components/graph/GraphFilterPanel, GraphLegend, GraphInspector and GraphInsightsPanel. */
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { LINK_RELATIONS, type LinkRelation } from "../../client/write.ts";
import { findBridges, findHiddenLinks, findOrphans, findSurprisingConnections } from "../insights";
import { buildDecisionChains } from "../decisionChains";
import type { GraphModel, GraphNode } from "../model";
import { GRAPH_SEARCH_LIMIT, graphSearchRank, rankGraphSearch } from "../search";
import { communityColor, refreshGraphTheme } from "../style";
import type { GraphFilterProfile } from "../types";
import { LARGE_GRAPH_EDGES } from "../layout/protocol";
import type { GraphViewState, GraphViewStore } from "./state";
import { OPEN_PROFILE } from "./state";

/** Chain groups use the existing maru-derived decisionChains.ts model. */
const CHAIN_LIST_LIMIT = 50;
/** Targets the inspector lists before asking for a narrower graph, as the chain lists do. */
const LINK_TARGET_LIMIT = 200;

/** What the inspector may offer when the provider declares the `link` action; absent means the control is hidden. */
export interface LinkProposal {
  propose(input: { from: string; to: string; relation: LinkRelation; bidirectional: boolean }): void;
}

export const GraphChainsPanel = memo(function GraphChainsPanel({ model, visibleIds, chainFocusIds, hasSupersedes, search = "", focus, open }: { model: GraphModel; visibleIds: Set<string>; chainFocusIds: Set<string>; hasSupersedes: boolean; search?: string; focus(ids: string[]): void; open(id: string): void }) {
  const layout = useMemo(() => buildDecisionChains(model), [model]);
  const shown = useMemo(() => {
    let chains = layout.chains.filter((chain) => chain.nodes.some((node) => visibleIds.has(node.id)));
    let isolated = layout.isolated.filter((node) => visibleIds.has(node.id));
    if (search.trim()) {
      const rank = (node: GraphNode) => visibleIds.has(node.id) ? graphSearchRank(node, search) ?? Infinity : Infinity;
      const best = (nodes: GraphNode[]) => nodes.reduce((value, node) => Math.min(value, rank(node)), Infinity);
      chains = chains.map((chain) => ({ chain, rank: best(chain.nodes) })).sort((a, b) => a.rank - b.rank).map((item) => item.chain);
      isolated = isolated.map((node) => ({ node, rank: rank(node) })).sort((a, b) => a.rank - b.rank).map((item) => item.node);
    }
    return { chains, isolated };
  }, [layout, visibleIds, search]);
  return <section className="vmem-card vmem-graph-panel" aria-label="Decision chains">
    <h2 className="vmem-card-title">Decision chains</h2>
    {!hasSupersedes && <p>This graph has no supersedes edges. Chains appear when decisions reference each other with supersedes or superseded_by.</p>}
    {shown.chains.length === 0 && <p>No linked decision chains in the current graph.</p>}
    {shown.chains.length > CHAIN_LIST_LIMIT && <p>Showing {CHAIN_LIST_LIMIT} of {shown.chains.length} chains; search or filter to narrow.</p>}
    <ol>{shown.chains.slice(0, CHAIN_LIST_LIMIT).map((chain) => {
      const ids = chain.nodes.map((node) => node.id), visible = ids.filter((id) => visibleIds.has(id));
      const selected = visible.length > 0 && visible.length === chainFocusIds.size && visible.every((id) => chainFocusIds.has(id));
      const label = chain.nodes.slice(0, 3).map((node) => node.label).join(" → ");
      const members = chain.nodes.length > CHAIN_LIST_LIMIT ? [...chain.nodes.filter((node) => visibleIds.has(node.id)), ...chain.nodes.filter((node) => !visibleIds.has(node.id))] : chain.nodes;
      return <li key={JSON.stringify(ids)}><button type="button" className="vmem-button" aria-pressed={selected} onClick={() => focus(visible)}>Focus chain: {label}{ids.length > 3 ? " ..." : ""}</button>
        {visible.length !== ids.length && <span> {visible.length} of {ids.length} visible</span>}
        <ul>{members.slice(0, CHAIN_LIST_LIMIT).map((node) => <li key={node.id}><button type="button" className="vmem-button" disabled={!node.relPath} onClick={() => open(node.id)}>Open {node.label}</button>{node.date ? ` (${node.date})` : ""}</li>)}</ul>
        {ids.length > CHAIN_LIST_LIMIT && <p>Showing {CHAIN_LIST_LIMIT} of {ids.length} decisions, visible first.</p>}
      </li>;
    })}</ol>
    {shown.isolated.length > 0 && <><h3>Unlinked decisions</h3>{shown.isolated.length > CHAIN_LIST_LIMIT && <p>Showing {CHAIN_LIST_LIMIT} of {shown.isolated.length} unlinked decisions; search or filter to narrow.</p>}<ul>{shown.isolated.slice(0, CHAIN_LIST_LIMIT).map((node) => <li key={node.id}><button type="button" className="vmem-button" aria-pressed={chainFocusIds.size === 1 && chainFocusIds.has(node.id)} onClick={() => focus([node.id])}>Focus {node.label}</button> <button type="button" className="vmem-button" disabled={!node.relPath} onClick={() => open(node.id)}>Open {node.label}</button></li>)}</ul></>}
  </section>;
});

function Facet({ label, items, values, update }: { label: string; items: { value: string; count: number }[]; values: string[]; update(values: string[]): void }) {
  return <fieldset className="vmem-graph-facet"><legend>{label}</legend>{items.map((item) => <label key={item.value} className="vmem-graph-option"><input type="checkbox" checked={values.includes(item.value)} onChange={() => update(values.includes(item.value) ? values.filter((v) => v !== item.value) : [...values, item.value])} /> {item.value} ({item.count})</label>)}</fieldset>;
}

export function GraphFilterPanel({ state, store }: { state: GraphViewState; store: GraphViewStore }) {
  const { profile, derived } = state;
  const update = (patch: Partial<GraphFilterProfile>) => store.setProfile({ ...profile, ...patch });
  const results = useMemo(() => rankGraphSearch(derived.analysisModel.nodes, state.search), [derived.analysisModel, state.search]);
  return <section className="vmem-card vmem-graph-panel" aria-label="Graph filters">
    <h2 className="vmem-card-title">Search and filters</h2>
    <label htmlFor="vmem-graph-search">Search notes</label>
    <input id="vmem-graph-search" className="vmem-input" type="search" value={state.search} onChange={(e) => store.setSearch(e.currentTarget.value)} />
    {state.search && <><p role="status">{results.length === GRAPH_SEARCH_LIMIT ? `First ${GRAPH_SEARCH_LIMIT} results` : `${results.length} search results`}</p><ul aria-label="Graph search results">{results.map((item) => <li key={item.id}><button type="button" className="vmem-button" onClick={() => store.select(item.id)}>{item.label}</button></li>)}</ul></>}
    <Facet label="Domains" items={derived.facets.domains} values={profile.domains} update={(domains) => update({ domains })} />
    <Facet label="Types" items={derived.facets.types} values={profile.types} update={(types) => update({ types })} />
    <Facet label="Relations" items={derived.facets.relations} values={profile.relations} update={(relations) => update({ relations })} />
    <label htmlFor="vmem-graph-community">Community</label>
    <select id="vmem-graph-community" className="vmem-input" value={profile.community === null ? "" : String(profile.community)} onChange={(e) => update({ community: e.currentTarget.value === "" ? null : Number(e.currentTarget.value) })}>
      <option value="">All communities</option>{derived.facets.communities.map((item) => <option key={item.value} value={item.value}>{item.value} ({item.count})</option>)}
    </select>
    {derived.pausedFilters.length > 0 && <p className="vmem-sub">Unavailable filters: {derived.pausedFilters.join(", ")}</p>}
    <button type="button" className="vmem-button" onClick={() => { store.setProfile({ ...OPEN_PROFILE }); store.setSearch(""); }}>Reset filters</button>
  </section>;
}

export function GraphLegend({ state, themeKey = "" }: { state: GraphViewState; themeKey?: string }) {
  const swatches = useRef<HTMLUListElement>(null);
  const communities = state.derived.facets.communities;
  useEffect(() => {
    const list = swatches.current;
    if (!list) return;
    refreshGraphTheme(list.closest(".vmem-graph")?.querySelector(".vmem-graph-canvas"));
    list.querySelectorAll<HTMLElement>("[data-community]").forEach((el) => { el.style.backgroundColor = communityColor(Number(el.dataset.community)); });
  }, [communities, themeKey, state.colorByCommunity]);
  return <section className="vmem-card vmem-graph-panel" aria-label="Graph legend"><h2 className="vmem-card-title">Legend</h2><p>Node size reflects link count. Unresolved notes use the canvas background. Selected and path nodes are highlighted.</p><p>Arrows represent frontmatter links; lines represent other links.</p>{state.colorByCommunity && communities.length > 0 && <ul ref={swatches} aria-label="Community colours">{communities.map((item) => <li key={item.value}><span className="vmem-community-swatch" data-community={item.value} aria-hidden="true" /> Community {item.value}</li>)}</ul>}</section>;
}

/**
 * The link form: a second note and one of the provider's relations. It only proposes — the shared write dialog shows
 * the provider's preview and its planned changes, and nothing reaches the vault before Confirm.
 */
function LinkForm({ node, model, propose }: { node: GraphNode; model: GraphModel; propose: LinkProposal["propose"] }) {
  const [to, setTo] = useState("");
  const [relation, setRelation] = useState<LinkRelation>(LINK_RELATIONS[0]);
  const [bidirectional, setBidirectional] = useState(true);
  // A placeholder link has no file behind it, so only notes the provider gave a path can be a target.
  const targets = useMemo(() => model.nodes.filter((item) => item.id !== node.id && item.relPath).sort((a, b) => a.label.localeCompare(b.label)), [model, node.id]);
  const from = node.relPath;
  const chosen = targets.find((item) => item.id === to);
  if (!from) return <p>This note is an unresolved link with no file, so a link cannot start here. Open the note it points at, or add it first.</p>;
  if (!targets.length) return <p>No other note in this graph can be a link target. Clear search and filters, or add another note first.</p>;
  return (
    <>
      <h3>Link this note</h3>
      <label htmlFor="vmem-graph-link-target">Link to</label>
      <select id="vmem-graph-link-target" className="vmem-input" value={chosen?.id ?? ""} onChange={(event) => setTo(event.currentTarget.value)}>
        <option value="">Choose a note</option>
        {targets.slice(0, LINK_TARGET_LIMIT).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select>
      {targets.length > LINK_TARGET_LIMIT && <p className="vmem-sub">Showing the first {LINK_TARGET_LIMIT} of {targets.length} notes by label; search or filter to narrow.</p>}
      <label htmlFor="vmem-graph-link-relation">Relation</label>
      <select id="vmem-graph-link-relation" className="vmem-input" value={relation} onChange={(event) => setRelation(event.currentTarget.value as LinkRelation)}>
        {LINK_RELATIONS.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
      <label className="vmem-graph-option"><input type="checkbox" checked={bidirectional} onChange={(event) => setBidirectional(event.currentTarget.checked)} /> Both directions</label>
      <button type="button" className="vmem-button" disabled={!chosen?.relPath} onClick={() => { if (chosen?.relPath) propose({ from, to: chosen.relPath, relation, bidirectional }); }}>Propose link</button>
      <p className="vmem-sub">Nothing is written until you confirm the preview.</p>
    </>
  );
}

export function GraphInspector({ node, model, open, link }: { node: GraphNode | null; model: GraphModel; open(id: string): void; link?: LinkProposal }) {
  if (!node) return <section className="vmem-card vmem-graph-panel" aria-label="Graph inspector"><h2 className="vmem-card-title">Inspector</h2><p>Select a note to inspect it.</p></section>;
  const labels = new Map(model.nodes.map((item) => [item.id, item.label]));
  const related = model.edges.filter((edge) => edge.source === node.id || edge.target === node.id);
  return <section className="vmem-card vmem-graph-panel" aria-label="Graph inspector"><h2 className="vmem-card-title">Inspector</h2><h3>{node.label}</h3><dl><dt>Type</dt><dd>{node.type}</dd><dt>Domain</dt><dd>{node.domain ?? "None"}</dd><dt>Community</dt><dd>{node.community ?? "None"}</dd><dt>Visible links</dt><dd>{node.degree}</dd><dt>Path</dt><dd>{node.relPath ?? "Unresolved"}</dd></dl>{node.relPath && <button type="button" className="vmem-button" onClick={() => open(node.id)}>Open note</button>}{link ? <LinkForm node={node} model={model} propose={link.propose} /> : null}<h3>Connections</h3><ul>{related.slice(0, 20).map((edge) => <li key={JSON.stringify([edge.source, edge.target, edge.relation])}>{labels.get(edge.source) ?? edge.source} → {labels.get(edge.target) ?? edge.target} ({edge.relation})</li>)}</ul>{related.length > 20 && <p>Showing 20 of {related.length} connections.</p>}</section>;
}

export function GraphInsightsPanel({ model, visibleIds, select }: { model: GraphModel; visibleIds: Set<string>; select(id: string): void }) {
  const [open, setOpen] = useState(false);
  const results = useMemo(() => open ? { orphans: findOrphans(model), bridges: findBridges(model), cross: findSurprisingConnections(model), hidden: model.edges.length <= LARGE_GRAPH_EDGES ? findHiddenLinks(model) : [] } : null, [model, open]);
  const labels = useMemo(() => new Map(model.nodes.map((node) => [node.id, node.label])), [model]);
  const label = (id: string) => labels.get(id) ?? id;
  return <section className="vmem-card vmem-graph-panel" aria-label="Graph insights"><h2 className="vmem-card-title">Insights</h2><button type="button" className="vmem-button" aria-expanded={open} aria-controls="vmem-graph-insights-results" onClick={() => setOpen(!open)}>{open ? "Hide insights" : "Show insights"}</button><div id="vmem-graph-insights-results">{results && <><h3>Orphan notes</h3><ul>{results.orphans.map((item) => <li key={item.id}><button type="button" className="vmem-button" disabled={!visibleIds.has(item.id)} title={!visibleIds.has(item.id) ? "Hidden by search" : undefined} onClick={() => select(item.id)}>{label(item.id)}</button></li>)}</ul><h3>Community bridges</h3><ul>{results.bridges.map((item) => <li key={item.id}><button type="button" className="vmem-button" disabled={!visibleIds.has(item.id)} title={!visibleIds.has(item.id) ? "Hidden by search" : undefined} onClick={() => select(item.id)}>{label(item.id)}</button> ({item.communityCount} communities)</li>)}</ul><h3>Cross-community connections</h3><ul>{results.cross.map((item) => <li key={`${item.source}:${item.target}`}>{label(item.source)} → {label(item.target)}</li>)}</ul><h3>Possible links</h3>{model.edges.length > LARGE_GRAPH_EDGES ? <p>Possible links are unavailable for large graphs. Narrow the graph with filters first.</p> : <ul>{results.hidden.map((item) => <li key={`${item.source}:${item.target}`}>{label(item.source)} ↔ {label(item.target)} ({item.shared} shared)</li>)}</ul>}</>}</div></section>;
}
