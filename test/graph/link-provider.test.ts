/**
 * Link authoring against the real `@staix/vault-mem` provider on a throwaway synthetic vault under a temp home: the
 * preview names both notes, the relation and the log event and writes nothing; confirming with its fingerprint writes;
 * the graph the panel assembles then carries the new edge from its first page; and repeating the same link is a no-op.
 * Synthetic notes only, and the temp tree is removed afterwards.
 */

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVaultMcp } from "@staix/vault-mem";
import { plugin as providerPlugin } from "@staix/vault-mem/ui-plugin";
import type { ActionResult } from "../../src/client/host.ts";
import { LINK_RELATIONS, linkAction } from "../../src/client/write.ts";
import { assembleGraphPages } from "../../src/graph/view/graph-snapshot.ts";
import type { GraphInput } from "../../src/graph/types.ts";

let root: string, home: string, provider: Awaited<ReturnType<typeof providerPlugin.open>>;
const oldHome = process.env.VMEM_HOME;
const oldMemory = process.env.AMEM_HOME;
const notes = ["alpha", "beta", "gamma"];

beforeAll(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "vmem-link-authoring-")));
  home = join(root, "home");
  const vault = join(root, "vault");
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
});

afterAll(async () => {
  await provider?.close?.();
  if (oldHome === undefined) delete process.env.VMEM_HOME;
  else process.env.VMEM_HOME = oldHome;
  if (oldMemory === undefined) delete process.env.AMEM_HOME;
  else process.env.AMEM_HOME = oldMemory;
  if (root) rmSync(root, { recursive: true, force: true });
});

const body = (stem: string) => readFileSync(join(root, "vault", "notes", `${stem}.md`), "utf8");
const preview = (input: Parameters<typeof provider.action>[0]) => provider.action(input);
type Preview = ActionResult & { needsConfirm: true; fingerprint: string; preview: string[]; changes: { op: string; target: string; note?: string }[] };
const isPreview = (reply: ActionResult): reply is Preview => "needsConfirm" in reply && reply.needsConfirm === true && typeof reply.fingerprint === "string";

test("the preview names both notes, the relation and the log event, and writes nothing", async () => {
  const before = body("alpha");
  const reply = await preview(linkAction({ from: "notes/alpha.md", to: "notes/beta.md", relation: "supports", bidirectional: true, vault: "test" }));
  if (!isPreview(reply)) throw new Error(`Not a preview: ${JSON.stringify(reply)}`);
  expect(reply.verb).toBe("Link notes");
  expect(reply.preview?.[0]).toBe("link notes/alpha.md → notes/beta.md (supports), both directions");
  // The provider's own default log event for a link, which the confirmed write appends.
  expect(reply.preview?.join("\n")).toContain('"type":"CONNECT"');
  expect(reply.preview?.join("\n")).toContain('"dest":"notes/beta.md"');
  expect(reply.changes?.map((change) => change.target)).toEqual(["notes/alpha.md", "notes/beta.md"]);
  expect(body("alpha")).toBe(before);
  expect(body("beta")).not.toContain("[[alpha]]");
});

test("confirming with the fingerprint writes, and the panel's graph shows the edge from its first page", async () => {
  const reply = await preview(linkAction({ from: "notes/alpha.md", to: "notes/beta.md", relation: "supports", bidirectional: true, vault: "test" }));
  if (!isPreview(reply)) throw new Error(`Not a preview: ${JSON.stringify(reply)}`);
  const done = await provider.action({ ...linkAction({ from: "notes/alpha.md", to: "notes/beta.md", relation: "supports", bidirectional: true, vault: "test" }), confirmed: true, fingerprint: reply.fingerprint });
  expect(done).toMatchObject({ ok: true, message: "Link notes: done" });
  expect(body("alpha")).toContain("[[beta]] (supports)");
  // Bidirectional by default, so the other note records it too.
  expect(body("beta")).toContain("[[alpha]]");

  const assembled = await assembleGraphPages((input) => provider.snapshot({ after: 0, ...input }), await provider.snapshot({ after: 0, panel: "graph", vault: "test" }), { vault: "test" });
  const graph = assembled.graph as GraphInput;
  const edge = graph.edges.find((item) => item.source === "alpha" && item.target === "beta");
  expect(edge).toMatchObject({ relation: "supports" });
  // Both notes carry the link, but the provider reports the pair once, so the panel draws one edge.
  expect(graph.edges.filter((item) => (item.source === "alpha" && item.target === "beta") || (item.source === "beta" && item.target === "alpha"))).toHaveLength(1);
});

test("linking the same pair again is a no-op the panel reports as done", async () => {
  const reply = await preview(linkAction({ from: "notes/alpha.md", to: "notes/beta.md", relation: "supports", bidirectional: true, vault: "test" }));
  expect(reply).toEqual({ ok: true, message: "Link notes: already done, nothing changed" });
});

test("a one-way link writes only the source note", async () => {
  const reply = await preview(linkAction({ from: "notes/alpha.md", to: "notes/gamma.md", relation: "contradicts", bidirectional: false, vault: "test" }));
  if (!isPreview(reply)) throw new Error(`Not a preview: ${JSON.stringify(reply)}`);
  expect(reply.preview?.[0]).toBe("link notes/alpha.md → notes/gamma.md (contradicts), one way");
  const done = await provider.action({ ...linkAction({ from: "notes/alpha.md", to: "notes/gamma.md", relation: "contradicts", bidirectional: false, vault: "test" }), confirmed: true, fingerprint: reply.fingerprint });
  expect(done).toMatchObject({ ok: true });
  expect(body("alpha")).toContain("[[gamma]] (contradicts)");
  expect(body("gamma")).not.toContain("[[alpha]]");
  const assembled = await assembleGraphPages((input) => provider.snapshot({ after: 0, ...input }), await provider.snapshot({ after: 0, panel: "graph", vault: "test" }), { vault: "test" });
  const graph = assembled.graph as GraphInput;
  expect(graph.edges.some((item) => item.source === "alpha" && item.target === "gamma")).toBe(true);
  expect(graph.edges.some((item) => item.source === "gamma" && item.target === "alpha")).toBe(false);
});

test("an unknown relation is refused with the relations the provider accepts", async () => {
  // An identifier no relation list contains, so the refusal comes from the provider's own check.
  const refused = await provider.action(linkAction({ from: "notes/alpha.md", to: "notes/beta.md", relation: "supports-strictly" as never, bidirectional: true, vault: "test" })) as ActionResult;
  expect(refused).toEqual({ ok: false, error: `link: invalid relation supports-strictly; use one of ${LINK_RELATIONS.join(", ")}` });
  // A missing target is named too, rather than sent on with an empty path.
  expect(await provider.action({ action: "link", from: "notes/alpha.md", relation: "supports", vault: "test" }))
    .toEqual({ ok: false, error: "link: from, to and relation are required; pick both notes and a relation" });
});
