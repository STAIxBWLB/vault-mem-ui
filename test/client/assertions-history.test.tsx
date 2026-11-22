/**
 * The two read-only panels: assertions (the journal's answer plus every coverage gap) and history (a note's
 * revisions and the changes between two of them). The replies below are the shapes the provider answers with
 * (`AssertionsSnapshot` and `HistorySnapshot`); the content is synthetic.
 */

import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AssertionsView } from "../../src/client/views/assertions.tsx";
import { HistoryView } from "../../src/client/views/history.tsx";

let root: Root;
let container: HTMLElement;
beforeAll(() => { GlobalRegistrator.register(); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => { act(() => root?.unmount()); container?.remove(); });
afterAll(async () => { await GlobalRegistrator.unregister(); });

const mount = (view: React.ReactElement, navigations: unknown[] = []): unknown[] => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(view));
  return navigations;
};

const navigate = (navigations: unknown[]) => (panel: string, params?: Record<string, string>) => navigations.push({ panel, params });
const button = (text: string) => [...container.querySelectorAll("button")].find((b) => b.textContent === text);
const rows = (label: string) => [...container.querySelectorAll(`ul[aria-label="${label}"] li.vmem-list-item`)];
const verb = (row: Element, text: string) => [...row.querySelectorAll("button")].find((b) => b.textContent === text)!;
const click = (element: HTMLElement) => act(() => element.click());

// ---------------------------------------------------------------- assertions

const assertion = {
  id: "a1", rev: 2, op: "revise", subject: "notes/a.md", relation: "status", value: "current", kind: "state",
  hash: "h1", recordedAt: "2026-01-02T03:04:05Z", reason: "review", subjectNote: { path: "notes/a.md", status: "present" },
};
const withheld = {
  id: "a2", rev: 1, op: "assert", subject: "notes/b.md", relation: "owner", value: { withheld: "secret" },
  hash: "h2", recordedAt: "2026-01-02T05:00:00Z", subjectNote: { path: "notes/b.md", status: "present" },
};
const missing = {
  id: "a3", rev: 1, op: "retract", subject: "notes/gone.md", relation: "status", hash: "h3",
  recordedAt: "2026-01-02T06:00:00Z", subjectNote: { path: "notes/gone.md", status: "missing" },
};
const assertionsReply = {
  vault: "work",
  result: {
    schemaVersion: 1, basis: "assertion_journal", vault: "work", at: "2026-01-02T07:00:00Z",
    asOf: { requested: "2026-01-01", cutoff: "2026-01-01T00:00:00Z", cutoffInclusive: false },
    pin: [], coverage: {}, items: [assertion, withheld, missing], truncated: true, continuation: "c1",
  },
  warnings: [
    { tone: "err", message: "1 journal entry is untrusted and left out (seg#3: bad hash); run `vmem assertions work --history --json`" },
    { tone: "warn", message: "1 assertion file is not committed; run `vmem sync` to share them" },
    { tone: "neutral", message: "1 purged payload is not shown" },
  ],
};

test("assertions: the journal's answer, each coverage gap as its own notice, and the links a row may offer", () => {
  const navigations: unknown[] = [];
  mount(<AssertionsView reply={assertionsReply} params={{ vault: "work" }} navigate={navigate(navigations)} beginWrite={() => {}} />, navigations);
  expect(container.textContent).toContain("notes/a.md status current");
  expect(container.textContent).toContain("revise · rev 2 · state · 2026-01-02 03:04 · review");
  expect(container.textContent).toContain("3 assertions · as of 2026-01-01 00:00 (exclusive)");
  expect(container.textContent).toContain("withheld (secret)");
  expect(container.textContent).toContain("note missing");

  // The three coverage tones: err is an alert, warn and information are status text.
  const notices = [...container.querySelectorAll(".vmem-notice")];
  expect(notices.map((n) => n.className)).toEqual(["vmem-notice vmem-notice-err", "vmem-notice vmem-notice-warn", "vmem-notice vmem-notice-info"]);
  expect(notices[0]!.getAttribute("role")).toBe("alert");
  expect(notices[1]!.getAttribute("role")).toBe("status");
  expect(notices[2]!.textContent).toContain("purged payload is not shown");

  // A present note is reachable; a missing one is shown but opens nothing.
  expect(rows("Assertions")).toHaveLength(3);
  click(rows("Assertions")[0]!.querySelector("button.vmem-row") as HTMLElement);
  expect(navigations.at(-1)).toEqual({ panel: "note", params: { path: "notes/a.md", vault: "work" } });
  click(rows("Assertions")[2]!.querySelector("button.vmem-row") as HTMLElement);
  expect(navigations).toHaveLength(1);
  expect(rows("Assertions")[2]!.querySelector("button.vmem-row")!.getAttribute("aria-disabled")).toBe("true");

  expect(container.textContent).toContain("The provider stopped at its page limit");
  click(button("Next page")!);
  expect(navigations.at(-1)).toEqual({ panel: "assertions", params: { vault: "work", cursor: "c1" } });
});

