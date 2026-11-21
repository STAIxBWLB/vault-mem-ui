/** Adapter from `acon`'s `ConsoleHost` to the client's host interface. */

import type { ConsoleHost } from "@staix/agent-console/contract";
import type { ActionResult, ActionInput, Host, SnapshotReply } from "./host.ts";

/**
 * `acon` pushes the active panel's snapshots and routes navigation through its own tabs, so `snapshot()` drops the
 * panel id and forwards the panel's parameters. The panel id itself reaches the client through `show()`.
 */
export function createAconHost(panel: ConsoleHost): Host {
  return {
    mount: panel.mount as unknown as HTMLElement,
    async snapshot(input) {
      const { panel: _panel, ...rest } = input;
      return (await panel.snapshot(rest)) as SnapshotReply;
    },
    action: (input: ActionInput) => panel.action(input as never) as Promise<ActionResult>,
    theme: () => ({ mode: panel.theme.mode, tokens: panel.theme.tokens }),
    subscribe(listener) {
      panel.onSnapshot((snapshot) => listener(snapshot as SnapshotReply));
      return () => {
        // The shell owns the subscription lifetime; unmounting the panel removes its listeners with it.
      };
    },
    navigate(next, params) {
      panel.navigate(panel.tool, next, params);
    },
    onTheme(listener) {
      panel.onTheme((theme) => listener({ mode: theme.mode, tokens: theme.tokens }));
      return () => {};
    },
  };
}
