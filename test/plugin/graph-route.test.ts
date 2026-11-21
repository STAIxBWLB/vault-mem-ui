/**
 * The graph panel is routed by both hosts: the plugin manifest declares it (acon's own `declaresPanel` and
 * `manifestProblems` accept it), the wrapped provider answers it as unavailable instead of an error, and the
 * standalone host serves `/api/snapshot {panel: "graph"}` from the real command wiring.
 */

import { afterEach, expect, test } from "bun:test";
import type { ConsolePanelManifest, ConsoleProvider } from "@staix/agent-console/contract";
// acon's own routing checks; not a public export, imported by file so the test runs the console's real rule.
import { declaresPanel, manifestProblems, providerProblems } from "../../node_modules/@staix/agent-console/src/plugins.ts";
import { GRAPH_UNAVAILABLE, graphAwareSnapshot, graphProvider, withGraphPanel } from "../../src/plugin/graph.ts";
import { plugin } from "../../src/plugin/index.ts";
import { run } from "../../src/server/cli.ts";
import type { Host } from "../../src/server/host.ts";

test("the plugin manifest declares graph, and acon's router accepts it", () => {
  expect(plugin.manifest.panels.map((p) => p.id)).toContain("graph");
  expect(declaresPanel(plugin.manifest, "graph")).toBe(true);
  expect(manifestProblems(plugin.manifest, "vmem")).toEqual([]);
});

test("a provider that already declares graph keeps its own manifest", () => {
  const m: ConsolePanelManifest = { api: 1, tool: "vmem", version: "x", title: "V", panels: [{ id: "graph", title: "Mine" }] };
  expect(withGraphPanel(m)).toBe(m);
});

test("graph snapshots become an unavailable reply only when the provider does not know the panel", async () => {
  const seen: unknown[] = [];
  const unknown = graphAwareSnapshot(async (input) => { seen.push(input.panel); return { error: `unknown panel ${input.panel}` }; });
  expect(await unknown({ panel: "graph", after: 0 })).toEqual({ graph: null, unavailable: GRAPH_UNAVAILABLE });
  expect(await unknown({ panel: "overview", after: 0 })).toEqual({ error: "unknown panel overview" });
  const throwing = graphAwareSnapshot(async () => { throw new Error("unknown panel graph"); });
  expect(await throwing({ panel: "graph", after: 0 })).toEqual({ graph: null, unavailable: GRAPH_UNAVAILABLE });
  const real = graphAwareSnapshot(async () => ({ graph: { nodes: [], edges: [] } }));
  expect(await real({ panel: "graph", after: 0 })).toEqual({ graph: { nodes: [], edges: [] } });
  const failing = graphAwareSnapshot(async () => { throw new Error("disk gone"); });
  await expect(failing({ panel: "graph", after: 0 })).rejects.toThrow("disk gone");
  expect(seen).toEqual(["graph", "overview"]);
});

test("graphProvider forwards every member and stays a valid acon provider", async () => {
  const calls: string[] = [];
  const base: ConsoleProvider = {
    assets: { js: "x" },
    snapshot: async () => ({ error: "unknown panel graph" }),
    action: async () => { calls.push("action"); return { ok: true }; },
    close: async () => { calls.push("close"); },
  };
  const wrapped = graphProvider(base);
  expect(providerProblems(wrapped, plugin.manifest)).toEqual([]);
  await wrapped.action({ action: "delete" });
  await wrapped.close!();
  expect(calls).toEqual(["action", "close"]);
  expect(await wrapped.snapshot({ panel: "graph", after: 0 })).toMatchObject({ graph: null });
});

const hosts: Host[] = [];
afterEach(async () => { await Promise.all(hosts.splice(0).map((h) => h.stop())); });

test("the standalone command routes graph to the unavailable reply", async () => {
  const host = await run({
    assets: { js: "export default () => ({});\n", css: "" }, argv: [], env: {}, out: () => {}, err: () => {}, exit: () => {},
    open: async () => ({ assets: { js: "" }, snapshot: async (input) => ({ error: `unknown panel ${input.panel}` }), action: async () => ({ ok: true }) }),
  });
  expect(host).not.toBeNull();
  hosts.push(host!);
  const signedIn = await fetch(host!.issue(), { redirect: "manual" });
  const cookie = signedIn.headers.get("set-cookie")!.split(";")[0]!;
  const manifest = await (await fetch(host!.origin + "/api/manifest", { headers: { cookie } })).json() as { panels: { id: string }[] };
  expect(manifest.panels.map((p) => p.id)).toContain("graph");
  const res = await fetch(host!.origin + "/api/snapshot", {
    method: "POST", headers: { cookie, origin: host!.origin, "content-type": "application/json" }, body: JSON.stringify({ panel: "graph" }),
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ graph: null, unavailable: GRAPH_UNAVAILABLE });
});
