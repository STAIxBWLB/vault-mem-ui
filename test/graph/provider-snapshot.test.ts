import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVaultMcp } from "@staix/vault-mem";
import { plugin as providerPlugin } from "@staix/vault-mem/ui-plugin";
import { assembleGraphSnapshot } from "../../node_modules/@staix/vault-mem/src/ui/graph-snapshot.ts";
import { assembleGraphPages } from "../../src/graph/view/graph-snapshot.ts";
import { buildGraphModel } from "../../src/graph/model.ts";
import { createGraphViewStore } from "../../src/graph/view/state.ts";
import { implementedPanelManifest, graphAwareSnapshot } from "../../src/plugin/graph.ts";
import type { GraphInput } from "../../src/graph/types.ts";
import type { Host } from "../../src/client/host.ts";
import { createFakeHost } from "../../src/client/fake.ts";
import { createStore } from "../../src/client/store.ts";

let root: string, home: string, provider: Awaited<ReturnType<typeof providerPlugin.open>>;
const oldHome = process.env.VMEM_HOME;
const oldMemory = process.env.AMEM_HOME;
let snapshot: Host["snapshot"];
beforeAll(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "vmem-graph-integration-")));
  home = join(root, "home"); const vault = join(root, "vault");
  mkdirSync(join(vault, "notes"), { recursive: true }); mkdirSync(home); mkdirSync(join(root, "memory"));
  writeFileSync(join(home, "vmem.config.json"), JSON.stringify({ vaults: [{ id: "test", path: vault, kind: "personal", write: "mcp" }] }));
  const writer = createVaultMcp(home);
  const entries = [
    { stem: "index", type: "moc", domain: "research", title: "Index", description: "Synthetic map" },
    { stem: "beta", type: "insight", domain: "research", title: "Beta", description: "Synthetic note", topics: ["index"], body: "Synthetic.\n\n## Topics\n\n- [[index]]" },
    { stem: "alpha", type: "insight", domain: "research", title: "Alpha", description: "Synthetic note", topics: ["index"], body: "[[beta]]\n\n## Topics\n\n- [[index]]" },
    { stem: "unused", type: "insight", domain: "research", title: "Unused", description: "Synthetic note", topics: ["index"], body: "Synthetic.\n\n## Topics\n\n- [[index]]" },
  ];
  for (const entry of entries) {
    const result = await writer.handlers.vmem_create!(entry) as { applied?: boolean; issues?: unknown };
    if (!result.applied) throw new Error(`Synthetic fixture refused: ${JSON.stringify(result.issues)}`);
  }
  process.env.VMEM_HOME = home;
  process.env.AMEM_HOME = join(root, "memory");
  provider = await providerPlugin.open({ home, log: () => {} });
  snapshot = (input) => provider.snapshot({ after: 0, ...input });
});
afterAll(async () => { await provider?.close?.(); if (oldHome === undefined) delete process.env.VMEM_HOME; else process.env.VMEM_HOME = oldHome; if (oldMemory === undefined) delete process.env.AMEM_HOME; else process.env.AMEM_HOME = oldMemory; if (root) rmSync(root, { recursive: true, force: true }); });

test("actual provider pages assemble and match its neighbors and path queries", async () => {
  const first = await snapshot({ panel: "graph", vault: "test" });
  expect(first).toMatchObject({ schema: 1, kind: "nodes", vault: "test" });
  expect(first.next).toBeTruthy();
  const assembled = await assembleGraphPages(snapshot, first, { vault: "test" });
  const graph = assembled.graph as GraphInput;
  expect(graph.nodes.map((node) => node.id)).toEqual(expect.arrayContaining(["alpha", "beta", "index"]));
  expect(graph.edges).toContainEqual({ source: "alpha", target: "beta", relation: "wiki_link", fromFrontmatter: false });
  expect(assembled.graphStats).toMatchObject({ pages: 2 });
  const neighbors = await snapshot({ panel: "graph", vault: "test", neighbors: "alpha" });
  expect((neighbors.neighborhood as { nodes: { id: string }[] }).nodes.map((node) => node.id)).toContain("beta");
  const path = await snapshot({ panel: "graph", vault: "test", from: "alpha", to: "beta" });
  expect(path.path).toMatchObject({ found: true, length: 1 });
  const store = createGraphViewStore(buildGraphModel(graph));
  store.openLocal("alpha", 1);
  expect(store.getState().derived.visibleNodeIds.has("beta")).toBe(true);
  store.pathTo("alpha"); store.pathTo("beta");
  expect(store.getState().path).toEqual(["alpha", "beta"]);
  expect(implementedPanelManifest(providerPlugin.manifest).panels.find((panel) => panel.id === "graph")?.order).toBe(11);
  expect(await graphAwareSnapshot(async () => ({ error: "unknown panel graph" }))({ panel: "graph", after: 0 })).toMatchObject({ graph: null });
});

