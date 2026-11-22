import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { App, VIEWS } from "../../src/client/App.tsx";
import { createStore } from "../../src/client/store.ts";
import { PANEL_IDS } from "../../src/client/prefs.ts";
import { SettingsView } from "../../src/client/views/settings.tsx";
import { createFakeHost } from "../../src/client/fake.ts";
import { confirmWrite, startWrite } from "../../src/client/write.ts";
import type { ActionInput } from "../../src/client/host.ts";

let root: Root;
let container: HTMLElement;
beforeAll(() => { GlobalRegistrator.register(); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => { act(() => root?.unmount()); container?.remove(); });
afterAll(async () => { await GlobalRegistrator.unregister(); });

test("each advertised client panel has a view", () => {
  expect(new Set(Object.keys(VIEWS))).toEqual(new Set(PANEL_IDS));
});

test("settings submits only edited values for the displayed vault", () => {
  let submitted: ActionInput | undefined;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  act(() => root.render(<SettingsView reply={{ vault: "work", defaultVault: "work", defaultVaultExplicit: false, write: "mcp", piiPatterns: ["private"], graphResolution: 1, enrichmentEnabled: false }} params={{}} navigate={() => {}} beginWrite={(input) => { submitted = input; }} />));
  expect(container.textContent).toContain("This vault (work)");
  expect(container.textContent).toContain("All vaults");
  act(() => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(submitted).toBeUndefined();
  expect(container.textContent).toContain("No values changed. Edit a setting, then preview again.");
  const write = container.querySelector<HTMLSelectElement>('#settings-write')!;
  write.value = "none";
  act(() => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(submitted).toEqual({ action: "settings", vault: "work", changes: { write: "none" } });
});

test("untouched patterns stay unchanged and blank lines are not patterns", () => {
  const calls: ActionInput[] = [];
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  act(() => root.render(<SettingsView reply={{ vault: "work", defaultVault: "work", write: "mcp", piiPatterns: ["a", "", "b\nc"], graphResolution: 1, enrichmentEnabled: false }} params={{}} navigate={() => {}} beginWrite={(input) => calls.push(input)} />));
  container.querySelector<HTMLSelectElement>("#settings-write")!.value = "none";
  const form = container.querySelector("form")!;
  act(() => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(calls[0]).toEqual({ action: "settings", vault: "work", changes: { write: "none" } });
  container.querySelector<HTMLTextAreaElement>("#settings-pii")!.value = "secret\n  \nother";
  act(() => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(calls[1]).toEqual({ action: "settings", vault: "work", changes: { write: "none", piiPatterns: ["secret", "other"] } });
});

test("settings form previews and confirms through the app store, then refreshes", async () => {
  let write = "mcp";
  const host = createFakeHost({ snapshots: { settings: () => ({ vault: "work", defaultVault: "work", write, piiPatterns: [], graphResolution: 1, enrichmentEnabled: false }) } });
  host.action = async (input) => {
    host.calls.action.push(input);
    if (!input.confirmed) return { ok: false, needsConfirm: true, fingerprint: "fp", verb: "Change settings", preview: ['write: "none"'] };
    write = "none";
    return { ok: true, message: "Settings updated; restart the console and MCP server" };
  };
  const store = createStore(host, { initialPanel: "settings" });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => { root.render(<App store={store} />); await store.refresh(); });
  container.querySelector<HTMLSelectElement>("#settings-write")!.value = "none";
  await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(container.textContent).toContain('write: "none"');
  expect(host.calls.action).toHaveLength(1);
  await act(async () => { [...container.querySelectorAll("button")].find((button) => button.textContent === "Confirm")!.click(); });
  expect(host.calls.action[1]).toEqual({ action: "settings", vault: "work", changes: { write: "none" }, confirmed: true, fingerprint: "fp" });
  expect(container.textContent).toContain("Settings updated; restart the console and MCP server");
  expect(container.querySelector<HTMLSelectElement>("#settings-write")!.value).toBe("none");
});

test("settings preview, stale confirmation and refusal preserve the provider response", async () => {
  const input = { action: "settings", vault: "work", changes: { write: "none" } };
  const host = createFakeHost({ replies: { settings: { ok: false, needsConfirm: true, fingerprint: "one", verb: "Change settings", preview: ['write: "none"'] } } });
  const preview = await startWrite(host, input);
  expect(preview).toMatchObject({ phase: "preview", fingerprint: "one", preview: ['write: "none"'] });
  host.action = async (action) => { host.calls.action.push(action); return { ok: false, needsConfirm: true, fingerprint: "two", preview: ["new preview"] }; };
  const stale = await confirmWrite(host, preview);
  expect(host.calls.action.at(-1)).toEqual({ ...input, confirmed: true, fingerprint: "one" });
  expect(stale).toMatchObject({ phase: "preview", fingerprint: "two", preview: ["new preview"] });
  host.action = async () => ({ ok: true, message: "Settings updated; restart the console and MCP server" });
  expect(await confirmWrite(host, stale)).toMatchObject({ phase: "done", message: expect.stringContaining("restart") });
  host.action = async () => ({ ok: false, error: "settings: invalid change; correct the settings and preview again" });
  expect(await startWrite(host, input)).toMatchObject({ phase: "error", message: expect.stringContaining("settings: invalid change; correct the settings and preview again") });
});
