import { afterEach, expect, test } from "bun:test";
import type { ConsolePanelManifest, ConsoleProvider } from "@staix/agent-console/contract";
import { CSP, allowedPanels, loopback, startHost, type Host } from "../../src/server/host";
import { parseArgs, run, shutdown } from "../../src/server/cli";
import { boundaryViolations } from "../../scripts/import-boundary";

// Synthetic provider: records every call so tests can prove the server relays and never confirms on its own.
type Call = { kind: "snapshot" | "action"; input: Record<string, unknown> };
function fakeProvider(calls: Call[]): ConsoleProvider {
  return {
    assets: { js: "", css: "" },
    async snapshot(input) { calls.push({ kind: "snapshot", input }); return { panel: input.panel, items: [] }; },
    async action(input) {
      calls.push({ kind: "action", input });
      if (input.confirmed === true && input.fingerprint === "fp-1") return { ok: true, message: "Delete note: done" };
      return { ok: false, needsConfirm: true, fingerprint: "fp-1", preview: ["delete notes/example.md"], verb: "Delete note" };
    },
  };
}
const manifest: ConsolePanelManifest = { api: 1, tool: "vmem", version: "0.0.0-test", title: "Vault", panels: [{ id: "overview", title: "Overview" }] };
const assets = { js: "export default () => ({});\n", css: ".vmem-ui-placeholder{margin:0}\n" };

