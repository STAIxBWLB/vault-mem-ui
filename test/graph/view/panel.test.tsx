/**
 * The graph panel against a real DOM with a fake Sigma and a fake layout worker: the canvas mounts, layout batches
 * reach it, keyboard and toolbar drive selection, a refused worker shows the cached-only state, and unmount tears
 * the worker and Sigma down. happy-dom is registered here only.
 */

import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { CanvasDeps, GraphLike, SigmaLike } from "../../../src/graph/view/canvas";
import { GraphPanel, configureGraph } from "../../../src/graph/view/GraphView.tsx";
import type { ActionInput } from "../../../src/client/host.ts";
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
  edgeAttrs: Map<string, Record<string, unknown>>;
  settings: Record<string, unknown>;
  handlers: Map<string, (p: { node?: string }) => void>;
  refreshes: number;
  killed: boolean;
  edgeColors: Map<string, string>;
  cameraMoves: Partial<{ x: number; y: number; ratio: number }>[];
}
function fakeCanvas(): Fake {
  const fake: Fake = { attrs: new Map(), edgeAttrs: new Map(), settings: {}, handlers: new Map(), refreshes: 0, killed: false, edgeColors: new Map(), cameraMoves: [], deps: null! };
  const graph: GraphLike = {
    addNode: (id, a) => fake.attrs.set(id, { ...a }),
    addEdgeWithKey: (key, _s, _t, a) => fake.edgeAttrs.set(key, { ...a }),
    getNodeAttribute: (id, k) => fake.attrs.get(id)?.[k],
    updateEachNodeAttributes: (fn) => { for (const [id, a] of fake.attrs) fake.attrs.set(id, fn(id, a)); },
    updateEachEdgeAttributes: (fn) => {
      for (const [key, a] of fake.edgeAttrs) {
        const next = fn(key, a);
        fake.edgeAttrs.set(key, next);
        if (typeof next.color === "string") fake.edgeColors.set(key, next.color);
      }
    },
    hasNode: (id) => fake.attrs.has(id),
  };
  const sigma: SigmaLike = {
    on: (e, h) => fake.handlers.set(e, h),
    getCamera: () => ({ getState: () => ({ ratio: 1 }), on: () => undefined, animate: (state) => { fake.cameraMoves.push(state); } }),
    getNodeDisplayData: (id) => (fake.attrs.has(id) ? { x: Number(fake.attrs.get(id)!.x), y: Number(fake.attrs.get(id)!.y) } : undefined),
    setSetting: (k, v) => { fake.settings[k] = v; },
    refresh: () => { fake.refreshes += 1; },
    hasProgramIndices: () => true,
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
    { source: "a", target: "b", relation: "wiki_link", fromFrontmatter: false, inferred: false },
    { source: "b", target: "c", relation: "wiki_link", fromFrontmatter: false, inferred: false },
  ],
};

