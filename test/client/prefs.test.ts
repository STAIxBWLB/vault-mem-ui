import { afterEach, describe, expect, test } from "bun:test";
import {
  DEFAULT_PREFS,
  browserStorage,
  isPanelId,
  readPrefs,
  writePrefs,
  type StorageLike,
} from "../../src/client/prefs.ts";

const KEY = "vmem-ui:prefs";

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

const refuse = (message: string) => (): never => {
  throw new Error(message);
};

const withLocalStorage = (value: unknown) => {
  Object.defineProperty(globalThis, "localStorage", { value, configurable: true });
};

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe("readPrefs", () => {
  test("answers the defaults when there is no storage, nothing stored, or the stored text is not JSON", () => {
    expect(readPrefs()).toEqual(DEFAULT_PREFS);
    expect(readPrefs(memoryStorage())).toEqual(DEFAULT_PREFS);
    expect(readPrefs(memoryStorage({ [KEY]: "{not json" }))).toEqual(DEFAULT_PREFS);
  });

  test("keeps the stored value that is one of ours and replaces the rest with the default", () => {
    const stored = memoryStorage({ [KEY]: JSON.stringify({ theme: "dark", lastPanel: "lint" }) });
    expect(readPrefs(stored)).toEqual({ theme: "dark", lastPanel: "lint" });
    expect(readPrefs(memoryStorage({ [KEY]: JSON.stringify({ theme: "solarized", lastPanel: "graph" }) }))).toEqual(DEFAULT_PREFS);
    expect(readPrefs(memoryStorage({ [KEY]: JSON.stringify({ theme: "light", lastPanel: 3 }) }))).toEqual({
      theme: "light",
      lastPanel: DEFAULT_PREFS.lastPanel,
    });
    expect(readPrefs(memoryStorage({ [KEY]: JSON.stringify(null) }))).toEqual(DEFAULT_PREFS);
    expect(readPrefs(memoryStorage({ [KEY]: JSON.stringify(["dark"]) }))).toEqual(DEFAULT_PREFS);
  });

  test("a storage that refuses the read is the default, never an error", () => {
    expect(readPrefs({ getItem: refuse("denied"), setItem: () => {} })).toEqual(DEFAULT_PREFS);
  });
});

describe("writePrefs", () => {
  test("stores the checked value, so what is kept is what the panel applies", () => {
    const storage = memoryStorage();
    expect(writePrefs({ theme: "dark", lastPanel: "log" }, storage)).toEqual({ theme: "dark", lastPanel: "log" });
    expect(JSON.parse(storage.data[KEY]!)).toEqual({ theme: "dark", lastPanel: "log" });
  });

  test("a value that is not ours is stored as the default it falls back to", () => {
    const storage = memoryStorage();
    expect(writePrefs({ theme: "paper", lastPanel: "graph" } as never, storage)).toEqual(DEFAULT_PREFS);
    expect(JSON.parse(storage.data[KEY]!)).toEqual(DEFAULT_PREFS);
  });

  test("a full or disabled store leaves the session working with the value in hand", () => {
    expect(writePrefs({ theme: "light", lastPanel: "notes" }, { getItem: () => null, setItem: refuse("QuotaExceededError") })).toEqual({
      theme: "light",
      lastPanel: "notes",
    });
    expect(writePrefs({ theme: "dark", lastPanel: "overview" })).toEqual({ theme: "dark", lastPanel: "overview" });
  });
});

describe("browserStorage", () => {
  test("uses localStorage when the page allows it and leaves nothing of its own behind", () => {
    const storage = memoryStorage();
    withLocalStorage(storage);
    expect(browserStorage()).toBe(storage);
    expect(Object.keys(storage.data)).toEqual([]);
  });

  test("a page with no storage, a refused write or a throwing property has none, and the panel still runs", () => {
    withLocalStorage(undefined);
    expect(browserStorage()).toBeUndefined();
    withLocalStorage({ getItem: () => null, setItem: refuse("SecurityError") });
    expect(browserStorage()).toBeUndefined();
    Object.defineProperty(globalThis, "localStorage", { get: refuse("SecurityError"), configurable: true });
    expect(browserStorage()).toBeUndefined();
  });

  test("an injected source wins over the page's own storage", () => {
    const storage = memoryStorage();
    const page = memoryStorage();
    withLocalStorage(page);
    expect(browserStorage(storage)).toBe(storage);
    expect(browserStorage(null)).toBe(page);
  });
});

describe("isPanelId", () => {
  test("accepts exactly the panels the client renders", () => {
    for (const id of ["overview", "notes", "note", "promote", "lint", "log"]) expect(isPanelId(id)).toBe(true);
    for (const id of ["graph", "", "Overview", "settings", 7, null, undefined]) expect(isPanelId(id)).toBe(false);
  });
});
