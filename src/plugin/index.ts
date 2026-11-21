/**
 * The `acon` plugin for the vmem tool: `@staix/vault-mem/ui-plugin` still answers every `snapshot` and `action`
 * (so writes keep vmem's validation, receipts and two-step confirmation), and this package's bundle becomes the
 * panel. Wrapping rather than copying keeps one provider behind both hosts.
 */

import type { ActionMeta, ConsoleContext, ConsolePlugin, ConsoleProvider } from "@staix/agent-console/contract";
import { plugin as vaultPlugin } from "@staix/vault-mem/ui-plugin";
import { panelAssets } from "./assets.ts";

export const plugin: ConsolePlugin = {
  manifest: vaultPlugin.manifest,
  async open(ctx: ConsoleContext): Promise<ConsoleProvider> {
    const provider = await vaultPlugin.open(ctx);
    // Every member is forwarded through a call, so a member the provider binds to its own instance keeps working.
    const wrapped: ConsoleProvider = {
      assets: panelAssets(),
      snapshot: (input) => provider.snapshot(input),
      action: (input, meta?: ActionMeta) => provider.action(input, meta),
    };
    if (provider.principalSnapshot) wrapped.principalSnapshot = (input) => provider.principalSnapshot!(input);
    if (provider.principalAction) wrapped.principalAction = (input, meta) => provider.principalAction!(input, meta);
    if (provider.asset) wrapped.asset = (input) => provider.asset!(input);
    if (provider.close) wrapped.close = () => provider.close!();
    return wrapped;
  },
};

export default plugin;