async function mount(reply: Record<string, unknown>, navigate: (p: string, q?: Record<string, string>) => void = () => {}, theme?: { mode: "light" | "dark" }, options: { beginWrite?(input: ActionInput): void; params?: Record<string, string> } = {}) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<GraphPanel reply={reply} params={options.params ?? {}} navigate={navigate} beginWrite={options.beginWrite ?? (() => {})} theme={theme} />);
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe("GraphPanel", () => {
  test("hiding inferred links updates the canvas view and exported graph", async () => {
    const fake = fakeCanvas();
    configureGraph({ moduleUrl: "x", workerAllowed: false, canvasDeps: async () => fake.deps });
    let blob: Blob | undefined;
    const create = spyOn(URL, "createObjectURL").mockImplementation((value) => { blob = value as Blob; return "blob:synthetic"; });
    const click = spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    try {
      await mount({ graph: { ...graph, edges: [{ ...graph.edges[0]!, inferred: false }, { ...graph.edges[1]!, inferred: true }] } });
      expect(container.textContent).toContain("2 links");
      const inferredColor = fake.edgeAttrs.get("e1")!.color;
      expect(inferredColor).not.toBe(fake.edgeAttrs.get("e0")!.color);
      await act(async () => fake.handlers.get("clickNode")!({ node: "b" }));
      expect(container.textContent).toContain("wiki_link, inferred");
      const edgeReducer = fake.settings.edgeReducer as (id: string, attrs: Record<string, unknown>) => Record<string, unknown>;
      expect(edgeReducer("e1", fake.edgeAttrs.get("e1")!).color).toBe(inferredColor);
      const toggle = [...container.querySelectorAll("label")].find((label) => label.textContent?.includes("Show inferred links"))!.querySelector("input")!;
      expect(toggle.checked).toBe(true);
      await act(async () => toggle.click());
      expect(container.textContent).toContain("1 links");
      expect(edgeReducer("e1", fake.edgeAttrs.get("e1")!).hidden).toBe(true);
      await act(async () => { [...container.querySelectorAll("button")].find((button) => button.textContent === "Export filtered graph HTML")!.click(); });
      const html = await blob!.text();
      const packet = JSON.parse(html.match(/<script id="graph-data" type="application\/json">([^<]*)<\/script>/)![1]!);
      const data = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(packet.data), (char) => char.charCodeAt(0))));
      expect(data.edges).toEqual([{ source: "a", target: "b", relation: "wiki_link", inferred: false }]);
    } finally { create.mockRestore(); click.mockRestore(); }
  });

  test("empty chains export directs the person to Global view", async () => {
    const fake = fakeCanvas();
    configureGraph({ moduleUrl: "x", workerAllowed: false, canvasDeps: async () => fake.deps });
    await mount({ graph });
    await act(async () => { [...container.querySelectorAll("button")].find((button) => button.textContent === "Decision chains")!.click(); });
    const button = [...container.querySelectorAll("button")].find((item) => item.textContent === "Export filtered graph HTML")!;
    expect(button.disabled).toBe(true);
    expect(container.textContent).toContain("No decision nodes match; choose Global view to export.");
  });
  test("visible graph export captures current positions while layout runs", async () => {
    const fake = fakeCanvas();
    configureGraph({ moduleUrl: "x", canvasDeps: async () => fake.deps, createWorker: () => new FakeWorker() as unknown as Worker });
    let blob: Blob | undefined;
    const create = spyOn(URL, "createObjectURL").mockImplementation((value) => { blob = value as Blob; return "blob:synthetic"; });
    const click = spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    try {
      const input = { ...graph, nodes: graph.nodes.map((node, i) => ({ ...node, domain: i < 2 ? "x" : "y", body: "SYNTHETIC_BODY_NOT_EXPORTED" })) };
      await mount({ graph: input });
      const worker = FakeWorker.last!;
      await act(async () => { worker.emit({ type: "ready" } as FromWorker); }); await flush();
      await act(async () => { worker.emit({ type: "positions", positions: new Float32Array([1, 2, 3, 4, 5, 6]), iterations: 3 } as FromWorker); });
      // A second batch arrives before the two-second cache save; export must read the live canvas, not the cache.
      await act(async () => { worker.emit({ type: "positions", positions: new Float32Array([11, 12, 13, 14, 15, 16]), iterations: 4 } as FromWorker); });
      const domains = [...container.querySelectorAll("fieldset")].find((fieldset) => fieldset.querySelector("legend")?.textContent === "Domains")!;
      await act(async () => { [...domains.querySelectorAll("label")].find((label) => label.textContent?.includes("x ("))!.querySelector("input")!.click(); });
      const button = [...container.querySelectorAll("button")].find((item) => item.textContent === "Export filtered graph HTML")!;
      expect(button.disabled).toBe(false);
      expect(container.textContent).toContain("Laying out");
      await act(async () => button.click());
      expect(click).toHaveBeenCalledTimes(1);
      const html = await blob!.text();
      const packet = JSON.parse(html.match(/<script id="graph-data" type="application\/json">([^<]*)<\/script>/)![1]!);
      const data = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(packet.data), (char) => char.charCodeAt(0))));
      expect(data.nodes.map((node: { id: string }) => node.id)).toEqual(["a", "b"]);
      expect(data.nodes.map((node: { position: number[] }) => node.position)).toEqual([[11, 12], [13, 14]]);
      expect(data.edges).toEqual([{ source: "a", target: "b", relation: "wiki_link", inferred: false }]);
      expect(html).not.toContain("SYNTHETIC_BODY_NOT_EXPORTED");
      expect(JSON.stringify(data)).not.toContain("SYNTHETIC_BODY_NOT_EXPORTED");
    } finally { create.mockRestore(); click.mockRestore(); }
  });

  test("visible graph export is disabled until the canvas is ready", async () => {
    const fake = fakeCanvas(); let resolve!: (deps: CanvasDeps) => void;
    configureGraph({ moduleUrl: "x", workerAllowed: false, canvasDeps: () => new Promise((done) => { resolve = done; }) });
    await mount({ graph });
    const button = [...container.querySelectorAll("button")].find((item) => item.textContent === "Export filtered graph HTML")!;
    expect(button.disabled).toBe(true);
    expect(container.textContent).toContain("Export is available when the graph canvas is ready");
    await act(async () => { resolve(fake.deps); }); await flush();
    expect(button.disabled).toBe(false);
  });

  test("an empty filtered graph disables export with a visible next step", async () => {
    const fake = fakeCanvas();
    configureGraph({ moduleUrl: "x", workerAllowed: false, canvasDeps: async () => fake.deps });
    await mount({ graph });
    const input = container.querySelector<HTMLInputElement>("#vmem-graph-search")!;
    const propsKey = Object.keys(input).find((key) => key.startsWith("__reactProps$"))!;
    const props = (input as unknown as Record<string, { onChange(event: { currentTarget: HTMLInputElement }): void }>)[propsKey]!;
    await act(async () => { input.value = "no match"; props.onChange({ currentTarget: input }); });
    const button = [...container.querySelectorAll("button")].find((item) => item.textContent === "Export filtered graph HTML")!;
    expect(button.disabled).toBe(true);
    expect(container.textContent).toContain("No nodes match; clear filters or search to export.");
  });

  test("a failed canvas visibly explains why export is unavailable", async () => {
    configureGraph({ moduleUrl: "x", canvasDeps: async () => { throw new Error("no canvas"); } });
    await mount({ graph }); await flush();
    const button = [...container.querySelectorAll("button")].find((item) => item.textContent === "Export filtered graph HTML")!;
    expect(button.disabled).toBe(true);
    expect(container.textContent).toContain("Export unavailable: the graph canvas could not start.");
  });
  test("search updates which chains are listed after the panel is mounted", async () => {
    const fake = fakeCanvas();
    configureGraph({ moduleUrl: "x", workerAllowed: false, canvasDeps: async () => fake.deps });
    const nodes = ["alpha", "beta", "omega", "zeta"].map((id) => ({ id, label: id, relPath: `notes/${id}.md`, type: "decision" }));
    const edges = [["alpha", "beta"], ["omega", "zeta"]].map(([source, target]) => ({ source: target, target: source, relation: "supersedes", fromFrontmatter: true, inferred: false }));
    await mount({ graph: { nodes, edges } });
    await act(async () => { [...container.querySelectorAll("button")].find((button) => button.textContent === "Decision chains")!.click(); });
    const input = container.querySelector<HTMLInputElement>("#vmem-graph-search")!;
    const propsKey = Object.keys(input).find((key) => key.startsWith("__reactProps$"))!;
    const props = (input as unknown as Record<string, { onChange(event: { currentTarget: HTMLInputElement }): void }>)[propsKey]!;
    await act(async () => { input.value = "alpha"; props.onChange({ currentTarget: input }); });
    const panel = container.querySelector('[aria-label="Decision chains"]')!;
    expect(panel.textContent).toContain("Focus chain: alpha");
    expect(panel.textContent).not.toContain("Focus chain: omega");
  });
  test("warns when the provider omitted unresolved links at its size limit", async () => {
    const fake = fakeCanvas();
    configureGraph({ moduleUrl: "x", workerAllowed: false, canvasDeps: async () => fake.deps });
    await mount({ graph, graphStats: { placeholdersOmitted: 2 } });
    expect(container.textContent).toContain("Some unresolved links were omitted by the provider");
  });
  test("chain search keeps the full chain and out-of-search note action", async () => {
    const fake = fakeCanvas();
    configureGraph({ moduleUrl: "x", workerAllowed: false, canvasDeps: async () => fake.deps });
    const nodes = ["a", "b", "c", "d"].map((id) => ({ id, label: id === "a" ? "Alpha" : id.toUpperCase(), relPath: `notes/${id}.md`, type: "decision", domain: id === "a" ? "x" : "y" }));
    const edges = [["a", "b"], ["b", "c"], ["c", "d"]].map(([source, target]) => ({ source: target, target: source, relation: "supersedes", fromFrontmatter: true, inferred: false }));
    await mount({ graph: { nodes, edges } });
    await act(async () => { [...container.querySelectorAll("button")].find((button) => button.textContent === "Decision chains")!.click(); });
    const input = container.querySelector<HTMLInputElement>("#vmem-graph-search")!;
    // React was imported before happy-dom in this file, so its input event plugin is not attached; invoke the mounted
    // input's current React handler to exercise the same search path and the real GraphView wiring.
    const propsKey = Object.keys(input).find((key) => key.startsWith("__reactProps$"))!;
    const props = (input as unknown as Record<string, { onChange(event: { currentTarget: HTMLInputElement }): void }>)[propsKey]!;
    await act(async () => { input.value = "Alpha"; props.onChange({ currentTarget: input }); });
    const panel = container.querySelector('[aria-label="Decision chains"]')!;
    expect(panel.textContent).toContain("2 of 4 visible");
    expect(panel.textContent).toContain("Open D");
    const domain = [...container.querySelectorAll("fieldset")].find((element) => element.querySelector("legend")?.textContent === "Domains")!;
    const option = [...domain.querySelectorAll("label")].find((label) => label.textContent?.includes("x ("))!.querySelector("input")!;
    await act(async () => option.click());
    expect(panel.textContent).toContain("1 of 4 visible");
    expect(panel.textContent).toContain("Open D");
  });
  test("graphs without supersedes edges explain the empty chain view", async () => {
    const fake = fakeCanvas();
    configureGraph({ moduleUrl: "x", workerAllowed: false, canvasDeps: async () => fake.deps });
    await mount({ graph: { nodes: [{ id: "a", label: "A", relPath: "notes/a.md", type: "decision" }, { id: "b", label: "B", relPath: "notes/b.md", type: "decision" }], edges: [{ source: "a", target: "b", relation: "wiki_link", fromFrontmatter: false, inferred: false }] } });
    await act(async () => { [...container.querySelectorAll("button")].find((button) => button.textContent === "Decision chains")!.click(); });
    expect(container.textContent).toContain("This graph has no supersedes edges");
    expect(container.querySelector('[aria-label="Decision chains"]')?.textContent).not.toContain("Focus chain:");
  });

  test("decision chain mode lists a chain, focuses it and opens a note", async () => {
    const fake = fakeCanvas();
    configureGraph({ moduleUrl: "x", workerAllowed: false, canvasDeps: async () => fake.deps });
    const opened: unknown[] = [];
    await mount({ graph: { nodes: [
      { id: "first", label: "First", relPath: "notes/first.md", type: "decision", date: "2025-01-01" },
      { id: "second", label: "Second", relPath: "notes/second.md", type: "decision", date: "2026-01-01" },
    ], edges: [{ source: "second", target: "first", relation: "supersedes", fromFrontmatter: true, inferred: false }] } }, (panel, params) => opened.push({ panel, params }));
    await act(async () => { [...container.querySelectorAll("button")].find((button) => button.textContent === "Decision chains")!.click(); });
    const focus = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Focus chain: First → Second"))!;
    expect(focus).toBeDefined();
    await act(async () => focus.click());
    expect(focus.getAttribute("aria-pressed")).toBe("true");
    const reduce = fake.settings.nodeReducer as (id: string, data: Record<string, unknown>) => Record<string, unknown>;
    expect(reduce("first", fake.attrs.get("first")!).highlighted).toBe(true);
    expect(reduce("second", fake.attrs.get("second")!).highlighted).toBe(true);
    const first = fake.attrs.get("first")!, second = fake.attrs.get("second")!;
    expect(fake.cameraMoves.at(-1)).toMatchObject({ x: (Number(first.x) + Number(second.x)) / 2, y: (Number(first.y) + Number(second.y)) / 2 });
    await act(async () => { [...container.querySelectorAll("button")].find((button) => button.textContent === "Open First")!.click(); });
    expect(opened).toEqual([{ panel: "note", params: { path: "notes/first.md" } }]);
    await act(async () => { container.querySelector(".vmem-graph-canvas")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    expect(container.querySelector('[aria-label="Decision chains"]')).not.toBeNull();
    expect(focus.getAttribute("aria-pressed")).toBe("false");
    await act(async () => { [...container.querySelectorAll("button")].find((button) => button.textContent === "Global view")!.click(); });
    expect(container.querySelector('[aria-label="Decision chains"]')).toBeNull();
  });
  test("provider errors are shown unchanged with a first-page retry", async () => {
    const navigations: unknown[] = [];
    const error = "graph page is invalid or expired; restart from the first page";
    await mount({ error }, (panel, params) => navigations.push({ panel, params }));
    expect(container.textContent).toContain(error);
    await act(async () => { [...container.querySelectorAll("button")].find((button) => button.textContent === "First page")!.click(); });
    expect(navigations).toEqual([{ panel: "graph", params: {} }]);
  });
  test("community swatches retain their colours after toggling off and on", async () => {
    const fake = fakeCanvas();
    configureGraph({ moduleUrl: "x", workerAllowed: false, canvasDeps: async () => fake.deps });
    await mount({ graph: { ...graph, communities: { a: 0, b: 2 } } });
    const swatches = () => [...container.querySelectorAll<HTMLElement>("[data-community]")].map((el) => el.style.backgroundColor);
    const colours = swatches();
    expect(colours).toHaveLength(2);
    expect(colours.every(Boolean)).toBe(true);
    const toggle = [...container.querySelectorAll("button")].find((button) => button.textContent === "Communities")!;
    await act(async () => toggle.click());
    expect(swatches()).toEqual([]);
    await act(async () => toggle.click());
    expect(swatches()).toEqual(colours);
  });

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
    await mount({ graph: { nodes: [{ id: "a", label: "A", relPath: "notes/a.md" }], edges: [{ source: "a", target: "missing", relation: "wiki_link", fromFrontmatter: false, inferred: false }] } });
    await flush();
    expect([...fake.attrs.keys()].sort()).toEqual(["a", "missing"]);
    expect(container.textContent).toContain("2 notes · 1 links");
  });

  test("a pin toggled after init but before ready reaches the worker once it is ready", async () => {
    const fake = fakeCanvas();
    configureGraph({ moduleUrl: "x", canvasDeps: async () => fake.deps, createWorker: () => new FakeWorker() as unknown as Worker });
    await mount({ graph });
    const worker = FakeWorker.last!;
    expect(worker.sent.map((m) => m.type)).toEqual(["init"]);
    await act(async () => fake.handlers.get("clickNode")!({ node: "c" }));
    const pin = [...container.querySelectorAll("button")].find((b) => b.textContent === "Pin")!;
    await act(async () => pin.click());
    expect(worker.sent.map((m) => m.type)).toEqual(["init"]); // no handle yet, nothing to send to
    await act(async () => { worker.emit({ type: "ready" } as FromWorker); });
    await flush();
    const c = fake.attrs.get("c")!;
    expect(worker.sent.at(-1)).toEqual({ type: "fix", nodes: [{ index: 2, fixed: true, position: [c.x as number, c.y as number] }] });
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

  test("pause then resume returns to running, so the button flips back and LOD-during-layout applies again", async () => {
    const fake = fakeCanvas();
    configureGraph({ moduleUrl: "x", canvasDeps: async () => fake.deps, createWorker: () => new FakeWorker() as unknown as Worker });
    await mount({ graph });
    const worker = FakeWorker.last!;
    await act(async () => { worker.emit({ type: "ready" } as FromWorker); });
    await flush();
    const button = (label: string) => [...container.querySelectorAll("button")].find((b) => b.textContent === label);
    await act(async () => button("Pause layout")!.click());
    expect(worker.sent.at(-1)).toEqual({ type: "pause" });
    await act(async () => { worker.emit({ type: "state", state: "paused" } as FromWorker); });
    await act(async () => button("Resume layout")!.click());
    expect(worker.sent.at(-1)).toEqual({ type: "resume" });
    await act(async () => { worker.emit({ type: "state", state: "running" } as FromWorker); });
    expect(button("Pause layout")).toBeDefined();
    expect(container.textContent).toContain("Laying out");
  });

  test("a new reply with the same graph keeps the view, worker and selection; a changed graph rebuilds", async () => {
    const fake = fakeCanvas();
    let workers = 0;
    configureGraph({ moduleUrl: "x", canvasDeps: async () => fake.deps, createWorker: () => { workers += 1; return new FakeWorker() as unknown as Worker; } });
    await mount({ graph });
    await act(async () => { FakeWorker.last!.emit({ type: "ready" } as FromWorker); });
    await flush();
    await act(async () => fake.handlers.get("clickNode")!({ node: "a" }));
    const render = (g: unknown) => act(async () => {
      root!.render(<GraphPanel reply={{ graph: g }} params={{}} navigate={() => {}} beginWrite={() => {}} />);
    });
    await render(structuredClone(graph));
    await flush();
    expect(workers).toBe(1);
    expect(fake.killed).toBe(false);
    expect(container.textContent).toContain("Alpha · 1 links");
    await render({ ...graph, edges: graph.edges.slice(0, 1) });
    await flush();
    expect(fake.killed).toBe(true);
    expect(workers).toBe(2);
  });

  test("snapshots whose old 32-bit content hashes collided still rebuild with the new data", async () => {
    const fake = fakeCanvas();
    configureGraph({ moduleUrl: "x", workerAllowed: false, canvasDeps: async () => fake.deps });
    const one = (label: string) => ({ nodes: [{ id: "a", label, relPath: "notes/a.md" }], edges: [] });
    await mount({ graph: one("0066j8m") });
    await flush();
    expect(fake.attrs.get("a")!.label).toBe("0066j8m");
    const next = fakeCanvas();
    configureGraph({ moduleUrl: "x", workerAllowed: false, canvasDeps: async () => next.deps });
    await act(async () => {
      root!.render(<GraphPanel reply={{ graph: one("0p1umdh") }} params={{}} navigate={() => {}} beginWrite={() => {}} />);
    });
    await flush();
    expect(fake.killed).toBe(true);
    expect(next.attrs.get("a")!.label).toBe("0p1umdh");
  });

  test("opening a note keeps the vault the graph was opened for", async () => {
    const fake = fakeCanvas();
    const opened: unknown[] = [];
    configureGraph({ moduleUrl: "x", workerAllowed: false, canvasDeps: async () => fake.deps });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<GraphPanel reply={{ graph }} params={{ vault: "work" }} navigate={(p, q) => opened.push([p, q])} beginWrite={() => {}} />);
    });
    await flush();
    await act(async () => fake.handlers.get("clickNode")!({ node: "a" }));
    const canvas = container.querySelector(".vmem-graph-canvas") as HTMLElement;
    await act(async () => { canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(opened).toEqual([["note", { path: "notes/a.md", vault: "work" }]]);
  });

  test("positions are saved when the layout ends and on unmount, not only on the 2 s throttle", async () => {
    const fake = fakeCanvas();
    const data: Record<string, string> = {};
    const storage = { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => { data[k] = v; } };
    configureGraph({ moduleUrl: "x", storage, canvasDeps: async () => fake.deps, createWorker: () => new FakeWorker() as unknown as Worker });
    await mount({ graph });
    const worker = FakeWorker.last!;
    await act(async () => { worker.emit({ type: "ready" } as FromWorker); });
    await flush();
    await act(async () => { worker.emit({ type: "positions", positions: new Float32Array([1, 1, 2, 2, 3, 3]), iterations: 1 } as FromWorker); });
    await act(async () => { worker.emit({ type: "positions", positions: new Float32Array([7, 7, 8, 8, 9, 9]), iterations: 2 } as FromWorker); });
    await act(async () => { worker.emit({ type: "state", state: "done" } as FromWorker); });
    const saved = () => JSON.parse(Object.values(data)[0]!).positions;
    expect(saved().c).toEqual([9, 9]);
    await act(async () => { worker.emit({ type: "positions", positions: new Float32Array([4, 4, 5, 5, 6, 6]), iterations: 3 } as FromWorker); });
    act(() => root!.unmount());
    root = null;
    expect(saved().c).toEqual([6, 6]);
  });

  test("a layout that fails to start after the canvas mounted is a layout error, not a WebGL one", async () => {
    const fake = fakeCanvas();
    configureGraph({ moduleUrl: "x", canvasDeps: async () => fake.deps, createWorker: () => { throw new TypeError("boom"); } });
    await mount({ graph });
    await flush();
    expect(container.textContent).not.toContain("WebGL");
    expect(container.textContent).toContain("live layout is unavailable");
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

  test("Ctrl/Cmd/Alt chords reach the browser; only bare keys drive the graph", async () => {
    const fake = fakeCanvas();
    configureGraph({ moduleUrl: "x", workerAllowed: false, canvasDeps: async () => fake.deps });
    await mount({ graph });
    await flush();
    await act(async () => fake.handlers.get("clickNode")!({ node: "a" }));
    const canvas = container.querySelector(".vmem-graph-canvas") as HTMLElement;
    for (const init of [{ key: "p", ctrlKey: true }, { key: "p", metaKey: true }, { key: "l", ctrlKey: true }, { key: "ArrowRight", altKey: true }]) {
      const event = new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true });
      await act(async () => { canvas.dispatchEvent(event); });
      expect(event.defaultPrevented).toBe(false);
    }
    expect([...container.querySelectorAll("button")].find((b) => b.textContent === "Global view")?.getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).toContain("Alpha");
    const bare = new KeyboardEvent("keydown", { key: "l", bubbles: true, cancelable: true });
    await act(async () => { canvas.dispatchEvent(bare); });
    expect(bare.defaultPrevented).toBe(true);
    expect([...container.querySelectorAll("button")].find((b) => b.textContent === "Local view")?.getAttribute("aria-pressed")).toBe("true");
  });

  test("toolbar opens the local view and back", async () => {
    const fake = fakeCanvas();
    configureGraph({ moduleUrl: "x", workerAllowed: false, canvasDeps: async () => fake.deps });
    await mount({ graph });
    await flush();
    await act(async () => fake.handlers.get("clickNode")!({ node: "a" }));
    const button = (label: string) => [...container.querySelectorAll("button")].find((b) => b.textContent === label)!;
    await act(async () => button("Local view").click());
    expect(button("Local view").getAttribute("aria-pressed")).toBe("true");
    await act(async () => button("Global view").click());
    expect(button("Global view").getAttribute("aria-pressed")).toBe("true");
  });
});

