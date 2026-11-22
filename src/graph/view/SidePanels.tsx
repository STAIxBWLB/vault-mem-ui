/** Read-only controls adapted from STAIxBWLB/maru@b33341df src/components/graph/GraphFilterPanel, GraphLegend, GraphInspector and GraphInsightsPanel. */
import { useMemo, useState } from "react";
import { findBridges, findHiddenLinks, findOrphans, findSurprisingConnections } from "../insights";
import type { GraphModel, GraphNode } from "../model";
import { rankGraphSearch } from "../search";
import type { GraphFilterProfile } from "../types";
import { LARGE_GRAPH_EDGES } from "../layout/protocol";
import type { GraphViewState, GraphViewStore } from "./state";
import { OPEN_PROFILE } from "./state";

function Facet({ label, items, values, update }: { label: string; items: { value: string; count: number }[]; values: string[]; update(values: string[]): void }) {
  return <fieldset className="vmem-graph-facet"><legend>{label}</legend>{items.map((item) => <label key={item.value} className="vmem-graph-option"><input type="checkbox" checked={values.includes(item.value)} onChange={() => update(values.includes(item.value) ? values.filter((v) => v !== item.value) : [...values, item.value])} /> {item.value} ({item.count})</label>)}</fieldset>;
}

export function GraphFilterPanel({ state, store }: { state: GraphViewState; store: GraphViewStore }) {
  const { profile, derived } = state;
  const update = (patch: Partial<GraphFilterProfile>) => store.setProfile({ ...profile, ...patch });
  const results = useMemo(() => rankGraphSearch(derived.analysisModel.nodes, state.search), [derived.analysisModel, state.search]);
  return <section className="vmem-graph-panel" aria-label="Graph filters">
    <h2>Search and filters</h2>
    <label htmlFor="vmem-graph-search">Search notes</label>
    <input id="vmem-graph-search" className="vmem-input" type="search" value={state.search} onChange={(e) => store.setSearch(e.currentTarget.value)} />
    {state.search && <><p role="status">{results.length} search results</p><ul aria-label="Graph search results">{results.map((item) => <li key={item.id}><button type="button" className="vmem-button" onClick={() => store.select(item.id)}>{item.label}</button></li>)}</ul></>}
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

export function GraphLegend({ state }: { state: GraphViewState }) {
  const { facets } = state.derived;
  return <section className="vmem-graph-panel" aria-label="Graph legend"><h2>Legend</h2><p>Node size reflects the number of links. Highlighted nodes show selection or path.</p><p>Domains: {facets.domains.map((item) => item.value).join(", ") || "none"}</p><p>Relations: {facets.relations.map((item) => item.value).join(", ") || "none"}</p><p>Communities: {facets.communities.map((item) => item.value).join(", ") || "none"}</p></section>;
}

export function GraphInspector({ node, model, open }: { node: GraphNode | null; model: GraphModel; open(id: string): void }) {
  if (!node) return <section className="vmem-graph-panel" aria-label="Graph inspector"><h2>Inspector</h2><p>Select a note to inspect it.</p></section>;
  const labels = new Map(model.nodes.map((item) => [item.id, item.label]));
  const related = model.edges.filter((edge) => edge.source === node.id || edge.target === node.id);
  return <section className="vmem-graph-panel" aria-label="Graph inspector"><h2>Inspector</h2><h3>{node.label}</h3><dl><dt>Type</dt><dd>{node.type}</dd><dt>Domain</dt><dd>{node.domain ?? "None"}</dd><dt>Community</dt><dd>{node.community ?? "None"}</dd><dt>Visible links</dt><dd>{node.degree}</dd><dt>Path</dt><dd>{node.relPath ?? "Unresolved"}</dd></dl>{node.relPath && <button type="button" className="vmem-button" onClick={() => open(node.id)}>Open note</button>}<h3>Connections</h3><ul>{related.slice(0, 20).map((edge) => <li key={JSON.stringify([edge.source, edge.target, edge.relation])}>{labels.get(edge.source) ?? edge.source} → {labels.get(edge.target) ?? edge.target} ({edge.relation})</li>)}</ul>{related.length > 20 && <p>Showing 20 of {related.length} connections.</p>}</section>;
}

export function GraphInsightsPanel({ model, select }: { model: GraphModel; select(id: string): void }) {
  const [open, setOpen] = useState(false);
  const results = useMemo(() => open ? { orphans: findOrphans(model), bridges: findBridges(model), cross: findSurprisingConnections(model), hidden: model.edges.length <= LARGE_GRAPH_EDGES ? findHiddenLinks(model) : [] } : null, [model, open]);
  const labels = useMemo(() => new Map(model.nodes.map((node) => [node.id, node.label])), [model]);
  const label = (id: string) => labels.get(id) ?? id;
  return <section className="vmem-graph-panel" aria-label="Graph insights"><h2>Insights</h2><button type="button" className="vmem-button" aria-expanded={open} aria-controls="vmem-graph-insights-results" onClick={() => setOpen(!open)}>{open ? "Hide insights" : "Show insights"}</button><div id="vmem-graph-insights-results">{results && <><h3>Orphan notes</h3><ul>{results.orphans.map((item) => <li key={item.id}><button type="button" className="vmem-button" onClick={() => select(item.id)}>{label(item.id)}</button></li>)}</ul><h3>Community bridges</h3><ul>{results.bridges.map((item) => <li key={item.id}><button type="button" className="vmem-button" onClick={() => select(item.id)}>{label(item.id)}</button> ({item.communityCount} communities)</li>)}</ul><h3>Cross-community connections</h3><ul>{results.cross.map((item) => <li key={`${item.source}:${item.target}`}>{label(item.source)} → {label(item.target)}</li>)}</ul><h3>Possible links</h3>{model.edges.length > LARGE_GRAPH_EDGES ? <p>Possible links are unavailable for large graphs. Narrow the graph with filters first.</p> : <ul>{results.hidden.map((item) => <li key={`${item.source}:${item.target}`}>{label(item.source)} ↔ {label(item.target)} ({item.shared} shared)</li>)}</ul>}</>}</div></section>;
}
