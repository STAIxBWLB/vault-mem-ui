/** Lint: the vault's findings, errors before warnings, each one opening the note it names. */

import { Empty, List } from "../components.tsx";
import { list, str, type FindingRow } from "../data.ts";
import type { ViewProps } from "./common.ts";
import { vaultParam } from "./common.ts";

export function LintView({ reply, params, navigate }: ViewProps) {
  const findings = list<FindingRow>(reply.findings);
  const summary = str(reply.summary);
  return (
    <>
      <p className="vmem-sub">{summary}</p>
      <List
        label="Lint findings"
        items={findings.map((finding, index) => ({
          key: `${finding.code}:${index}:${str(finding.message)}`,
          title: str(finding.message),
          sub: [str(finding.code), str(finding.path)].filter(Boolean).join(" · "),
          chip: { text: str(finding.severity) || "warning", tone: finding.severity === "error" ? "err" : "warn" },
          ...(finding.path ? { onOpen: () => navigate("note", { path: str(finding.path), ...vaultParam(params) }) } : {}),
        }))}
        empty={<Empty title="No lint findings" hint="The vault passes every check." />}
      />
    </>
  );
}
