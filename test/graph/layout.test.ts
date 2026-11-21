import { describe, expect, it } from "bun:test";
import {
  CONVERGED_MOVEMENT,
  CONVERGED_STREAK,
  LARGE_BATCH_MS,
  LARGE_GRAPH_EDGES,
  LAYOUT_WORKER_NAME,
  MAX_LAYOUT_ITERATIONS,
  SMALL_BATCH_MS,
  batchIntervalMs,
  inferLayoutSettings,
  type FromWorker,
  type LayoutGraph,
  type ToWorker,
} from "../../src/graph/layout/protocol";
import { createLayoutEngine, layoutGraphProblem } from "../../src/graph/layout/engine";
import { attachLayoutWorker, isLayoutWorkerContext } from "../../src/graph/layout/worker";
import { startLayout, type CachedOnly, type LayoutHandle } from "../../src/graph/layout/client";

// Synthetic ring with chords; no vault data.
function ring(n: number): LayoutGraph {
  const positions = new Float32Array(n * 2);
  for (let i = 0; i < n; i += 1) { positions[i * 2] = Math.cos(i) * 10 + i; positions[i * 2 + 1] = Math.sin(i * 3) * 10 - i; }
  const s: number[] = [], t: number[] = [];
  for (let i = 0; i < n; i += 1) { s.push(i); t.push((i + 1) % n); if (i % 3 === 0) { s.push(i); t.push((i + 5) % n); } }
  return { nodeCount: n, positions, sources: Uint32Array.from(s), targets: Uint32Array.from(t) };
}
const ENTRY = new URL("./layout-worker-entry.ts", import.meta.url);
const allFinite = (a: Float32Array) => a.every(Number.isFinite);

describe("constants", () => {
  it("applies batches less often above the large-graph threshold", () => {
    expect(CONVERGED_MOVEMENT).toBe(0.01);
    expect(CONVERGED_STREAK).toBe(5);
    expect(Number.isFinite(MAX_LAYOUT_ITERATIONS)).toBe(true);
    expect(batchIntervalMs(LARGE_GRAPH_EDGES)).toBe(SMALL_BATCH_MS);
    expect(batchIntervalMs(LARGE_GRAPH_EDGES + 1)).toBe(LARGE_BATCH_MS);
    expect(LARGE_BATCH_MS).toBe(100);
  });
  it("infers FA2 settings like the library", () => {
    expect(inferLayoutSettings(100)).toMatchObject({ barnesHutOptimize: false, strongGravityMode: true });
    expect(inferLayoutSettings(5000).barnesHutOptimize).toBe(true);
  });
});

describe("engine", () => {
  it("moves nodes with ForceAtlas2 and keeps them finite", () => {
    const g = ring(30);
    const engine = createLayoutEngine(g, inferLayoutSettings(30));
    engine.step(50);
    const p = engine.positions();
    expect(engine.iterations).toBe(50);
    expect(p.length).toBe(60);
    expect(allFinite(p)).toBe(true);
    expect([...p]).not.toEqual([...g.positions]);
  });
  it("keeps pinned nodes in place", () => {
    const g = { ...ring(10), fixed: Uint8Array.from({ length: 10 }, (_, i) => (i === 0 ? 1 : 0)) };
    const engine = createLayoutEngine(g, inferLayoutSettings(10));
    engine.step(20);
    expect(engine.positions()[0]).toBeCloseTo(g.positions[0]!, 5);
    expect(engine.positions()[1]).toBeCloseTo(g.positions[1]!, 5);
  });
  it("names the cause of a malformed graph", () => {
    expect(layoutGraphProblem({ ...ring(4), sources: Uint32Array.from([0, 9]), targets: Uint32Array.from([1, 2]) })).toBe("edge 1 points at node 9, but there are only 4 nodes");
    expect(layoutGraphProblem({ ...ring(4), positions: new Float32Array(3) })).toBe("positions has 3 values, expected 8 (x,y per node)");
    expect(() => createLayoutEngine({ ...ring(4), positions: new Float32Array(3) }, {})).toThrow("expected 8");
  });
});

// In-process worker scope: the real attachLayoutWorker against a fake postMessage, with a manual scheduler.
function fakeScope() {
  const out: FromWorker[] = [];
  const transfers: Transferable[][] = [];
  let listener: ((e: MessageEvent<ToWorker>) => void) | null = null;
  const queue: (() => void)[] = [];
  let closed = false;
  const scope = {
    name: LAYOUT_WORKER_NAME,
    postMessage(m: FromWorker, t?: Transferable[]) { out.push(m); transfers.push(t ?? []); },
    addEventListener(_: "message", l: (e: MessageEvent<ToWorker>) => void) { listener = l; },
    close() { closed = true; },
  };
  let clock = 0;
  attachLayoutWorker(scope, { schedule: (fn) => { queue.push(fn); }, now: () => (clock += 1) });
  return {
    out, transfers,
    send: (m: ToWorker) => listener!({ data: m } as MessageEvent<ToWorker>),
    runOne: () => queue.shift()?.(),
    pending: () => queue.length,
    closed: () => closed,
  };
}

