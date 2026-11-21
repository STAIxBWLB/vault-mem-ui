/** Adapter from `acon`'s `ConsoleHost` to the client's host interface. */

import type { ConsoleHost } from "@staix/agent-console/contract";
import type { ActionResult, ActionInput, Host, SnapshotReply } from "./host.ts";

/** Keys the console sets on a confirmed action; its server refuses a page that sends them. */
const RESERVED = new Set(["confirmed", "fingerprint"]);

/**
 * `acon` pushes the active panel's snapshots and routes navigation through its own tabs, so `snapshot()` drops the
 * panel id and forwards the panel's parameters. The panel id itself reaches the client through `show()`.
 *
 * Confirmation belongs to the console: `host.action` answers a `needsConfirm` itself — its server stores the
 * fingerprint under a confirm token, the shell renders the preview in its own dialog, and the confirm is a second
 * call carrying that token. So the adapter says `confirm: "host"` and never passes `confirmed` or `fingerprint`
 * through: the console refuses those from a page.
 */
export function createAconHost(panel: ConsoleHost): Host {
  return {
    mount: panel.mount as unknown as HTMLElement,
    confirm: "host",
    async snapshot(input) {
      const { panel: _panel, ...rest } = input;
      return (await panel.snapshot(rest)) as SnapshotReply;
    },
    action(input: ActionInput) {
      const forwarded: Record<string, unknown> = { ...input };
      for (const key of RESERVED) delete forwarded[key];
      return panel.action(forwarded as never) as Promise<ActionResult>;
    },
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
