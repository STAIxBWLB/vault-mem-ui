import { afterAll, beforeAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { App } from "../../src/client/App";
import { createFakeHost } from "../../src/client/fake";
import { createStore } from "../../src/client/store";

beforeAll(() => { GlobalRegistrator.register(); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterAll(async () => { await GlobalRegistrator.unregister(); });

test("search shortcut leaves editable fields, modifiers and composition alone", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const outside = document.createElement("input");
  document.body.append(outside);
  const root = createRoot(container);
  const store = createStore(createFakeHost({ snapshots: { overview: { status: { vaults: [] } } } }));
  await store.refresh();
  await act(async () => { root.render(<App store={store} />); });
  const search = container.querySelector<HTMLInputElement>('input[type="search"]')!;
  const key = (target: Element, extra: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true, ...extra });
    target.dispatchEvent(event);
    return event;
  };
  try {
    search.focus();
    expect(key(search).defaultPrevented).toBe(false);
    outside.focus();
    expect(key(outside).defaultPrevented).toBe(false);
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    document.body.append(editable);
    expect(key(editable).defaultPrevented).toBe(false);
    expect(key(document.body, { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(key(document.body, { isComposing: true }).defaultPrevented).toBe(false);
    const shortcut = key(document.body);
    expect(shortcut.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(search);
    editable.remove();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    outside.remove();
  }
});
