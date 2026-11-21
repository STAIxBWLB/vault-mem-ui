/**
 * Bundle entry. `acon` imports this file as its panel module and calls the default export with its host;
 * the standalone shell imports `mountClient` and supplies its own host over the M1-b HTTP endpoints.
 */

import { createRoot } from "react-dom/client";
import { createAconHost } from "./acon.ts";
import { createStandaloneHost } from "./standalone.ts";
import { App, createClient } from "./App.tsx";
import type { Host } from "./host.ts";

export type { ActionResult, ActionInput, Host, SnapshotReply, Theme } from "./host.ts";
export { createClient } from "./App.tsx";
export { createStore } from "./store.ts";
export { DEFAULT_PREFS, readPrefs, writePrefs, type Prefs } from "./prefs.ts";
export { createAconHost } from "./acon.ts";

export interface ClientHandle {
  show(panel: string, params?: Record<string, string>): void;
  hide(): void;
  destroy(): void;
}

/** Mount the client into `host.mount` and return the handle the host drives. */
export function mountClient(host: Host, options: { initialPanel?: string; autoLoad?: boolean } = {}): ClientHandle {
  const store = createClient(host, { initialPanel: options.initialPanel });
  const element = document.createElement("div");
  element.className = "vmem-root";
  host.mount.append(element);
  const root = createRoot(element);
  root.render(<App store={store} />);
  const stop = store.start();
  if (options.autoLoad !== false) void store.refresh();
  return {
    show(panel, params = {}) {
      store.show(panel, params);
    },
    hide() {
      // The shell hides by detaching the mount element; state survives so coming back does not refetch blindly.
    },
    destroy() {
      stop();
      root.unmount();
      element.remove();
    },
  };
}

/** `acon` panel factory: the console's host is adapted, the client itself is host-agnostic. */
export default function panel(panelHost: Parameters<typeof createAconHost>[0]): ClientHandle {
  return mountClient(createAconHost(panelHost));
}

// The standalone page owns this root; acon's shell does not create it.
if (typeof document !== "undefined") {
  const standaloneRoot = document.getElementById("vmem-ui-root");
  if (standaloneRoot) mountClient(createStandaloneHost(standaloneRoot));
}
