/**
 * The link control through the store, against the real `@staix/vault-mem` provider: a schema-1 graph snapshot is
 * assembled by the store, the inspector offers the link because the assembled reply kept the provider's declared
 * actions, and proposing a link reaches the provider's preview in the write dialog. Confirming then shows the write
 * and the reloaded graph. Synthetic notes under a temp home, removed afterwards.
 */

import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createVaultMcp } from "@staix/vault-mem";
import { plugin as providerPlugin } from "@staix/vault-mem/ui-plugin";
import type { ConsoleProvider } from "@staix/agent-console/contract";
import { App } from "../../../src/client/App.tsx";
import type { Host } from "../../../src/client/host.ts";
import { createStore } from "../../../src/client/store.ts";
import type { GraphInput } from "../../../src/graph/types.ts";
import type { CanvasDeps, GraphLike, SigmaLike } from "../../../src/graph/view/canvas.ts";
import { configureGraph } from "../../../src/graph/view/GraphView.tsx";
import { graphProvider } from "../../../src/plugin/graph.ts";

let root: string, home: string, vault: string, provider: Awaited<ReturnType<typeof providerPlugin.open>>;
const oldHome = process.env.VMEM_HOME;
const oldMemory = process.env.AMEM_HOME;
const notes = ["alpha", "beta"];

beforeAll(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "vmem-link-store-")));
  home = join(root, "home");
  vault = join(root, "vault");
  mkdirSync(join(vault, "notes"), { recursive: true });
  mkdirSync(home);
  mkdirSync(join(root, "memory"));
  writeFileSync(join(home, "vmem.config.json"), JSON.stringify({ vaults: [{ id: "test", path: vault, kind: "personal", write: "mcp" }] }));
  const writer = createVaultMcp(home);
  const entries = [
    { stem: "index", type: "moc", domain: "research", title: "Index", description: "Synthetic map" },
    ...notes.map((stem) => ({ stem, type: "insight", domain: "research", title: stem, description: "Synthetic note", topics: ["index"], body: "Synthetic.\n\n## Topics\n\n- [[index]]" })),
  ];
  for (const entry of entries) {
    const result = await writer.handlers.vmem_create!(entry) as { applied?: boolean; issues?: unknown };
    if (!result.applied) throw new Error(`Synthetic note refused: ${JSON.stringify(result.issues)}`);
  }
  process.env.VMEM_HOME = home;
  process.env.AMEM_HOME = join(root, "memory");
  provider = await providerPlugin.open({ home, log: () => {} });
  GlobalRegistrator.register();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => current?.unmount());
  current = null;
  document.body.replaceChildren();
});

afterAll(async () => {
  configureGraph({});
  await GlobalRegistrator.unregister();
  await provider?.close?.();
  if (oldHome === undefined) delete process.env.VMEM_HOME;
  else process.env.VMEM_HOME = oldHome;
  if (oldMemory === undefined) delete process.env.AMEM_HOME;
  else process.env.AMEM_HOME = oldMemory;
  if (root) rmSync(root, { recursive: true, force: true });
});

interface FakeLayout {
  deps: CanvasDeps;
  handlers: Map<string, (payload: { node?: string }) => void>;
}
/** Only what mounting the canvas touches: nodes, edges, camera and the click handler the test drives selection with. */
function fakeLayout(): FakeLayout {
  const handlers = new Map<string, (payload: { node?: string }) => void>();
  const attrs = new Map<string, Record<string, unknown>>();
  const graph: GraphLike = {
    addNode: (id, a) => attrs.set(id, { ...a }),
    addEdgeWithKey: () => {},
    getNodeAttribute: (id, key) => attrs.get(id)?.[key],
    updateEachNodeAttributes: (fn) => { for (const [id, a] of attrs) attrs.set(id, fn(id, a)); },
    updateEachEdgeAttributes: (fn) => { fn("e0", {}); },
    hasNode: (id) => attrs.has(id),
  };
  const sigma: SigmaLike = {
    on: (event, handler) => handlers.set(event, handler),
    getCamera: () => ({ getState: () => ({ ratio: 1 }), on: () => undefined, animate: () => undefined }),
    getNodeDisplayData: (id) => (attrs.has(id) ? { x: Number(attrs.get(id)!.x), y: Number(attrs.get(id)!.y) } : undefined),
    setSetting: () => {},
    refresh: () => {},
    hasProgramIndices: () => true,
    kill: () => {},
  };
  return { deps: { createGraph: () => graph, createSigma: () => sigma }, handlers };
}

