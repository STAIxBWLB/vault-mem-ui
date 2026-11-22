/**
 * The link write through the client store: the provider's preview and its fingerprint, nothing sent until Confirm, and
 * a graph reloaded from its first page afterwards. The host here answers `changed: false` for the cursor the panel
 * holds, which is what a provider that kept its page cache would say; only a first-page request can show the new link.
 */

import { expect, test } from "bun:test";
import { createFakeHost } from "../../src/client/fake.ts";
import { createStore } from "../../src/client/store.ts";
import { linkAction } from "../../src/client/write.ts";
import type { ActionResult, SnapshotReply } from "../../src/client/host.ts";
import type { GraphInput } from "../../src/graph/types.ts";

const totals = { nodes: 2, edges: 1, placeholders: 0, placeholdersOmitted: 0 };
const graphMeta = { directed: false, multigraph: false, partitioner: "leiden", resolution: 1, modularity: 0, iterations: 1, max_iterations: 32 };

/** Two synthetic notes and, once `linked`, the typed link between them the way the provider pages it. */
function pages(linked: boolean, cursor: number) {
  const revision = linked ? "linked" : "unlinked";
  const nodes = {
    schema: 1, vault: "test", revision, graph: graphMeta, totals: { ...totals, edges: linked ? 1 : 0 }, kind: "nodes", offset: 0, count: 2,
    columns: {
      id: ["alpha", "beta"], label: ["Alpha", "Beta"], type: ["insight", "insight"], domain: ["research", "research"],
      source_file: ["notes/alpha.md", "notes/beta.md"], community: [1, 1], degree: [linked ? 1 : 0, linked ? 1 : 0],
      updated: [null, null], date: [null, null], placeholder: [false, false], description: [null, null], confidence: [null, null], topics: [null, null],
    },
    next: "edge-page", cursor,
  };
  const edges = {
    schema: 1, vault: "test", revision, graph: graphMeta, totals: { ...totals, edges: linked ? 1 : 0 }, kind: "edges", offset: 0, count: linked ? 1 : 0,
    columns: linked
      ? { source: [0], target: [1], relations: ["supports"], relation: [0], field: [null], rel: ["supports"], confidence_tag: "EXTRACTED", confidence: 1 }
      : { source: [], target: [], relations: [], relation: [], field: [], rel: [], confidence_tag: [], confidence: [] },
    next: null, cursor: cursor + 1,
  };
  return { nodes, edges };
}

test("a link is previewed, confirmed, and then the graph is read from its first page again", async () => {
  let linked = false;
  let cursor = 10;
  const host = createFakeHost();
  host.snapshot = async (input) => {
    host.calls.snapshot.push(input);
    const page = pages(linked, cursor);
    if (input.page) return page.edges;
    // A provider that kept its page cache answers the cursor the panel already holds with "nothing changed".
    if (input.after === cursor) return { changed: false, cursor };
    return page.nodes;
  };
  const answers: ActionResult[] = [
    { ok: false, needsConfirm: true, fingerprint: "sha256:link", verb: "Link notes", changes: [{ op: "modify", target: "notes/alpha.md" }], warnings: [],
      preview: ["link notes/alpha.md → notes/beta.md (supports), both directions", 'log: {"type":"CONNECT","project":"-","source":"notes/alpha.md","dest":"notes/beta.md","note":"link"}'] },
    { ok: true, message: "Link notes: done" },
  ];
  host.action = async (input) => {
    host.calls.action.push(input);
    return answers.shift() ?? { ok: true };
  };

  const store = createStore(host, { initialPanel: "graph" });
  await store.refresh();
  expect(host.calls.snapshot).toHaveLength(2);
  expect((store.getState().reply?.graph as GraphInput).edges).toEqual([]);
  // The cursor path is what the panel holds between polls.
  await store.refresh();
  expect(host.calls.snapshot.at(-1)).toMatchObject({ panel: "graph", after: 10 });
  expect(host.calls.snapshot).toHaveLength(3);

  await store.beginWrite(linkAction({ from: "notes/alpha.md", to: "notes/beta.md", relation: "supports", bidirectional: true, vault: "test" }));
  expect(store.getState().write).toMatchObject({ phase: "preview", fingerprint: "sha256:link", verb: "Link notes" });
  expect(host.calls.action).toEqual([{ action: "link", from: "notes/alpha.md", to: "notes/beta.md", relation: "supports", bidirectional: true, vault: "test" }]);

  linked = true;
  cursor = 20;
  await store.confirmWriteNow();
  expect(host.calls.action.at(-1)).toEqual({ action: "link", from: "notes/alpha.md", to: "notes/beta.md", relation: "supports", bidirectional: true, vault: "test", confirmed: true, fingerprint: "sha256:link" });
  expect(store.getState().write).toEqual({ phase: "done", message: "Link notes: done" });
  await Bun.sleep(0);

  const reload = host.calls.snapshot.at(-2)!;
  expect(reload).toMatchObject({ panel: "graph" });
  expect(reload.after).toBeUndefined();
  expect(host.calls.snapshot.at(-1)).toMatchObject({ panel: "graph", page: "edge-page" });
  expect((store.getState().reply?.graph as GraphInput).edges).toEqual([{ source: "alpha", target: "beta", relation: "supports", fromFrontmatter: true }]);

  // With the write finished, the panel is back on the cursor path for the next poll.
  await store.refresh();
  expect(host.calls.snapshot.at(-1)).toMatchObject({ after: 20 });
});

