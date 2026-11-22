/** History: a note's revisions, and the changes between two of them picked from that list. Read-only. */

import { useState } from "react";
import { Empty, List, Notice } from "../components.tsx";
import { list, num, rec, str, when } from "../data.ts";
import type { ViewProps } from "./common.ts";
import { vaultParam } from "./common.ts";

/** Git's change letters as the words a person reads; anything else is shown as given. */
const CHANGE_TEXT: Record<string, string> = { A: "added", M: "modified", D: "deleted", T: "type changed" };

/**
 * The picked pair travels in these params. Every navigation remounts this view, so a half-picked pair would be lost
 * between two pages; vmem_history declares only vault, path, limit and cursor, and the provider's forward() copies
 * just declared properties, so the provider never sees these two.
 */
const PICK_FROM = "pickFrom";
const PICK_TO = "pickTo";

const short = (value: string): string => (value.length > 12 ? value.slice(0, 12) : value);

export function HistoryView({ reply, params, navigate }: ViewProps) {
  const vault = str(reply.vault) || str(params.vault);
  const path = str(reply.path) || str(params.path);
  const history = rec(reply.history);
  const changes = rec(reply.changes);
  const revisions = list<Record<string, unknown>>(history.revisions);
  const changed = list<Record<string, unknown>>(changes.changed);
  const error = str(reply.error);
  const coverage = rec(history.coverage);
  const reason = str(coverage.reason);
  const incomplete = coverage.complete === false;
  // `from`/`to` are the pair whose changes are on screen; the pick is what the person is still choosing, and it is
  // read back from the params so a page turn does not throw away half of it.
  const [pending, setPending] = useState({ from: str(params[PICK_FROM]) || str(params.from), to: str(params[PICK_TO]) || str(params.to) });
  const pick = (end: "from" | "to", revision: string) => setPending((pair) => ({ ...pair, [end]: revision }));
  const ready = pending.from !== "" && pending.to !== "" && pending.from !== pending.to;
  const nav = (extra: Record<string, string>) =>
    navigate("history", { ...(vault ? { vault } : {}), ...(path ? { path } : {}), ...extra });
  // Every chosen end is carried, including one that also appears as from/to: the revisions buttons send the cursor and
  // this pick only, so a skipped end would leave a shown pair behind on the next page.
  const pickParams = (): Record<string, string> => ({
    ...(pending.from ? { [PICK_FROM]: pending.from } : {}),
    ...(pending.to ? { [PICK_TO]: pending.to } : {}),
  });
  // Changes paging stays on the pair that produced the list: an old changesCursor sent with a newer pick would page a
  // list the person is no longer looking at. The pick rides along, so choosing a new pair survives a page turn too.
  const shownFrom = str(changes.from);
  const shownTo = str(changes.to);
  // Each list keeps its own page while the other one turns: both cursors belong to their own list (the changes cursor
  // to the pair, the revisions cursor to HEAD), so carrying the other one is safe. Each first-page button still drops
  // only its own cursor.
  const changesNav = (extra: Record<string, string>) =>
    nav({ from: shownFrom, to: shownTo, ...pickParams(), ...(params.cursor ? { cursor: params.cursor } : {}), ...extra });
  // A revisions page turn keeps the changes list on screen too: the pair that produced it travels with the cursor, so
  // only the revisions under it change.
  const revisionsNav = (extra: Record<string, string>) =>
    nav({
      ...pickParams(),
      ...(shownFrom && shownTo
        ? { from: shownFrom, to: shownTo, ...(params.changesCursor ? { changesCursor: params.changesCursor } : {}) }
        : {}),
      ...extra,
    });
  const historyMore = str(history.continuation);
  const changesMore = str(changes.continuation);
  const stop = str(history.stopReason);

  if (!path) {
    return <Empty title="No note selected" hint="Open a note, then choose History on that note." />;
  }
  // A refusal (unknown vault, a cursor the provider no longer knows, a half pair) answers no history at all, and the
  // refusal already names its cause and next step.
  if (error && !reply.history) return <Notice tone="err">{error}</Notice>;
  return (
    <>
      <h1>History</h1>
      {error ? <Notice tone="err">{error}</Notice> : null}
      <p className="vmem-sub">{path}</p>
      <section className="vmem-section" aria-label="Revisions">
        <h2 className="vmem-card-title">Revisions</h2>
        {incomplete && reason ? <Notice tone="warn">{reason}</Notice> : null}
        {revisions.length === 0 && !incomplete ? (
          <Empty title="No history" hint="This note has no commit yet, or the path is not in the vault's first-parent history." />
        ) : null}
        <List
          label="Revisions"
          items={revisions.map((revision) => {
            const id = str(revision.revision);
            return {
              key: id,
              title: `Revision ${short(id)}`,
              sub: [when(revision.committedAt), `${str(revision.bytes)} bytes`, revision.blob ? `blob ${short(str(revision.blob))}` : ""].filter(Boolean).join(" · "),
              verbs: (
                <>
                  <button type="button" className="vmem-button" aria-pressed={pending.from === id} onClick={() => pick("from", id)}>
                    From
                  </button>
                  <button type="button" className="vmem-button" aria-pressed={pending.to === id} onClick={() => pick("to", id)}>
                    To
                  </button>
                </>
              ),
            };
          })}
        />
        <div className="vmem-bar">
          {params.cursor ? (
            <button type="button" className="vmem-button" onClick={() => revisionsNav({})}>
              Newest revisions
            </button>
          ) : null}
          {historyMore ? (
            <button type="button" className="vmem-button" onClick={() => revisionsNav({ cursor: historyMore })}>
              Older revisions
            </button>
          ) : null}
        </div>
        {stop === "scan_limit" || stop === "transport_limit" ? (
          <Notice tone="warn">The provider stopped reading history at its {stop === "scan_limit" ? "scan limit" : "transport limit"}; older commits exist beyond this page.</Notice>
        ) : null}
      </section>
      <section className="vmem-section" aria-label="Changes">
        <h2 className="vmem-card-title">Changes</h2>
        <p className="vmem-sub">
          From {pending.from ? short(pending.from) : "not chosen"} to {pending.to ? short(pending.to) : "not chosen"}
        </p>
        <div className="vmem-bar">
          <button type="button" className="vmem-button vmem-button-primary" disabled={!ready} onClick={() => nav({ from: pending.from, to: pending.to })}>
            Show changes
          </button>
          {pending.from || pending.to ? (
            <button
              type="button"
              className="vmem-button"
              onClick={() => {
                setPending({ from: "", to: "" });
                nav({});
              }}
            >
              Clear
            </button>
          ) : null}
        </div>
        {shownFrom && shownTo ? (
          <>
            <p className="vmem-sub">
              {changed.length} {changed.length === 1 ? "note" : "notes"} changed between {short(shownFrom)} and {short(shownTo)}
              {changes.total !== undefined ? ` of ${str(changes.total)}` : ""}
            </p>
            <List
              label="Changed notes"
              items={changed.map((note) => {
                const status = str(note.status);
                const notePath = str(note.path);
                return {
                  key: `${status}:${notePath}`,
                  title: notePath,
                  sub: [CHANGE_TEXT[status] ?? status, note.before ? `before ${short(str(note.before))}` : "", note.after ? `after ${short(str(note.after))}` : ""].filter(Boolean).join(" · "),
                  chip: { text: status || "?", tone: status === "D" ? "err" : status === "A" ? "neutral" : "warn" },
                  ...(notePath && status !== "D" ? { onOpen: () => navigate("note", { path: notePath, ...vaultParam(params) }) } : {}),
                };
              })}
              empty={<Empty title="No changes" hint="These revisions change no notes in this vault." />}
            />
            <div className="vmem-bar">
              {params.changesCursor ? (
                <button type="button" className="vmem-button" onClick={() => changesNav({})}>
                  First page
                </button>
              ) : null}
              {changesMore ? (
                <button type="button" className="vmem-button" onClick={() => changesNav({ changesCursor: changesMore })}>
                  More changes
                </button>
              ) : null}
            </div>
            {num(changes.skippedDenied) || num(changes.skippedSymlink) ? (
              <Notice tone="warn">
                {num(changes.skippedDenied)} denied {num(changes.skippedDenied) === 1 ? "path" : "paths"} and {num(changes.skippedSymlink)} symlink
                {num(changes.skippedSymlink) === 1 ? "" : "s"} are left out of this list.
              </Notice>
            ) : null}
            {changes.truncated === true ? <p className="vmem-sub">The provider stopped at its page limit; continue to the next page.</p> : null}
          </>
        ) : null}
      </section>
    </>
  );
}
