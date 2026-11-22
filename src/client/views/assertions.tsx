/** Assertions: the journal's answer for this vault, with every coverage gap named. Read-only. */

import { Empty, List, Notice, type ListItem } from "../components.tsx";
import { list, rec, str, when } from "../data.ts";
import type { ViewProps } from "./common.ts";
import { vaultParam } from "./common.ts";

type NoticeTone = "info" | "warn" | "err";

/** The provider's coverage tones: "neutral" is information, not a gap. */
const NOTICE_TONE: Record<string, NoticeTone> = { err: "err", warn: "warn", neutral: "info" };

function row(item: Record<string, unknown>, params: Record<string, string>, navigate: ViewProps["navigate"]): ListItem {
  const value = item.value;
  const withheld = value && typeof value === "object" ? str(rec(value).withheld) : "";
  const subjectNote = rec(item.subjectNote);
  const notePath = str(subjectNote.path);
  const chip = withheld
    ? { text: `withheld (${withheld})`, tone: "warn" as const }
    : item.availability === "unavailable" || item.purged === true
      ? { text: "payload unavailable", tone: "warn" as const }
      : item.revisionConflict === true
        ? { text: "revision conflict", tone: "err" as const }
        : str(item.replacedAt)
          ? { text: "replaced", tone: "neutral" as const }
          : undefined;
  const sub = [
    str(item.op),
    item.rev === undefined ? "" : `rev ${str(item.rev)}`,
    str(item.kind),
    when(item.recordedAt),
    str(item.reason),
    str(subjectNote.status) && str(subjectNote.status) !== "present" ? `note ${str(subjectNote.status)}` : "",
  ].filter(Boolean).join(" · ");
  return {
    key: `${str(item.id)}:${str(item.rev)}:${str(item.op)}`,
    title: [str(item.subject), str(item.relation), typeof value === "string" ? value : ""].filter(Boolean).join(" "),
    sub,
    ...(chip ? { chip } : {}),
    ...(notePath && subjectNote.status === "present" ? { onOpen: () => navigate("note", { path: notePath, ...vaultParam(params) }) } : {}),
  };
}

export function AssertionsView({ reply, params, navigate }: ViewProps) {
  const error = str(reply.error);
  if (error) return <Notice tone="err">{error}</Notice>;
  const result = rec(reply.result);
  const warnings = list<Record<string, unknown>>(reply.warnings);
  const items = list<Record<string, unknown>>(result.items);
  const asOf = rec(result.asOf);
  const cutoff = str(asOf.cutoff);
  const continuation = str(result.continuation);
  const nav = (extra: Record<string, string>) => navigate("assertions", { ...vaultParam(params), ...extra });
  return (
    <>
      <h1>Assertions</h1>
      {warnings.map((warning, index) => (
        <Notice key={`${str(warning.tone)}:${index}`} tone={NOTICE_TONE[str(warning.tone)] ?? "info"}>
          {str(warning.message)}
        </Notice>
      ))}
      <p className="vmem-sub">
        {items.length ? `${items.length} ${items.length === 1 ? "assertion" : "assertions"}` : "No assertions"}
        {cutoff ? ` · as of ${when(cutoff)}${asOf.cutoffInclusive === false ? " (exclusive)" : ""}` : str(result.at) ? ` · evaluated ${when(result.at)}` : ""}
      </p>
      <List
        label="Assertions"
        items={items.map((item) => row(item, params, navigate))}
        empty={<Empty title="No assertions" hint="Record one with vmem assert, then reload this panel." />}
      />
      <div className="vmem-bar">
        {params.cursor ? (
          <button type="button" className="vmem-button" onClick={() => nav({})}>
            First page
          </button>
        ) : null}
        {continuation ? (
          <button type="button" className="vmem-button" onClick={() => nav({ cursor: continuation })}>
            Next page
          </button>
        ) : null}
      </div>
      {result.truncated === true ? (
        <p className="vmem-sub">The provider stopped at its page limit; continue to the next page or narrow the query with the CLI.</p>
      ) : null}
    </>
  );
}
