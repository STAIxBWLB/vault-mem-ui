// Worker side of the layout protocol. The panel module calls `runLayoutWorker()` when `isLayoutWorkerContext()` is
// true, so the worker is the panel's own same-origin module: `new Worker(new URL(import.meta.url), {type: "module",
// name: LAYOUT_WORKER_NAME})`. No blob: URL, no separate asset.

import { createLayoutEngine, type LayoutEngine } from "./engine";
import { LAYOUT_WORKER_NAME, type FromWorker, type ToWorker } from "./protocol";

interface WorkerScope {
  name?: string;
  postMessage(message: FromWorker, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent<ToWorker>) => void): void;
  close(): void;
}

/** True only inside a worker started under LAYOUT_WORKER_NAME (not on a page, not in another worker). */
export function isLayoutWorkerContext(scope: unknown = globalThis): boolean {
  const s = scope as Partial<WorkerScope> & { document?: unknown };
  return typeof s.document === "undefined" && typeof s.postMessage === "function" && s.name === LAYOUT_WORKER_NAME;
}

export interface LayoutLoopOptions {
  /** Defaults to setTimeout; tests may inject a scheduler. */
  schedule?: (fn: () => void, ms: number) => unknown;
  now?: () => number;
}

/** Wires the protocol onto a worker scope. Exported for tests; production calls runLayoutWorker(). */
export function attachLayoutWorker(scope: WorkerScope, options: LayoutLoopOptions = {}): void {
  const schedule = options.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const now = options.now ?? (() => performance.now());
  let engine: LayoutEngine | null = null;
  let batchMs = 16;
  let maxIterations = Infinity;
  let state: "idle" | "running" | "paused" | "stopped" | "done" = "idle";
  let pending = false;

  const post = (message: FromWorker, transfer?: Transferable[]) => scope.postMessage(message, transfer);
  const fail = (cause: unknown) => {
    const message = cause instanceof Error ? cause.message : String(cause);
    state = "stopped";
    post({ type: "error", message: `graph layout stopped: ${message}; reload the graph to restart the layout, or keep the cached positions` });
  };
  const sendPositions = () => {
    const positions = engine!.positions();
    post({ type: "positions", positions, iterations: engine!.iterations }, [positions.buffer]);
  };

  // One batch: iterate until the batch interval is used up, send positions once, then yield so pause/stop/teardown
  // messages are handled between batches.
  const tick = () => {
    pending = false;
    if (state !== "running" || !engine) return;
    try {
      const start = now();
      do {
        engine.step(1);
      } while (engine.iterations < maxIterations && now() - start < batchMs);
      sendPositions();
      if (engine.iterations >= maxIterations) {
        state = "done";
        post({ type: "state", state: "done" });
        return;
      }
    } catch (error) {
      fail(error);
      return;
    }
    pending = true;
    schedule(tick, 0);
  };
  const run = () => {
    state = "running";
    post({ type: "state", state: "running" });
    if (!pending) { pending = true; schedule(tick, 0); }
  };

  scope.addEventListener("message", (event) => {
    const message = event.data;
    try {
      switch (message.type) {
        case "init":
          engine = createLayoutEngine(message.graph, message.settings);
          batchMs = message.batchMs;
          maxIterations = message.maxIterations ?? Infinity;
          post({ type: "ready" });
          run();
          break;
        case "pause":
          if (state === "running") { state = "paused"; post({ type: "state", state: "paused" }); }
          break;
        case "resume":
          if (state === "paused") run();
          break;
        case "stop":
          if (engine && state !== "stopped") { state = "stopped"; sendPositions(); post({ type: "state", state: "stopped" }); }
          break;
        case "teardown":
          state = "stopped";
          engine = null;
          scope.close();
          break;
      }
    } catch (error) {
      fail(error);
    }
  });
}

/** Entry for the panel module: `if (isLayoutWorkerContext()) runLayoutWorker();` */
export function runLayoutWorker(): void {
  attachLayoutWorker(globalThis as unknown as WorkerScope);
}
