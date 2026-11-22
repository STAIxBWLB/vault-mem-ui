/** History: a note's revisions, and the changes between two of them picked from that list. Read-only. */

import { useState } from "react";
import { Empty, List, Notice } from "../components.tsx";
import { list, num, rec, str, when } from "../data.ts";
import type { ViewProps } from "./common.ts";
import { vaultParam } from "./common.ts";

/** Git's change letters as the words a person reads; anything else is shown as given. */
const CHANGE_TEXT: Record<string, string> = { A: "added", M: "modified", D: "deleted", T: "type changed" };

const short = (value: string): string => (value.length > 12 ? value.slice(0, 12) : value);

export function HistoryView({ reply, params, navigate }: ViewProps) {
  const vault = str(reply.vault) || str(params.vault);
  const path = str(reply.path) || str(params.path);
  const history = rec(reply.history);
  const changes = rec(reply.changes);
  const revisions = list<Record<string, unknown>>(history.revisions);
  const changed = list<Record<string, unknown>>(changes.changed);
  const error = str(reply.error);
  // The picked pair lives here until both ends are chosen, because the provider refuses a half pair and would then
  // answer no history at all, leaving nothing to pick the second end from.
  const [pending, setPending] = useState({ from: str(params.from), to: str(params.to) });
  // Another note starts a fresh pair; the pair a link carries is the one already shown.
  const [seenPath, setSeenPath] = useState(path);
  if (path !== seenPath) {
    setSeenPath(path);
    setPending({ from: str(params.from), to: str(params.to) });
  }
  const nav = (extra: Record<string, string>) =>
    navigate("history", { ...(vault ? { vault } : {}), ...(path ? { path } : {}), ...extra });
  const pick = (end: "from" | "to", revision: string) => setPending((pair) => ({ ...pair, [end]: revision }));
  const ready = pending.from !== "" && pending.to !== "" && pending.from !== pending.to;
  const historyMore = str(history.continuation);
  const changesMore = str(changes.continuation);
  const stop = str(history.stopReason);

  if (!path) {
    return <Empty title="No note selected" hint="Open a note, then choose History on that note." />;
  }
  return (
    <>
      <h1>History</h1>
      {error ? <Notice tone="err">{error}</Notice> : null}
      <p className="vmem-sub">{path}</p>
      <section className="vmem-section" aria-label="Revisions">
        <h2 className="vmem-card-title">Revisions</h2>
        {revisions.length === 0 ? <Empty title="No history" hint="This note has no commit yet, or the path is not in the vault's first-parent history." /> : null}
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
          {historyMore ? (
            <button type="button" className="vmem-button" onClick={() => nav({ cursor: historyMore, ...(pending.from && pending.to ? { from: pending.from, to: pending.to } : {}) })}>
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
        {changes.from && changes.to ? (
          <>
            <p className="vmem-sub">
              {changed.length} {changed.length === 1 ? "note" : "notes"} changed between {short(str(changes.from))} and {short(str(changes.to))}
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
                <button type="button" className="vmem-button" onClick={() => nav({ from: pending.from, to: pending.to })}>
                  First page
                </button>
              ) : null}
              {changesMore ? (
                <button type="button" className="vmem-button" onClick={() => nav({ from: pending.from, to: pending.to, changesCursor: changesMore })}>
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
