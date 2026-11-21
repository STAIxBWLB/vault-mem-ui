/**
 * Standalone loopback host for the vault-mem console provider (issue #1, "Standalone host").
 * Pattern follows agent-console src/server.ts (H0): one-time ticket, HttpOnly SameSite=Strict session cookie,
 * Host and Origin checks on every request, strict CSP, bounded bodies and idle exit.
 * The server only relays snapshot and action to the provider; it never adds `confirmed` or a fingerprint,
 * so vmem's two-step confirmation stays with the person.
 */
import type { Server } from "bun";
import type { ConsolePanelManifest, ConsoleProvider } from "@staix/agent-console/contract";

/** Same directives as the acon panel contract: own scripts and styles only, no inline code, no blob:, no other origin. */
export const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
export const DEFAULT_IDLE_MS = 30 * 60_000;
export const DEFAULT_MAX_BODY_BYTES = 32 * 1024;
const TICKET_MS = 5 * 60_000;
const SESSION_MS = 12 * 60 * 60_000;
const MAX_TICKETS = 16;
const HARD_BODY_SLACK = 64 * 1024;

export interface ClientAssets {
  /** The client bundle (M1-a build output); a placeholder until the client lands. */
  js: string;
  css: string;
}

export interface HostOptions {
  provider: ConsoleProvider;
  manifest: ConsolePanelManifest;
  assets: ClientAssets;
  /** 0 picks a free port. */
  port?: number;
  idleMs?: number;
  maxBodyBytes?: number;
  /** Runs once after the idle stop; the command closes the provider and exits here. */
  onIdle?: () => void;
  now?: () => number;
}

export interface Host {
  readonly origin: string;
  readonly port: number;
  /** A new one-time sign-in link, valid for 5 minutes. */
  issue(): string;
  stop(): Promise<void>;
}

const BASE_HEADERS: Record<string, string> = {
  "Content-Security-Policy": CSP,
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
};

const secret = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");

