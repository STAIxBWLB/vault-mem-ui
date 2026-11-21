import { expect, test } from "bun:test";
import { buildGraphModel } from "../../src/graph/model";
import { exportGraphHtml } from "../../src/graph/export";

test("export encodes hostile labels as inert JSON and includes only graph metadata", () => {
  const hostile = '</script><script>alert("x")</script><!-- 한글';
  const model = buildGraphModel({ nodes: [{ id: hostile, label: hostile, relPath: "notes/private.md", type: "insight", domain: "research" }, { id: "b", label: "Beta", relPath: "notes/b.md" }], edges: [{ source: hostile, target: "b", relation: hostile, fromFrontmatter: false }], communities: { b: 3 } }, 1);
  const html = exportGraphHtml(model, { [hostile]: [1, 2] });
  expect(html).toBe(exportGraphHtml(model, { [hostile]: [1, 2] }));
  expect(html).not.toContain(hostile);
  expect(html).not.toContain("notes/private.md");
  expect(html).not.toMatch(/https?:|src=["']/i);
  const packet = JSON.parse(html.match(/<script id="graph-data" type="application\/json">([^<]*)<\/script>/)![1]!);
  const decoded = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(packet.data), (c) => c.charCodeAt(0))));
  expect(decoded.nodes[0]).toEqual({ id: hostile, label: hostile, type: "insight", domain: "research", community: null, degree: 1, position: [1, 2] });
  expect(decoded.edges[0]).toEqual({ source: hostile, target: "b", relation: hostile });
});
