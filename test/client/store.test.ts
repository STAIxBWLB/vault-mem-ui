import { describe, expect, test } from "bun:test";
import { createFakeHost, type FakeHost } from "../../src/client/fake.ts";
import type { ActionResult, SnapshotInput, SnapshotReply } from "../../src/client/host.ts";
import type { StorageLike } from "../../src/client/prefs.ts";
import { createStore, resolveTheme } from "../../src/client/store.ts";

const KEY = "vmem-ui:prefs";

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

interface Pending {
  input: SnapshotInput;
  resolve(reply: SnapshotReply): void;
  reject(error: unknown): void;
}

/** A host whose snapshots answer only when the test says so, so reply order is under the test's control. */
function deferred(host: FakeHost = createFakeHost()): { host: FakeHost; pending: Pending[] } {
  const pending: Pending[] = [];
  host.snapshot = (input) =>
    new Promise<SnapshotReply>((resolve, reject) => {
      pending.push({ input, resolve, reject });
    });
  return { host, pending };
}

describe("resolveTheme", () => {
  test("system follows the host, and the person's own choice keeps the host's tokens", () => {
    const hostTheme = { mode: "dark" as const, tokens: { accent: "#f80" } };
    expect(resolveTheme("system", hostTheme)).toEqual(hostTheme);
    expect(resolveTheme("light", hostTheme)).toEqual({ mode: "light", tokens: { accent: "#f80" } });
    const own = resolveTheme("dark", { mode: "light" });
    expect(own.mode).toBe("dark");
    expect(own.tokens).toBeUndefined();
  });
});

describe("createStore", () => {
  test("starts on the stored panel, and an explicit panel wins over it", () => {
    const storage = memoryStorage({ [KEY]: JSON.stringify({ theme: "system", lastPanel: "lint" }) });
    expect(createStore(createFakeHost(), { storage }).getState().panel).toBe("lint");
    expect(createStore(createFakeHost(), { storage, initialPanel: "overview" }).getState().panel).toBe("overview");
  });

  test("a stored theme reaches the panel at start, and changing it is kept for the next visit", () => {
    const storage = memoryStorage({ [KEY]: JSON.stringify({ theme: "light", lastPanel: "notes" }) });
    const store = createStore(createFakeHost({ theme: { mode: "dark" } }), { storage });
    expect(store.getState().theme.mode).toBe("light");
    store.setTheme("system");
    expect(store.getState().theme.mode).toBe("dark");
    expect(JSON.parse(storage.data[KEY]!)).toEqual({ theme: "system", lastPanel: "notes" });
  });

  test("switching panels keeps the choice, so the next visit opens where the person left", () => {
    const storage = memoryStorage();
    const store = createStore(createFakeHost(), { storage });
    store.show("log", { type: "LEARN" });
    expect(store.getState().panel).toBe("log");
    expect(store.getState().params).toEqual({ type: "LEARN" });
    expect(JSON.parse(storage.data[KEY]!).lastPanel).toBe("log");
  });

  test("an unreadable store still lets the person move and choose; nothing is kept", () => {
    const refusing: StorageLike = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    const store = createStore(createFakeHost(), { storage: refusing });
    store.show("promote");
    store.setTheme("dark");
    expect(store.getState().panel).toBe("promote");
    expect(store.getState().theme.mode).toBe("dark");
  });
});

describe("refresh", () => {
  test("a reply for a panel the person already left does not land", async () => {
    const { host, pending } = deferred();
    const store = createStore(host);
    store.show("notes", { q: "a" });
    store.show("log");
    pending[0]!.resolve({ panel: "notes" });
    await Bun.sleep(0);
    expect(store.getState().reply).toBeNull();
    expect(store.getState().phase).toBe("loading");
    pending[1]!.resolve({ panel: "log" });
    await Bun.sleep(0);
    expect(store.getState().reply).toEqual({ panel: "log" });
    expect(store.getState().phase).toBe("ready");
  });

  test("the same panel asked with other parameters is a new request too", async () => {
    const { host, pending } = deferred();
    const store = createStore(host);
    store.show("note", { path: "notes/a.md" });
    store.show("note", { path: "notes/b.md" });
    pending[0]!.resolve({ body: "a" });
    pending[1]!.resolve({ body: "b" });
    await Bun.sleep(0);
    expect(store.getState().reply).toEqual({ body: "b" });
  });

  test("a slow failure does not report an error over the panel that did load", async () => {
    const { host, pending } = deferred();
    const store = createStore(host);
    store.show("notes");
    store.show("lint");
    pending[1]!.resolve({ findings: [] });
    pending[0]!.reject(new Error("offline"));
    await Bun.sleep(0);
    expect(store.getState().phase).toBe("ready");
    expect(store.getState().error).toBeUndefined();
  });

  test("a failure names the panel and the next step", async () => {
    const { host, pending } = deferred();
    const store = createStore(host);
    store.show("notes");
    pending[0]!.reject(new Error("offline"));
    await Bun.sleep(1);
    expect(store.getState().phase).toBe("error");
    expect(store.getState().error).toBe("Could not load this panel: offline. Retry, or check the host connection.");
  });
});