const INDEX_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vault</title><link rel="stylesheet" href="/panel.css"></head>
<body><main id="vmem-ui-root"><p class="vmem-ui-placeholder">vault-mem-ui standalone host is running. The client UI is not built into this bundle yet.</p></main>
<script type="module" src="/panel.js"></script></body></html>
`;

class Refusal extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/** Reads a request body as JSON, refusing anything over `limit` bytes before and while reading. */
export async function readJsonBody(req: Request, limit: number): Promise<Record<string, unknown>> {
  const declared = req.headers.get("content-length");
  const tooBig = `request body is over the ${limit} byte limit; send a smaller request`;
  if (declared !== null && Number(declared) > limit) throw new Refusal(413, tooBig);
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    throw new Refusal(415, "request body must be JSON; send it with Content-Type: application/json");
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (req.body) {
    const reader = req.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Refusal(413, tooBig); }
      chunks.push(value);
    }
  }
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder().decode(Buffer.concat(chunks))); } catch {
    throw new Refusal(400, "request body is not valid JSON; send one complete JSON object");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Refusal(400, "request body must be a JSON object; wrap the fields in {}");
  return parsed as Record<string, unknown>;
}

export function startHost(options: HostOptions): Host {
  const { provider, manifest, assets } = options;
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
  const maxBody = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const now = options.now ?? Date.now;
  const tickets = new Map<string, number>();
  const sessions = new Map<string, number>();
  const panels = new Set(manifest.panels.map((p) => p.id).concat(["inbox", "search"]));
  let lastSeen = now();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Filled in right after Bun.serve returns; requests cannot arrive earlier.
  let hosts: string[] = [];
  let origins: string[] = [];
  let cookieName = "";

  const prune = (m: Map<string, number>) => { const t = now(); for (const [k, exp] of m) if (exp <= t) m.delete(k); };
  const cookieOf = (req: Request) => req.headers.get("cookie")?.split(";").map((v) => v.trim()).find((v) => v.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  const signedIn = (req: Request) => { prune(sessions); const c = cookieOf(req); return c !== undefined && sessions.has(c); };

  const text = (status: number, body: string, headers: Record<string, string> = {}) =>
    new Response(body, { status, headers: { ...BASE_HEADERS, "Content-Type": "text/plain; charset=utf-8", ...headers } });
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, "Content-Type": "application/json; charset=utf-8" } });
  const refuse = (req: Request, status: number, message: string) =>
    new URL(req.url).pathname.startsWith("/api/") ? json(status, { ok: false, error: message }) : text(status, `${message}\n`);

  const NOT_SIGNED_IN = "not signed in; open the link that vmem-ui printed, or restart vmem-ui for a new one";

  async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    // Host check before anything else: blocks DNS rebinding to this loopback port.
    if (!hosts.includes(req.headers.get("host") ?? "")) {
      return refuse(req, 421, `host "${req.headers.get("host") ?? ""}" is not this server; open ${origins[0]} instead`);
    }
    const origin = req.headers.get("origin");
    if (origin !== null && !origins.includes(origin)) {
      return refuse(req, 403, `cross-origin request from ${origin} refused; use the vmem-ui page at ${origins[0]}`);
    }
    const site = req.headers.get("sec-fetch-site");
    if (site !== null && !["same-origin", "none"].includes(site)) {
      return refuse(req, 403, "cross-site request refused; open the vmem-ui page directly instead of from another site");
    }

    if (req.method === "GET" && url.pathname === "/login") {
      prune(tickets);
      const ticket = url.searchParams.get("t") ?? "";
      if (!tickets.delete(ticket)) return text(401, "this sign-in link was already used or has expired; restart vmem-ui to get a new link\n");
      const session = secret();
      sessions.set(session, now() + SESSION_MS);
      return new Response(null, {
        status: 303,
        headers: { ...BASE_HEADERS, Location: "/", "Set-Cookie": `${cookieName}=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}` },
      });
    }

    if (!signedIn(req)) return refuse(req, 401, NOT_SIGNED_IN);

    if (req.method === "GET") {
      if (url.pathname === "/") return new Response(INDEX_HTML, { headers: { ...BASE_HEADERS, "Content-Type": "text/html; charset=utf-8" } });
      if (url.pathname === "/panel.js") return new Response(assets.js, { headers: { ...BASE_HEADERS, "Content-Type": "text/javascript; charset=utf-8" } });
      if (url.pathname === "/panel.css") return new Response(assets.css, { headers: { ...BASE_HEADERS, "Content-Type": "text/css; charset=utf-8" } });
      if (url.pathname === "/api/manifest") return json(200, manifest);
      return refuse(req, 404, `no page at ${url.pathname}; open ${origins[0]}/`);
    }

    if (req.method === "POST" && (url.pathname === "/api/snapshot" || url.pathname === "/api/action")) {
      // State-changing routes need an explicit same-origin Origin header, not just the cookie.
      if (origin === null) return refuse(req, 403, "Origin header missing; send API requests from the vmem-ui page");
      const input = await readJsonBody(req, maxBody);
      if (url.pathname === "/api/snapshot") {
        const panel = typeof input.panel === "string" ? input.panel : "";
        if (!panels.has(panel)) return refuse(req, 400, `unknown panel "${panel}"; use one of ${[...panels].join(", ")}`);
        const after = typeof input.after === "number" && Number.isFinite(input.after) ? input.after : 0;
        return json(200, await provider.snapshot({ ...input, panel, after }));
      }
      if (typeof input.action !== "string" || input.action === "") return refuse(req, 400, "action name missing; send {\"action\": \"<name>\", ...}");
      // Relay only: `confirmed` and `fingerprint` pass through exactly as the person's page sent them.
      return json(200, await provider.action(input as Parameters<ConsoleProvider["action"]>[0], { identity: "local", node: "local", via: "console", actor: { kind: "person", id: "local" } }));
    }
    return refuse(req, 405, `${req.method} ${url.pathname} is not supported; the API takes POST /api/snapshot and POST /api/action`);
  }

  const server: Server<undefined> = Bun.serve({
    hostname: "127.0.0.1",
    port: options.port ?? 0,
    // Bun's own cap is a hard backstop above the app limit, so an oversized body normally reaches readJsonBody and
    // gets an actionable 413; anything past the backstop is cut off by Bun without being buffered.
    maxRequestBodySize: maxBody + HARD_BODY_SLACK,
    async fetch(req) {
      lastSeen = now();
      armIdle();
      try {
        return await handle(req);
      } catch (err) {
        if (err instanceof Refusal) return refuse(req, err.status, err.message);
        const message = err instanceof Error ? err.message : String(err);
        return refuse(req, 500, `the vault provider failed: ${message}; check the vmem-ui terminal and retry`);
      }
    },
  });
  const port = server.port!;
  const origin = `http://127.0.0.1:${port}`;
  hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  origins = [origin, `http://localhost:${port}`];
  cookieName = `vmem_ui_${port}`;

  function armIdle() {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (stopped) return;
      if (now() - lastSeen < idleMs) return armIdle();
      void stop().then(() => options.onIdle?.());
    }, Math.max(0, idleMs - (now() - lastSeen)));
  }
  armIdle();

  async function stop() {
    if (stopped) return;
    stopped = true;
    if (timer) clearTimeout(timer);
    tickets.clear();
    sessions.clear();
    await server.stop(true);
  }

  return {
    origin,
    port,
    issue() {
      prune(tickets);
      while (tickets.size >= MAX_TICKETS) tickets.delete(tickets.keys().next().value!);
      const ticket = secret();
      tickets.set(ticket, now() + TICKET_MS);
      return `${origin}/login?t=${ticket}`;
    },
    stop,
  };
}
