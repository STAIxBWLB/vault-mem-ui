/** In-memory host: the standalone shell's stand-in until M1-b merges, and the views' test host. */

import type { ActionResult, ActionInput, Host, SnapshotInput, SnapshotReply, Theme } from "./host.ts";

export type SnapshotSource = SnapshotReply | ((input: SnapshotInput) => SnapshotReply | Promise<SnapshotReply>);

export interface FakeSeed {
  snapshots?: Record<string, SnapshotSource>;
  replies?: Record<string, ActionResult>;
  theme?: Theme;
  mount?: HTMLElement;
}

export interface FakeHost extends Host {
  calls: { snapshot: SnapshotInput[]; action: ActionInput[]; navigate: string[] };
  push(reply: SnapshotReply): void;
}

/** Answers by panel id (falling back to `default`), records every call, and lets a test push a poll reply. */
export function createFakeHost(seed: FakeSeed = {}): FakeHost {
  const calls: FakeHost["calls"] = { snapshot: [], action: [], navigate: [] };
  const listeners = new Set<(reply: SnapshotReply) => void>();
  const theme: Theme = seed.theme ?? { mode: "light" };
  return {
    mount: seed.mount ?? ({ append() {} } as unknown as HTMLElement),
    calls,
    async snapshot(input) {
      calls.snapshot.push(input);
      const source = seed.snapshots?.[input.panel] ?? seed.snapshots?.default ?? {};
      return typeof source === "function" ? await source(input) : source;
    },
    async action(input) {
      calls.action.push(input);
      return seed.replies?.[input.action] ?? { ok: true, message: `${input.action}: done` };
    },
    theme: () => theme,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    navigate(next) {
      calls.navigate.push(next);
    },
    push(reply) {
      for (const listener of listeners) listener(reply);
    },
  };
}
