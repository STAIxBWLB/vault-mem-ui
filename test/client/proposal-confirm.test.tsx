import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { App } from "../../src/client/App.tsx";
import { createFakeHost } from "../../src/client/fake.ts";
import { createStore } from "../../src/client/store.ts";

let root: Root;
let container: HTMLElement;
beforeAll(() => { GlobalRegistrator.register(); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => { act(() => root?.unmount()); container?.remove(); });
afterAll(async () => { await GlobalRegistrator.unregister(); });

test("app previews and confirms a proposal with the returned fingerprint", async () => {
  const snapshot = { vault: "work", state: "pending", page: { items: [], nextCursor: null }, selected: { id: "p1", vault: "work", state: "pending", path: "notes/a.md", content: "Synthetic proposal" } };
  const host = createFakeHost({ snapshots: { proposals: snapshot } });
  host.action = async (input) => {
    host.calls.action.push(input);
    return input.confirmed ? { ok: true, message: "Apply proposal: done" } : { ok: false, needsConfirm: true, fingerprint: "fp1", verb: "Apply proposal", preview: ["apply proposal p1"] };
  };
  const store = createStore(host, { initialPanel: "proposals" });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => { root.render(<App store={store} />); await store.refresh(); });
  await act(async () => { [...container.querySelectorAll("button")].find((button) => button.textContent === "Preview apply")!.click(); });
  expect(container.querySelector('[role="dialog"]')?.textContent).toContain("apply proposal p1");
  expect(host.calls.action).toEqual([{ action: "proposal-apply", vault: "work", id: "p1" }]);
  await act(async () => { [...container.querySelectorAll("button")].find((button) => button.textContent === "Confirm")!.click(); });
  expect(host.calls.action[1]).toEqual({ action: "proposal-apply", vault: "work", id: "p1", confirmed: true, fingerprint: "fp1" });
  expect(container.querySelector('[role="dialog"]')?.textContent).toContain("Apply proposal: done");
});
