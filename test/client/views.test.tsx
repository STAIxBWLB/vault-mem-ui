import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PanelView } from "../../src/client/App.tsx";
import type { ClientState } from "../../src/client/store.ts";
import { DEFAULT_PREFS } from "../../src/client/prefs.ts";

function state(overrides: Partial<ClientState> = {}): ClientState {
  return {
    panel: "overview",
    params: {},
    reply: {},
    phase: "ready",
    prefs: DEFAULT_PREFS,
    theme: { mode: "light" },
    write: { phase: "idle" },
    ...overrides,
  };
}

const render = (current: ClientState): string =>
  renderToStaticMarkup(
    <PanelView
      state={current}
      onNavigate={() => {}}
      onWrite={() => {}}
      onTheme={() => {}}
      onConfirm={() => {}}
      onCancel={() => {}}
      reducedMotion={false}
      onToggleMotion={() => {}}
    />,
  );

/** What each panel is handed: the shape the vmem provider answers for that panel. */
const replies: Record<string, Record<string, unknown>> = {
  overview: {
    status: { vaults: [{ id: "work", kind: "personal", write: "ok", health: "ok" }] },
    vault: "work",
    noteCount: 3,
    mocs: [{ path: "notes/maps/index.md", title: "Index", count: 4 }],
    log: [{ at: "2026-11-21 09:12", type: "LEARN", project: "proj", source: "notes/a.md", agent: true }],
  },
  notes: {
    q: "",
    notes: [{ path: "notes/a.md", title: "Alpha", type: "note", domain: "work", description: "first" }],
  },
  note: {
    note: {
      path: "notes/a.md",
      title: "Alpha",
      sha256: "0123456789abcdef",
      body: "body line",
      frontmatter: { title: "Alpha", type: "note", status: "current" },
    },
    links: { out: [{ resolved: "notes/b.md" }], in: [{ source: "notes/c.md" }], dead: [{ target: "notes/gone.md" }] },
    orgVaults: ["org"],
  },
  promote: {
    projects: [{ candidates: [{ id: "mem-1", kind: "decision", title: "Use X", project: "proj", at: 1763000000000 }] }],
    selected: "mem-1",
    page: "0:0",
    nextPage: "1:0",
  },
  lint: {
    summary: "1 error, 0 warnings",
    findings: [{ code: "L01", severity: "error", path: "notes/a.md", message: "no title in `notes/a.md`" }],
  },
  log: {
    rows: [{ at: "2026-11-21 09:12", type: "LEARN", project: "proj", source: "notes/a.md", note: "n", agent: false }],
    cursor: "42",
    more: true,
  },
};

