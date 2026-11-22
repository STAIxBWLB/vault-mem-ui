/**
 * The `acon` plugin for the vmem tool: `@staix/vault-mem/ui-plugin` still answers every `snapshot` and `action`
 * (so writes keep vmem's validation, receipts and two-step confirmation), and this package's bundle becomes the
 * panel. Wrapping rather than copying keeps one provider behind both hosts. The manifest also declares the graph
 * panel, answered as unavailable until the provider has a graph snapshot (see ./graph.ts).
 */

import type { ConsoleContext, ConsolePlugin, ConsoleProvider } from "@staix/agent-console/contract";
import { plugin as vaultPlugin } from "@staix/vault-mem/ui-plugin";
import { isPanelId } from "../client/prefs.ts";
import { panelAssets } from "./assets.ts";
import { graphProvider, withGraphPanel } from "./graph.ts";

export const plugin: ConsolePlugin = {
  manifest: withGraphPanel({
    ...vaultPlugin.manifest,
    panels: vaultPlugin.manifest.panels.filter((panel) => isPanelId(panel.id)),
  }),
  async open(ctx: ConsoleContext): Promise<ConsoleProvider> {
    const provider = await vaultPlugin.open(ctx);
    // Every member is forwarded through a call, so a member the provider binds to its own instance keeps working.
    return { ...graphProvider(provider), assets: panelAssets() };
  },
};

export default plugin;
