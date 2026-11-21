// Main-thread side of the layout protocol. Starts the panel's own module as a module worker and, when that is not
// possible (no Worker, a CSP SecurityError, a script load refused by a static multi-node host), reports a
// "cached-only" state instead: the view then shows cached positions and runs no layout loop. It never falls back to a
// blob: worker or to layout on the main thread.

import {
  LAYOUT_WORKER_NAME,
  batchIntervalMs,
  inferLayoutSettings,
  type ForceAtlas2Settings,
  type FromWorker,
  type LayoutGraph,
  type ToWorker,
} from "./protocol";

export const WORKER_START_TIMEOUT_MS = 5_000;

export interface LayoutCallbacks {
  onPositions(positions: Float32Array, iterations: number): void;
  onState?(state: "running" | "paused" | "stopped" | "done"): void;
  onError?(message: string): void;
}

export interface LayoutHandle {
  readonly state: "running";
  pause(): void;
  resume(): void;
  /** Pins or releases nodes in the live layout (see ToWorker "fix"). */
  fix(nodes: { index: number; fixed: boolean; position?: [number, number] }[]): void;
  /** Stops iterating; the worker sends the final positions and stays alive until teardown. */
  stop(): void;
  /** Ends the worker. Safe to call more than once. */
  teardown(): void;
}

export interface CachedOnly {
  readonly state: "cached-only";
  /** Cause and next step, ready to show. */
  readonly reason: string;
}

export interface StartLayoutOptions extends LayoutCallbacks {
  /** The panel module's own URL: `new URL(import.meta.url)`. */
  moduleUrl: URL | string;
  graph: LayoutGraph;
  settings?: ForceAtlas2Settings;
  batchMs?: number;
  /** Overrides MAX_LAYOUT_ITERATIONS (the safety cap). */
  maxIterations?: number;
  /** Override CONVERGED_MOVEMENT / CONVERGED_STREAK (the default end condition). */
  convergedMovement?: number;
  convergedStreak?: number;
  /** False on hosts that cannot start a worker (the static multi-node host). */
  workerAllowed?: boolean;
  /** Worker constructor; defaults to the global Worker. */
  createWorker?: (url: URL | string, options: WorkerOptions) => Worker;
  startTimeoutMs?: number;
}

const cachedOnly = (cause: string): CachedOnly => ({
  state: "cached-only",
  reason: `live layout is unavailable: ${cause}; showing cached positions only. Open the graph from the standalone vmem-ui or a single acon host to lay it out.`,
});

export function startLayout(options: StartLayoutOptions): Promise<LayoutHandle | CachedOnly> {
  if (options.workerAllowed === false) return Promise.resolve(cachedOnly("this host does not allow layout workers"));
  const create = options.createWorker ?? (typeof Worker === "undefined" ? undefined : (url: URL | string, o: WorkerOptions) => new Worker(url, o));
  if (!create) return Promise.resolve(cachedOnly("this browser has no Worker support"));

  let worker: Worker;
  try {
    worker = create(options.moduleUrl, { type: "module", name: LAYOUT_WORKER_NAME });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    return Promise.resolve(cachedOnly(name === "SecurityError" ? "the page's security policy refused the layout worker" : `the layout worker could not start (${error instanceof Error ? error.message : String(error)})`));
  }

  return new Promise((resolve) => {
    let ready = false;
    let ended = false;
    const send = (message: ToWorker, transfer: Transferable[] = []) => { if (!ended) worker.postMessage(message, transfer); };
    const end = () => { if (ended) return; ended = true; worker.terminate(); };
    const timer = setTimeout(() => {
      if (ready) return;
      end();
      resolve(cachedOnly(`the layout worker did not start within ${(options.startTimeoutMs ?? WORKER_START_TIMEOUT_MS) / 1000} s`));
    }, options.startTimeoutMs ?? WORKER_START_TIMEOUT_MS);

    const handle: LayoutHandle = {
      state: "running",
      pause: () => send({ type: "pause" }),
      resume: () => send({ type: "resume" }),
      fix: (nodes) => send({ type: "fix", nodes }),
      stop: () => send({ type: "stop" }),
      teardown: () => { if (ended) return; send({ type: "teardown" }); end(); },
    };

    worker.addEventListener("message", (event: MessageEvent<FromWorker>) => {
      const message = event.data;
      switch (message.type) {
        case "ready":
          ready = true;
          clearTimeout(timer);
          resolve(handle);
          break;
        case "positions":
          options.onPositions(message.positions, message.iterations);
          break;
        case "state":
          options.onState?.(message.state);
          break;
        case "error":
          if (!ready) { clearTimeout(timer); end(); resolve(cachedOnly(message.message)); } else options.onError?.(message.message);
          break;
      }
    });
    // A script refused by CSP or a failed module load arrives as an error event, not a throw.
    worker.addEventListener("error", (event: Event) => {
      event.preventDefault?.();
      const detail = (event as ErrorEvent).message || "the module could not be loaded";
      if (!ready) { clearTimeout(timer); end(); resolve(cachedOnly(`the layout worker failed to load (${detail})`)); return; }
      end();
      options.onError?.(`graph layout stopped: ${detail}; reload the graph to restart the layout, or keep the cached positions`);
    });

    const graph = options.graph;
    const init: ToWorker = {
      type: "init",
      graph,
      settings: options.settings ?? inferLayoutSettings(graph.nodeCount),
      batchMs: options.batchMs ?? batchIntervalMs(graph.sources.length),
      ...(options.maxIterations !== undefined ? { maxIterations: options.maxIterations } : {}),
      ...(options.convergedMovement !== undefined ? { convergedMovement: options.convergedMovement } : {}),
      ...(options.convergedStreak !== undefined ? { convergedStreak: options.convergedStreak } : {}),
    };
    // Copy, not transfer: the caller keeps its arrays (they may be the cached layout on screen).
    send(init);
  });
}
