/** One note: its frontmatter, body and links, with delete, move and promote as previewed writes. */

import { useState } from "react";
import { Chip, Empty, Field, List, Notice } from "../components.tsx";
import { list, rec, str, type LinkRow } from "../data.ts";
import type { ViewProps } from "./common.ts";
import { vaultParam } from "./common.ts";

export function NoteView({ reply, params, navigate, beginWrite }: ViewProps) {
  const note = rec(reply.note);
  const error = str(reply.error);
  const orgVaults = list<string>(reply.orgVaults).map(str);
  const [to, setTo] = useState("");
  const [org, setOrg] = useState(orgVaults[0] ?? "");
  const [topics, setTopics] = useState("");
  const [again, setAgain] = useState(false);
  if (error) return <Notice tone="err">{error}</Notice>;
  if (!note.path) {
    return <Empty title="No note selected" hint="Open a note from Search or from a link in another note." />;
  }
  const path = str(note.path);
  const front = rec(note.frontmatter);
  const links = rec(reply.links);
  const out = list<LinkRow>(links.out);
  const back = list<LinkRow>(links.in);
  const dead = list<LinkRow>(links.dead);
  const rows = [
    ...out.map((link) => ({ key: `out:${str(link.resolved)}`, label: `→ ${str(link.resolved)}`, path: str(link.resolved) })),
    ...back.map((link) => ({ key: `in:${str(link.source)}`, label: `← ${str(link.source)}`, path: str(link.source) })),
    ...dead.map((link) => ({ key: `dead:${str(link.target)}`, label: `✕ ${str(link.target)}`, path: "" })),
  ];
  return (
    <>
      <header className="vmem-detail-head">
        <p className="vmem-sub">
          {str(front.type) || "note"}
          {front.status ? <Chip text={str(front.status)} tone={str(front.status) === "superseded" ? "warn" : "neutral"} /> : null}
        </p>
        <h1 className="vmem-detail-title">{str(front.title) || path}</h1>
        {front.description ? <p className="vmem-sub">{str(front.description)}</p> : null}
      </header>
      <div className="vmem-bar">
        <button
          type="button"
          className="vmem-button vmem-button-danger"
          onClick={() => beginWrite({ action: "delete", path, ...vaultParam(params) })}
        >
          Delete…
        </button>
        <button type="button" className="vmem-button" onClick={() => navigate("history", { path, ...vaultParam(params) })}>
          History…
        </button>
        <form
          className="vmem-inline"
          onSubmit={(event) => {
            event.preventDefault();
            if (to.trim()) beginWrite({ action: "move", from: path, to: to.trim(), ...vaultParam(params) });
          }}
        >
          <Field name="to" label="New stem" value={to} placeholder="new-stem" onChange={setTo} />
          <button type="submit" className="vmem-button">
            Move…
          </button>
        </form>
      </div>
      {orgVaults.length ? (
        <form
          className="vmem-inline vmem-promote-form"
          onSubmit={(event) => {
            event.preventDefault();
            beginWrite({
              action: "promote",
              path,
              to: org,
              ...(topics.trim() ? { topics: topics.trim() } : {}),
              ...(again ? { again: true } : {}),
              ...vaultParam(params),
            });
          }}
        >
          <label className="vmem-label" htmlFor="vmem-org">
            Org vault
          </label>
          <select id="vmem-org" className="vmem-input" value={org} onChange={(event) => setOrg(event.currentTarget.value)}>
            {orgVaults.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
          <Field name="orgTopics" label="Topics (optional)" value={topics} placeholder="topic, topic" onChange={setTopics} />
          <label className="vmem-check">
            <input type="checkbox" checked={again} onChange={(event) => setAgain(event.currentTarget.checked)} /> promote again
          </label>
          <button type="submit" className="vmem-button">
            Promote to org…
          </button>
        </form>
      ) : null}
      <section className="vmem-section" aria-label="Body">
        <pre className="vmem-body">{str(note.body)}</pre>
        {note.truncated ? <Notice tone="warn">Truncated; open the file for the rest.</Notice> : null}
      </section>
      <section className="vmem-section" aria-label="Links">
        <h2 className="vmem-card-title">
          Links ({out.length} out, {back.length} in{dead.length ? `, ${dead.length} dead` : ""})
        </h2>
        <List
          label="Links"
          items={rows.map((row) => ({
            key: row.key,
            title: row.label,
            ...(row.path ? { onOpen: () => navigate("note", { path: row.path, ...vaultParam(params) }) } : {}),
          }))}
          empty={<Empty title="No links" />}
        />
      </section>
      <p className="vmem-sub vmem-footer">
        {path} · sha256 {str(note.sha256).slice(0, 12)}
      </p>
    </>
  );
}
