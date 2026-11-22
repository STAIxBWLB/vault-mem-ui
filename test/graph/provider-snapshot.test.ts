import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVaultMcp } from "@staix/vault-mem";
import { plugin as providerPlugin } from "@staix/vault-mem/ui-plugin";
import type { GraphPanelPage } from "@staix/vault-mem/ui-plugin";
import { assembleGraphPages } from "../../src/graph/view/graph-snapshot.ts";
import { buildGraphModel } from "../../src/graph/model.ts";
import { createGraphViewStore } from "../../src/graph/view/state.ts";
import { buildDecisionChains } from "../../src/graph/decisionChains.ts";
import { implementedPanelManifest, graphAwareSnapshot } from "../../src/plugin/graph.ts";
import type { GraphInput } from "../../src/graph/types.ts";
import type { Host, SnapshotReply } from "../../src/client/host.ts";
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
    { stem: "alpha", type: "insight", domain: "research", title: "Alpha", description: "Synthetic note", topics: ["index"], body: "- [[beta]] (supports)\n\n## Topics\n\n- [[index]]" },
    { stem: "unused", type: "insight", domain: "research", title: "Unused", description: "Synthetic note", topics: ["index"], body: "Synthetic.\n\n## Topics\n\n- [[index]]" },
    { stem: "infer-source", type: "insight", domain: "research", title: "Infer source", description: "Synthetic note", topics: ["index"], body: "Synthetic.\n\n## Topics\n\n- [[index]]" },
    { stem: "infer-target", type: "insight", domain: "research", title: "Infer target", description: "Synthetic note", topics: ["index"], body: "Synthetic.\n\n## Topics\n\n- [[index]]" },
  ];
  for (const entry of entries) {
    const result = await writer.handlers.vmem_create!(entry) as { applied?: boolean; issues?: unknown };
    if (!result.applied) throw new Error(`Synthetic fixture refused: ${JSON.stringify(result.issues)}`);
  }
  for (const stem of ["z-sup-old", "a-sup-new", "z-by-old", "a-by-new", "z-both-old", "a-both-new"]) {
    const result = await writer.handlers.vmem_create!({ stem, type: "decision", domain: "research", title: stem, description: "Synthetic decision", topics: ["index"], body: "Synthetic.\n\n## Topics\n\n- [[index]]" }) as { applied?: boolean; issues?: unknown };
    if (!result.applied) throw new Error(`Synthetic decision refused: ${JSON.stringify(result.issues)}`);
  }
  for (const [stem, field, target] of [["a-sup-new", "supersedes", "z-sup-old"], ["z-by-old", "superseded_by", "a-by-new"], ["a-both-new", "supersedes", "z-both-old"], ["z-both-old", "superseded_by", "a-both-new"]]) {
    const result = await writer.handlers.vmem_set_frontmatter!({ vault: "test", path: `notes/${stem}.md`, set: { [field!]: `[[${target}]]` } }) as { applied?: boolean; issues?: unknown };
    if (!result.applied) throw new Error(`Synthetic relation refused: ${JSON.stringify(result.issues)}`);
  }
  const source = await writer.handlers.vmem_read!({ vault: "test", path: "notes/infer-source.md" }) as { sha256: string };
  const proposal = await writer.handlers.vmem_proposal_submit!({ vault: "test", operation: { op: "infer-link", path: "notes/infer-source.md", target: "notes/infer-target.md", expectedSha: source.sha256 } }) as { stored?: boolean; id?: string; issues?: unknown };
  if (!proposal.stored || !proposal.id) throw new Error(`Synthetic inferred link proposal refused: ${JSON.stringify(proposal.issues)}`);
  const preview = await writer.handlers.vmem_proposal_apply!({ vault: "test", id: proposal.id }) as { fingerprint?: string; issues?: unknown };
  if (!preview.fingerprint) throw new Error(`Synthetic inferred link preview refused: ${JSON.stringify(preview.issues)}`);
  const applied = await writer.handlers.vmem_proposal_apply!({ vault: "test", id: proposal.id, confirm: true, fingerprint: preview.fingerprint }) as { applied?: boolean; issues?: unknown };
  if (!applied.applied) throw new Error(`Synthetic inferred link refused: ${JSON.stringify(applied.issues)}`);
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
  const nodeColumns = first.columns as { id: string[]; community: (number | null)[] };
  const edgePage = await snapshot({ panel: "graph", vault: "test", page: String(first.next) });
  const edgeColumns = edgePage.columns as { source: number[]; target: number[]; rel: (string | null)[] };
  const edgeIndex = edgeColumns.source.findIndex((source, i) => nodeColumns.id[source] === "alpha" && nodeColumns.id[edgeColumns.target[i]!] === "beta");
  expect(edgeColumns.rel[edgeIndex]).toBe("supports");
  expect(graph.edges).toContainEqual({ source: "alpha", target: "beta", relation: "supports", fromFrontmatter: false, inferred: false });
  const alphaIndex = nodeColumns.id.indexOf("alpha");
  expect(nodeColumns.community[alphaIndex]).not.toBeNull();
  expect(graph.communities?.alpha).toBe(nodeColumns.community[alphaIndex] ?? undefined);
  expect(graph.edges).toContainEqual({ source: "infer-source", target: "infer-target", relation: "wiki_link", fromFrontmatter: false, inferred: true });
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

