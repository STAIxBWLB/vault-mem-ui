import { describe, expect, test } from "bun:test";
import { createFakeHost } from "../../src/client/fake.ts";
import type { ActionResult } from "../../src/client/host.ts";
import { confirmWrite, problemText, startWrite, type WriteState } from "../../src/client/write.ts";

const preview: ActionResult = {
  ok: false,
  needsConfirm: true,
  fingerprint: "sha256:abc",
  verb: "Delete note",
  preview: ["delete notes/a.md"],
  changes: [{ op: "delete", target: "notes/a.md" }],
  warnings: ["2 links point here: notes/b.md"],
};

describe("startWrite", () => {
  test("sends the action once and shows the preview the provider answered", async () => {
    const host = createFakeHost({ replies: { delete: preview } });
    const state = (await startWrite(host, { action: "delete", path: "notes/a.md" })) as Extract<WriteState, { phase: "preview" }>;
    expect(host.calls.action).toEqual([{ action: "delete", path: "notes/a.md" }]);
    expect(state.phase).toBe("preview");
    expect(state.fingerprint).toBe("sha256:abc");
    expect(state.verb).toBe("Delete note");
    expect(state.preview).toEqual(["delete notes/a.md"]);
    expect(state.changes).toEqual([{ op: "delete", target: "notes/a.md" }]);
    expect(state.warnings).toEqual(["2 links point here: notes/b.md"]);
  });

  test("nothing is confirmed on the first call, whatever the provider answers", async () => {
    const host = createFakeHost({ replies: { delete: preview } });
    await startWrite(host, { action: "delete", path: "notes/a.md" });
    expect(host.calls.action[0]!.confirmed).toBeUndefined();
    expect(host.calls.action[0]!.fingerprint).toBeUndefined();
  });

  test("a provider that writes without asking goes straight to done", async () => {
    const host = createFakeHost({ replies: { move: { ok: true, message: "Move note: done" } } });
    expect(await startWrite(host, { action: "move", from: "a", to: "b" })).toEqual({ phase: "done", message: "Move note: done" });
  });

  test("a refusal keeps the provider's own words first and adds the next step", async () => {
    const host = createFakeHost({ replies: { delete: { ok: false, error: "path is required" } } });
    expect(await startWrite(host, { action: "delete" })).toEqual({
      phase: "error",
      message: "path is required. Fix that and start the write again, or reload the panel first if it may already have been applied.",
    });
    const silent = createFakeHost({ replies: { delete: { ok: false } } });
    expect(await startWrite(silent, { action: "delete" })).toEqual({
      phase: "error",
      message: "delete was refused without a reason. Reload the panel and try again; if it repeats, check the vault's log.",
    });
  });

  test("a confirmation request without a fingerprint cannot be confirmed, so it is refused instead", async () => {
    const host = createFakeHost({ replies: { delete: { ok: false, needsConfirm: true, preview: ["delete notes/a.md"] } } });
    const state = await startWrite(host, { action: "delete", path: "notes/a.md" });
    expect(state.phase).toBe("error");
    expect(state).toMatchObject({ message: expect.stringContaining("without a fingerprint") });
  });

  test("a host that throws is reported with the next step, and the action is not retried", async () => {
    const host = createFakeHost();
    host.action = async () => {
      throw new Error("offline");
    };
    expect(await startWrite(host, { action: "delete", path: "notes/a.md" })).toEqual({
      phase: "error",
      message: "delete was not sent: offline. Check the host connection and try again.",
    });
  });
});

describe("confirmWrite", () => {
  test("re-sends the previewed action with its own fingerprint, and only then is anything written", async () => {
    const host = createFakeHost({ replies: { delete: preview } });
    const state = await startWrite(host, { action: "delete", path: "notes/a.md" });
    host.action = async (input) => {
      host.calls.action.push(input);
      return { ok: true, message: "Delete note: done" };
    };
    expect(await confirmWrite(host, state)).toEqual({ phase: "done", message: "Delete note: done" });
    expect(host.calls.action.at(-1)).toEqual({ action: "delete", path: "notes/a.md", confirmed: true, fingerprint: "sha256:abc" });
  });

  test("a token the provider issued travels with the confirmation", async () => {
    const host = createFakeHost({ replies: { promote: { ...preview, confirmToken: "tok-1" } } });
    const state = await startWrite(host, { action: "promote", path: "notes/a.md", to: "org" });
    host.action = async (input) => {
      host.calls.action.push(input);
      return { ok: true };
    };
    await confirmWrite(host, state);
    expect(host.calls.action.at(-1)!.confirmToken).toBe("tok-1");
  });

  test("a repeated confirmation request is shown again instead of being treated as done", async () => {
    const host = createFakeHost({ replies: { delete: preview } });
    const state = await startWrite(host, { action: "delete", path: "notes/a.md" });
    host.action = async (input) => {
      host.calls.action.push(input);
      return { ...preview, fingerprint: "sha256:abc" };
    };
    const again = await confirmWrite(host, state);
    expect(again.phase).toBe("preview");
    expect(again).toMatchObject({ fingerprint: "sha256:abc" });
  });

  test("a state that is not a preview sends nothing", async () => {
    const host = createFakeHost();
    for (const state of [{ phase: "idle" }, { phase: "done", message: "x" }, { phase: "error", message: "y" }] as WriteState[]) {
      expect(await confirmWrite(host, state)).toBe(state);
    }
    expect(host.calls.action).toEqual([]);
  });

  test("a failed confirmation keeps the fingerprint, so the person can retry the same preview", async () => {
    const host = createFakeHost({ replies: { delete: preview } });
    const state = await startWrite(host, { action: "delete", path: "notes/a.md" });
    host.action = async () => {
      throw new Error("timeout");
    };
    const failed = await confirmWrite(host, state);
    expect(failed).toEqual({ phase: "error", message: "Delete note was not confirmed: timeout. Check the host connection and try again." });
    expect(state).toMatchObject({ phase: "preview", fingerprint: "sha256:abc" });
  });
});

describe("problemText", () => {
  test("names the failure and the next step, with or without a cause", () => {
    expect(problemText(new Error("offline"), "delete was not sent")).toBe("delete was not sent: offline. Check the host connection and try again.");
    expect(problemText(undefined, "delete was not sent")).toBe("delete was not sent. Check the host connection and try again.");
    expect(problemText("  ", "delete was not sent")).toBe("delete was not sent. Check the host connection and try again.");
    expect(problemText("refused", "delete was not sent")).toBe("delete was not sent: refused. Check the host connection and try again.");
  });
});