describe("worker protocol (in process)", () => {
  it("round-trips init, transferred Float32Array batches, pause, resume and stop", () => {
    const w = fakeScope();
    w.send({ type: "init", graph: ring(20), settings: inferLayoutSettings(20), batchMs: 3 });
    expect(w.out.map((m) => m.type)).toEqual(["ready", "state"]);
    w.runOne();
    const batch = w.out.at(-1)!;
    expect(batch.type).toBe("positions");
    if (batch.type !== "positions") throw new Error();
    expect(batch.positions).toBeInstanceOf(Float32Array);
    expect(batch.positions.length).toBe(40);
    expect(batch.iterations).toBeGreaterThan(0);
    expect(w.transfers.at(-1)).toEqual([batch.positions.buffer]);

    w.send({ type: "pause" });
    expect(w.out.at(-1)).toEqual({ type: "state", state: "paused" });
    const count = w.out.length;
    w.runOne(); // the already-scheduled tick sees "paused" and does nothing
    expect(w.out.length).toBe(count);
    expect(w.pending()).toBe(0);

    w.send({ type: "resume" });
    expect(w.out.at(-1)).toEqual({ type: "state", state: "running" });
    w.runOne();
    expect(w.out.at(-1)!.type).toBe("positions");

    w.send({ type: "stop" });
    expect(w.out.at(-2)!.type).toBe("positions");
    expect(w.out.at(-1)).toEqual({ type: "state", state: "stopped" });
    const afterStop = w.out.length;
    while (w.pending()) w.runOne();
    expect(w.out.length).toBe(afterStop);
  });

  it("ends on its own as done when the layout settles, without maxIterations", () => {
    const w = fakeScope();
    w.send({ type: "init", graph: ring(20), settings: inferLayoutSettings(20), batchMs: 50 });
    let guard = 0;
    while (w.pending() && guard++ < 10_000) w.runOne();
    expect(w.pending()).toBe(0);
    expect(w.out.at(-1)).toEqual({ type: "state", state: "done" });
    const last = w.out.filter((m) => m.type === "positions").at(-1);
    if (!last || last.type !== "positions") throw new Error("no positions");
    expect(last.iterations).toBeGreaterThan(CONVERGED_STREAK);
    expect(last.iterations).toBeLessThan(MAX_LAYOUT_ITERATIONS);
  });

  it("stops at the safety cap when the layout never settles", () => {
    const w = fakeScope();
    w.send({ type: "init", graph: ring(10), settings: {}, batchMs: 1000, convergedMovement: -1 });
    while (w.pending()) w.runOne();
    const last = w.out.filter((m) => m.type === "positions").at(-1);
    expect(last && last.type === "positions" && last.iterations).toBe(MAX_LAYOUT_ITERATIONS);
    expect(w.out.at(-1)).toEqual({ type: "state", state: "done" });
  });

  it("ends an empty graph immediately", () => {
    const w = fakeScope();
    w.send({ type: "init", graph: { nodeCount: 0, positions: new Float32Array(0), sources: new Uint32Array(0), targets: new Uint32Array(0) }, settings: {}, batchMs: 5 });
    w.runOne();
    expect(w.out.at(-1)).toEqual({ type: "state", state: "done" });
    expect(w.pending()).toBe(0);
  });

  it("reports done after maxIterations", () => {
    const w = fakeScope();
    w.send({ type: "init", graph: ring(10), settings: {}, batchMs: 1000, maxIterations: 7, convergedMovement: 0 });
    while (w.pending()) w.runOne();
    const last = w.out.filter((m) => m.type === "positions").at(-1);
    expect(last && last.type === "positions" && last.iterations).toBe(7);
    expect(w.out.at(-1)).toEqual({ type: "state", state: "done" });
  });

  it("reports a bad init with cause and next step", () => {
    const w = fakeScope();
    w.send({ type: "init", graph: { ...ring(4), positions: new Float32Array(1) }, settings: {}, batchMs: 5 });
    expect(w.out).toEqual([{ type: "error", message: "graph layout stopped: positions has 1 values, expected 8 (x,y per node); reload the graph to restart the layout, or keep the cached positions" }]);
  });

  it("teardown closes the scope and stops the loop", () => {
    const w = fakeScope();
    w.send({ type: "init", graph: ring(10), settings: {}, batchMs: 2 });
    w.send({ type: "teardown" });
    expect(w.closed()).toBe(true);
    const n = w.out.length;
    while (w.pending()) w.runOne();
    expect(w.out.length).toBe(n);
  });

  it("detects the worker context only under the layout worker name", () => {
    expect(isLayoutWorkerContext()).toBe(false); // test runner: wrong name
    expect(isLayoutWorkerContext({ name: LAYOUT_WORKER_NAME, postMessage() {} })).toBe(true);
    expect(isLayoutWorkerContext({ name: LAYOUT_WORKER_NAME, postMessage() {}, document: {} })).toBe(false);
    expect(isLayoutWorkerContext({ name: "other", postMessage() {} })).toBe(false);
  });
});