/** The host the panel is written against, over the provider the plugin wraps: `after` defaults to 0 as the hosts do. */
function hostOver(wrapped: ConsoleProvider): Host {
  return {
    mount: document.createElement("div"),
    async snapshot(input) {
      const { panel, ...rest } = input;
      return wrapped.snapshot({ after: 0, panel: String(panel), ...rest });
    },
    action: (input) => wrapped.action(input as Parameters<ConsoleProvider["action"]>[0]),
    theme: () => ({ mode: "light" }),
  };
}

let current: Root | null = null;
let container: HTMLElement;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const body = (stem: string) => readFileSync(join(vault, "notes", `${stem}.md`), "utf8");

test("a schema-1 graph reply keeps the declaration, so the link control appears and reaches the provider's preview", async () => {
  const fake = fakeLayout();
  configureGraph({ moduleUrl: "x", workerAllowed: false, canvasDeps: async () => fake.deps });
  // The provider's own declaration, as the plugin passes it into the graph wrapper.
  const wrapped = graphProvider(provider, providerPlugin.manifest.capabilities?.actions ?? []);
  const host = hostOver(wrapped);
  const store = createStore(host, { initialPanel: "graph" });
  container = document.createElement("div");
  document.body.append(container);
  current = createRoot(container);
  await act(async () => { current!.render(<App store={store} />); });
  await act(async () => { store.show("graph", { vault: "test" }); await store.refresh(); });
  await flush();
  await flush();

  // The store committed an assembled reply (not the raw page), and the declaration survived it.
  const assembled = store.getState().reply!;
  expect(assembled.graphStats).toBeDefined();
  expect(assembled.capabilities).toMatchObject({ actions: expect.arrayContaining(["link"]) });
  expect(container.textContent).toContain("notes ·");

  await act(async () => fake.handlers.get("clickNode")!({ node: "alpha" }));
  const inspector = container.querySelector('[aria-label="Graph inspector"]')!;
  expect(inspector.textContent).toContain("Link this note");

  const target = container.querySelector<HTMLSelectElement>("#vmem-graph-link-target")!;
  await act(async () => { target.value = "beta"; target.dispatchEvent(new Event("change", { bubbles: true })); });
  const propose = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Propose link")!;
  expect(propose.disabled).toBe(false);
  const before = body("alpha");
  await act(async () => propose.click());
  await flush();

  // The provider's preview, in the shared dialog, with nothing written yet.
  const dialog = container.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("Link notes");
  expect(dialog.textContent).toContain("link notes/alpha.md → notes/beta.md (supports), both directions");
  expect(dialog.textContent).toContain('"type":"CONNECT"');
  expect(store.getState().write).toMatchObject({ phase: "preview" });
  expect(body("alpha")).toBe(before);

  await act(async () => [...dialog.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Confirm")!.click());
  await flush();
  await flush();
  expect(container.querySelector('[role="dialog"]')?.textContent).toContain("Link notes: done");
  expect(body("alpha")).toContain("[[beta]] (supports)");
  // The graph the panel now holds was read again after the write, so the new edge is there.
  expect((store.getState().reply?.graph as GraphInput).edges).toContainEqual({ source: "alpha", target: "beta", relation: "supports", fromFrontmatter: false, inferred: false });
});
