// Deterministic seeded synthetic graph input for tests. No vault content.
// Adapted from STAIxBWLB/maru@b33341df src/lib/graph/fixtures.ts, which generated VaultEntry[]; this produces
// GraphInput directly, with the same shape: ~edgeCount/nodeCount body links per note and a frontmatter `topics`
// link on every fifth note.
import type { GraphInput } from "../../src/graph/types";

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TYPES = ["insight", "decision", "observation", "person", "meeting", "reference"];
const DOMAINS = ["research", "projects", "operations", "teaching", "people", "ai-practice"];

export function generateGraphInput(nodeCount: number, edgeCount: number, seed = 42): GraphInput {
  const rand = mulberry32(seed);
  const outDegree = Math.max(1, Math.round(edgeCount / Math.max(1, nodeCount)));
  const input: GraphInput = { nodes: [], edges: [] };
  for (let i = 0; i < nodeCount; i += 1) {
    input.nodes.push({
      id: `note-${i}`,
      label: `note-${i}`,
      relPath: `notes/note-${i}.md`,
      type: TYPES[i % TYPES.length],
      domain: DOMAINS[i % DOMAINS.length],
    });
    for (let l = 0; l < outDegree; l += 1) {
      const target = Math.floor(rand() * nodeCount);
      if (target !== i) input.edges.push({ source: `note-${i}`, target: `note-${target}`, relation: "wiki_link", fromFrontmatter: false, inferred: false });
    }
    if (i % 5 === 0 && nodeCount > 1) {
      input.edges.push({ source: `note-${i}`, target: `note-${(i + 1) % nodeCount}`, relation: "topics", fromFrontmatter: true, inferred: false });
    }
  }
  return input;
}

export const GRAPH_FIXTURES = {
  tiny: () => generateGraphInput(4, 3),
  empty: (): GraphInput => ({ nodes: [], edges: [] }),
  dense: () => generateGraphInput(1_200, 6_000),
  stress: () => generateGraphInput(10_000, 50_000),
} as const;
