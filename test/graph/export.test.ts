import { expect, test } from "bun:test";
import { buildGraphModel } from "../../src/graph/model";
import { exportGraphHtml } from "../../src/graph/export";
import { runInNewContext } from "node:vm";

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

test("offline canvas draws higher graph y above lower graph y", () => {
  const model = buildGraphModel({ nodes: [{ id: "low", label: "Low", relPath: "notes/low.md" }, { id: "high", label: "High", relPath: "notes/high.md" }], edges: [] });
  const html = exportGraphHtml(model, { low: [0, 0], high: [0, 10] });
  const packet = html.match(/<script id="graph-data" type="application\/json">([^<]*)<\/script>/)![1]!;
  const script = html.match(/<script>\n([\s\S]*?)<\/script>/)![1]!;
  const points: number[][] = [];
  const ctx = { beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, arc(x: number, y: number) { points.push([x, y]); }, fill() {}, fillText() {} };
  const document = { getElementById(id: string) { return id === "graph-data" ? { textContent: packet } : id === "graph" ? { getContext: () => ctx } : { append() {} }; }, createElement: () => ({ textContent: "" }) };
  runInNewContext(script, { document, TextDecoder, Uint8Array, atob });
  expect(points).toHaveLength(2);
  expect(points[1]![1]!).toBeLessThan(points[0]![1]!);
});
