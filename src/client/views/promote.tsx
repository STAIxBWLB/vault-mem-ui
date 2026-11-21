/** Promote: durable agent memories offered to the vault, with the fields a promotion needs. */

import { useState } from "react";
import { Chip, Empty, Field, List, Notice } from "../components.tsx";
import { list, num, rec, str, when, type CandidateRow } from "../data.ts";
import type { ViewProps } from "./common.ts";
import { vaultParam } from "./common.ts";

export function PromoteView({ reply, params, navigate, beginWrite }: ViewProps) {
  const projects = list<{ candidates?: CandidateRow[] }>(reply.projects);
  const all = projects.flatMap((project) => list<CandidateRow>(project.candidates));
  const selected = all.find((candidate) => candidate.id === str(reply.selected));
  const [values, setValues] = useState<Record<string, string>>({});
  const unavailable = str(reply.unavailable);
  const page = str(reply.page);
  const nextPage = str(reply.nextPage);
  const pageIndex = Number((page.split(":")[1] ?? "").trim());
  const showFirst = Number.isSafeInteger(pageIndex) ? pageIndex > 0 : Boolean(params.page);
  const field = (name: string) => values[name] ?? "";
  const set = (name: string) => (value: string) => setValues((current) => ({ ...current, [name]: value }));

  return (
    <>
      {unavailable ? <Notice tone="err">{unavailable}</Notice> : null}
      {selected ? (
        <form
          className="vmem-card vmem-form"
          aria-label={`Promote ${str(selected.title) || str(selected.kind)}`}
          onSubmit={(event) => {
            event.preventDefault();
            const meta = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.trim()]).filter(([, value]) => value));
            beginWrite({
              action: "promote-from-amem",
              id: selected.id,
              ...(selected.project ? { project: selected.project } : {}),
              ...meta,
              ...vaultParam(params),
            });
          }}
        >
          <h2 className="vmem-card-title">Promote: {str(selected.title) || str(selected.kind) || selected.id}</h2>
          <Field name="domain" label="Domain" required value={field("domain")} onChange={set("domain")} />
          <Field name="topics" label="Topics, comma separated" required value={field("topics")} onChange={set("topics")} />
          <Field name="type" label="Type (optional)" value={field("type")} onChange={set("type")} />
          <Field name="description" label="Description (optional)" value={field("description")} onChange={set("description")} />
          <Field name="stem" label="File stem (needed when the title has no ASCII letters)" value={field("stem")} onChange={set("stem")} />
          <div className="vmem-bar">
            <button type="submit" className="vmem-button vmem-button-primary">
              Preview promotion…
            </button>
            <button type="button" className="vmem-button" onClick={() => navigate("promote", { ...vaultParam(params) })}>
              Clear selection
            </button>
          </div>
        </form>
      ) : null}
      {nextPage || showFirst ? (
        <div className="vmem-bar">
          {showFirst ? (
            <button type="button" className="vmem-button" onClick={() => navigate("promote", { ...vaultParam(params) })}>
              First page
            </button>
          ) : null}
          {nextPage ? (
            <button
              type="button"
              className="vmem-button"
              onClick={() => navigate("promote", { page: nextPage, ...vaultParam(params) })}
            >
              Next page
            </button>
          ) : null}
        </div>
      ) : null}
      <List
        label="Promotion candidates"
        items={all.map((candidate) => {
          const chosen = str(reply.selected) === candidate.id;
          return {
            key: candidate.id,
            title: str(candidate.title) || str(candidate.kind) || candidate.id,
            sub: [str(candidate.kind), str(candidate.project), when(num(candidate.at) || candidate.at)].filter(Boolean).join(" · "),
            ...(chosen ? { chip: { text: "selected" } } : {}),
            verbs: chosen ? undefined : (
              <button
                type="button"
                className="vmem-button"
                onClick={() =>
                  navigate("promote", {
                    id: candidate.id,
                    ...(candidate.project ? { project: candidate.project } : {}),
                    ...(page ? { page } : {}),
                    ...vaultParam(params),
                  })
                }
              >
                Select
              </button>
            ),
          };
        })}
        empty={
          <Empty
            title="No promotion candidates"
            hint="Durable agent memories appear here when agent-mem marks them for the vault."
          />
        }
      />
      {all.length ? <Chip text={`${all.length} candidates`} /> : null}
    </>
  );
}