test("assertions: a paged answer can go back to the first page, and an empty or refused one says so", () => {
  const navigations: unknown[] = [];
  mount(<AssertionsView reply={assertionsReply} params={{ vault: "work", cursor: "c0" }} navigate={navigate(navigations)} beginWrite={() => {}} />, navigations);
  click(button("First page")!);
  expect(navigations.at(-1)).toEqual({ panel: "assertions", params: { vault: "work" } });

  const empty: unknown[] = [];
  act(() => root.render(<AssertionsView reply={{ vault: "work", result: null, warnings: [] }} params={{ vault: "work" }} navigate={navigate(empty)} beginWrite={() => {}} />));
  expect(container.textContent).toContain("No assertions");
  expect(container.textContent).toContain("Record one with vmem assert, then reload this panel.");
  expect(container.querySelector('ul[aria-label="Assertions"]')).toBeNull();

  act(() => root.render(
    <AssertionsView
      reply={{ vault: null, result: null, warnings: [], error: "unknown vault nope; pick a registered vault from Overview" }}
      params={{ vault: "nope" }}
      navigate={navigate(empty)}
      beginWrite={() => {}}
    />,
  ));
  expect(container.textContent).toContain("unknown vault nope; pick a registered vault from Overview");
  expect(container.querySelector(".vmem-notice-err")?.getAttribute("role")).toBe("alert");
});

// ---------------------------------------------------------------- history

const older = { revision: "aaaaaaaaaaaa1111", blob: "bbbbbbbbbbbb2222", bytes: 120, committedAt: "2026-01-02T03:04:05Z" };
const newer = { revision: "cccccccccccc3333", blob: "dddddddddddd4444", bytes: 130, committedAt: "2026-01-03T03:04:05Z" };
const history = {
  path: "notes/a.md", revisions: [newer, older], scanned: 12, scanLimit: 500, pageLimit: 20,
  stopReason: "page_full", truncated: true, continuation: "h2", skippedSymlink: 0,
};
const historyReply = { vault: "work", path: "notes/a.md", history, changes: null };

test("history: the revisions, older ones paged, and the stop reason when the provider read only part of it", () => {
  const navigations: unknown[] = [];
  mount(<HistoryView reply={historyReply} params={{ path: "notes/a.md" }} navigate={navigate(navigations)} beginWrite={() => {}} />, navigations);
  expect(container.textContent).toContain("notes/a.md");
  expect(rows("Revisions")).toHaveLength(2);
  expect(rows("Revisions")[0]!.textContent).toContain("Revision cccccccccccc");
  expect(rows("Revisions")[0]!.textContent).toContain("2026-01-03 03:04 · 130 bytes · blob dddddddddd");
  click(button("Older revisions")!);
  expect(navigations.at(-1)).toEqual({ panel: "history", params: { vault: "work", path: "notes/a.md", cursor: "h2" } });

  act(() => root.render(
    <HistoryView
      reply={{ ...historyReply, history: { ...history, stopReason: "scan_limit", continuation: undefined } }}
      params={{ path: "notes/a.md" }}
      navigate={navigate(navigations)}
      beginWrite={() => {}}
    />,
  ));
  expect(container.textContent).toContain("The provider stopped reading history at its scan limit");
});

test("history: two picked revisions are sent together, and one pick alone never asks for changes", () => {
  const navigations: unknown[] = [];
  mount(<HistoryView reply={historyReply} params={{ path: "notes/a.md" }} navigate={navigate(navigations)} beginWrite={() => {}} />, navigations);
  expect(button("Show changes")!.hasAttribute("disabled")).toBe(true);
  expect(container.textContent).toContain("From not chosen to not chosen");

  click(verb(rows("Revisions")[0]!, "From"));
  expect(verb(rows("Revisions")[0]!, "From").getAttribute("aria-pressed")).toBe("true");
  expect(button("Show changes")!.hasAttribute("disabled")).toBe(true);
  expect(navigations).toEqual([]);
  // The same revision at both ends is not a change, so it does not enable the button either.
  click(verb(rows("Revisions")[0]!, "To"));
  expect(button("Show changes")!.hasAttribute("disabled")).toBe(true);

  click(verb(rows("Revisions")[1]!, "To"));
  expect(container.textContent).toContain("From cccccccccccc to aaaaaaaaaaaa");
  expect(button("Show changes")!.hasAttribute("disabled")).toBe(false);
  click(button("Show changes")!);
  expect(navigations.at(-1)).toEqual({
    panel: "history",
    params: { vault: "work", path: "notes/a.md", from: "cccccccccccc3333", to: "aaaaaaaaaaaa1111" },
  });
});

