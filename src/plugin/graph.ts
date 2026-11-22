/**
 * The graph panel on top of a vmem provider that may not have one yet. The manifest gains a declared `graph` panel
 * so both hosts route it (acon refuses undeclared panels; the standalone host checks the manifest). A `graph`
 * snapshot goes to the provider first, so a provider that implements vault-mem #266 answers it itself; until then
 * its "unknown panel" reply becomes `{ graph: null, unavailable }` and the panel says why. This is not #266's wire
 * format and makes no claim about it.
 */

import type { ConsolePanelManifest, ConsoleProvider } from "@staix/agent-console/contract";
import { isPanelId } from "../client/prefs.ts";

export const GRAPH_PANEL = { id: "graph", title: "Graph", order: 6.5 } as const;

export const GRAPH_UNAVAILABLE =
  "this vmem provider does not send a graph snapshot yet (vault-mem #266); update @staix/vault-mem, then reload this panel";

/** The manifest with a `graph` panel, unless the provider already declares one. */
export function withGraphPanel(manifest: ConsolePanelManifest): ConsolePanelManifest {
  if (manifest.panels.some((p) => p.id === GRAPH_PANEL.id)) return manifest;
  return { ...manifest, panels: [...manifest.panels, { ...GRAPH_PANEL }] };
}

/** Declare only panels rendered by this bundle in either host. */
export function implementedPanelManifest(manifest: ConsolePanelManifest): ConsolePanelManifest {
  return withGraphPanel({ ...manifest, panels: manifest.panels.filter((panel) => isPanelId(panel.id)) });
}

function isUnknownGraphPanel(reply: Record<string, unknown>): boolean {
  return typeof reply.error === "string" && /unknown panel/i.test(reply.error) && !("graph" in reply);
}

/** Snapshot that answers `graph` with an explicit unavailable reply when the provider does not know the panel.
 *
 *  A graph reply also carries the provider's declared `capabilities.actions`, because neither host hands the manifest
 *  to the panel (`ConsoleHost` has no such member) and the graph's link control may only appear when the provider
 *  declares `link`. `actions` is the same list the manifest declares: the provider's own action vocabulary.
 *
 *  Two replies are left exactly as the provider sent them. A `changed: false` cursor stub must keep only its own keys,
 *  because acon's shell counts an unchanged poll by them (`shell/shell.js` `pollPanel`); with a third key it would push
 *  the stub as new data and cache it, replacing the panel's graph. A continuation page needs no declaration either:
 *  the assembler reads it from the first page, which is not a `page` request. */
export function graphAwareSnapshot(snapshot: ConsoleProvider["snapshot"], actions: readonly string[] = []): ConsoleProvider["snapshot"] {
  const capabilities = { actions: [...actions] };
  return async (input) => {
    if (input.panel !== GRAPH_PANEL.id) return snapshot(input);
    let reply: Record<string, unknown>;
    try {
      reply = await snapshot(input);
    } catch (error) {
      if (error instanceof Error && /unknown panel/i.test(error.message)) return { graph: null, unavailable: GRAPH_UNAVAILABLE, capabilities };
      throw error;
    }
    if (isUnknownGraphPanel(reply)) return { graph: null, unavailable: GRAPH_UNAVAILABLE, capabilities };
    if (input.page !== undefined || reply.changed === false) return reply;
    return { ...reply, capabilities };
  };
}

/** The provider with the graph-aware snapshot; every other member is forwarded through a call so bound methods keep working. */
export function graphProvider(provider: ConsoleProvider, actions: readonly string[] = []): ConsoleProvider {
  const wrapped: ConsoleProvider = {
    assets: provider.assets,
    snapshot: graphAwareSnapshot((input) => provider.snapshot(input), actions),
    action: (input, meta) => provider.action(input, meta),
  };
  if (provider.principalSnapshot) wrapped.principalSnapshot = (input) => provider.principalSnapshot!(input);
  if (provider.principalAction) wrapped.principalAction = (input, meta) => provider.principalAction!(input, meta);
  if (provider.asset) wrapped.asset = (input) => provider.asset!(input);
  if (provider.close) wrapped.close = () => provider.close!();
  return wrapped;
}
