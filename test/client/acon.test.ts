import { describe, expect, test } from "bun:test";
import type { ConsoleHost } from "@staix/agent-console/contract";
import { createAconHost } from "../../src/client/acon.ts";

interface Recorded {
  snapshots: Record<string, unknown>[];
  actions: Record<string, unknown>[];
  navigations: { tool: string; panel: string; params?: Record<string, string> }[];
}

function consoleHost(recorded: Recorded): ConsoleHost {
  const mount = {} as ConsoleHost["mount"];
  return {
    tool: "vmem",
    node: "local",
    mount,
    ui: {} as ConsoleHost["ui"],
    theme: { mode: "dark", tokens: { accent: "#f80" } },
    async snapshot(extra) {
      recorded.snapshots.push(extra ?? {});
      return { panelData: extra ?? null };
    },
    async action(input) {
      recorded.actions.push(input);
      return { ok: true, message: String(input.action) };
    },
    navigate(tool, panel, params) {
      recorded.navigations.push({ tool, panel, params });
    },
    onSnapshot() {},
    onTheme() {},
    toast() {},
    sheet: { open: () => ({} as ConsoleHost["mount"]), close() {} },
  };
}

const empty = (): Recorded => ({ snapshots: [], actions: [], navigations: [] });

describe("createAconHost", () => {
  test("renders into the console's own mount and reports its theme with its tokens", () => {
    const panel = consoleHost(empty());
    const host = createAconHost(panel);
    expect(host.mount).toBe(panel.mount);
    expect(host.theme()).toEqual({ mode: "dark", tokens: { accent: "#f80" } });
  });

  test("drops the panel id the console routes itself, and forwards the panel's parameters", async () => {
    const recorded = empty();
    const host = createAconHost(consoleHost(recorded));
    expect(await host.snapshot({ panel: "note", path: "notes/a.md", vault: "work" })).toEqual({ panelData: { path: "notes/a.md", vault: "work" } });
    expect(recorded.snapshots).toEqual([{ path: "notes/a.md", vault: "work" }]);
  });

  test("sends a panel with no parameters as an empty extra, which is what the console's snapshot takes", async () => {
    const recorded = empty();
    const host = createAconHost(consoleHost(recorded));
    await host.snapshot({ panel: "overview" });
    expect(recorded.snapshots).toEqual([{}]);
  });

  test("forwards an action and its confirmation unchanged", async () => {
    const recorded = empty();
    const host = createAconHost(consoleHost(recorded));
    expect(await host.action({ action: "delete", path: "notes/a.md", confirmed: true, fingerprint: "sha256:abc" })).toEqual({
      ok: true,
      message: "delete",
    });
    expect(recorded.actions).toEqual([{ action: "delete", path: "notes/a.md", confirmed: true, fingerprint: "sha256:abc" }]);
  });

  test("navigates through the console's tabs, named by the console's own tool", () => {
    const recorded = empty();
    const host = createAconHost(consoleHost(recorded));
    host.navigate!("note", { path: "notes/a.md" });
    host.navigate!("log");
    expect(recorded.navigations).toEqual([
      { tool: "vmem", panel: "note", params: { path: "notes/a.md" } },
      { tool: "vmem", panel: "log", params: undefined },
    ]);
  });

  test("hands the console's pushes and theme changes to the client", () => {
    const recorded = empty();
    const panel = consoleHost(recorded);
    const seen: unknown[] = [];
    const themes: string[] = [];
    panel.onSnapshot = (cb) => cb({ pushed: true });
    panel.onTheme = (cb) => cb({ mode: "light", tokens: {} });
    const host = createAconHost(panel);
    host.subscribe!((reply) => seen.push(reply));
    host.onTheme!((theme) => themes.push(theme.mode));
    expect(seen).toEqual([{ pushed: true }]);
    expect(themes).toEqual(["light"]);
  });

  test("unsubscribing is a no-op the console's own panel lifetime covers, and it does not throw", () => {
    const host = createAconHost(consoleHost(empty()));
    expect(() => {
      host.subscribe!(() => {})();
      host.onTheme!(() => {})();
    }).not.toThrow();
  });
});
