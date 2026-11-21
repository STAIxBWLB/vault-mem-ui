/** Overview: the registered vaults, what the shown vault holds, and the newest log lines. */

import { Empty, List, Notice, SearchForm } from "../components.tsx";
import { list, num, rec, str, type LogRow, type VaultRow } from "../data.ts";
import type { ViewProps } from "./common.ts";
import { vaultParam } from "./common.ts";

export function OverviewView({ reply, params, navigate }: ViewProps) {
  const status = rec(reply.status);
  const vaults = list<VaultRow>(status.vaults);
  const shown = str(reply.vault);
  const mocs = list<{ path?: string; title?: string; count?: number }>(reply.mocs);
  const log = list<LogRow>(reply.log);
  if (!vaults.length) {
    return (
      <>
        <SearchForm value="" onSubmit={(q) => navigate("notes", q ? { q } : {})} />
        <Empty title="No vault registered" hint="Run `vmem vaults add <id> <path>` to register one, then reload this panel." />
      </>
    );
  }
  return (
    <>
      <SearchForm value="" onSubmit={(q) => navigate("notes", { ...(q ? { q } : {}), ...vaultParam(params) })} />
      <div className="vmem-cards">
        <section className="vmem-card" aria-label="Vaults">
          <h2 className="vmem-card-title">Vaults</h2>
          <List
            label="Vaults"
            items={vaults.map((vault) => ({
              key: vault.id,
              title: vault.id,
              sub: [vault.kind, vault.write ? `write ${vault.write}` : "", vault.health && vault.health !== "ok" ? vault.health : ""]
                .filter(Boolean)
                .join(" · "),
              ...(vault.id === shown ? { chip: { text: "shown" } } : {}),
              onOpen: () => navigate("overview", { vault: vault.id }),
            }))}
          />
        </section>
        <section className="vmem-card" aria-label="Notes and maps">
          <h2 className="vmem-card-title">
            {num(reply.noteCount)}
            {reply.noteCountCapped ? "+" : ""} notes · maps
          </h2>
          <List
            label="Maps"
            items={mocs.slice(0, 8).map((moc) => ({
              key: str(moc.path),
              title: str(moc.title) || str(moc.path),
              sub: `${num(moc.count)} links`,
              onOpen: () => navigate("note", { path: str(moc.path), ...vaultParam(params) }),
            }))}
            empty={<Empty title="No maps yet" hint="A map note links the notes of one area; it appears here once it exists." />}
          />
        </section>
        <section className="vmem-card" aria-label="Recent log">
          <h2 className="vmem-card-title">Recent log</h2>
          <List
            label="Recent log"
            items={log.map((row, index) => ({
              key: `${index}:${str(row.at)}:${str(row.source)}`,
              title: row.raw ?? `${str(row.type)} ${str(row.source)}${row.dest ? ` → ${str(row.dest)}` : ""}`,
              sub: row.raw ? undefined : [str(row.at), str(row.project), row.agent ? "agent" : ""].filter(Boolean).join(" · "),
              onOpen: () => navigate("log", { ...vaultParam(params) }),
            }))}
            empty={<Empty title="Log is empty" />}
          />
        </section>
      </div>
      {status.error ? <Notice tone="err">{str(status.error)}</Notice> : null}
    </>
  );
}
