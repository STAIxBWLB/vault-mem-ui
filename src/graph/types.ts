// Graph view settings and the graph input contract.
// Ported from STAIxBWLB/maru@b33341df src/lib/settings.ts (the graph types only).

export type GraphMode = "global" | "local" | "chains";

export interface GraphFilterProfile {
  domains: string[];
  /** Node origins to keep; empty = all. Values: "workspace" | "knowledge". */
  origins: string[];
  types: string[];
  relations: string[];
  community: number | null;
  showUnresolved: boolean;
  showGenerated: boolean;
  /** Minimum distinct visible neighbors; 0 = all authored notes. */
  minVisibleNeighbors: number;
}

export interface GraphDisplaySettings {
  arrows: "typed" | "all" | "none";
  labels: "low" | "balanced" | "high";
  colorMode: "neutral" | "domain" | "community" | "origin";
  relationColors: boolean;
  nodeScale: number;
  edgeScale: number;
}

export interface GraphLocalTarget {
  ownerWorkspacePath: string | null;
  relPath: string;
}

/**
 * Internal input to the graph model. A later adapter fills it from the provider's graph snapshot
 * (STAIxBWLB/vault-mem#266); this is not that wire format and makes no claim about it.
 */
export interface GraphInput {
  nodes: GraphInputNode[];
  edges: GraphInputEdge[];
  /** Community id per node id, when the provider has computed communities. */
  communities?: Record<string, number>;
}

export interface GraphInputNode {
  id: string;
  label: string;
  /** Vault-relative path; null for an unresolved link target. */
  relPath: string | null;
  ownerWorkspacePath?: string | null;
  origin?: "workspace" | "knowledge";
  type?: string | null;
  domain?: string | null;
  /** created / decided_date / date; orders decision chains. */
  date?: string | null;
  /** Last modification time (ISO); drives stale-note detection. */
  updatedAt?: string | null;
}

export interface GraphInputEdge {
  source: string;
  target: string;
  /** Frontmatter field name, or "wiki_link" for a body link. */
  relation: string;
  fromFrontmatter: boolean;
}
