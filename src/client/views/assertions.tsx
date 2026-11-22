/** Assertions: the journal's answer for this vault, with every coverage gap named. Read-only. */

import { Empty, List, Notice, type ListItem } from "../components.tsx";
import { list, rec, str, when } from "../data.ts";
import type { ViewProps } from "./common.ts";
import { vaultParam } from "./common.ts";

type NoticeTone = "info" | "warn" | "err";

/** The provider's coverage tones: "neutral" is information, not a gap. */
const NOTICE_TONE: Record<string, NoticeTone> = { err: "err", warn: "warn", neutral: "info" };

/** The one reason a row is not plain reading, in the order the provider reports them. */
function chipOf(item: Record<string, unknown>, value: unknown): ListItem["chip"] {
  const withheld = value && typeof value === "object" ? str(rec(value).withheld) : "";
  if (withheld) return { text: `withheld (${withheld})`, tone: "warn" };
  if (item.availability === "unavailable" || item.purged === true) return { text: "payload unavailable", tone: "warn" };
  if (item.revisionConflict === true) return { text: "revision conflict", tone: "err" };
  if (str(item.replacedAt)) return { text: "replaced", tone: "neutral" };
  return undefined;
}

/** A state holds from..to and an event happened on / held on: without it an ended state reads like a current one. */
function validityOf(item: Record<string, unknown>): string[] {
  return [
    str(item.from) ? `from ${str(item.from)}` : "",
    str(item.to) ? `to ${str(item.to)}` : "",
    str(item.on) ? `on ${str(item.on)}` : "",
    str(item.held_on) ? `held ${str(item.held_on)}` : "",
  ];
}

function row(item: Record<string, unknown>, params: Record<string, string>, navigate: ViewProps["navigate"]): ListItem {
  const value = item.value;
  const subjectNote = rec(item.subjectNote);
  const notePath = str(subjectNote.path);
  const chip = chipOf(item, value);
  const status = str(subjectNote.status);
  const sub = [
    str(item.op),
    item.rev === undefined ? "" : `rev ${str(item.rev)}`,
    str(item.kind),
    ...validityOf(item),
    when(item.recordedAt),
    str(item.reason),
    status && status !== "present" ? `note ${status}` : "",
  ].filter(Boolean).join(" · ");
  return {
    key: `${str(item.id)}:${str(item.rev)}:${str(item.op)}`,
    // A purged assertion can have neither subject nor value left, and the id is then the only thing to name it by.
    title: [str(item.subject), str(item.relation), typeof value === "string" ? value : ""].filter(Boolean).join(" ") || str(item.id) || "assertion",
    sub,
    ...(chip ? { chip } : {}),
    ...(notePath && status === "present" ? { onOpen: () => navigate("note", { path: notePath, ...vaultParam(params) }) } : {}),
  };
}

/** When the answer was evaluated, and against which instant when the person asked for one. */
function asOfText(result: Record<string, unknown>, asOf: Record<string, unknown>): string {
  const cutoff = str(asOf.cutoff);
  if (cutoff) return ` · as of ${when(cutoff)}${asOf.cutoffInclusive === false ? " (exclusive)" : ""}`;
  const at = str(result.at);
  return at ? ` · evaluated ${when(at)}` : "";
}

export function AssertionsView({ reply, params, navigate }: ViewProps) {
  const error = str(reply.error);
  if (error) return <Notice tone="err">{error}</Notice>;
  const result = rec(reply.result);
  const warnings = list<Record<string, unknown>>(reply.warnings);
  const items = list<Record<string, unknown>>(result.items);
  const evaluated = asOfText(result, rec(result.asOf));
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
        {evaluated}
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