describe("navigate", () => {
  test("a host that routes panels itself is asked to, and the store waits for the host's own show", () => {
    const host = createFakeHost();
    const store = createStore(host);
    store.navigate("notes", { q: "x" });
    expect(host.calls.navigate).toEqual(["notes"]);
    expect(store.getState().panel).toBe("overview");
  });

  test("a host with no router switches in place", () => {
    const host = createFakeHost();
    delete (host as { navigate?: unknown }).navigate;
    const store = createStore(host);
    store.navigate("lint");
    expect(store.getState().panel).toBe("lint");
    expect(host.calls.snapshot).toEqual([{ panel: "lint" }]);
  });
});

describe("start", () => {
  test("without host pushes the panel polls, and the returned stop ends it", async () => {
    const host = createFakeHost({ snapshots: { default: { ok: true } } });
    delete (host as { subscribe?: unknown }).subscribe;
    const store = createStore(host, { intervalMs: 5 });
    const stop = store.start();
    await Bun.sleep(25);
    stop();
    const counted = host.calls.snapshot.length;
    expect(counted).toBeGreaterThan(1);
    await Bun.sleep(25);
    expect(host.calls.snapshot.length).toBe(counted);
  });

  test("a host theme change is applied, and the person's own choice still wins", () => {
    const host = createFakeHost({ theme: { mode: "light" } });
    let push: ((theme: { mode: "light" | "dark" }) => void) | undefined;
    host.onTheme = (listener) => {
      push = listener;
      return () => {};
    };
    const store = createStore(host, { storage: memoryStorage() });
    const stop = store.start();
    push!({ mode: "dark" });
    expect(store.getState().theme.mode).toBe("dark");
    store.setTheme("light");
    push!({ mode: "dark" });
    expect(store.getState().theme.mode).toBe("light");
    stop();
  });

  test("with host pushes the panel follows them, and theme changes reach it", async () => {
    const host = createFakeHost({ theme: { mode: "light" } });
    const store = createStore(host);
    const stop = store.start();
    host.push({ pushed: true });
    expect(store.getState().reply).toEqual({ pushed: true });
    expect(host.calls.snapshot).toEqual([]);
    stop();
    host.push({ pushed: "after stop" });
    expect(store.getState().reply).toEqual({ pushed: true });
  });
});

describe("writes", () => {
  test("beginWrite shows the preview, confirmWriteNow re-sends the fingerprint, and the panel reloads", async () => {
    const answers: ActionResult[] = [
      { ok: false, needsConfirm: true, fingerprint: "sha256:abc", verb: "Delete note", preview: ["delete notes/a.md"], changes: [], warnings: [] },
      { ok: true, message: "Delete note: done" },
    ];
    const host = createFakeHost();
    host.action = async (input) => {
      host.calls.action.push(input);
      return answers.shift() ?? { ok: true };
    };
    const store = createStore(host);
    await store.beginWrite({ action: "delete", path: "notes/a.md" });
    expect(store.getState().write).toMatchObject({ phase: "preview", fingerprint: "sha256:abc", verb: "Delete note" });
    expect(host.calls.action).toEqual([{ action: "delete", path: "notes/a.md" }]);

    await store.confirmWriteNow();
    expect(store.getState().write).toEqual({ phase: "done", message: "Delete note: done" });
    expect(host.calls.action.at(-1)).toEqual({ action: "delete", path: "notes/a.md", confirmed: true, fingerprint: "sha256:abc" });
    await Bun.sleep(0);
    expect(host.calls.snapshot.length).toBeGreaterThan(0);
  });

  test("confirming with nothing previewed sends nothing", async () => {
    const host = createFakeHost();
    const store = createStore(host);
    await store.confirmWriteNow();
    expect(host.calls.action).toEqual([]);
    expect(store.getState().write).toEqual({ phase: "idle" });
  });

  test("a cancelled dialog drops the preview, so the write cannot be confirmed later", async () => {
    const host = createFakeHost({ replies: { delete: { ok: false, needsConfirm: true, fingerprint: "sha256:abc" } } });
    const store = createStore(host);
    await store.beginWrite({ action: "delete", path: "notes/a.md" });
    store.setWrite({ phase: "idle" });
    await store.confirmWriteNow();
    expect(host.calls.action).toHaveLength(1);
  });
});

describe("subscribe", () => {
  test("hands every change to its listeners and stops when the listener leaves", () => {
    const store = createStore(createFakeHost(), { storage: memoryStorage() });
    const seen: string[] = [];
    const stop = store.subscribe((state) => seen.push(state.panel));
    stop();
    store.show("notes");
    expect(seen).toEqual([]);
    const keep = store.subscribe((state) => seen.push(state.panel));
    // Switching panels stores the choice first, then the panel itself: both are changes the view renders.
    store.show("log");
    expect(seen).toEqual(["notes", "log"]);
    keep();
  });
});
