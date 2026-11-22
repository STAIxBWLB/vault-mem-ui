import { describe, expect, it } from "bun:test";
import { buildDecisionChains } from "../../src/graph/decisionChains";
import type { GraphEdge, GraphModel, GraphNode } from "../../src/graph/model";

function decision(id: string, date: string | null): GraphNode {
  return {
    id,
    label: id,
    relPath: `notes/${id}.md`,
    origin: "workspace",
    type: "decision",
    domain: "operations",
    degree: 0,
    community: null,
    isGodNode: false,
    date,
    updatedAt: null,
  };
}

function supersedes(source: string, target: string): GraphEdge {
  return { source, target, relation: "supersedes", fromFrontmatter: true, origin: "workspace" };
}

function model(nodes: GraphNode[], edges: GraphEdge[]): GraphModel {
  return { nodes, edges, enriched: false, builtAt: 0 };
}

describe("buildDecisionChains", () => {
  it("orders by relation direction even when dates disagree and reciprocal fields repeat an edge", () => {
    const nodes = [decision("old", "2027-01-01"), decision("middle", null), decision("new", "2020-01-01")];
    const reciprocal: GraphEdge = { source: "old", target: "middle", relation: "superseded_by", fromFrontmatter: true, origin: "workspace" };
    const layout = buildDecisionChains(model(nodes, [supersedes("middle", "old"), reciprocal, supersedes("new", "middle")]));
    expect(layout.chains).toHaveLength(1);
    expect(layout.chains[0]!.nodes.map((node) => node.id)).toEqual(["old", "middle", "new"]);
  });
  it("orders a 3-note chain left→right by date in one lane", () => {
    const layout = buildDecisionChains(
      model(
        [
          decision("v3", "2026-07-01"),
          decision("v1", "2026-05-01"),
          decision("v2", "2026-06-01"),
          decision("unrelated", "2026-04-01"),
        ],
        [supersedes("v3", "v2"), supersedes("v2", "v1")],
      ),
    );
    expect(layout.chains).toHaveLength(1);
    expect(layout.chains[0].nodes.map((n) => n.id)).toEqual(["v1", "v2", "v3"]);
    expect(layout.isolated.map((n) => n.id)).toEqual(["unrelated"]);
  });

  it("terminates on supersedes cycles and keeps all members in one chain", () => {
    const layout = buildDecisionChains(
      model(
        [decision("a", "2026-01-01"), decision("b", "2026-02-01")],
        [supersedes("a", "b"), supersedes("b", "a")], // malformed loop
      ),
    );
    expect(layout.chains).toHaveLength(1);
    expect(layout.chains[0].nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(layout.isolated).toHaveLength(0);
  });

  it("ignores supersedes edges to non-decision nodes and handles superseded_by", () => {
    const insight: GraphNode = { ...decision("not-a-decision", null), type: "insight" };
    const layout = buildDecisionChains(
      model(
        [decision("d1", "2026-01-01"), decision("d2", "2026-02-01"), insight],
        [
          { source: "d1", target: "not-a-decision", relation: "supersedes", fromFrontmatter: true, origin: "workspace" },
          { source: "d1", target: "d2", relation: "superseded_by", fromFrontmatter: true, origin: "workspace" },
        ],
      ),
    );
    expect(layout.chains).toHaveLength(1);
    expect(layout.chains[0].nodes.map((n) => n.id)).toEqual(["d1", "d2"]);
  });

  it("sorts null dates last within a chain", () => {
    const layout = buildDecisionChains(
      model(
        [decision("dated", "2026-03-01"), decision("undated", null)],
        [supersedes("undated", "dated")],
      ),
    );
    expect(layout.chains[0].nodes.map((n) => n.id)).toEqual(["dated", "undated"]);
  });
});
