/** Settings are read and changed only through the provider's preview and confirmation flow. */
import { Notice } from "../components.tsx";
import { list, str } from "../data.ts";
import type { ViewProps } from "./common.ts";
import { useState } from "react";

export function SettingsView({ reply, beginWrite }: ViewProps) {
  const [message, setMessage] = useState("");
  const error = str(reply.error);
  if (error) return <Notice tone="err">{error}</Notice>;
  const vault = str(reply.vault);
  if (!vault) return <Notice tone="err">No vault selected. Select a vault from Overview.</Notice>;
  const defaults = {
    defaultVault: str(reply.defaultVault), write: str(reply.write),
    piiPatterns: list<string>(reply.piiPatterns), graphResolution: Number(reply.graphResolution),
    enrichmentEnabled: reply.enrichmentEnabled === true,
  };
  return <form key={JSON.stringify([vault, defaults])} className="vmem-card vmem-form" aria-label="Vault settings" onChange={() => setMessage("")} onSubmit={(event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const piiText = String(form.get("piiPatterns") ?? "");
    const values = {
      defaultVault: String(form.get("defaultVault") ?? ""),
      write: String(form.get("write") ?? ""),
      graphResolution: Number(form.get("graphResolution")),
      enrichmentEnabled: form.has("enrichmentEnabled"),
    };
    const changes: Record<string, unknown> = Object.fromEntries(Object.entries(values).filter(([key, value]) =>
      JSON.stringify(value) !== JSON.stringify(defaults[key as keyof typeof defaults])));
    if (piiText !== defaults.piiPatterns.join("\n")) changes.piiPatterns = piiText.split(/\r?\n/).filter((line) => line.trim() !== "");
    if (!Object.keys(changes).length) { setMessage("No values changed. Edit a setting, then preview again."); return; }
    setMessage("");
    beginWrite({ action: "settings", vault, changes });
  }}>
    <h1 className="vmem-card-title">Settings</h1>
    <p>Vault: {vault}. Default vault: {defaults.defaultVault || "none"}{reply.defaultVaultExplicit === false ? " (automatic)" : ""}.</p>
    <fieldset className="vmem-form"><legend>This vault ({vault})</legend>
    <label className="vmem-label" htmlFor="settings-write">Write permission</label>
    <select className="vmem-input" id="settings-write" name="write" defaultValue={defaults.write}>
      <option value="mcp">MCP</option><option value="cli">CLI</option><option value="none">None</option>
    </select>
    <label className="vmem-label" htmlFor="settings-resolution">Graph community resolution (greater than 0, at most 100)</label>
    <input className="vmem-input" id="settings-resolution" name="graphResolution" type="number" min="5e-324" max="100" step="any" required defaultValue={defaults.graphResolution} />
    <label className="vmem-check"><input name="enrichmentEnabled" type="checkbox" defaultChecked={defaults.enrichmentEnabled} /> Enable enrichment</label>
    </fieldset>
    <fieldset className="vmem-form"><legend>All vaults</legend>
    <label className="vmem-label" htmlFor="settings-default">Default vault ID</label>
    <p id="settings-default-hint" className="vmem-sub">Current default: {defaults.defaultVault || "none"}. Enter a registered vault ID.</p>
    <input className="vmem-input" id="settings-default" name="defaultVault" defaultValue={defaults.defaultVault} aria-describedby="settings-default-hint" required />
    <label className="vmem-label" htmlFor="settings-pii">PII patterns, one per line</label>
    <textarea className="vmem-input" id="settings-pii" name="piiPatterns" defaultValue={defaults.piiPatterns.join("\n")} rows={4} />
    </fieldset>
    <p className="vmem-sub">Changes are previewed before confirmation. Default vault and permission changes require a console and MCP server restart.</p>
    {message && <p role="status">{message}</p>}
    <button type="submit" className="vmem-button vmem-button-primary">Preview changes</button>
  </form>;
}
