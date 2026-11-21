import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const macChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = process.env.CHROME_BIN || (process.platform === "darwin" && existsSync(macChrome) ? macChrome : undefined) || Bun.which("google-chrome") || Bun.which("google-chrome-stable") || Bun.which("chromium");

test.skipIf(!browser && !process.env.CI)("graph export downloads under the console panel CSP", async () => {
  expect(browser).toBeTruthy();
  const bundle = await Bun.build({ entrypoints: ["src/client/graph-export.tsx"], target: "browser", format: "esm" });
  expect(bundle.success).toBe(true);
  const javascript = await bundle.outputs[0]!.text();
  const script = `import { downloadGraphHtml } from '/export.js'; document.getElementById('go').addEventListener('click', () => downloadGraphHtml({nodes:[{id:'a',label:'Alpha',type:'insight',domain:null,community:null,degree:0}],edges:[]}, {}));`;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(req) {
    const route = new URL(req.url).pathname;
    if (route === "/export.js") return new Response(javascript, { headers: { "Content-Type": "text/javascript" } });
    if (route === "/boot.js") return new Response(script, { headers: { "Content-Type": "text/javascript" } });
    return new Response('<!doctype html><button id="go">Export</button><script type="module" src="/boot.js"></script>', { headers: { "Content-Type": "text/html", "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-src 'self'; frame-ancestors 'none'" } });
  } });
  const root = mkdtempSync(join(tmpdir(), "vmem-export-csp-"));
  const child = Bun.spawn([browser!, "--headless", "--disable-gpu", "--no-sandbox", "--no-first-run", `--user-data-dir=${root}`, "--remote-debugging-port=0", "about:blank"], { stdout: "ignore", stderr: "ignore" });
  let socket: WebSocket | undefined;
  try {
    const devtools = join(root, "DevToolsActivePort");
    for (let i = 0; i < 100 && !existsSync(devtools); i++) await Bun.sleep(100);
    expect(existsSync(devtools)).toBe(true);
    const [port, endpoint] = readFileSync(devtools, "utf8").trim().split("\n");
    socket = new WebSocket(`ws://127.0.0.1:${port}${endpoint}`);
    await new Promise<void>((resolve, reject) => { socket!.onopen = () => resolve(); socket!.onerror = () => reject(new Error("Could not connect to the test browser")); });
    let id = 0;
    const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
    let complete!: () => void;
    const downloaded = new Promise<void>((resolve) => { complete = resolve; });
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const entry = pending.get(message.id);
        if (entry) { pending.delete(message.id); message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result); }
      } else if (message.method === "Browser.downloadProgress" && message.params.state === "completed") complete();
    };
    const call = (method: string, params: object, sessionId?: string): Promise<any> => new Promise((resolve, reject) => {
      const next = ++id; pending.set(next, { resolve, reject }); socket!.send(JSON.stringify({ id: next, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
    await call("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: root, eventsEnabled: true });
    const target = await call("Target.createTarget", { url: `http://127.0.0.1:${server.port}/` });
    const { sessionId } = await call("Target.attachToTarget", { targetId: target.targetId, flatten: true });
    await call("Runtime.enable", {}, sessionId);
    // Target creation can return before navigation commits; wait for the intended document, not about:blank.
    const waitForDocument = async (session: string, expectedUrl: string, requiredText = "") => {
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          const result = await call("Runtime.evaluate", { expression: "JSON.stringify({url:location.href, ready:document.readyState, text:document.body?.textContent ?? ''})", returnByValue: true }, session);
          const state = JSON.parse(result.result.value);
          if (state.url === expectedUrl && state.ready === "complete" && state.text.includes(requiredText)) return;
        } catch { /* A navigation may replace the execution context before it commits. */ }
        await Bun.sleep(100);
      }
      throw new Error(`Browser did not load the expected document: ${expectedUrl}`);
    };
    await waitForDocument(sessionId, `http://127.0.0.1:${server.port}/`, "Export");
    await call("Runtime.evaluate", { expression: "document.getElementById('go').click()", userGesture: true }, sessionId);
    await Promise.race([downloaded, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Browser did not complete the download under the panel CSP")), 10000))]);
    const html = readFileSync(join(root, "vault-graph.html"), "utf8");
    expect(html).toContain('id="graph-data"');
    const fileUrl = pathToFileURL(join(root, "vault-graph.html")).href;
    const offline = await call("Target.createTarget", { url: fileUrl });
    const offlineSession = (await call("Target.attachToTarget", { targetId: offline.targetId, flatten: true })).sessionId;
    await call("Runtime.enable", {}, offlineSession);
    await waitForDocument(offlineSession, fileUrl, "Alpha (insight, 0 links)");
  } finally {
    socket?.close();
    child.kill();
    await child.exited;
    await server.stop(true);
    rmSync(root, { recursive: true, force: true });
  }
}, 30000);
