import { expect, test } from "bun:test";
import { createStandaloneHost } from "../../src/client/standalone";
import { createStore } from "../../src/client/store";
import { startHost } from "../../src/server/host";
import type { ConsolePanelManifest, ConsoleProvider } from "@staix/agent-console/contract";

test("standalone host relays snapshots and a preview followed by the person's confirmation", async () => {
  const calls: Record<string, unknown>[] = [];
  const provider: ConsoleProvider = {
    assets: { js: "", css: "" },
    async snapshot(input) { return { panel: input.panel, note: { path: "notes/example.md" } }; },
    async action(input) {
      calls.push(input);
      return input.confirmed ? { ok: true, message: "done" } : { ok: false, needsConfirm: true, fingerprint: "preview-fingerprint", preview: ["delete example"] };
    },
  };
  const manifest: ConsolePanelManifest = { api: 1, tool: "vmem", version: "test", title: "Vault", panels: [{ id: "note", title: "Note" }] };
  const server = startHost({ provider, manifest, assets: { js: "", css: "" } });
  try {
    const login = await fetch(server.issue(), { redirect: "manual" });
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const requests: string[] = [];
    const request = async (url: string, init: RequestInit) => {
      requests.push(String(url));
      expect(init?.credentials).toBe("same-origin");
      expect(init?.mode).toBe("same-origin");
      return fetch(server.origin + String(url), { ...init, headers: { ...init?.headers, cookie, origin: server.origin } });
    };
    const host = createStandaloneHost({} as HTMLElement, request);
    const store = createStore(host, { initialPanel: "note" });
    await store.refresh();
    expect(store.getState().reply).toMatchObject({ panel: "note" });
    await store.beginWrite({ action: "delete", path: "notes/example.md" });
    expect(store.getState().write).toMatchObject({ phase: "preview", fingerprint: "preview-fingerprint" });
    expect(calls).toHaveLength(1);
    await store.confirmWriteNow();
    expect(calls[1]).toMatchObject({ action: "delete", confirmed: true, fingerprint: "preview-fingerprint" });
    expect(store.getState().write.phase).toBe("done");
    expect(requests.every((url) => url === "/api/snapshot" || url === "/api/action")).toBe(true);
  } finally {
    await server.stop();
  }
});