test("real provider supersedes fields produce equivalent ordered chains without duplicate edges", async () => {
  const first = await snapshot({ panel: "graph", vault: "test" });
  const nodeIds = (first.columns as { id: string[] }).id;
  const edgePage = await snapshot({ panel: "graph", vault: "test", page: String(first.next) });
  const columns = edgePage.columns as { source: number[]; target: number[]; relation: number[]; relations: string[]; field: (string | null)[] };
  const providerEdges = columns.source.map((source, i) => ({ source: nodeIds[source], target: nodeIds[columns.target[i]!], relation: columns.relations[columns.relation[i]!], field: columns.field[i] }));
  expect(providerEdges).toContainEqual({ source: "a-sup-new", target: "z-sup-old", relation: "supersedes", field: "supersedes" });
  expect(providerEdges).toContainEqual({ source: "z-by-old", target: "a-by-new", relation: "supersedes", field: "superseded_by" });
  expect(providerEdges.filter((edge) => edge.relation === "supersedes" && ["a-both-new", "z-both-old"].includes(edge.source!))).toHaveLength(2);
  const assembled = await assembleGraphPages(snapshot, first, { vault: "test" });
  const model = buildGraphModel(assembled.graph as GraphInput);
  const chains = buildDecisionChains(model).chains.map((chain) => chain.nodes.map((node) => node.id));
  for (const kind of ["sup", "by", "both"]) {
    expect(chains).toContainEqual([`z-${kind}-old`, `a-${kind}-new`]);
    const related = model.edges.filter((edge) => edge.relation === "supersedes" && edge.source === `a-${kind}-new` && edge.target === `z-${kind}-old`);
    expect(related).toHaveLength(1);
  }
  const store = createGraphViewStore(model); store.setMode("chains");
  expect(store.getState().derived.visibleModel.edges.filter((edge) => edge.relation === "supersedes")).toHaveLength(3);
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

function fakePages(name = "missing"): (GraphPanelPage & Record<string, unknown>)[] {
  const totals = { nodes: 2, edges: 1, placeholders: 1, placeholdersOmitted: 0 };
  const graph = { directed: false, multigraph: false, partitioner: "leiden", resolution: 1, modularity: 0, iterations: 1, max_iterations: 32 };
  return [
    { schema: 1, vault: "test", revision: name, graph, totals, kind: "nodes", offset: 0, count: 2, columns: { id: ["a", name], label: ["A", name], type: ["insight", null], domain: ["research", null], source_file: ["notes/a.md", null], community: [2, null], degree: [1, 1], updated: [null, null], date: [null, null], placeholder: [false, true], description: [null, null], confidence: [null, null], topics: [null, null] }, next: "edge-page", cursor: 1 },
    { schema: 1, vault: "test", revision: name, graph, totals, kind: "edges", offset: 0, count: 1, columns: { source: [0], target: [1], relations: ["wiki_link"], relation: [0], field: [null], rel: [null], confidence_tag: "EXTRACTED", confidence: 1 }, next: null, cursor: 2 },
  ];
}

test("edge confidence accepts scalar and per-edge tags, and rejects malformed tags", async () => {
  const pages = fakePages();
  const edge = pages[1]!;
  const columns = edge.columns as import("@staix/vault-mem/ui-plugin").GraphEdgeColumns;
  const assemble = (tags: unknown) => assembleGraphPages(async (input) => input.page ? ({ ...edge, columns: { ...columns, confidence_tag: tags } }) : pages[0]!, pages[0]!, {});
  for (const [tag, inferred] of [["EXTRACTED", false], ["INFERRED", true], [["EXTRACTED"], false], [["INFERRED"], true]] as const) {
    expect(((await assemble(tag)).graph as GraphInput).edges[0]!.inferred).toBe(inferred);
  }
  const totals = { ...pages[0]!.totals, edges: 2 };
  const first = { ...pages[0]!, totals };
  const mixed = { ...edge, totals, count: 2, columns: { ...columns, source: [0, 1], target: [1, 0], relation: [0, 0], field: [null, null], rel: [null, null], confidence_tag: ["INFERRED", "EXTRACTED"] } };
  const result = await assembleGraphPages(async () => mixed, first, {});
  expect((result.graph as GraphInput).edges.map((item) => item.inferred)).toEqual([true, false]);
  for (const invalid of ["UNKNOWN", [], ["INFERRED", "EXTRACTED"], ["UNKNOWN"], Array(1), null]) {
    expect((await assemble(invalid)).error).toBe("Graph edge columns are invalid; restart from the first page.");
  }
});

test("provider columnar unresolved placeholders stay non-navigable", async () => {
  const pages = fakePages();
  let i = 0;
  const result = await assembleGraphPages(async () => ({ ...pages[++i]!, cursor: i }), { ...pages[0]!, cursor: 0 }, {});
  expect((result.graph as GraphInput).nodes.find((node) => node.id === "missing")).toMatchObject({ relPath: null });
  expect((result.graph as GraphInput).edges).toContainEqual({ source: "a", target: "missing", relation: "wiki_link", fromFrontmatter: false, inferred: false });
});

test("an assembled reply keeps the first page's declared actions, and invents none", async () => {
  const pages = fakePages();
  const declared = { actions: ["delete", "link"] };
  const withActions = await assembleGraphPages(async (input) => (input.page ? pages[1]! : { ...pages[0]!, cursor: 0, capabilities: declared }), { ...pages[0]!, cursor: 0, capabilities: declared }, {});
  expect(withActions.capabilities).toEqual(declared);
  // The reply is rebuilt from its pages, so a host that declares nothing gets no field rather than an empty one.
  const plain = await assembleGraphPages(async (input) => (input.page ? pages[1]! : pages[0]!), pages[0]!, {});
  expect("capabilities" in plain).toBe(false);
});

test("errors stay verbatim and a second stale page does not retry forever", async () => {
  const error = { error: "graph: no selected vault; select a registered vault" };
  expect(await assembleGraphPages(async () => ({}), error, {})).toEqual(error);
  const pages = fakePages();
  const first = { ...pages[0]!, cursor: 1 };
  let calls = 0;
  const failure = "graph page is invalid or expired; restart from the first page";
  const result = await assembleGraphPages(async (input) => { calls++; return input.page ? { error: failure } : first; }, first, {});
  expect(calls).toBe(3);
  expect(result).toEqual({ error: failure });
});

test("the client store assembles pushed pages without retaining partial results", async () => {
  const pages = fakePages();
  const host = createFakeHost({ snapshots: { graph: () => ({ ...pages[1]!, cursor: 2 }) } });
  const store = createStore(host, { initialPanel: "graph" });
  const stop = store.start();
  host.push({ ...pages[0]!, cursor: 1 });
  await Bun.sleep(0);
  expect((store.getState().reply?.graph as GraphInput).edges).toHaveLength(1);
  host.push({ changed: false, cursor: 1 });
  await Bun.sleep(0);
  expect((store.getState().reply?.graph as GraphInput).nodes).toHaveLength(2);
  stop();
});

test("unchanged polling and pushes reuse the graph; a new revision loads all pages", async () => {
  const old = fakePages("missing"), updated = fakePages("other");
  let current = old, cursor = 101, failNext = false;
  const host = createFakeHost();
  host.snapshot = async (input) => {
    host.calls.snapshot.push(input);
    if (failNext) { failNext = false; throw new Error("offline"); }
    if (!input.page && input.after === cursor) return { changed: false, cursor };
    const page = input.page ? current.find((candidate) => candidate.kind === "edges")! : current[0]!;
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
  cursor = 151;
  await store.refresh();
  expect(host.calls.snapshot).toHaveLength(4);
  expect(store.getState().reply?.graph).toBe(held);
  expect((store.getState().reply?.graphStats as { cursor: number }).cursor).toBe(151);
  await store.refresh();
  expect(host.calls.snapshot.at(-1)).toMatchObject({ after: 151 });
  const stop = store.start();
  const callsBeforePush = host.calls.snapshot.length;
  host.push({ ...old[0]!, cursor: 171 });
  await Bun.sleep(0);
  expect(host.calls.snapshot).toHaveLength(callsBeforePush);
  expect(store.getState().reply?.graph).toBe(held);
  expect((store.getState().reply?.graphStats as { cursor: number }).cursor).toBe(171);
  current = updated; cursor = 201;
  await store.refresh();
  expect(host.calls.snapshot).toHaveLength(callsBeforePush + 2);
  expect((store.getState().reply?.graph as GraphInput).nodes.map((node) => node.id)).toContain("other");
  const newGraph = store.getState().reply?.graph;
  failNext = true; await store.refresh();
  expect(store.getState().phase).toBe("error");
  await store.refresh();
  expect(store.getState().phase).toBe("ready");
  expect(store.getState().error).toBeUndefined();
  expect(store.getState().reply?.graph).toBe(newGraph);
  failNext = true; await store.refresh();
  expect(store.getState().phase).toBe("error");
  host.push({ ...updated[0]!, cursor: 222 });
  await Bun.sleep(0);
  expect(store.getState().phase).toBe("ready");
  expect(store.getState().error).toBeUndefined();
  expect(store.getState().reply?.graph).toBe(newGraph);
  expect((store.getState().reply?.graphStats as { cursor: number }).cursor).toBe(222);
  stop();
});

test("rejects inconsistent revisions, offsets, sizes, totals and repeated cursors", async () => {
  const pages = fakePages();
  const run = async (next: Record<string, unknown>, first = pages[0]!) => assembleGraphPages(async (input) => input.page ? next : first, first, {});
  expect((await run({ ...pages[1], revision: "changed" })).error).toContain("changed or are invalid");
  expect((await run({ ...pages[0], offset: 1 })).error).toContain("out of order");
  expect((await run({ ...pages[1], next: "edge-page" })).error).toContain("cursor is invalid");
  expect((await run({ ...pages[1], count: 0, columns: { source: [], target: [], relation: [], relations: [], field: [], rel: [], confidence_tag: [], confidence: [] }, next: null })).error).toContain("incomplete");
  const oversized = { ...pages[0]!, totals: { ...pages[0]!.totals, nodes: 10001 } };
  const sizeMessage = "Graphs larger than 10,000 notes or 100,000 links are not supported in this panel yet; use Search instead.";
  expect((await assembleGraphPages(async () => ({}), oversized, {})).error).toBe(sizeMessage);
  expect((await assembleGraphPages(async () => ({}), { ...pages[0]!, totals: { ...pages[0]!.totals, edges: 100001 } }, {})).error).toBe(sizeMessage);
  for (const totals of [null, { ...pages[0]!.totals, nodes: -1 }, { ...pages[0]!.totals, nodes: 1.5 }]) {
    expect((await assembleGraphPages(async () => ({}), { ...pages[0], totals }, {})).error).toBe("Graph provider returned malformed totals; update @staix/vault-mem or report its version.");
  }
  for (const revision of [undefined, "", "   ", 42]) {
    expect((await assembleGraphPages(async () => ({}), { ...pages[0], revision }, {})).error).toBe("Graph provider returned a missing or invalid revision; update @staix/vault-mem or report its version.");
  }
});

test("cancellation stops page assembly before processing a delayed page", async () => {
  const pages = fakePages(); let active = true; let release!: (page: SnapshotReply) => void;
  const pending = assembleGraphPages(() => new Promise((resolve) => { release = resolve; }), pages[0]!, {}, () => active);
  active = false; release(pages[1]!);
  expect(await pending).toEqual({ cancelled: true });
});

test("a newer refresh wins over a push whose page is still in flight", async () => {
  const old = fakePages("old"), fresh = fakePages("fresh");
  const host = createFakeHost(); let release!: (page: SnapshotReply) => void;
  host.snapshot = async (input) => {
    if (input.page && input.vault === "test" && !release) return new Promise((resolve) => { release = resolve; });
    return input.page ? fresh[1]! : { ...fresh[0]!, cursor: 10 };
  };
  const store = createStore(host, { initialPanel: "graph" }); const stop = store.start();
  host.push(old[0]!);
  expect(release).toBeDefined();
  await store.refresh();
  expect((store.getState().reply?.graph as GraphInput).nodes.map((node) => node.id)).toContain("fresh");
  release(old[1]!);
  await Bun.sleep(0);
  expect((store.getState().reply?.graph as GraphInput).nodes.map((node) => node.id)).toContain("fresh");
  stop();
});

test("a new push supersedes an older refresh in flight", async () => {
  const old = fakePages("old"), fresh = fakePages("fresh");
  const host = createFakeHost(); let release!: (page: SnapshotReply) => void;
  host.snapshot = async (input) => input.page ? fresh[1]! : new Promise((resolve) => { release = resolve; });
  const store = createStore(host, { initialPanel: "graph" }); const stop = store.start();
  const refresh = store.refresh();
  host.push(fresh[0]!);
  await Bun.sleep(0);
  release(old[0]!);
  await refresh;
  expect((store.getState().reply?.graph as GraphInput).nodes.map((node) => node.id)).toContain("fresh");
  stop();
});
