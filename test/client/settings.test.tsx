import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { VIEWS } from "../../src/client/App.tsx";
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
  const write = container.querySelector<HTMLSelectElement>('#settings-write')!;
  write.value = "none";
  act(() => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(submitted).toEqual({ action: "settings", vault: "work", changes: { write: "none" } });
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
  host.action = async () => ({ ok: false, error: "settings: no values changed; change a setting before previewing" });
  expect(await startWrite(host, { action: "settings", vault: "work", changes: {} })).toMatchObject({ phase: "error", message: expect.stringContaining("settings: no values changed; change a setting before previewing") });
});