test("a host that owns the confirmation also reloads the graph from its first page", async () => {
  // `acon` runs the preview and the confirm itself: one call answers the outcome, so beginWrite is where the graph
  // becomes stale.
  let linked = false;
  const host = createFakeHost({ replies: { link: { ok: true, message: "Link notes: done" } } });
  host.confirm = "host";
  host.snapshot = async (input) => {
    host.calls.snapshot.push(input);
    const page = pages(linked, 10);
    if (input.page) return page.edges;
    if (input.after === 10) return { changed: false, cursor: 10 };
    return page.nodes;
  };
  const store = createStore(host, { initialPanel: "graph" });
  await store.refresh();
  await store.refresh();
  expect(host.calls.snapshot).toHaveLength(3);

  linked = true;
  await store.beginWrite(linkAction({ from: "notes/alpha.md", to: "notes/beta.md", relation: "supports", bidirectional: true }));
  expect(store.getState().write).toEqual({ phase: "idle" });
  await Bun.sleep(0);
  expect(host.calls.snapshot.at(-2)!.after).toBeUndefined();
  expect((store.getState().reply?.graph as GraphInput).edges).toHaveLength(1);
});

test("a cursor stub that supersedes the post-write read keeps the demand for the first page", async () => {
  // Near-acon: the write is done, its first-page read is in flight, and a poll's `changed: false` stub arrives as the
  // newest answer. The stub carries no graph, so the next refresh still has to read the graph from its first page.
  let linked = false;
  let hold = false;
  let release: ((page: SnapshotReply) => void) | null = null;
  const host = createFakeHost();
  host.snapshot = async (input) => {
    host.calls.snapshot.push(input);
    const page = pages(linked, 10);
    if (input.page) return page.edges;
    if (input.after !== undefined) return { changed: false, cursor: 10 };
    if (hold) { hold = false; return new Promise((resolve) => { release = resolve; }); }
    return page.nodes;
  };
  host.action = async (input) => {
    host.calls.action.push(input);
    return input.confirmed ? { ok: true, message: "Link notes: done" } : { ok: false, needsConfirm: true, fingerprint: "sha256:link", verb: "Link notes", preview: ["link notes/alpha.md → notes/beta.md (supports), both directions"], changes: [], warnings: [] };
  };
  const store = createStore(host, { initialPanel: "graph" });
  const stop = store.start();
  await store.refresh();
  await store.beginWrite(linkAction({ from: "notes/alpha.md", to: "notes/beta.md", relation: "supports", bidirectional: true }));

  linked = true;
  hold = true;
  const confirming = store.confirmWriteNow();
  await Bun.sleep(0);
  expect(release).not.toBeNull();
  // The stub is accepted while the first-page read is still in flight, so that read's assembly is dropped.
  host.push({ changed: false, cursor: 10 });
  await Bun.sleep(0);
  release!(pages(true, 10).nodes);
  await confirming;
  await Bun.sleep(0);
  expect(store.getState().reply?.graph).toBeDefined();

  const before = host.calls.snapshot.length;
  await store.refresh();
  // The refresh's own first request, not a page the dropped assembly still fetched on its way out.
  const request = host.calls.snapshot[before]!;
  expect(request).toMatchObject({ panel: "graph" });
  expect(request.after).toBeUndefined();
  expect((store.getState().reply?.graph as GraphInput).edges).toHaveLength(1);
  stop();
});

test("a cancelled preview sends nothing and keeps the graph as it was", async () => {
  const host = createFakeHost({ replies: { link: { ok: false, needsConfirm: true, fingerprint: "sha256:link", verb: "Link notes", preview: ["link notes/alpha.md → notes/beta.md (supports), both directions"], changes: [], warnings: [] } } });
  host.snapshot = async (input) => {
    host.calls.snapshot.push(input);
    const page = pages(false, 10);
    return input.page ? page.edges : page.nodes;
  };
  const store = createStore(host, { initialPanel: "graph" });
  await store.refresh();
  const calls = host.calls.snapshot.length;
  await store.beginWrite(linkAction({ from: "notes/alpha.md", to: "notes/beta.md", relation: "supports", bidirectional: true }));
  store.setWrite({ phase: "idle" });
  await store.confirmWriteNow();
  expect(host.calls.action).toHaveLength(1);
  expect(host.calls.snapshot).toHaveLength(calls);
});
