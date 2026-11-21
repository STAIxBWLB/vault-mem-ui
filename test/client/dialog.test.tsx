/**
 * The write dialog against a real DOM: opening moves the focus into it, Tab cannot leave it, and closing returns the
 * focus to the control that opened it. happy-dom is registered here only, so the rest of the suite stays DOM-free.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WriteDialog } from "../../src/client/components.tsx";
import type { WriteState } from "../../src/client/write.ts";

let root: Root | null = null;
let container: HTMLElement;

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  document.body.replaceChildren();
});

const preview: WriteState = {
  phase: "preview",
  input: { action: "delete", path: "notes/a.md" },
  fingerprint: "0123456789abcdef",
  verb: "Delete note",
  preview: ["delete notes/a.md"],
  changes: [{ op: "delete", target: "notes/a.md" }],
  warnings: [],
};

/** A panel behind the overlay, holding the focus the way the delete button would. */
function outside(): HTMLButtonElement {
  const opener = document.createElement("button");
  opener.textContent = "Delete…";
  document.body.append(opener);
  opener.focus();
  return opener;
}

function mount(state: WriteState, onCancel = () => {}) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(<WriteDialog state={state} onConfirm={() => {}} onCancel={onCancel} />));
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const focused = () => document.activeElement;
const press = (key: string, shiftKey = false) => {
  const target = focused() ?? document.body;
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true }));
  });
};

describe("WriteDialog focus", () => {
  test("opening moves the focus into the dialog, so the panel behind it cannot be typed into", () => {
    const opener = outside();
    mount(preview);
    expect(focused()).not.toBe(opener);
    expect(dialog()?.contains(focused())).toBe(true);
    expect(focused()).toBe(dialog());
  });

  test("the first Tab enters the controls and Tab wraps at the last one instead of reaching the panel", () => {
    outside();
    mount(preview);
    press("Tab");
    const [confirm, cancel] = [...dialog()!.querySelectorAll("button")];
    expect(focused()).toBe(confirm);
    // The platform moves between the controls; what the dialog owns is the edge, and it wraps there.
    act(() => cancel!.focus());
    press("Tab");
    expect(focused()).toBe(confirm);
    expect(dialog()?.contains(focused())).toBe(true);
  });

  test("Shift+Tab wraps backwards from the first control to the last", () => {
    outside();
    mount(preview);
    press("Tab");
    press("Tab", true);
    const buttons = [...dialog()!.querySelectorAll("button")];
    expect(focused()).toBe(buttons[buttons.length - 1]!);
  });

  test("Escape handling is the panel's, and closing returns the focus to the control that opened it", () => {
    const opener = outside();
    let closed = 0;
    mount(preview, () => {
      closed += 1;
    });
    expect(closed).toBe(0);
    const cancel = [...dialog()!.querySelectorAll("button")][1]!;
    act(() => cancel.click());
    expect(closed).toBe(1);
    // The parent would drop the dialog on cancel; unmount stands in for that here.
    act(() => root!.unmount());
    root = null;
    expect(focused()).toBe(opener);
  });

  test("a finished write keeps the dialog reachable and closeable", () => {
    outside();
    mount({ phase: "error", message: "path is required. Fix that and start the write again." });
    expect(dialog()?.contains(focused())).toBe(true);
    expect(dialog()?.textContent).toContain("Refused");
    expect(dialog()?.querySelector("button")?.textContent).toBe("Close");
  });

  test("a cancelled write and a host-reported outcome each render their own heading", () => {
    outside();
    mount({ phase: "cancelled", message: "delete: cancelled, so nothing was written." });
    expect(dialog()?.textContent).toContain("Cancelled");
    act(() => root!.unmount());
    mount({ phase: "done", message: "Delete note: done" });
    expect(dialog()?.textContent).toContain("Done");
    act(() => root!.unmount());
    // A host that already reported the outcome keeps no dialog at all.
    mount({ phase: "done", message: "Delete note: done", quiet: true });
    expect(dialog()).toBeNull();
  });
});
