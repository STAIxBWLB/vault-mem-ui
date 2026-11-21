/**
 * The `acon` host as the console actually behaves: its server mints the confirm token, refuses a page that sets
 * `confirmed` or `fingerprint`, and answers the second call only when the token matches the input it was minted for.
 * `host.action` runs that whole round trip — the shell shows the preview in its own dialog and resolves with the
 * outcome. So the adapter drops the reserved keys, and with `confirm: "host"` the client never sends them at all.
 */

import { describe, expect, test } from "bun:test";
import type { ConsoleHost } from "@staix/agent-console/contract";
import { createAconHost } from "../../src/client/acon.ts";
import { createStore } from "../../src/client/store.ts";
import type { ActionInput } from "../../src/client/host.ts";
import { createFakeHost } from "../../src/client/fake.ts";
import type { StorageLike } from "../../src/client/prefs.ts";

interface Recorded {
  posted: Record<string, unknown>[];
}

type Decision = "confirm" | "cancel" | "expire";

/**
 * The console's rules, reduced to what a panel can observe: `confirmed` and `fingerprint` are reserved, a preview
 * mints a token bound to the input it came from, and only that token completes the write. The server side, below,
 * answers what the provider answers; the shell side is the round trip `host.action` performs.
 */
function consoleHost(recorded: Recorded, decision: Decision): ConsoleHost {
  const tokens = new Map<string, string>();
  const fingerprint = "sha256:vmem";
  let minted = 0;
  const server = async (input: Record<string, unknown>) => {
    const reserved = ["confirmed", "fingerprint"].filter((key) => key in input);
    if (reserved.length) return { ok: false, error: "confirmed and fingerprint are set by the console, not the page" };
    const { confirmToken, ...rest } = input;
    if (confirmToken === undefined) {
      const token = `token-${++minted}`;
      tokens.set(token, JSON.stringify(rest));
      return { ok: false, needsConfirm: true, fingerprint, verb: "Delete note", preview: ["delete notes/a.md"], changes: [], confirmToken: token };
    }
    const bound = tokens.get(String(confirmToken));
    tokens.delete(String(confirmToken));
    if (!bound || bound !== JSON.stringify(rest)) return { ok: false, error: "this preview expired or was already used; review it again" };
    return { ok: true, message: "Delete note: done" };
  };
  // `runAction`, then `confirmFlow`: the person's own decision happens in the console's dialog.
  const runAction = async (input: Record<string, unknown>) => {
    const first = await server(input);
    if (!("needsConfirm" in first)) return first;
    if (decision === "cancel") return { ok: false, cancelled: true };
    if (decision === "expire") return { ok: false, error: "this preview expired or was already used; review it again" };
    return server({ ...input, confirmToken: first.confirmToken });
  };
  return {
    tool: "vmem",
    node: "local",
    mount: {} as ConsoleHost["mount"],
    ui: {} as ConsoleHost["ui"],
    theme: { mode: "light", tokens: {} },
    snapshot: async () => ({ ok: true }),
    action: (input) => {
      recorded.posted.push(input);
      return runAction(input) as never;
    },
    navigate() {},
    onSnapshot() {},
    onTheme() {},
    toast() {},
    sheet: { open: () => ({} as ConsoleHost["mount"]), close() {} },
  };
}

const storage = (): StorageLike => ({ getItem: () => null, setItem: () => {} });
const record = (): Recorded => ({ posted: [] });

describe("the console owns the confirmation", () => {
  test("the adapter says so and drops the keys the console reserves", async () => {
    const recorded = record();
    const host = createAconHost(consoleHost(recorded, "confirm"));
    expect(host.confirm).toBe("host");
    await host.action({ action: "delete", path: "notes/a.md", confirmed: true, fingerprint: "sha256:vmem" });
    expect(recorded.posted).toEqual([{ action: "delete", path: "notes/a.md" }]);
  });

  test("a write the person confirms in the console ends as done, and the panel keeps no dialog", async () => {
    const recorded = record();
    const store = createStore(createAconHost(consoleHost(recorded, "confirm")), { storage: storage() });
    await store.beginWrite({ action: "delete", path: "notes/a.md" } as ActionInput);
    // One call from the panel: the console's preview and confirm round trip happen inside it.
    expect(recorded.posted).toEqual([{ action: "delete", path: "notes/a.md" }]);
    expect(store.getState().write).toEqual({ phase: "idle" });
  });

  test("a cancellation in the console's dialog is the person's decision, not a failure", async () => {
    const recorded = record();
    const store = createStore(createAconHost(consoleHost(recorded, "cancel")), { storage: storage() });
    await store.beginWrite({ action: "delete", path: "notes/a.md" });
    expect(store.getState().write).toEqual({ phase: "cancelled", message: "delete: cancelled, so nothing was written." });
  });

  test("a preview the console reports as expired comes back with the next step", async () => {
    const recorded = record();
    const store = createStore(createAconHost(consoleHost(recorded, "expire")), { storage: storage() });
    await store.beginWrite({ action: "delete", path: "notes/a.md" });
    const write = store.getState().write;
    expect(write.phase).toBe("error");
    if (write.phase === "error") {
      expect(write.message).toContain("this preview expired");
      expect(write.message).toContain("start the write again");
    }
  });

  test("a console page that posted the reserved keys itself would be refused, which is why it must not", async () => {
    const recorded = record();
    const raw = consoleHost(recorded, "confirm");
    // Straight at the console, bypassing the adapter: the server's own refusal, so the test's fake and the real
    // server agree on the rule the adapter exists to honour.
    expect(await raw.action({ action: "delete", path: "notes/a.md", confirmed: true } as never)).toEqual({
      ok: false,
      error: "confirmed and fingerprint are set by the console, not the page",
    });
  });
});

describe("a host that answers the provider directly still gets the two-step flow", () => {
  test("the fake host is client-confirmed, so the preview is rendered and the fingerprint re-sent", async () => {
    const host = createFakeHost({
      replies: {
        delete: { ok: false, needsConfirm: true, fingerprint: "sha256:vmem", verb: "Delete note", preview: ["delete notes/a.md"], changes: [] },
      },
    });
    expect(host.confirm).toBeUndefined();
    const store = createStore(host, { storage: storage() });
    await store.beginWrite({ action: "delete", path: "notes/a.md" });
    expect(store.getState().write.phase).toBe("preview");
    host.action = async (input) => {
      host.calls.action.push(input);
      return { ok: true, message: "Delete note: done" };
    };
    await store.confirmWriteNow();
    expect(store.getState().write).toEqual({ phase: "done", message: "Delete note: done" });
    expect(host.calls.action.at(-1)).toEqual({ action: "delete", path: "notes/a.md", confirmed: true, fingerprint: "sha256:vmem" });
  });
});
