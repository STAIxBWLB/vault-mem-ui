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

test("search-hidden members remain in the chain and are counted", () => {
  const nodes = ["a", "b", "c", "d"].map((id) => ({ id, label: id.toUpperCase(), relPath: `notes/${id}.md`, type: "decision", domain: id === "a" ? "x" : "y" }));
  const edges = [["a", "b"], ["b", "c"], ["c", "d"]].map(([source, target]) => ({ source: source!, target: target!, relation: "supersedes", fromFrontmatter: true }));
  const store = createGraphViewStore(buildGraphModel({ nodes, edges })); store.setMode("chains"); store.setSearch("A");
  const state = store.getState();
  const markup = renderToStaticMarkup(<GraphChainsPanel model={store.model} visibleIds={state.derived.visibleNodeIds} chainFocusIds={state.chainFocusIds} hasSupersedes focus={() => {}} open={() => {}} />);
  expect(markup).toContain("2 of 4 visible");
  expect(markup).toContain("Open D");
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
