/** Log: the vault's change log, newest first, with a type filter and a cursor for newer rows. */

import { useState } from "react";
import { Empty, List, Notice } from "../components.tsx";
import { list, str, when, type LogRow } from "../data.ts";
import type { ViewProps } from "./common.ts";
import { vaultParam } from "./common.ts";

export function LogView({ reply, params, navigate }: ViewProps) {
  const rows = list<LogRow>(reply.rows);
  const error = str(reply.error);
  const cursor = str(reply.cursor);
  const [type, setType] = useState(params.type ?? "");
  return (
    <>
      {error ? <Notice tone="err">{error}</Notice> : null}
      <form
        className="vmem-bar"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          const next = type.trim();
          navigate("log", { ...(next ? { type: next } : {}), ...vaultParam(params) });
        }}
      >
        <input
          className="vmem-input"
          type="search"
          name="type"
          value={type}
          placeholder="Filter by type (e.g. LEARN)"
          aria-label="Filter the log by type"
          onChange={(event) => setType(event.currentTarget.value)}
        />
        <button type="submit" className="vmem-button">
          Filter
        </button>
        {cursor ? (
          <button
            type="button"
            className="vmem-button"
            onClick={() => navigate("log", { since: cursor, ...(type.trim() ? { type: type.trim() } : {}), ...vaultParam(params) })}
          >
            Newer entries
          </button>
        ) : null}
      </form>
      <List
        label="Log"
        items={rows.map((row, index) => {
          const path = str(row.dest) || str(row.source);
          return {
            key: `${index}:${str(row.at)}:${str(row.source)}`,
            title: row.raw ?? `${str(row.type)} ${str(row.source)}${row.dest ? ` → ${str(row.dest)}` : ""}`,
            sub: row.raw ? "unparsed line" : [when(row.at), str(row.project), str(row.note), row.agent ? "agent" : ""].filter(Boolean).join(" · "),
            ...(path.startsWith("notes/") ? { onOpen: () => navigate("note", { path, ...vaultParam(params) }) } : {}),
          };
        })}
        empty={<Empty title="Log is empty" hint="A write appends a line here." />}
      />
      {reply.more ? <p className="vmem-sub">Older entries exist; narrow the filter to see them.</p> : null}
    </>
  );
}