describe("link authoring", () => {
  const inspector = () => container.querySelector('[aria-label="Graph inspector"]')!;
  const propose = () => [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Propose link");
  /** A real change event, which React's delegated listener handles for a select (its props expando is absent). */
  const choose = async (selector: string, value: string) => {
    const select = container.querySelector<HTMLSelectElement>(selector)!;
    await act(async () => { select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); });
  };

  test("a provider that declares no actions gets no link control", async () => {
    const fake = fakeCanvas();
    configureGraph({ moduleUrl: "x", workerAllowed: false, canvasDeps: async () => fake.deps });
    await mount({ graph });
    await flush();
    await act(async () => fake.handlers.get("clickNode")!({ node: "a" }));
    expect(inspector().textContent).toContain("Open note");
    expect(inspector().textContent).not.toContain("Link this note");
    expect(propose()).toBeUndefined();
  });

  test("the control appears only for a provider whose declared actions include link", async () => {
    const fake = fakeCanvas();
    configureGraph({ moduleUrl: "x", workerAllowed: false, canvasDeps: async () => fake.deps });
    await mount({ graph, capabilities: { actions: ["delete", "move"] } });
    await flush();
    await act(async () => fake.handlers.get("clickNode")!({ node: "a" }));
    expect(inspector().textContent).not.toContain("Link this note");
    act(() => root!.unmount());
    root = null;
    await mount({ graph, capabilities: { actions: ["delete", "link"] } });
    await flush();
    await act(async () => fake.handlers.get("clickNode")!({ node: "a" }));
    expect(inspector().textContent).toContain("Link this note");
    expect(propose()).toBeDefined();
  });

  test("proposing a link sends the provider's action with both note paths, the relation and the vault", async () => {
    const fake = fakeCanvas();
    const written: ActionInput[] = [];
    configureGraph({ moduleUrl: "x", workerAllowed: false, canvasDeps: async () => fake.deps });
    await mount({ graph, capabilities: { actions: ["link"] } }, () => {}, undefined, { params: { vault: "work" }, beginWrite: (input) => written.push(input) });
    await flush();
    await act(async () => fake.handlers.get("clickNode")!({ node: "a" }));
    // The provider's own relation list, and nothing proposed before a target is picked.
    expect([...container.querySelectorAll<HTMLOptionElement>("#vmem-graph-link-relation option")].map((option) => option.value))
      .toEqual(["supports", "contradicts", "extends", "applies-to", "context-for"]);
    // Only notes with a file can be targets, so the unresolved "c" is not offered.
    expect([...container.querySelectorAll<HTMLOptionElement>("#vmem-graph-link-target option")].map((option) => option.value)).toEqual(["", "b"]);
    expect(propose()!.disabled).toBe(true);
    await choose("#vmem-graph-link-target", "b");
    await choose("#vmem-graph-link-relation", "contradicts");
    expect(propose()!.disabled).toBe(false);
    await act(async () => propose()!.click());
    expect(written).toEqual([{ action: "link", from: "notes/a.md", to: "notes/b.md", relation: "contradicts", bidirectional: true, vault: "work" }]);
  });

  test("unchecking both directions proposes a one-way link", async () => {
    const fake = fakeCanvas();
    const written: ActionInput[] = [];
    configureGraph({ moduleUrl: "x", workerAllowed: false, canvasDeps: async () => fake.deps });
    await mount({ graph, capabilities: { actions: ["link"] } }, () => {}, undefined, { beginWrite: (input) => written.push(input) });
    await flush();
    await act(async () => fake.handlers.get("clickNode")!({ node: "a" }));
    await choose("#vmem-graph-link-target", "b");
    const both = inspector().querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(both.checked).toBe(true);
    await act(async () => both.click());
    expect(both.checked).toBe(false);
    await act(async () => propose()!.click());
    expect(written).toEqual([{ action: "link", from: "notes/a.md", to: "notes/b.md", relation: "supports", bidirectional: false }]);
  });

  test("an unresolved note cannot start a link", async () => {
    const fake = fakeCanvas();
    configureGraph({ moduleUrl: "x", workerAllowed: false, canvasDeps: async () => fake.deps });
    await mount({ graph, capabilities: { actions: ["link"] } });
    await flush();
    await act(async () => fake.handlers.get("clickNode")!({ node: "c" }));
    expect(inspector().textContent).toContain("unresolved link with no file");
    expect(propose()).toBeUndefined();
  });

  test("choosing another note starts the link form empty", async () => {
    const fake = fakeCanvas();
    configureGraph({ moduleUrl: "x", workerAllowed: false, canvasDeps: async () => fake.deps });
    const nodes = ["a", "b", "c"].map((id) => ({ id, label: id.toUpperCase(), relPath: `notes/${id}.md` }));
    await mount({ graph: { nodes, edges: [] }, capabilities: { actions: ["link"] } });
    await flush();
    await act(async () => fake.handlers.get("clickNode")!({ node: "a" }));
    await choose("#vmem-graph-link-target", "b");
    expect(container.querySelector<HTMLSelectElement>("#vmem-graph-link-target")!.value).toBe("b");
    await act(async () => fake.handlers.get("clickNode")!({ node: "c" }));
    // C is another note, so the form starts again instead of proposing C to the target picked while A was selected.
    expect(container.querySelector<HTMLSelectElement>("#vmem-graph-link-target")!.value).toBe("");
    expect(propose()!.disabled).toBe(true);
  });

  test("a large graph lists 200 targets and says how to reach the rest", async () => {
    const fake = fakeCanvas();
    configureGraph({ moduleUrl: "x", workerAllowed: false, canvasDeps: async () => fake.deps });
    const nodes = Array.from({ length: 251 }, (_, i) => ({ id: `n${i}`, label: `Note ${i}`, relPath: `notes/n${i}.md` }));
    await mount({ graph: { nodes, edges: [] }, capabilities: { actions: ["link"] } });
    await flush();
    await act(async () => fake.handlers.get("clickNode")!({ node: "n0" }));
    expect(inspector().textContent).toContain("Showing the first 200 of 250 notes by label; search or filter to narrow.");
    expect(container.querySelectorAll("#vmem-graph-link-target option")).toHaveLength(201);
  });
});
