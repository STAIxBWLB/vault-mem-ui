import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { buildGraphModel } from "../../../src/graph/model";
import { createGraphViewStore } from "../../../src/graph/view/state";
import { GraphChainsPanel, GraphFilterPanel, GraphInspector, GraphLegend } from "../../../src/graph/view/SidePanels";

test("chain and unlinked lists are capped with counts", () => {
  const nodes = Array.from({ length: 162 }, (_, i) => ({ id: `n${i}`, label: `Node ${i}`, relPath: `notes/n${i}.md`, type: "decision" }));
  const edges = Array.from({ length: 51 }, (_, i) => ({ source: `n${i * 2}`, target: `n${i * 2 + 1}`, relation: "supersedes", fromFrontmatter: true }));
  const store = createGraphViewStore(buildGraphModel({ nodes, edges })); store.setMode("chains");
  const state = store.getState();
  const markup = renderToStaticMarkup(<GraphChainsPanel model={state.derived.analysisModel} visibleIds={state.derived.visibleNodeIds} chainFocusIds={state.chainFocusIds} hasSupersedes focus={() => {}} open={() => {}} />);
  expect(markup).toContain("Showing 50 of 51 chains");
  expect(markup).toContain("Showing 50 of 60 unlinked decisions");
  expect((markup.match(/Focus chain:/g) ?? []).length).toBe(50);
  expect((markup.match(/>Focus Node/g) ?? []).length).toBe(50);
});

test("search narrows chains before the cap so an older match stays reachable", () => {
  const nodes = Array.from({ length: 120 }, (_, i) => ({ id: `n${String(i).padStart(3, "0")}`, label: i === 0 ? "Wanted" : `Node ${i}`, relPath: `notes/n${String(i).padStart(3, "0")}.md`, type: "decision" }));
  const edges = Array.from({ length: 60 }, (_, i) => ({ source: nodes[i * 2 + 1]!.id, target: nodes[i * 2]!.id, relation: "supersedes", fromFrontmatter: true }));
  const store = createGraphViewStore(buildGraphModel({ nodes, edges })); store.setMode("chains"); store.setSearch("Wanted");
  const state = store.getState();
  const markup = renderToStaticMarkup(<GraphChainsPanel model={store.model} visibleIds={state.derived.visibleNodeIds} chainFocusIds={state.chainFocusIds} hasSupersedes focus={() => {}} open={() => {}} />);
  expect(markup).toContain("Focus chain: Wanted");
  expect((markup.match(/Focus chain:/g) ?? []).length).toBe(1);
});

test("an exact search match outranks more than 50 substring-matching chains", () => {
  const nodes = Array.from({ length: 600 }, (_, i) => ({ id: `n${String(i).padStart(3, "0")}`, label: `Note ${i}`, relPath: `notes/n${i}.md`, type: "decision" }));
  const edges = Array.from({ length: 300 }, (_, i) => ({ source: nodes[i * 2 + 1]!.id, target: nodes[i * 2]!.id, relation: "supersedes", fromFrontmatter: true }));
  const store = createGraphViewStore(buildGraphModel({ nodes, edges })); store.setMode("chains"); store.setSearch("Note 4");
  const state = store.getState();
  const markup = renderToStaticMarkup(<GraphChainsPanel model={store.model} visibleIds={state.derived.visibleNodeIds} chainFocusIds={state.chainFocusIds} hasSupersedes search={state.search} focus={() => {}} open={() => {}} />);
  expect(markup).toContain("search or filter to narrow");
  expect(markup.indexOf("Focus chain: Note 4 → Note 5")).toBeLessThan(markup.indexOf("Focus chain: Note 498"));
  expect(markup).toContain("Focus chain: Note 4 → Note 5");
});

test("search ranks isolated decisions before the cap", () => {
  const nodes = Array.from({ length: 120 }, (_, i) => ({ id: `n${String(i).padStart(3, "0")}`, label: `Note ${i}`, relPath: `notes/n${i}.md`, type: "decision" }));
  const store = createGraphViewStore(buildGraphModel({ nodes, edges: [] })); store.setMode("chains"); store.setSearch("Note 1");
  const state = store.getState();
  const markup = renderToStaticMarkup(<GraphChainsPanel model={store.model} visibleIds={state.derived.visibleNodeIds} chainFocusIds={state.chainFocusIds} hasSupersedes={false} search={state.search} focus={() => {}} open={() => {}} />);
  expect(markup.indexOf("Focus Note 1<")).toBeGreaterThan(-1);
  expect(markup.indexOf("Focus Note 1<")).toBeLessThan(markup.indexOf("Focus Note 119<"));
  expect(markup).not.toContain("Focus Note 2<");
});

test("search hides unrelated unlinked decisions", () => {
  const nodes = ["Alpha", "Beta"].map((label) => ({ id: label, label, relPath: `notes/${label}.md`, type: "decision" }));
  const store = createGraphViewStore(buildGraphModel({ nodes, edges: [] })); store.setMode("chains"); store.setSearch("Alpha");
  const state = store.getState();
  const markup = renderToStaticMarkup(<GraphChainsPanel model={store.model} visibleIds={state.derived.visibleNodeIds} chainFocusIds={state.chainFocusIds} hasSupersedes={false} search={state.search} focus={() => {}} open={() => {}} />);
  expect(markup).toContain("Focus Alpha");
  expect(markup).not.toContain("Focus Beta");
});