test("history: the provider's half-pair refusal is shown as given and the revisions stay to pick from", () => {
  const navigations: unknown[] = [];
  mount(
    <HistoryView
      reply={{ ...historyReply, error: "changes need both from and to commit ids; pick two revisions from the history list" }}
      params={{ path: "notes/a.md", from: older.revision }}
      navigate={navigate(navigations)}
      beginWrite={() => {}}
    />,
    navigations,
  );
  expect(container.textContent).toContain("changes need both from and to commit ids; pick two revisions from the history list");
  expect(container.querySelector(".vmem-notice-err")?.getAttribute("role")).toBe("alert");
  expect(rows("Revisions")).toHaveLength(2);
  expect(container.textContent).toContain("From aaaaaaaaaaaa to not chosen");
});

test("history: the changes between two revisions, paged, with deleted notes shown but not opened", () => {
  const navigations: unknown[] = [];
  const changes = {
    from: older.revision, to: newer.revision,
    changed: [
      { path: "notes/a.md", status: "M", before: "1111aaaa2222", after: "3333bbbb4444" },
      { path: "notes/new.md", status: "A", before: null, after: "5555cccc6666" },
      { path: "notes/gone.md", status: "D", before: "7777dddd8888", after: null },
      { path: "notes/link.md", status: "T", before: "9999eeee0000", after: "9999eeee0000" },
    ],
    total: 6, truncated: true, continuation: "ch2", skippedDenied: 2, skippedSymlink: 1,
  };
  mount(
    <HistoryView
      reply={{ ...historyReply, changes }}
      params={{ path: "notes/a.md", from: older.revision, to: newer.revision, changesCursor: "ch1" }}
      navigate={navigate(navigations)}
      beginWrite={() => {}}
    />,
    navigations,
  );
  expect(container.textContent).toContain("4 notes changed between aaaaaaaaaaaa and cccccccccccc of 6");
  expect(rows("Changed notes").map((r) => r.textContent)).toEqual([
    "notes/a.mdmodified · before 1111aaaa2222 · after 3333bbbb4444M",
    "notes/new.mdadded · after 5555cccc6666A",
    "notes/gone.mddeleted · before 7777dddd8888D",
    "notes/link.mdtype changed · before 9999eeee0000 · after 9999eeee0000T",
  ]);
  expect([...container.querySelectorAll('ul[aria-label="Changed notes"] .vmem-chip')].map((c) => c.className)).toEqual([
    "vmem-chip vmem-chip-warn",
    "vmem-chip vmem-chip-neutral",
    "vmem-chip vmem-chip-err",
    "vmem-chip vmem-chip-warn",
  ]);
  click([...container.querySelectorAll('ul[aria-label="Changed notes"] button.vmem-row')][0] as HTMLElement);
  expect(navigations.at(-1)).toEqual({ panel: "note", params: { path: "notes/a.md" } });
  click([...container.querySelectorAll('ul[aria-label="Changed notes"] button.vmem-row')][2] as HTMLElement);
  expect(navigations).toHaveLength(1);

  expect(container.textContent).toContain("2 denied paths and 1 symlink are left out of this list.");
  expect(container.textContent).toContain("The provider stopped at its page limit; continue to the next page.");
  click(button("More changes")!);
  expect(navigations.at(-1)).toEqual({
    panel: "history",
    params: { vault: "work", path: "notes/a.md", from: older.revision, to: newer.revision, changesCursor: "ch2" },
  });
  click(button("First page")!);
  expect(navigations.at(-1)).toEqual({
    panel: "history",
    params: { vault: "work", path: "notes/a.md", from: older.revision, to: newer.revision },
  });
});

test("history: a pair that changes nothing, and a note the panel was not given", () => {
  const navigations: unknown[] = [];
  const changes = { from: older.revision, to: newer.revision, changed: [], total: 0, truncated: false, skippedDenied: 0, skippedSymlink: 0 };
  mount(
    <HistoryView
      reply={{ ...historyReply, changes }}
      params={{ path: "notes/a.md", from: older.revision, to: newer.revision }}
      navigate={navigate(navigations)}
      beginWrite={() => {}}
    />,
    navigations,
  );
  expect(container.textContent).toContain("No changes");
  expect(container.textContent).toContain("These revisions change no notes in this vault.");

  act(() => root.render(<HistoryView reply={{ vault: null, path: null, history: null, changes: null }} params={{}} navigate={navigate(navigations)} beginWrite={() => {}} />));
  expect(container.textContent).toContain("No note selected");
  expect(container.textContent).toContain("Open a note, then choose History on that note.");

  act(() => root.render(<HistoryView reply={{ ...historyReply, history: null }} params={{ path: "notes/a.md" }} navigate={navigate(navigations)} beginWrite={() => {}} />));
  expect(container.textContent).toContain("No history");
  act(() => root.render(<HistoryView reply={{ ...historyReply, history: { ...history, revisions: [] } }} params={{ path: "notes/a.md" }} navigate={navigate(navigations)} beginWrite={() => {}} />));
  expect(container.textContent).toContain("No history");
});
