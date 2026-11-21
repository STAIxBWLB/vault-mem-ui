/** Search / notes list: a query, or the newest notes when the query is empty. */

import { Empty, List, Notice, SearchForm } from "../components.tsx";
import { list, str, type NoteRow } from "../data.ts";
import type { ViewProps } from "./common.ts";
import { vaultParam } from "./common.ts";

export function NotesView({ reply, params, navigate }: ViewProps) {
  const q = str(reply.q);
  const notes = list<NoteRow>(reply.notes);
  const error = str(reply.error);
  return (
    <>
      <SearchForm value={q} onSubmit={(next) => navigate("notes", { ...(next ? { q: next } : {}), ...vaultParam(params) })} />
      {error ? <Notice tone="err">{error}</Notice> : null}
      <List
        label={q ? `Results for ${q}` : "Notes"}
        items={notes.map((note) => ({
          key: note.path,
          title: str(note.title) || note.path,
          sub: [str(note.type), str(note.domain), str(note.description)].filter(Boolean).join(" · "),
          onOpen: () => navigate("note", { path: note.path, ...vaultParam(params) }),
        }))}
        empty={
          q ? (
            <Empty title="No notes match" hint="Try fewer words: terms are combined with AND." />
          ) : (
            <Empty title="No notes" hint="This vault holds no notes yet, or the vault is not readable." />
          )
        }
      />
    </>
  );
}