test("long chains cap members and show visible matches first", () => {
  const nodes = Array.from({ length: 60 }, (_, i) => ({ id: `n${String(i).padStart(2, "0")}`, label: i === 59 ? "Wanted" : `Node ${i}`, relPath: `notes/n${i}.md`, type: "decision" }));
  const edges = nodes.slice(1).map((node, i) => ({ source: nodes[i]!.id, target: node.id, relation: "supersedes", fromFrontmatter: true }));
  const store = createGraphViewStore(buildGraphModel({ nodes, edges })); store.setMode("chains"); store.setSearch("Wanted");
  const state = store.getState();
  const markup = renderToStaticMarkup(<GraphChainsPanel model={store.model} visibleIds={state.derived.visibleNodeIds} chainFocusIds={state.chainFocusIds} hasSupersedes focus={() => {}} open={() => {}} />);
  expect(markup).toContain("Showing 50 of 60 decisions, visible first");
  expect(markup).toContain("Open Wanted");
  expect((markup.match(/>Open /g) ?? []).length).toBe(50);
});

test("search-hidden members remain in the chain and are counted", () => {
  const nodes = ["a", "b", "c", "d"].map((id) => ({ id, label: id.toUpperCase(), relPath: `notes/${id}.md`, type: "decision", domain: id === "a" ? "x" : "y" }));
  const edges = [["a", "b"], ["b", "c"], ["c", "d"]].map(([source, target]) => ({ source: source!, target: target!, relation: "supersedes", fromFrontmatter: true }));
  const store = createGraphViewStore(buildGraphModel({ nodes, edges })); store.setMode("chains"); store.setSearch("A");
  const state = store.getState();
  const markup = renderToStaticMarkup(<GraphChainsPanel model={store.model} visibleIds={state.derived.visibleNodeIds} chainFocusIds={state.chainFocusIds} hasSupersedes focus={() => {}} open={() => {}} />);
  expect(markup).toContain("2 of 4 visible");
  expect(markup).toContain("Open D");
  const selectedMarkup = renderToStaticMarkup(<GraphChainsPanel model={store.model} visibleIds={state.derived.visibleNodeIds} chainFocusIds={new Set(["a", "b"])} hasSupersedes focus={() => {}} open={() => {}} />);
  expect(selectedMarkup).toContain('aria-pressed="true"');
  store.setSearch(""); store.setProfile({ ...store.getState().profile, domains: ["x"] });
  const filtered = store.getState();
  const filteredMarkup = renderToStaticMarkup(<GraphChainsPanel model={store.model} visibleIds={filtered.derived.visibleNodeIds} chainFocusIds={filtered.chainFocusIds} hasSupersedes focus={() => {}} open={() => {}} />);
  expect(filteredMarkup).toContain("1 of 4 visible");
  expect(filteredMarkup).not.toContain("Unlinked decisions");
});

const model = buildGraphModel({ nodes: [
  { id: "a", label: "Alpha", relPath: "notes/a.md", type: "insight", domain: "research" },
  { id: "b", label: "Beta", relPath: "notes/b.md", type: "decision", domain: "teaching" },
], edges: [{ source: "a", target: "b", relation: "supports", fromFrontmatter: true }], communities: { a: 1, b: 2 } });

test("facet filters and search use the derived graph", () => {
  const store = createGraphViewStore(model);
  store.setProfile({ ...store.getState().profile, domains: ["research"] });
  expect([...store.getState().derived.visibleNodeIds]).toEqual(["a"]);
  store.setProfile({ ...store.getState().profile, domains: [], types: ["decision"] });
  expect([...store.getState().derived.visibleNodeIds]).toEqual(["b"]);
  store.setProfile({ ...store.getState().profile, types: [], community: 1 });
  expect([...store.getState().derived.visibleNodeIds]).toEqual(["a"]);
  store.setProfile({ ...store.getState().profile, community: null, relations: ["supports"] });
  expect(store.getState().derived.visibleModel.edges).toHaveLength(1);
  store.setProfile({ ...store.getState().profile, relations: [] });
  store.setSearch("Alpha");
  expect([...store.getState().derived.visibleNodeIds]).toEqual(["a", "b"]);
  store.setSearch("no matching note");
  expect(store.getState().derived.visibleNodeIds.size).toBe(0);
  const markup = renderToStaticMarkup(<GraphFilterPanel state={store.getState()} store={store} />);
  expect(markup).toContain("Domains");
  expect(markup).toContain("Relations");
  expect(markup).toContain("Community");
  expect(renderToStaticMarkup(<GraphLegend state={store.getState()} />)).toContain("frontmatter links");
});

test("inspector reports selected metadata and visible relations", () => {
  const node = model.nodes[0]!;
  const markup = renderToStaticMarkup(<GraphInspector node={node} model={model} open={() => {}} />);
  for (const text of ["Alpha", "insight", "research", "notes/a.md", "supports", "Open note"]) expect(markup).toContain(text);
  expect(renderToStaticMarkup(<GraphInspector node={null} model={model} open={() => {}} />)).toContain("Select a note");
});
