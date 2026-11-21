// Adapted from STAIxBWLB/maru@b33341df src/lib/graph/model.test.ts. The buildVaultGraph/enrichGraph cases are
// rewritten for buildGraphModel(GraphInput); the focusSubgraph and isGeneratedNode cases are kept as-is.
import { describe, expect, it } from "bun:test";
import {
  buildAdjacency,
  buildGraphModel,
  edgeOrigin,
  focusSubgraph,
  isGeneratedNode,
  type GraphNode,
} from "../../src/graph/model";
import type { GraphInput } from "../../src/graph/types";

const INPUT: GraphInput = {
  nodes: [
    { id: "a-note", label: "a-note", relPath: "notes/a-note.md", type: "insight", domain: "research" },
    { id: "b-note", label: "b-note", relPath: "notes/b-note.md", type: "decision", domain: "projects" },
    { id: "projects", label: "projects", relPath: "notes/projects.md", type: "moc", domain: "projects" },
  ],
  edges: [
    { source: "a-note", target: "projects", relation: "topics", fromFrontmatter: true },
    { source: "a-note", target: "b-note", relation: "wiki_link", fromFrontmatter: false },
    { source: "b-note", target: "missing-target", relation: "wiki_link", fromFrontmatter: false },
  ],
};

describe("buildGraphModel", () => {
  it("keeps relations and their frontmatter flag", () => {
    const model = buildGraphModel(INPUT, 0);
    expect(model.edges.find((e) => e.source === "a-note" && e.target === "projects")).toMatchObject({ relation: "topics", fromFrontmatter: true });
    expect(model.edges.find((e) => e.source === "a-note" && e.target === "b-note")).toMatchObject({ relation: "wiki_link", fromFrontmatter: false });
    expect(model.builtAt).toBe(0);
  });

  it("creates ghost nodes for edge targets missing from the input", () => {
    const ghost = buildGraphModel(INPUT).nodes.find((n) => n.id === "missing-target");
    expect(ghost).toMatchObject({ type: "unresolved", relPath: null, origin: "unknown", updatedAt: null });
  });

  it("treats an input node without a path as unresolved", () => {
    const model = buildGraphModel({ nodes: [{ id: "x", label: "X", relPath: null }], edges: [] });
    expect(model.nodes[0]).toMatchObject({ type: "unresolved", origin: "unknown" });
  });

  it("dedupes (source, target, relation) triples, drops self loops and duplicate node ids", () => {
    const model = buildGraphModel({
      nodes: [...INPUT.nodes, { id: "a-note", label: "dup", relPath: "notes/dup.md" }],
      edges: [
        ...INPUT.edges,
        { source: "a-note", target: "b-note", relation: "wiki_link", fromFrontmatter: false },
        { source: "a-note", target: "a-note", relation: "wiki_link", fromFrontmatter: false },
      ],
    });
    expect(model.edges.filter((e) => e.source === "a-note" && e.target === "b-note")).toHaveLength(1);
    expect(model.edges.some((e) => e.source === e.target)).toBe(false);
    expect(model.nodes.filter((n) => n.id === "a-note")).toHaveLength(1);
    expect(model.nodes.find((n) => n.id === "a-note")!.label).toBe("a-note");
  });

  it("computes degree and marks god nodes excluding moc/unresolved", () => {
    const model = buildGraphModel(INPUT);
    const a = model.nodes.find((n) => n.id === "a-note")!;
    expect(a.degree).toBe(2);
    expect(a.isGodNode).toBe(true);
    expect(model.nodes.find((n) => n.id === "projects")!.isGodNode).toBe(false);
    expect(model.nodes.find((n) => n.id === "missing-target")!.isGodNode).toBe(false);
  });

  it("defaults missing type and domain", () => {
    const n = buildGraphModel({ nodes: [{ id: "u", label: "U", relPath: "u.md", type: " ", domain: "" }], edges: [] }).nodes[0]!;
    expect(n.type).toBe("untyped");
    expect(n.domain).toBeNull();
  });

  it("applies communities and marks the model enriched only when they are supplied", () => {
    const plain = buildGraphModel(INPUT);
    expect(plain.enriched).toBe(false);
    expect(plain.nodes.every((n) => n.community === null)).toBe(true);
    const enriched = buildGraphModel({ ...INPUT, communities: { "a-note": 4, "b-note": 7 } });
    expect(enriched.enriched).toBe(true);
    expect(enriched.nodes.find((n) => n.id === "a-note")!.community).toBe(4);
    expect(enriched.nodes.find((n) => n.id === "b-note")!.community).toBe(7);
    expect(enriched.nodes.find((n) => n.id === "projects")!.community).toBeNull();
    expect(enriched.nodes.find((n) => n.id === "missing-target")!.community).toBeNull();
  });

  it("does not mutate its input", () => {
    const copy = structuredClone(INPUT);
    buildGraphModel(INPUT);
    expect(INPUT).toEqual(copy);
  });
});