test("a stale real provider page restarts once and reloads the new revision", async () => {
  const old = await snapshot({ panel: "graph", vault: "test" });
  const preview = await provider.action({ action: "delete", vault: "test", path: "notes/unused.md" });
  if (!("needsConfirm" in preview) || preview.needsConfirm !== true || !("fingerprint" in preview) || typeof preview.fingerprint !== "string") throw new Error(`Delete preview failed: ${JSON.stringify(preview)}`);
  const result = await provider.action({ action: "delete", vault: "test", path: "notes/unused.md", confirmed: true, fingerprint: preview.fingerprint });
  expect(result.ok).toBe(true);
  const called: string[] = [];
  const assembled = await assembleGraphPages(async (input) => { called.push(typeof input.page === "string" ? "page" : "first"); return snapshot(input); }, old, { vault: "test" });
  expect(called).toEqual(["page", "first", "page"]);
  expect((assembled.graph as GraphInput).nodes.some((node) => node.id === "unused")).toBe(false);
});

test("provider columnar unresolved placeholders stay non-navigable", async () => {
  const assembly = assembleGraphSnapshot({ notes: [{ path: "notes/a.md", source: "---\ntype: insight\ndomain: research\n---\n[[missing]]" }], today: "2026-01-01", logPath: "log", log: null, registryIds: null, reports: {} }, "test");
  let i = 0;
  const result = await assembleGraphPages(async () => ({ ...assembly.pages[++i]!, cursor: i }), { ...assembly.pages[0]!, cursor: 0 }, {});
  expect((result.graph as GraphInput).nodes.find((node) => node.id === "missing")).toMatchObject({ relPath: null });
  expect((result.graph as GraphInput).edges).toContainEqual({ source: "a", target: "missing", relation: "wiki_link", fromFrontmatter: false });
});

test("errors stay verbatim and a second stale page does not retry forever", async () => {
  const error = { error: "graph: no selected vault; select a registered vault" };
  expect(await assembleGraphPages(async () => ({}), error, {})).toEqual(error);
  const assembly = assembleGraphSnapshot({ notes: [{ path: "notes/a.md", source: "---\ntype: insight\n---\n[[missing]]" }], today: "2026-01-01", logPath: "log", log: null, registryIds: null, reports: {} }, "test");
  const first = { ...assembly.pages[0]!, cursor: 1 };
  let calls = 0;
  const failure = "graph page is invalid or expired; restart from the first page";
  const result = await assembleGraphPages(async (input) => { calls++; return input.page ? { error: failure } : first; }, first, {});
  expect(calls).toBe(3);
  expect(result).toEqual({ error: failure });
});

test("the client store assembles pushed pages without retaining partial results", async () => {
  const assembly = assembleGraphSnapshot({ notes: [{ path: "notes/a.md", source: "---\ntype: insight\n---\n[[missing]]" }], today: "2026-01-01", logPath: "log", log: null, registryIds: null, reports: {} }, "test");
  const host = createFakeHost({ snapshots: { graph: () => ({ ...assembly.pages[1]!, cursor: 2 }) } });
  const store = createStore(host, { initialPanel: "graph" });
  const stop = store.start();
  host.push({ ...assembly.pages[0]!, cursor: 1 });
  await Bun.sleep(0);
  expect((store.getState().reply?.graph as GraphInput).edges).toHaveLength(1);
  host.push({ changed: false, cursor: 1 });
  await Bun.sleep(0);
  expect((store.getState().reply?.graph as GraphInput).nodes).toHaveLength(2);
  stop();
});

test("unchanged polling and pushes reuse the graph; a new revision loads all pages", async () => {
  const synthetic = (name: string) => assembleGraphSnapshot({ notes: [{ path: "notes/a.md", source: `---\ntype: insight\n---\n[[${name}]]` }], today: "2026-01-01", logPath: "log", log: null, registryIds: null, reports: {} }, "test");
  const old = synthetic("missing"), updated = synthetic("other");
  let current = old, cursor = 101;
  const host = createFakeHost();
  host.snapshot = async (input) => {
    host.calls.snapshot.push(input);
    if (!input.page && input.after === cursor) return { changed: false, cursor };
    const page = input.page ? current.pages.find((candidate) => candidate.kind === "edges")! : current.pages[0]!;
    return { ...page, cursor: input.page ? cursor + 1 : cursor };
  };
  const store = createStore(host, { initialPanel: "graph" });
  await store.refresh();
  expect(host.calls.snapshot).toHaveLength(2);
  const held = store.getState().reply?.graph;
  await store.refresh();
  expect(host.calls.snapshot).toHaveLength(3);
  expect(host.calls.snapshot[2]).toMatchObject({ panel: "graph", after: 101 });
  expect(store.getState().reply?.graph).toBe(held);
  const stop = store.start();
  host.push({ ...old.pages[0]!, cursor: 101 });
  await Bun.sleep(0);
  expect(host.calls.snapshot).toHaveLength(3);
  expect(store.getState().reply?.graph).toBe(held);
  current = updated; cursor = 201;
  await store.refresh();
  expect(host.calls.snapshot).toHaveLength(5);
  expect((store.getState().reply?.graph as GraphInput).nodes.map((node) => node.id)).toContain("other");
  stop();
});
