import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConsolePanelManifest, ConsoleProvider } from "@staix/agent-console/contract";
import { CSP, startHost } from "../../src/server/host";

const macChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = process.env.CHROME_BIN || (process.platform === "darwin" && await Bun.file(macChrome).exists() ? macChrome : undefined) || Bun.which("google-chrome") || Bun.which("google-chrome-stable") || Bun.which("chromium");

async function renderPage(injectViolation: boolean): Promise<string> {
  const provider: ConsoleProvider = {
    assets: { js: "", css: "" },
    async snapshot() { return { status: { vaults: [] } }; },
    async action() { return { ok: false, error: "not used" }; },
  };
  const manifest: ConsolePanelManifest = { api: 1, tool: "vmem", version: "test", title: "Vault", panels: [{ id: "overview", title: "Overview" }] };
  // This listener is part of the served module, so it runs under the unchanged CSP before the application.
  const monitor = `window.addEventListener('securitypolicyviolation', event => { document.documentElement.dataset.cspViolation = event.violatedDirective; });\n`;
  const violation = injectViolation ? `\nconst injected = document.createElement('script'); injected.textContent = 'window.testInlineRan = true'; document.body.append(injected);\n` : "";
  const assets = { js: monitor + await Bun.file("dist/panel.js").text() + violation, css: await Bun.file("dist/panel.css").text() };
  const host = startHost({ provider, manifest, assets });
  const profile = mkdtempSync(join(tmpdir(), "vmem-ui-browser-"));
  try {
    const probe = await fetch(host.issue(), { redirect: "manual" });
    expect(probe.headers.get("content-security-policy")).toBe(CSP);
    const child = Bun.spawn([browser!, "--headless", "--disable-gpu", "--no-sandbox", "--no-first-run", `--user-data-dir=${profile}`, "--virtual-time-budget=5000", "--dump-dom", host.issue()], { stdout: "pipe", stderr: "pipe" });
    const [html, errors, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (exit !== 0) throw new Error(`Chrome exited ${exit}: ${errors}`);
    return html;
  } finally {
    await host.stop();
    rmSync(profile, { recursive: true, force: true });
  }
}

test.skipIf(!browser && !process.env.CI)("served standalone page mounts without CSP violations", async () => {
  expect(browser).toBeTruthy();
  const html = await renderPage(false);
  expect(html).toContain('aria-label="Vault panels"');
  expect(html).toContain("No vault registered");
  expect(html).not.toContain("data-csp-violation=");
}, 30000);

test.skipIf(!browser && !process.env.CI)("CSP monitor detects a blocked inline script", async () => {
  const html = await renderPage(true);
  expect(html).toContain('data-csp-violation="script-src-elem"');
}, 30000);