describe("node and edge origin", () => {
  const input: GraphInput = {
    nodes: [
      { id: "kg-note", label: "kg-note", relPath: "vault/notes/kg-note.md", origin: "knowledge" },
      { id: "weekly-report", label: "weekly-report", relPath: "projects/weekly-report.md", origin: "workspace" },
      { id: "plan", label: "plan", relPath: "projects/plan.md", origin: "workspace" },
    ],
    edges: [
      { source: "kg-note", target: "weekly-report", relation: "source_ref", fromFrontmatter: true },
      { source: "weekly-report", target: "kg-note", relation: "wiki_link", fromFrontmatter: false },
      { source: "weekly-report", target: "nowhere", relation: "wiki_link", fromFrontmatter: false },
      { source: "plan", target: "weekly-report", relation: "wiki_link", fromFrontmatter: false },
    ],
  };

  it("classifies edges by the pair they connect", () => {
    const model = buildGraphModel(input);
    const find = (source: string, target: string) => model.edges.find((e) => e.source === source && e.target === target);
    expect(find("plan", "weekly-report")?.origin).toBe("workspace");
    expect(find("weekly-report", "kg-note")?.origin).toBe("cross");
    expect(find("kg-note", "weekly-report")?.origin).toBe("cross");
  });

  it("gives ghost nodes no origin and lets their edges keep the known side", () => {
    const model = buildGraphModel(input);
    expect(model.nodes.find((n) => n.id === "nowhere")?.origin).toBe("unknown");
    expect(model.edges.find((e) => e.target === "nowhere")?.origin).toBe("workspace");
  });

  it("defaults resolved nodes to knowledge (a vault graph is knowledge end to end)", () => {
    const model = buildGraphModel(INPUT);
    expect(model.nodes.filter((n) => n.relPath).every((n) => n.origin === "knowledge")).toBe(true);
  });

  it("edgeOrigin inherits the known side of a ghost", () => {
    expect(edgeOrigin("unknown", "unknown")).toBe("workspace");
    expect(edgeOrigin("unknown", "knowledge")).toBe("knowledge");
    expect(edgeOrigin("workspace", "knowledge")).toBe("cross");
  });
});

describe("focusSubgraph / buildAdjacency", () => {
  it("keeps k-hop neighborhood only", () => {
    const model = buildGraphModel({
      nodes: [...INPUT.nodes, ...["c-note", "d-note", "far"].map((id) => ({ id, label: id, relPath: `notes/${id}.md` }))],
      edges: [
        ...INPUT.edges,
        { source: "c-note", target: "b-note", relation: "wiki_link", fromFrontmatter: false },
        { source: "d-note", target: "c-note", relation: "wiki_link", fromFrontmatter: false },
      ],
    });
    const sub = focusSubgraph(model, "a-note", 2);
    const ids = new Set(sub.nodes.map((n) => n.id));
    expect(ids.has("a-note")).toBe(true);
    expect(ids.has("b-note")).toBe(true); // 1 hop
    expect(ids.has("c-note")).toBe(true); // 2 hops
    expect(ids.has("d-note")).toBe(false); // 3 hops
    expect(ids.has("far")).toBe(false); // disconnected
    expect(buildAdjacency(model).get("a-note")).toContain("b-note");
  });
});

describe("isGeneratedNode", () => {
  const node = (over: Partial<GraphNode>): GraphNode => ({
    id: "n",
    label: "N",
    relPath: "notes/n.md",
    type: "meeting",
    domain: null,
    degree: 1,
    community: null,
    isGodNode: false,
    date: null,
    updatedAt: null,
    ...over,
  } as GraphNode);
  const patterns = ["reports/", "log.md"];

  it("does not flag untyped notes; they are visible authored content", () => {
    expect(isGeneratedNode(node({ type: "untyped", relPath: "notes/anything.md" }), patterns)).toBe(false);
    expect(isGeneratedNode(node({ type: "untyped" }), [])).toBe(false);
  });

  it("matches trailing-slash patterns as relPath prefixes, case-insensitively", () => {
    expect(isGeneratedNode(node({ relPath: "reports/lint-260712.md" }), patterns)).toBe(true);
    expect(isGeneratedNode(node({ relPath: "Reports/Graph-Report.md" }), patterns)).toBe(true);
    expect(isGeneratedNode(node({ relPath: "notes/reports-summary.md" }), patterns)).toBe(false);
  });

  it("matches bare patterns as exact filenames only", () => {
    expect(isGeneratedNode(node({ relPath: "log.md" }), patterns)).toBe(true);
    expect(isGeneratedNode(node({ relPath: "vault/LOG.md" }), patterns)).toBe(true);
    expect(isGeneratedNode(node({ relPath: "notes/backlog.md" }), patterns)).toBe(false);
  });

  it("never flags ghosts; they belong to the showUnresolved filter", () => {
    expect(isGeneratedNode(node({ type: "unresolved", relPath: null }), patterns)).toBe(false);
  });
});
