/**
 * The `acon` conformance kit for this package's plugin. The kit opens the plugin, snapshots every panel, sends an
 * unknown action, checks the confirmation round trip of the destructive actions, and reads `assets` as the console
 * would — so it is the gate for "the panel is one module and one stylesheet, and the provider still asks first".
 *
 * vmem resolves its own home from the environment, not from the `home` the kit passes in the context, so the whole
 * suite runs against throwaway vmem and agent-mem homes: no real vault is read, and the promotion panel has nothing
 * slow to scan. The build must have run first (`bun run check` builds before testing), because the plugin reads
 * `dist/`.
 */

import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerConsoleConformance } from "@staix/agent-console/conformance";
import { createVaultMcp } from "@staix/vault-mem";
import { plugin } from "../src/plugin/index.ts";

// vmem refuses an input directory reached through a symlink, and `mkdtempSync` on macOS answers one
// (`/var` is `/private/var`), so the seed is written under the resolved path.
const root = realpathSync(mkdtempSync(join(tmpdir(), "vmem-ui-conformance-")));
const home = join(root, "vmem");
const memory = join(root, "memory");
const vault = join(root, "vault");
mkdirSync(join(vault, "notes"), { recursive: true });
mkdirSync(home, { recursive: true });
mkdirSync(memory, { recursive: true });
writeFileSync(
  join(home, "vmem.config.json"),
  `${JSON.stringify({ vaults: [{ id: "test", path: vault, kind: "personal", write: "mcp" }] }, null, 2)}\n`,
);
// Create notes through the installed provider's validated public write API.
const writer = createVaultMcp(home);
for (const args of [
  { stem: "index", type: "moc", domain: "research", title: "Index", description: "Synthetic map for conformance" },
  { stem: "a", type: "insight", domain: "research", title: "Alpha", description: "Synthetic note for conformance", topics: ["index"], body: "Synthetic content.\n\n## Topics\n\n- [[index]]" },
]) {
  const receipt = await writer.handlers.vmem_create!(args) as { applied?: boolean; issues?: unknown };
  if (!receipt.applied) throw new Error(`Could not create synthetic fixture through vmem: ${JSON.stringify(receipt.issues)}`);
}
process.env.VMEM_HOME = home;
process.env.AMEM_HOME = memory;

registerConsoleConformance(plugin, {
  home,
  // Both previews read a note that exists, so the kit sees the real fingerprint and planned changes the
  // client renders, and neither preview writes anything.
  destructive: [
    { action: "delete", path: "notes/a.md" },
    { action: "move", from: "notes/a.md", to: "beta" },
    { action: "settings", vault: "test", changes: { write: "none" } },
  ],
});