describe("startLayout with a real module worker", () => {
  it("starts from a module URL, streams positions, and cancels on stop", async () => {
    const batches: Float32Array[] = [];
    const states: string[] = [];
    let stopped!: () => void;
    const stoppedP = new Promise<void>((r) => { stopped = r; });
    const handle = await startLayout({
      moduleUrl: ENTRY, graph: ring(40), batchMs: 5, convergedMovement: -1, maxIterations: 1e9,
      onPositions: (p) => batches.push(p),
      onState: (s) => { states.push(s); if (s === "stopped") stopped(); },
    });
    expect(handle.state).toBe("running");
    const h = handle as LayoutHandle;
    while (batches.length < 3) await Bun.sleep(5);
    expect(batches.every((b) => b instanceof Float32Array && b.length === 80 && allFinite(b))).toBe(true);
    h.pause();
    await Bun.sleep(30);
    const pausedAt = batches.length;
    await Bun.sleep(60);
    expect(batches.length).toBe(pausedAt);
    h.resume();
    while (batches.length <= pausedAt) await Bun.sleep(5);
    h.stop();
    await stoppedP;
    const final = batches.length;
    await Bun.sleep(60);
    expect(batches.length).toBe(final);
    expect(states).toEqual(["running", "paused", "running", "stopped"]);
    h.teardown();
    h.teardown(); // idempotent
  });

  it("teardown terminates the worker and no more batches arrive", async () => {
    const batches: Float32Array[] = [];
    const h = (await startLayout({ moduleUrl: ENTRY, graph: ring(40), batchMs: 2, convergedMovement: -1, maxIterations: 1e9, onPositions: (p) => batches.push(p) })) as LayoutHandle;
    while (batches.length < 1) await Bun.sleep(5);
    h.teardown();
    const n = batches.length;
    await Bun.sleep(80);
    expect(batches.length).toBeLessThanOrEqual(n + 1);
    const m = batches.length;
    await Bun.sleep(80);
    expect(batches.length).toBe(m);
  });

  it("returns cached-only when init fails in the worker", async () => {
    const r = await startLayout({ moduleUrl: ENTRY, graph: { ...ring(4), positions: new Float32Array(1) }, onPositions() {} });
    expect(r.state).toBe("cached-only");
    expect((r as CachedOnly).reason).toContain("positions has 1 values");
  });
});

describe("fallback: no layout loop, cached positions only", () => {
  const base = { graph: ring(5), onPositions: () => { throw new Error("no positions expected"); } };
  it("when the host disallows workers", async () => {
    const r = await startLayout({ ...base, moduleUrl: ENTRY, workerAllowed: false, createWorker: () => { throw new Error("must not be called"); } });
    expect(r).toEqual({ state: "cached-only", reason: "live layout is unavailable: this host does not allow layout workers; showing cached positions only. Open the graph from the standalone vmem-ui or a single acon host to lay it out." });
  });
  it("when the CSP throws SecurityError", async () => {
    const r = await startLayout({ ...base, moduleUrl: "blob:never", createWorker: () => { throw new DOMException("blocked", "SecurityError"); } });
    expect(r.state).toBe("cached-only");
    expect((r as CachedOnly).reason).toContain("the page's security policy refused the layout worker");
  });
  it("when the module fails to load", async () => {
    const r = await startLayout({ ...base, moduleUrl: new URL("./does-not-exist.ts", import.meta.url) });
    expect(r.state).toBe("cached-only");
    expect((r as CachedOnly).reason).toContain("the layout worker failed to load");
  });
  it("when the worker never answers", async () => {
    let terminated = false;
    const silent = { postMessage() {}, addEventListener() {}, terminate() { terminated = true; } } as unknown as Worker;
    const r = await startLayout({ ...base, moduleUrl: ENTRY, createWorker: () => silent, startTimeoutMs: 30 });
    expect((r as CachedOnly).reason).toContain("did not start within 0.03 s");
    expect(terminated).toBe(true);
  });
  it("always asks for a module worker from the given URL, never blob:", async () => {
    const seen: { url: string; opts: WorkerOptions }[] = [];
    await startLayout({ ...base, moduleUrl: ENTRY, startTimeoutMs: 10, createWorker: (url, opts) => { seen.push({ url: String(url), opts }); throw new Error("stop here"); } });
    expect(seen).toEqual([{ url: ENTRY.href, opts: { type: "module", name: LAYOUT_WORKER_NAME } }]);
  });
});
