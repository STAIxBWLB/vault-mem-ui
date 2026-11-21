/**
 * The graph panel against a real DOM with a fake Sigma and a fake layout worker: the canvas mounts, layout batches
 * reach it, keyboard and toolbar drive selection, a refused worker shows the cached-only state, and unmount tears
 * the worker and Sigma down. happy-dom is registered here only.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { CanvasDeps, GraphLike, SigmaLike } from "../../../src/graph/view/canvas";
import { GraphPanel, configureGraph } from "../../../src/graph/view/GraphView.tsx";
import type { FromWorker, ToWorker } from "../../../src/graph/layout/protocol";

let root: Root | null = null;
let container: HTMLElement;

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  configureGraph({});
  await GlobalRegistrator.unregister();
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  document.body.replaceChildren();
});

interface Fake {
  deps: CanvasDeps;
  attrs: Map<string, Record<string, unknown>>;
  settings: Record<string, unknown>;
  handlers: Map<string, (p: { node?: string }) => void>;
  refreshes: number;
  killed: boolean;
  edgeColors: Map<string, string>;
}
function fakeCanvas(): Fake {
  const fake: Fake = { attrs: new Map(), settings: {}, handlers: new Map(), refreshes: 0, killed: false, edgeColors: new Map(), deps: null! };
  const graph: GraphLike = {
    addNode: (id, a) => fake.attrs.set(id, { ...a }),
    addEdgeWithKey: () => undefined,
    setNodeAttribute: (id, k, v) => { fake.attrs.get(id)![k] = v; },
    getNodeAttribute: (id, k) => fake.attrs.get(id)?.[k],
    setEdgeAttribute: (key, k, v) => { fake.edgeColors.set(key, v as string); void k; },
    hasNode: (id) => fake.attrs.has(id),
  };
  const sigma: SigmaLike = {
    on: (e, h) => fake.handlers.set(e, h),
    getCamera: () => ({ getState: () => ({ ratio: 1 }), on: () => undefined, animate: () => undefined }),
    getNodeDisplayData: (id) => (fake.attrs.has(id) ? { x: 0, y: 0 } : undefined),
    setSetting: (k, v) => { fake.settings[k] = v; },
    refresh: () => { fake.refreshes += 1; },
    kill: () => { fake.killed = true; },
  };
  fake.deps = { createGraph: () => graph, createSigma: (_g, _c, s) => { Object.assign(fake.settings, s); return sigma; } };
  return fake;
}

class FakeWorker {
  static last: FakeWorker | null = null;
  sent: ToWorker[] = [];
  terminated = false;
  private listeners: ((e: { data: FromWorker }) => void)[] = [];
  onerror: unknown = null;
  constructor() { FakeWorker.last = this; }
  addEventListener(type: string, l: (e: { data: FromWorker }) => void) { if (type === "message") this.listeners.push(l); }
  removeEventListener() {}
  postMessage(m: ToWorker) { this.sent.push(m); }
  terminate() { this.terminated = true; }
  emit(m: FromWorker) { for (const l of this.listeners) l({ data: m }); }
}

const graph = {
  nodes: [
    { id: "a", label: "Alpha", relPath: "notes/a.md" },
    { id: "b", label: "Beta", relPath: "notes/b.md" },
    { id: "c", label: "Gamma", relPath: null },
  ],
  edges: [
    { source: "a", target: "b", relation: "wiki_link", fromFrontmatter: false },
    { source: "b", target: "c", relation: "wiki_link", fromFrontmatter: false },
  ],
};

async function mount(reply: Record<string, unknown>, navigate: (p: string, q?: Record<string, string>) => void = () => {}, theme?: { mode: "light" | "dark" }) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<GraphPanel reply={reply} params={{}} navigate={navigate} beginWrite={() => {}} theme={theme} />);
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe("GraphPanel", () => {
  test("a provider without a graph snapshot says so with the next step", async () => {
    configureGraph({});
    await mount({});
    expect(container.textContent).toContain("Graph not available");
    expect(container.textContent).toContain("vault-mem #266");
  });

  test("the host's unavailable reason is shown as given", async () => {
    configureGraph({});
    await mount({ graph: null, unavailable: "the provider is old; update it, then reload this panel" });
    expect(container.textContent).toContain("The provider is old; update it, then reload this panel.");
  });

  test("an edge to an absent note keeps the link and draws the target as an unresolved ghost", async () => {
    const fake = fakeCanvas();
    configureGraph({ moduleUrl: "x", workerAllowed: false, canvasDeps: async () => fake.deps });
    await mount({ graph: { nodes: [{ id: "a", label: "A", relPath: "notes/a.md" }], edges: [{ source: "a", target: "missing", relation: "wiki_link", fromFrontmatter: false }] } });
    await flush();
    expect([...fake.attrs.keys()].sort()).toEqual(["a", "missing"]);
    expect(container.textContent).toContain("2 notes · 1 links");
  });

  test("pinning while the layout runs tells the worker, with the node's current position", async () => {
    const fake = fakeCanvas();
    configureGraph({ moduleUrl: "x", canvasDeps: async () => fake.deps, createWorker: () => new FakeWorker() as unknown as Worker });
    await mount({ graph });
    const worker = FakeWorker.last!;
    await act(async () => { worker.emit({ type: "ready" } as FromWorker); });
    await flush();
    await act(async () => { worker.emit({ type: "positions", positions: new Float32Array([1, 2, 3, 4, 5, 6]), iterations: 3 } as FromWorker); });
    await act(async () => fake.handlers.get("clickNode")!({ node: "b" }));
    const pin = [...container.querySelectorAll("button")].find((b) => b.textContent === "Pin")!;
    await act(async () => pin.click());
    expect(worker.sent.at(-1)).toEqual({ type: "fix", nodes: [{ index: 1, fixed: true, position: [3, 4] }] });
    expect(pin.getAttribute("aria-pressed")).toBe("true");
    await act(async () => pin.click());
    expect(worker.sent.at(-1)).toEqual({ type: "fix", nodes: [{ index: 1, fixed: false, position: [3, 4] }] });
  });

  test("a theme change re-reads the canvas tokens and recolours nodes and edges", async () => {
    const fake = fakeCanvas();
    configureGraph({ moduleUrl: "x", workerAllowed: false, canvasDeps: async () => fake.deps });
    await mount({ graph }, () => {}, { mode: "light" });
    await flush();
    const lightEdge = fake.edgeColors.get("e0");
    const canvas = container.querySelector(".vmem-graph-canvas") as HTMLElement;
    canvas.style.setProperty("--graph-canvas", "#101010");
    await act(async () => {
      root!.render(<GraphPanel reply={{ graph }} params={{}} navigate={() => {}} beginWrite={() => {}} theme={{ mode: "dark" }} />);
    });
    const darkEdge = fake.edgeColors.get("e0");
    expect(darkEdge).toBeDefined();
    expect(darkEdge).not.toBe(lightEdge);
  });

  test("mounts Sigma, applies worker batches, and tears both down on unmount", async () => {
    const fake = fakeCanvas();
    configureGraph({ moduleUrl: "https://host.test/panel.js", canvasDeps: async () => fake.deps, createWorker: () => new FakeWorker() as unknown as Worker, storage: undefined });
    await mount({ graph });
    const worker = FakeWorker.last!;
    expect(fake.attrs.size).toBe(3);
    expect(worker.sent[0]?.type).toBe("init");
    await act(async () => { worker.emit({ type: "ready" } as FromWorker); });
    await flush();
    expect(container.textContent).toContain("Laying out");
    await act(async () => { worker.emit({ type: "positions", positions: new Float32Array([10, 11, 20, 21, 30, 31]), iterations: 7 } as FromWorker); });
    expect(fake.attrs.get("b")).toMatchObject({ x: 20, y: 21 });
    expect(container.textContent).toContain("7 iterations");
    act(() => root!.unmount());
    root = null;
    expect(worker.terminated).toBe(true);
    expect(fake.killed).toBe(true);
  });

  test("a host that cannot start the worker shows cached positions with the reason", async () => {
    const fake = fakeCanvas();
    configureGraph({ moduleUrl: "https://host.test/panel.js", workerAllowed: false, canvasDeps: async () => fake.deps });
    await mount({ graph });
    await flush();
    expect(container.textContent).toContain("live layout is unavailable");
    expect(fake.attrs.size).toBe(3);
  });

  test("a canvas that cannot start reports it instead of a blank panel", async () => {
    configureGraph({ moduleUrl: "x", canvasDeps: async () => { throw new Error("no WebGL"); } });
    await mount({ graph });
    await flush();
    expect(container.textContent).toContain("could not start (no WebGL)");
  });

  test("click selects, the keyboard steps through neighbours and Enter opens the note", async () => {
    const fake = fakeCanvas();
    const opened: unknown[] = [];
    configureGraph({ moduleUrl: "x", workerAllowed: false, canvasDeps: async () => fake.deps });
    await mount({ graph }, (p, q) => opened.push([p, q]));
    await flush();
    await act(async () => fake.handlers.get("clickNode")!({ node: "a" }));
    expect(container.textContent).toContain("Alpha · 1 links");
    const canvas = container.querySelector(".vmem-graph-canvas") as HTMLElement;
    await act(async () => { canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
    expect(container.textContent).toContain("Beta");
    await act(async () => { canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(opened).toEqual([["note", { path: "notes/b.md" }]]);
    const refreshes = fake.refreshes;
    await act(async () => fake.handlers.get("enterNode")!({ node: "c" }));
    expect(fake.refreshes).toBeGreaterThan(refreshes);
  });

  test("toolbar opens the local view and back", async () => {
    const fake = fakeCanvas();
    configureGraph({ moduleUrl: "x", workerAllowed: false, canvasDeps: async () => fake.deps });
    await mount({ graph });
    await flush();
    await act(async () => fake.handlers.get("clickNode")!({ node: "a" }));
    const button = (label: string) => [...container.querySelectorAll("button")].find((b) => b.textContent === label)!;
    await act(async () => button("Local view").click());
    expect(container.textContent).toContain("Global view");
    await act(async () => button("Global view").click());
    expect(button("Global view")).toBeUndefined();
  });
});
