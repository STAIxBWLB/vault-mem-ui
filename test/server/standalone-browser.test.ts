import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConsolePanelManifest, ConsoleProvider } from "@staix/agent-console/contract";
import { CSP, startHost } from "../../src/server/host";

const macChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = process.env.CHROME_BIN || (process.platform === "darwin" && await Bun.file(macChrome).exists() ? macChrome : undefined) || Bun.which("google-chrome") || Bun.which("google-chrome-stable") || Bun.which("chromium");

test.skipIf(!browser && !process.env.CI)("served standalone page mounts in Chromium under its CSP", async () => {
  expect(browser).toBeTruthy();
  const provider: ConsoleProvider = {
    assets: { js: "", css: "" },
    async snapshot() { return { status: { vaults: [] } }; },
    async action() { return { ok: false, error: "not used" }; },
  };
  const manifest: ConsolePanelManifest = { api: 1, tool: "vmem", version: "test", title: "Vault", panels: [{ id: "overview", title: "Overview" }] };
  const assets = { js: await Bun.file("dist/panel.js").text(), css: await Bun.file("dist/panel.css").text() };
  const host = startHost({ provider, manifest, assets });
  const profile = mkdtempSync(join(tmpdir(), "vmem-ui-browser-"));
  try {
    const probe = await fetch(host.issue(), { redirect: "manual" });
    expect(probe.headers.get("content-security-policy")).toBe(CSP);
    const process = Bun.spawn([browser!, "--headless", "--disable-gpu", "--no-sandbox", "--no-first-run", `--user-data-dir=${profile}`, "--virtual-time-budget=5000", "--dump-dom", host.issue()], { stdout: "pipe", stderr: "pipe" });
    const [html, errors, exit] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
    expect(exit).toBe(0);
    expect(html).toContain('aria-label="Vault panels"');
    expect(html).toContain("No vault registered");
    expect(errors).not.toContain("violates the following Content Security Policy");
  } finally {
    await host.stop();
    rmSync(profile, { recursive: true, force: true });
  }
}, 30000);