describe("PanelView", () => {
  test("renders each panel from the provider's own reply, and the nav marks the current one", () => {
    const overview = render(state({ panel: "overview", reply: replies.overview! }));
    expect(overview).toContain("Vaults");
    expect(overview).toContain("work");
    expect(overview).toContain("3 notes");
    expect(overview).toContain("Index");
    expect(overview).toContain('aria-current="page"');

    const notes = render(state({ panel: "notes", reply: replies.notes! }));
    expect(notes).toContain("Alpha");
    expect(notes).toContain('type="search"');

    const note = render(state({ panel: "note", reply: replies.note!, params: { path: "notes/a.md" } }));
    expect(note).toContain("body line");
    expect(note).toContain("Links (1 out, 1 in, 1 dead)");
    expect(note).toContain("→ notes/b.md");
    expect(note).toContain("Delete…");
    expect(note).toContain("Promote to org…");

    const promote = render(state({ panel: "promote", reply: replies.promote! }));
    expect(promote).toContain("Use X");
    expect(promote).toContain("Domain");
    expect(promote).toContain("Preview promotion…");

    const lint = render(state({ panel: "lint", reply: replies.lint! }));
    expect(lint).toContain("no title in `notes/a.md`");
    expect(lint).toContain("error");

    const log = render(state({ panel: "log", reply: replies.log! }));
    expect(log).toContain("LEARN notes/a.md");
    expect(log).toContain("Newer entries");
    expect(log).toContain("Older entries exist");
  });

  test("an empty reply says so instead of rendering an empty shell", () => {
    expect(render(state({ panel: "notes" }))).toContain("No notes");
    expect(render(state({ panel: "lint" }))).toContain("No lint findings");
    expect(render(state({ panel: "log" }))).toContain("Log is empty");
    expect(render(state({ panel: "promote" }))).toContain("No promotion candidates");
    expect(render(state({ panel: "overview", reply: { status: { vaults: [] } } }))).toContain("No vault registered");
  });

  test("a failing panel shows the error and keeps the navigation usable", () => {
    const markup = render(state({ phase: "error", error: "Could not load this panel: offline.", reply: null }));
    expect(markup).toContain("Could not load this panel: offline.");
    expect(markup).toContain('aria-label="Vault panels"');
  });

  test("the write dialog shows the fingerprint's own preview before anything is sent", () => {
    const markup = render(
      state({
        panel: "note",
        reply: replies.note!,
        write: {
          phase: "preview",
          input: { action: "delete", path: "notes/a.md" },
          fingerprint: "0123456789abcdef",
          verb: "Delete note",
          preview: ["delete notes/a.md"],
          changes: [{ op: "delete", target: "notes/a.md" }],
          warnings: ["1 link points here: notes/c.md"],
        },
      }),
    );
    expect(markup).toContain("Delete note");
    expect(markup).toContain("Nothing has been written yet");
    expect(markup).toContain("delete notes/a.md");
    expect(markup).toContain("1 link points here: notes/c.md");
    expect(markup).toContain("Confirm");
    expect(markup).toContain("Cancel");
    expect(markup).toContain('role="dialog"');
  });

  test("a finished or refused write is reported with a way to close it", () => {
    expect(render(state({ write: { phase: "done", message: "Delete note: done" } }))).toContain("Delete note: done");
    const refused = render(state({ write: { phase: "error", message: "path is required" } }));
    expect(refused).toContain("path is required");
    expect(refused).toContain("Close");
  });

  test("the person's theme and motion choice reach the markup as attributes, never as inline style", () => {
    const dark = render(state({ theme: { mode: "dark" }, prefs: { ...DEFAULT_PREFS, theme: "dark" } }));
    expect(dark).toContain('data-theme="dark"');
    const still = renderToStaticMarkup(
      <PanelView
        state={state()}
        onNavigate={() => {}}
        onWrite={() => {}}
        onTheme={() => {}}
        onConfirm={() => {}}
        onCancel={() => {}}
        reducedMotion
        onToggleMotion={() => {}}
      />,
    );
    expect(still).toContain('data-motion="reduced"');
    expect(still).toContain('aria-pressed="true"');
  });
});

describe("panel markup rules", () => {
  const all = (): [string, string][] => [
    ...Object.entries(replies).map(([panel, reply]) => [panel, render(state({ panel, reply }))] as [string, string]),
    [
      "write",
      render(
        state({
          write: {
            phase: "preview",
            input: { action: "delete", path: "notes/a.md" },
            fingerprint: "0123456789abcdef",
            verb: "Delete note",
            preview: ["delete notes/a.md"],
            changes: [{ op: "delete", target: "notes/a.md" }],
            warnings: [],
          },
        }),
      ),
    ],
  ];

  test("no inline style, no style element, no script and no inline handler, in any panel or in the dialog", () => {
    const rules: [string, RegExp][] = [
      ["an inline style attribute", / style=/i],
      ["a style element", /<style/i],
      ["a script element", /<script/i],
      ["an inline handler", / on[a-z]+=/i],
    ];
    for (const [panel, markup] of all()) {
      const broken = rules.filter(([, pattern]) => pattern.test(markup)).map(([name]) => `${panel}: ${name}`);
      expect(broken).toEqual([]);
    }
  });

  test("state travels as classes and data attributes, which is where the stylesheet looks for it", () => {
    const markup = render(state({ theme: { mode: "dark" } }));
    expect(markup).toContain('class="vmem"');
    expect(markup).toContain('data-theme="dark"');
    expect(markup).toContain("vmem-button");
  });

  test("every row that opens is a button, so the list works with Tab alone as well as with the arrows", () => {
    const broken: string[] = [];
    for (const [panel, markup] of all()) {
      for (const element of markup.match(/<(?!button\b)[a-z]+[^>]*\brole="button"/gi) ?? []) broken.push(`${panel}: ${element}`);
    }
    expect(broken).toEqual([]);
  });
});
