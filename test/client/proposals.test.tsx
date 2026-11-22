import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ProposalsView } from "../../src/client/views/proposals.tsx";
import { createFakeHost } from "../../src/client/fake.ts";
import { confirmWrite, startWrite } from "../../src/client/write.ts";
import type { ActionInput } from "../../src/client/host.ts";

let root: Root;
let container: HTMLElement;
beforeAll(() => { GlobalRegistrator.register(); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => { act(() => root?.unmount()); container?.remove(); });
afterAll(async () => { await GlobalRegistrator.unregister(); });

const reply = { vault: "work", state: "pending", page: { items: [{ id: "p1", path: "notes/a.md", state: "pending", createdAt: "2026-01-01" }], nextCursor: "next", issues: [] }, selected: { id: "p1", path: "notes/a.md", state: "pending", content: "Synthetic proposal", issues: [] } };

test("list, paging and selection preserve the selected vault and state", () => {
  const navigations: unknown[] = [];
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  act(() => root.render(<ProposalsView reply={reply} params={{}} navigate={(panel, params) => navigations.push({ panel, params })} beginWrite={() => {}} />));
  expect(container.textContent).toContain("Synthetic proposal");
  act(() => [...container.querySelectorAll("button")].find((b) => b.textContent === "Next page")!.click());
  expect(navigations.at(-1)).toEqual({ panel: "proposals", params: { vault: "work", state: "pending", page: "next" } });
  act(() => [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("notes/a.md"))!.click());
  expect(navigations.at(-1)).toEqual({ panel: "proposals", params: { vault: "work", state: "pending", id: "p1" } });
  const select = container.querySelector<HTMLSelectElement>("#proposal-state")!; select.value = "rejected";
  act(() => select.dispatchEvent(new Event("change", { bubbles: true })));
  expect(navigations.at(-1)).toEqual({ panel: "proposals", params: { vault: "work", state: "rejected" } });
});

test("apply and reject send explicit actions and validate the reason", () => {
  const writes: ActionInput[] = [];
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  act(() => root.render(<ProposalsView reply={reply} params={{}} navigate={() => {}} beginWrite={(input) => writes.push(input)} />));
  act(() => [...container.querySelectorAll("button")].find((b) => b.textContent === "Preview apply")!.click());
  expect(writes).toEqual([{ action: "proposal-apply", vault: "work", id: "p1" }]);
  const form = container.querySelector("form")!;
  act(() => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(writes).toHaveLength(1); expect(container.textContent).toContain("Enter a reason");
  const field = container.querySelector<HTMLTextAreaElement>("#proposal-reason")!;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => { setter.call(field, "Not suitable"); field.dispatchEvent(new Event("input", { bubbles: true })); });
  act(() => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(writes.at(-1)).toEqual({ action: "proposal-reject", vault: "work", id: "p1", reason: "Not suitable" });
  field.value = "가".repeat(1366);
  act(() => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(writes).toHaveLength(2);
  expect(container.textContent).toContain("4096 bytes");
});

test("apply and reject require confirmation and stale previews are shown again", async () => {
  for (const action of ["proposal-apply", "proposal-reject"]) {
    const input = { action, vault: "work", id: "p1", ...(action === "proposal-reject" ? { reason: "Not suitable" } : {}) };
    const host = createFakeHost({ replies: { [action]: { ok: false, needsConfirm: true, fingerprint: "fp1", preview: ["review"] } } });
    const preview = await startWrite(host, input);
    expect(preview).toMatchObject({ phase: "preview", fingerprint: "fp1" });
    host.action = async (next) => { host.calls.action.push(next); return { ok: false, needsConfirm: true, fingerprint: "fp2", preview: ["updated"] }; };
    const stale = await confirmWrite(host, preview);
    expect(host.calls.action.at(-1)).toMatchObject({ confirmed: true, fingerprint: "fp1" });
    expect(stale).toMatchObject({ phase: "preview", fingerprint: "fp2" });
    host.action = async (next) => { host.calls.action.push(next); return { ok: true, message: "done" }; };
    expect(await confirmWrite(host, stale)).toMatchObject({ phase: "done", message: "done" });
    expect(host.calls.action.at(-1)).toMatchObject({ confirmed: true, fingerprint: "fp2" });
    host.action = async () => ({ ok: false, error: "provider refusal" });
    expect(await confirmWrite(host, stale)).toMatchObject({ phase: "error", message: expect.stringContaining("provider refusal") });
  }
});
