/** Proposal review through the provider's snapshot and confirmation-bound actions. */
import { useState } from "react";
import { Empty, List, Notice } from "../components.tsx";
import { list, rec, str } from "../data.ts";
import type { ViewProps } from "./common.ts";

const STATES = ["pending", "applied", "rejected", "apply_unknown"] as const;

export function ProposalsView({ reply, params, navigate, beginWrite }: ViewProps) {
  const [message, setMessage] = useState("");
  const page = rec(reply.page), selected = rec(reply.selected);
  const vault = str(reply.vault), state = str(reply.state) || "pending";
  const nav = (extra: Record<string, string>) => navigate("proposals", { ...(vault ? { vault } : {}), state, ...extra });
  const items = list<Record<string, unknown>>(page.items);
  const id = str(selected.id), selectedState = str(selected.state);
  const issues = [...list<Record<string, unknown>>(page.issues), ...list<Record<string, unknown>>(selected.issues)];
  return <>
    <h1>Proposals</h1>
    {str(reply.error) && <Notice tone="err">{str(reply.error)}</Notice>}
    {issues.map((issue, index) => <Notice key={`${str(issue.code)}:${index}`} tone="warn">{str(issue.message)}</Notice>)}
    <label className="vmem-label" htmlFor="proposal-state">State</label>
    <select id="proposal-state" className="vmem-input" value={state} onChange={(event) => { setMessage(""); nav({ state: event.currentTarget.value }); }}>
      {STATES.map((value) => <option key={value} value={value}>{value}</option>)}
    </select>
    <List label="Proposals" items={items.map((item) => ({ key: str(item.id), title: str(item.path) || str(item.id), sub: [str(item.id), str(item.state), str(item.createdAt)].filter(Boolean).join(" · "), onOpen: () => { setMessage(""); nav({ ...(params.page ? { page: params.page } : {}), id: str(item.id) }); } }))} empty={<Empty title="No proposals" />} />
    <div className="vmem-bar">
      {params.page && <button type="button" className="vmem-button" onClick={() => nav({})}>First page</button>}
      {str(page.nextCursor) && <button type="button" className="vmem-button" onClick={() => nav({ page: str(page.nextCursor) })}>Next page</button>}
    </div>
    {id && <section className="vmem-card" aria-label="Selected proposal">
      <h2 className="vmem-card-title">Proposal {id}</h2>
      <p>{str(selected.path)} · {selectedState}</p>
      {str(selected.agentLabelUnverified) && <p>Agent label (unverified): {str(selected.agentLabelUnverified)}</p>}
      {str(selected.decisionReason) && <p>Decision reason: {str(selected.decisionReason)}</p>}
      <pre className="vmem-body">{str(selected.content)}</pre>
      {selected.truncated === true && <p>Proposal content is truncated. Inspect the full proposal with the vmem CLI before deciding.</p>}
      {selectedState === "pending" && <>
        <button type="button" className="vmem-button" onClick={() => beginWrite({ action: "proposal-apply", vault, id })}>Preview apply</button>
        <form key={`${vault}:${id}`} className="vmem-form" onSubmit={(event) => {
          event.preventDefault();
          const reason = String(new FormData(event.currentTarget).get("reason") ?? "");
          if (!reason.trim()) { setMessage("Enter a reason before previewing rejection."); return; }
          if (new TextEncoder().encode(reason).length > 4096) { setMessage("Keep the reason within 4096 bytes, then preview again."); return; }
          setMessage(""); beginWrite({ action: "proposal-reject", vault, id, reason });
        }}>
          <label className="vmem-label" htmlFor="proposal-reason">Rejection reason</label>
          <textarea id="proposal-reason" name="reason" className="vmem-input" onChange={() => setMessage("")} />
          <p role="status">{message}</p>
          <button type="submit" className="vmem-button">Preview rejection</button>
        </form>
      </>}
    </section>}
  </>;
}
