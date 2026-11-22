/** Settings are read and changed only through the provider's preview and confirmation flow. */
import { Notice } from "../components.tsx";
import { list, str } from "../data.ts";
import type { ViewProps } from "./common.ts";

export function SettingsView({ reply, beginWrite }: ViewProps) {
  const error = str(reply.error);
  if (error) return <Notice tone="err">{error}</Notice>;
  const vault = str(reply.vault);
  if (!vault) return <Notice tone="err">No vault selected. Select a vault from Overview.</Notice>;
  const defaults = {
    defaultVault: str(reply.defaultVault), write: str(reply.write),
    piiPatterns: list<string>(reply.piiPatterns), graphResolution: Number(reply.graphResolution),
    enrichmentEnabled: reply.enrichmentEnabled === true,
  };
  return <form key={JSON.stringify([vault, defaults])} className="vmem-card vmem-form" aria-label="Vault settings" onSubmit={(event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const values = {
      defaultVault: String(form.get("defaultVault") ?? ""),
      write: String(form.get("write") ?? ""),
      piiPatterns: String(form.get("piiPatterns") ?? "").split("\n").filter((line) => line !== ""),
      graphResolution: Number(form.get("graphResolution")),
      enrichmentEnabled: form.has("enrichmentEnabled"),
    };
    const changes = Object.fromEntries(Object.entries(values).filter(([key, value]) =>
      JSON.stringify(value) !== JSON.stringify(defaults[key as keyof typeof defaults])));
    beginWrite({ action: "settings", vault, changes });
  }}>
    <h1 className="vmem-card-title">Settings</h1>
    <p>Vault: {vault}. Default vault: {defaults.defaultVault || "none"}{reply.defaultVaultExplicit === false ? " (automatic)" : ""}.</p>
    <label className="vmem-label" htmlFor="settings-default">Default vault ID</label>
    <input className="vmem-input" id="settings-default" name="defaultVault" defaultValue={defaults.defaultVault} required />
    <label className="vmem-label" htmlFor="settings-write">Write permission</label>
    <select className="vmem-input" id="settings-write" name="write" defaultValue={defaults.write}>
      <option value="mcp">MCP</option><option value="cli">CLI</option><option value="none">None</option>
    </select>
    <label className="vmem-label" htmlFor="settings-pii">PII patterns, one per line</label>
    <textarea className="vmem-input" id="settings-pii" name="piiPatterns" defaultValue={defaults.piiPatterns.join("\n")} rows={4} />
    <label className="vmem-label" htmlFor="settings-resolution">Graph community resolution (greater than 0, at most 100)</label>
    <input className="vmem-input" id="settings-resolution" name="graphResolution" type="number" min="0" max="100" step="any" required defaultValue={defaults.graphResolution} />
    <label className="vmem-check"><input name="enrichmentEnabled" type="checkbox" defaultChecked={defaults.enrichmentEnabled} /> Enable enrichment</label>
    <p className="vmem-sub">Changes are previewed before confirmation. Default vault and permission changes require a console and MCP server restart.</p>
    <button type="submit" className="vmem-button vmem-button-primary">Preview changes</button>
  </form>;
}
