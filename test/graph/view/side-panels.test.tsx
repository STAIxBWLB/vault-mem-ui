import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { buildGraphModel } from "../../../src/graph/model";
import { createGraphViewStore } from "../../../src/graph/view/state";
import { GraphFilterPanel, GraphInspector, GraphLegend } from "../../../src/graph/view/SidePanels";

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
