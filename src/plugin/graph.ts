/**
 * The graph panel on top of a vmem provider that may not have one yet. The manifest gains a declared `graph` panel
 * so both hosts route it (acon refuses undeclared panels; the standalone host checks the manifest). A `graph`
 * snapshot goes to the provider first, so a provider that implements vault-mem #266 answers it itself; until then
 * its "unknown panel" reply becomes `{ graph: null, unavailable }` and the panel says why. This is not #266's wire
 * format and makes no claim about it.
 */

import type { ConsolePanelManifest, ConsoleProvider } from "@staix/agent-console/contract";

export const GRAPH_PANEL = { id: "graph", title: "Graph", order: 7 } as const;

export const GRAPH_UNAVAILABLE =
  "this vmem provider does not send a graph snapshot yet (vault-mem #266); update @staix/vault-mem, then reload this panel";

/** The manifest with a `graph` panel, unless the provider already declares one. */
export function withGraphPanel(manifest: ConsolePanelManifest): ConsolePanelManifest {
  if (manifest.panels.some((p) => p.id === GRAPH_PANEL.id)) return manifest;
  return { ...manifest, panels: [...manifest.panels, { ...GRAPH_PANEL }] };
}

function isUnknownGraphPanel(reply: Record<string, unknown>): boolean {
  return typeof reply.error === "string" && /unknown panel/i.test(reply.error) && !("graph" in reply);
}

/** Snapshot that answers `graph` with an explicit unavailable reply when the provider does not know the panel. */
export function graphAwareSnapshot(snapshot: ConsoleProvider["snapshot"]): ConsoleProvider["snapshot"] {
  return async (input) => {
    if (input.panel !== GRAPH_PANEL.id) return snapshot(input);
    let reply: Record<string, unknown>;
    try {
      reply = await snapshot(input);
    } catch (error) {
      if (error instanceof Error && /unknown panel/i.test(error.message)) return { graph: null, unavailable: GRAPH_UNAVAILABLE };
      throw error;
    }
    return isUnknownGraphPanel(reply) ? { graph: null, unavailable: GRAPH_UNAVAILABLE } : reply;
  };
}

/** The provider with the graph-aware snapshot; every other member is forwarded through a call so bound methods keep working. */
export function graphProvider(provider: ConsoleProvider): ConsoleProvider {
  const wrapped: ConsoleProvider = {
    assets: provider.assets,
    snapshot: graphAwareSnapshot((input) => provider.snapshot(input)),
    action: (input, meta) => provider.action(input, meta),
  };
  if (provider.principalSnapshot) wrapped.principalSnapshot = (input) => provider.principalSnapshot!(input);
  if (provider.principalAction) wrapped.principalAction = (input, meta) => provider.principalAction!(input, meta);
  if (provider.asset) wrapped.asset = (input) => provider.asset!(input);
  if (provider.close) wrapped.close = () => provider.close!();
  return wrapped;
}