const hosts: Host[] = [];
afterEach(async () => { await Promise.all(hosts.splice(0).map((h) => h.stop())); });
function start(extra: Partial<Parameters<typeof startHost>[0]> = {}) {
  const calls: Call[] = [];
  const host = startHost({ provider: fakeProvider(calls), manifest, assets, ...extra });
  hosts.push(host);
  return { host, calls };
}
async function signIn(host: Host): Promise<string> {
  const res = await fetch(host.issue(), { redirect: "manual" });
  expect(res.status).toBe(303);
  const cookie = res.headers.get("set-cookie")!;
  return cookie.split(";")[0]!;
}
const post = (host: Host, path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(host.origin + path, { method: "POST", headers: { "content-type": "application/json", origin: host.origin, ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

test("binds loopback only", async () => {
  const { host } = start();
  expect(host.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  // Not reachable on a non-loopback interface address; 0.0.0.0 would accept it, 127.0.0.1 does not.
  const { networkInterfaces } = await import("node:os");
  const external = Object.values(networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal);
  if (external) await expect(fetch(`http://${external.address}:${host.port}/`, { signal: AbortSignal.timeout(2000) })).rejects.toThrow();
});

test("ticket signs in once with an HttpOnly SameSite=Strict cookie and cannot be reused", async () => {
  const { host } = start();
  const link = host.issue();
  const first = await fetch(link, { redirect: "manual" });
  expect(first.status).toBe(303);
  const setCookie = first.headers.get("set-cookie")!;
  expect(setCookie).toContain("HttpOnly");
  expect(setCookie).toContain("SameSite=Strict");
  expect(setCookie).toContain("Path=/");
  const reuse = await fetch(link, { redirect: "manual" });
  expect(reuse.status).toBe(401);
  expect(await reuse.text()).toContain("already used or has expired; restart vmem-ui");
  const forged = await fetch(`${host.origin}/login?t=nope`, { redirect: "manual" });
  expect(forged.status).toBe(401);
});

test("ticket expires after 5 minutes", async () => {
  let t = 1_000_000;
  const { host } = start({ now: () => t });
  const link = host.issue();
  t += 5 * 60_000 + 1;
  expect((await fetch(link, { redirect: "manual" })).status).toBe(401);
});

test("every page and API needs the session", async () => {
  const { host, calls } = start();
  for (const path of ["/", "/panel.js", "/panel.css", "/api/manifest"]) {
    const res = await fetch(host.origin + path);
    expect(res.status).toBe(401);
    expect(await res.text()).toContain("open the link that vmem-ui printed");
  }
  const res = await post(host, "/api/snapshot", { panel: "overview" }, { cookie: "vmem_ui_1=forged" });
  expect(res.status).toBe(401);
  expect(calls).toEqual([]);
});

test("serves the client bundle with the strict CSP", async () => {
  const { host } = start();
  const cookie = await signIn(host);
  const page = await fetch(host.origin + "/", { headers: { cookie } });
  expect(page.status).toBe(200);
  const csp = page.headers.get("content-security-policy")!;
  expect(csp).toBe(CSP);
  for (const d of ["default-src 'none'", "script-src 'self'", "style-src 'self'", "frame-ancestors 'none'"]) expect(csp).toContain(d);
  expect(csp).not.toContain("blob:");
  expect(csp).not.toContain("unsafe-inline");
  const html = await page.text();
  expect(html).not.toMatch(/<style|style=|<script>(?!<)/);
  expect(html).toContain('<script type="module" src="/panel.js">');
  expect(await (await fetch(host.origin + "/panel.js", { headers: { cookie } })).text()).toBe(assets.js);
  const css = await fetch(host.origin + "/panel.css", { headers: { cookie } });
  expect(css.headers.get("content-type")).toContain("text/css");
  expect(css.headers.get("content-security-policy")).toBe(CSP);
});

test("refuses a foreign Host header (DNS rebinding)", async () => {
  const { host } = start();
  const cookie = await signIn(host);
  const res = await fetch(host.origin + "/", { headers: { cookie, host: "evil.example" } });
  expect(res.status).toBe(421);
  expect(await res.text()).toContain(`is not this server; open ${host.origin}`);
  // The login route is checked too.
  expect((await fetch(host.issue(), { headers: { host: "evil.example" }, redirect: "manual" })).status).toBe(421);
});

test("accepts localhost as the same server", async () => {
  const { host } = start();
  const cookie = await signIn(host);
  expect((await fetch(host.origin + "/", { headers: { cookie, host: `localhost:${host.port}` } })).status).toBe(200);
});

test("refuses a foreign Origin, a cross-site fetch and an API call without Origin", async () => {
  const { host, calls } = start();
  const cookie = await signIn(host);
  const foreign = await post(host, "/api/snapshot", { panel: "overview" }, { cookie, origin: "http://evil.example" });
  expect(foreign.status).toBe(403);
  expect((await foreign.json()).error).toContain("cross-origin request from http://evil.example refused");
  const site = await fetch(host.origin + "/", { headers: { cookie, "sec-fetch-site": "cross-site" } });
  expect(site.status).toBe(403);
  expect(await site.text()).toContain("open the vmem-ui page directly");
  const noOrigin = await fetch(host.origin + "/api/snapshot", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: "{}" });
  expect(noOrigin.status).toBe(403);
  expect((await noOrigin.json()).error).toContain("Origin header missing");
  expect(calls).toEqual([]);
});

test("bounds request bodies", async () => {
  const { host, calls } = start({ maxBodyBytes: 1024 });
  const cookie = await signIn(host);
  const big = await post(host, "/api/action", { action: "delete", pad: "x".repeat(4096) }, { cookie });
  expect(big.status).toBe(413);
  expect((await big.json()).error).toBe("request body is over the 1024 byte limit; send a smaller request");
  // A chunked body without Content-Length is cut off while reading.
  const stream = new ReadableStream({ start(c) { for (let i = 0; i < 8; i++) c.enqueue(new TextEncoder().encode("x".repeat(512))); c.close(); } });
  const chunked = await fetch(host.origin + "/api/action", { method: "POST", headers: { cookie, origin: host.origin, "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit);
  expect(chunked.status).toBe(413);
  expect((await chunked.json()).error).toContain("over the 1024 byte limit; send a smaller request");
  const notJson = await post(host, "/api/action", "{nope", { cookie });
  expect(notJson.status).toBe(400);
  expect((await notJson.json()).error).toContain("not valid JSON");
  const wrongType = await post(host, "/api/action", "{}", { cookie, "content-type": "text/plain" });
  expect(wrongType.status).toBe(415);
  expect(calls).toEqual([]);
});

test("far oversized bodies (declared and streamed) still get an actionable 413", async () => {
  const { host, calls } = start({ maxBodyBytes: 1024 });
  const cookie = await signIn(host);
  for (const size of [70_000, 8 * 1024 * 1024]) {
    const declared = await post(host, "/api/action", { action: "delete", pad: "x".repeat(size) }, { cookie });
    expect(declared.status).toBe(413);
    expect((await declared.json()).error).toBe("request body is over the 1024 byte limit; send a smaller request");
    const chunk = new TextEncoder().encode("x".repeat(64 * 1024));
    let sent = 0;
    const stream = new ReadableStream({ pull(c) { if (sent >= size) return c.close(); sent += chunk.byteLength; c.enqueue(chunk); } });
    const streamed = await fetch(host.origin + "/api/action", { method: "POST", headers: { cookie, origin: host.origin, "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit);
    expect(streamed.status).toBe(413);
    expect((await streamed.json()).error).toBe("request body is over the 1024 byte limit; send a smaller request");
  }
  expect(calls).toEqual([]);
});

test("relays snapshot and refuses unknown panels", async () => {
  const { host, calls } = start();
  const cookie = await signIn(host);
  const ok = await post(host, "/api/snapshot", { panel: "overview", after: 3 }, { cookie });
  expect(await ok.json()).toEqual({ panel: "overview", items: [] });
  expect(calls).toEqual([{ kind: "snapshot", input: { panel: "overview", after: 3 } }]);
  const bad = await post(host, "/api/snapshot", { panel: "secrets" }, { cookie });
  expect(bad.status).toBe(400);
  expect((await bad.json()).error).toContain('unknown panel "secrets"; use one of overview');
});

test("write actions keep vmem's two-step confirmation: the server never confirms", async () => {
  const { host, calls } = start();
  const cookie = await signIn(host);
  const first = await (await post(host, "/api/action", { action: "delete", path: "notes/example.md" }, { cookie })).json();
  expect(first).toMatchObject({ ok: false, needsConfirm: true, fingerprint: "fp-1" });
  expect(calls[0]!.input).toEqual({ action: "delete", path: "notes/example.md" });
  expect(calls[0]!.input).not.toHaveProperty("confirmed");
  const second = await (await post(host, "/api/action", { action: "delete", path: "notes/example.md", confirmed: true, fingerprint: "fp-1" }, { cookie })).json();
  expect(second).toEqual({ ok: true, message: "Delete note: done" });
  expect(calls[1]!.input).toEqual({ action: "delete", path: "notes/example.md", confirmed: true, fingerprint: "fp-1" });
  expect(calls.length).toBe(2);
  const missing = await post(host, "/api/action", { path: "x" }, { cookie });
  expect(missing.status).toBe(400);
});

test("provider failures name cause and next step, and reach the terminal", async () => {
  const provider: ConsoleProvider = { assets: { js: "", css: "" }, async snapshot() { throw new Error("vault not found"); }, async action() { return { ok: false, error: "x" }; } };
  const logged: string[] = [];
  const host = startHost({ provider, manifest, assets, log: (line) => logged.push(line) });
  hosts.push(host);
  const cookie = await signIn(host);
  const res = await post(host, "/api/snapshot", { panel: "overview" }, { cookie });
  expect(res.status).toBe(500);
  expect((await res.json()).error).toBe("the vault provider failed: vault not found; check the vmem-ui terminal and retry");
  // The reply points at the terminal, so the cause is there, with the route it came from.
  expect(logged).toEqual(["vmem-ui: POST /api/snapshot failed: vault not found"]);
});

test("unsupported methods and paths are refused with the next step", async () => {
  const { host } = start();
  const cookie = await signIn(host);
  const del = await fetch(host.origin + "/api/action", { method: "DELETE", headers: { cookie } });
  expect(del.status).toBe(405);
  expect((await del.json()).error).toContain("POST /api/snapshot and POST /api/action");
  const missing = await fetch(host.origin + "/nope", { headers: { cookie } });
  expect(missing.status).toBe(404);
});

test("exits after the idle timeout and stays up while used", async () => {
  let idled = 0;
  const { host } = start({ idleMs: 150, onIdle: () => { idled++; } });
  const cookie = await signIn(host);
  for (let i = 0; i < 3; i++) { await Bun.sleep(80); expect((await fetch(host.origin + "/", { headers: { cookie } })).status).toBe(200); }
  expect(idled).toBe(0);
  await Bun.sleep(300);
  expect(idled).toBe(1);
  await expect(fetch(host.origin + "/", { headers: { cookie }, signal: AbortSignal.timeout(1000) })).rejects.toThrow();
});

test("provider initialization failure is reported with cause and next step, not thrown", async () => {
  const errs: string[] = [];
  const host = await run({
    assets, argv: [], env: {}, out: () => {}, err: (l) => errs.push(l), exit: () => {},
    open: async () => { throw new Error("VMEM_HOME must be an absolute path"); },
  });
  expect(host).toBeNull();
  expect(errs).toEqual(["vmem-ui: could not open the vault-mem provider: VMEM_HOME must be an absolute path; check VMEM_HOME and AGENTHUB_HOME (absolute paths, readable vault registry), then run vmem-ui again"]);
});

test("--help names the vault home the command serves", async () => {
  const out: string[] = [];
  const host = await run({ assets, argv: ["--help"], env: {}, out: (line) => out.push(line), err: () => {}, exit: () => {} });
  expect(host).toBeNull();
  expect(out.join("\n")).toContain("VMEM_HOME");
});

test("command options refuse bad input with cause and next step", () => {
  expect(parseArgs([])).toEqual({ port: 0, idleMs: 30 * 60_000, help: false });
  expect(parseArgs(["--port", "8123", "--idle-minutes", "5"])).toEqual({ port: 8123, idleMs: 5 * 60_000, help: false });
  expect(parseArgs(["--port", "99999"])).toEqual({ error: "--port needs a port number from 0 to 65535; got 99999" });
  expect(parseArgs(["--idle-minutes", "0"])).toEqual({ error: "--idle-minutes needs a whole number of minutes, 1 or more; got 0" });
  expect(parseArgs(["--bogus"])).toEqual({ error: "unknown option --bogus; run vmem-ui --help for the options" });
});

test("a port is decimal digits only, so an empty, spaced, hex or fractional value is refused", () => {
  const portError = (raw: string) => ({ error: `--port needs a port number from 0 to 65535; got ${raw === "" ? "nothing" : raw}` });
  // Number("") is 0, Number("0x10") is 16 and Number(" 80 ") is 80: each used to be a valid port.
  expect(parseArgs(["--port", ""])).toEqual(portError(""));
  expect(parseArgs(["--port", "0x10"])).toEqual(portError("0x10"));
  expect(parseArgs(["--port", " 80"])).toEqual(portError(" 80"));
  expect(parseArgs(["--port", "8.5"])).toEqual(portError("8.5"));
  expect(parseArgs(["--port", "-1"])).toEqual(portError("-1"));
  expect(parseArgs(["--port"])).toEqual(portError(""));
  expect(parseArgs(["--port", "0"])).toEqual({ port: 0, idleMs: 30 * 60_000, help: false });
  expect(parseArgs(["--idle-minutes", ""])).toEqual({ error: "--idle-minutes needs a whole number of minutes, 1 or more; got nothing" });
});

test("a default port is checked without the :80 no browser sends", () => {
  expect(loopback(80)).toEqual({ origin: "http://127.0.0.1", hosts: ["127.0.0.1", "localhost"], origins: ["http://127.0.0.1", "http://localhost"] });
  const picked = loopback(8123);
  expect(picked.origin).toBe("http://127.0.0.1:8123");
  expect(picked.hosts).toEqual(["127.0.0.1:8123", "localhost:8123"]);
  expect(picked.origins).toEqual(["http://127.0.0.1:8123", "http://localhost:8123"]);
});

test("panels come from the manifest, with inbox and search only where the plugin advertises them", async () => {
  const bare = start();
  const cookie = await signIn(bare.host);
  for (const panel of ["inbox", "search"]) {
    const res = await post(bare.host, "/api/snapshot", { panel }, { cookie });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain(`unknown panel "${panel}"; use one of overview`);
  }
  expect(bare.calls).toEqual([]);

  const withCapabilities = start({ manifest: { ...manifest, capabilities: { inbox: true, search: true } } });
  const studioCookie = await signIn(withCapabilities.host);
  for (const panel of ["inbox", "search"]) {
    expect((await post(withCapabilities.host, "/api/snapshot", { panel }, { cookie: studioCookie })).status).toBe(200);
  }
  expect([...allowedPanels({ ...manifest, capabilities: { search: true } })]).toEqual(["overview", "search"]);
});

test("the snapshot cursor must be a whole number of items already held", async () => {
  const { host, calls } = start();
  const cookie = await signIn(host);
  for (const after of [1.5, -1, Number.MAX_SAFE_INTEGER + 2, "3"]) {
    const res = await post(host, "/api/snapshot", { panel: "overview", after }, { cookie });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('"after" must be how many items you already have, as a whole number 0 or more');
  }
  expect(calls).toEqual([]);
  expect((await post(host, "/api/snapshot", { panel: "overview" }, { cookie })).status).toBe(200);
  expect(calls).toEqual([{ kind: "snapshot", input: { panel: "overview", after: 0 } }]);
});

test("only the exact JSON media type is accepted", async () => {
  const { host, calls } = start();
  const cookie = await signIn(host);
  for (const type of ["application/jsonx", "text/json", "application/json-patch+json", ""]) {
    const res = await post(host, "/api/snapshot", { panel: "overview" }, { cookie, "content-type": type });
    expect(res.status).toBe(415);
    expect((await res.json()).error).toBe("request body must be JSON; send it with Content-Type: application/json");
  }
  expect(calls).toEqual([]);
  // Parameters after the media type are still JSON, and a media type is case-insensitive.
  expect((await post(host, "/api/snapshot", { panel: "overview" }, { cookie, "content-type": "application/json; charset=utf-8" })).status).toBe(200);
  expect((await post(host, "/api/snapshot", { panel: "overview" }, { cookie, "content-type": "Application/JSON" })).status).toBe(200);
  expect(calls).toHaveLength(2);
});

test("closing the host closes the provider once, on a signal and on the idle exit alike", async () => {
  const order: string[] = [];
  const provider: ConsoleProvider = { ...fakeProvider([]), async close() { order.push("close"); } };
  const { host } = start({ provider });
  await shutdown(host, (code) => order.push(`exit ${code}`));
  expect(order).toEqual(["close", "exit 0"]);
  await host.close();
  expect(order).toEqual(["close", "exit 0"]);
  await expect(fetch(host.origin + "/", { signal: AbortSignal.timeout(1000) })).rejects.toThrow();
});

test("the idle exit takes the same close path, so the provider is closed there too", async () => {
  let closes = 0;
  let idled = 0;
  const provider: ConsoleProvider = { ...fakeProvider([]), async close() { closes++; } };
  start({ provider, idleMs: 60, onIdle: () => { idled++; } });
  await Bun.sleep(300);
  expect(idled).toBe(1);
  expect(closes).toBe(1);
});

test("concurrent closes share one in-flight close, so neither caller returns early", async () => {
  const events: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  const provider: ConsoleProvider = { ...fakeProvider([]), async close() { calls++; events.push("close start"); await gate; events.push("close end"); } };
  const { host } = start({ provider });
  const first = host.close().then(() => events.push("first returned"));
  const second = host.close().then(() => events.push("second returned"));
  await Bun.sleep(0);
  // Both callers are still waiting on the one close that the provider is holding.
  expect(events).toEqual(["close start"]);
  release();
  await Promise.all([first, second]);
  expect(calls).toBe(1);
  expect(events).toEqual(["close start", "close end", "first returned", "second returned"]);
});

test("a second signal cannot exit before the provider has closed", async () => {
  const events: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const provider: ConsoleProvider = { ...fakeProvider([]), async close() { await gate; events.push("provider closed"); } };
  const { host } = start({ provider });
  const exit = (code: number) => events.push(`exit ${code}`);
  const first = shutdown(host, exit);
  const second = shutdown(host, exit);
  await Bun.sleep(0);
  expect(events).toEqual([]);
  release();
  await Promise.all([first, second]);
  expect(events).toEqual(["provider closed", "exit 0", "exit 0"]);
});

test("a close that fails is reported and exits non-zero, and a concurrent caller sees the same failure", async () => {
  const provider: ConsoleProvider = { ...fakeProvider([]), async close() { throw new Error("index is locked"); } };
  const { host } = start({ provider });
  const logged: string[] = [];
  const exits: number[] = [];
  await shutdown(host, (code) => exits.push(code), (line) => logged.push(line));
  expect(exits).toEqual([1]);
  expect(logged).toEqual(["vmem-ui: could not close the vault-mem provider: index is locked; exiting anyway"]);
  // The failed close is the one close: a later caller gets its rejection rather than a silent success.
  await expect(host.close()).rejects.toThrow("index is locked");
});

test("a failed close on the idle exit is reported and the command still stops", async () => {
  const logged: string[] = [];
  let idled = 0;
  const provider: ConsoleProvider = { ...fakeProvider([]), async close() { throw new Error("index is locked"); } };
  start({ provider, idleMs: 60, onIdle: () => { idled++; }, log: (line) => logged.push(line) });
  await Bun.sleep(300);
  expect(idled).toBe(1);
  expect(logged).toEqual(["vmem-ui: could not close the vault-mem provider: index is locked; stopping anyway"]);
});

test("bin reads only this package's two dist files", async () => {
  const source = await Bun.file(new URL("../../bin/vmem-ui.ts", import.meta.url)).text();
  // Both signals take the same close path as the idle exit, so the provider is closed on Ctrl-C too.
  expect(source).toContain("shutdown(host,");
  expect(source).toContain('process.on("SIGINT", stop)');
  expect(source).toContain('process.on("SIGTERM", stop)');
  expect(source).not.toContain("host.stop(");
  // The only boundary finding allowed in bin is Bun.file, and only on the fixed CLIENT_FILES URLs.
  const findings = boundaryViolations(source, "bin/vmem-ui.ts");
  expect(findings.every((f) => f.includes("Bun.file"))).toBe(true);
  const fileCalls = [...source.matchAll(/Bun\.file\(([^)]*)\)/g)].map((m) => m[1]);
  expect(fileCalls).toEqual(["CLIENT_FILES.js", "CLIENT_FILES.css"]);
  const { CLIENT_FILES } = await import("../../bin/vmem-ui.ts");
  expect(CLIENT_FILES.js.pathname.endsWith("/dist/panel.js")).toBe(true);
  expect(CLIENT_FILES.css.pathname.endsWith("/dist/panel.css")).toBe(true);
});
