// Layout worker protocol and tuning constants (issue #1, "Layout"; evidence docs/spikes/02-layout-worker.md).
// The worker is the panel's own module started as a module worker; it never uses a blob: URL and the layout never
// runs on the main thread.

import type { ForceAtlas2Settings } from "graphology-layout-forceatlas2";

export type { ForceAtlas2Settings };

/** Above this many edges, batches are applied less often (spike 2b: a batch costs ~6 ms of main-thread work at
 *  30,000 edges and ~20 ms at 100,000). The view tunes these. */
export const LARGE_GRAPH_EDGES = 30_000;
/** Batch interval for graphs up to LARGE_GRAPH_EDGES: about one frame. */
export const SMALL_BATCH_MS = 16;
/** Batch interval above LARGE_GRAPH_EDGES, the spike 2b starting point. */
export const LARGE_BATCH_MS = 100;

export function batchIntervalMs(edgeCount: number): number {
  return edgeCount > LARGE_GRAPH_EDGES ? LARGE_BATCH_MS : SMALL_BATCH_MS;
}

/** ForceAtlas2's own inferSettings formula (graphology-layout-forceatlas2 0.10.1 index.js, MIT), taking only the
 *  node count so the main thread does not need a graphology instance. */
export function inferLayoutSettings(nodeCount: number): ForceAtlas2Settings {
  return {
    barnesHutOptimize: nodeCount > 2000,
    strongGravityMode: true,
    gravity: 0.05,
    scalingRatio: 10,
    slowDown: 1 + Math.log(Math.max(1, nodeCount)),
  };
}

/** Graph shape sent to the worker: node i is index i; edges are parallel index arrays. */
export interface LayoutGraph {
  nodeCount: number;
  /** Initial coordinates, x0,y0,x1,y1,... (length 2 * nodeCount). Cached positions go here. */
  positions: Float32Array;
  sources: Uint32Array;
  targets: Uint32Array;
  /** Optional per-node size (adjustSizes) and pinned flag. */
  sizes?: Float32Array;
  fixed?: Uint8Array;
}

export type ToWorker =
  | { type: "init"; graph: LayoutGraph; settings: ForceAtlas2Settings; batchMs: number; maxIterations?: number }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "stop" }
  | { type: "teardown" };

export type FromWorker =
  | { type: "ready" }
  /** x0,y0,x1,y1,...; the buffer is transferred. */
  | { type: "positions"; positions: Float32Array; iterations: number }
  | { type: "state"; state: "running" | "paused" | "stopped" | "done" }
  | { type: "error"; message: string };

/** Marker the panel module checks to know it was started as the layout worker. */
export const LAYOUT_WORKER_NAME = "vmem-ui-layout";
