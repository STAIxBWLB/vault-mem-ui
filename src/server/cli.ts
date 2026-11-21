/**
 * `vmem-ui` command logic: open the vault-mem console provider in process and serve it on loopback.
 * File reads of the client bundle live in bin/vmem-ui.ts (a fixed two-file allowlist of this package's dist),
 * so nothing under src/ touches the filesystem.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import plugin from "@staix/vault-mem/ui-plugin";
import { DEFAULT_IDLE_MS, startHost, type ClientAssets, type Host } from "./host.ts";

export interface RunOptions {
  assets: ClientAssets;
  argv: string[];
  env: Record<string, string | undefined>;
  out: (line: string) => void;
  err: (line: string) => void;
  /** Called with the exit code when the server stops on its own (idle). */
  exit: (code: number) => void;
  /** Provider factory; tests replace it. Defaults to the vault-mem console plugin. */
  open?: typeof plugin.open;
}

export const USAGE = `usage: vmem-ui [--port <n>] [--idle-minutes <n>]
Serves the vault-mem console on 127.0.0.1 and prints a one-time sign-in link.
  --port <n>          loopback port (default: a free port)
  --idle-minutes <n>  exit after this many minutes without a request (default: ${DEFAULT_IDLE_MS / 60_000})`;

export function parseArgs(argv: string[]): { port: number; idleMs: number; help: boolean } | { error: string } {
  let port = 0, idleMs = DEFAULT_IDLE_MS, help = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-h" || a === "--help") { help = true; continue; }
    if (a === "--port" || a === "--idle-minutes") {
      const raw = argv[++i];
      const n = Number(raw);
      if (raw === undefined || !Number.isInteger(n) || n < 0 || (a === "--port" && n > 65535) || (a === "--idle-minutes" && n < 1)) {
        return { error: `${a} needs ${a === "--port" ? "a port number from 0 to 65535" : "a whole number of minutes, 1 or more"}; got ${raw ?? "nothing"}` };
      }
      if (a === "--port") port = n; else idleMs = n * 60_000;
      continue;
    }
    return { error: `unknown option ${a}; run vmem-ui --help for the options` };
  }
  return { port, idleMs, help };
}

/** Returns the running host, or null after printing why it could not start. */
export async function run(options: RunOptions): Promise<Host | null> {
  const parsed = parseArgs(options.argv);
  if ("error" in parsed) { options.err(`vmem-ui: ${parsed.error}`); return null; }
  if (parsed.help) { options.out(USAGE); return null; }
  const home = options.env.AGENTHUB_HOME ?? join(homedir(), ".agenthub");
  let provider: Awaited<ReturnType<typeof plugin.open>>;
  try {
    provider = await (options.open ?? plugin.open.bind(plugin))({ home, log: (line) => options.err(line) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    options.err(`vmem-ui: could not open the vault-mem provider: ${msg}; check VMEM_HOME and AGENTHUB_HOME (absolute paths, readable vault registry), then run vmem-ui again`);
    return null;
  }
  let host: Host;
  try {
    host = startHost({
      provider, manifest: plugin.manifest, assets: options.assets, port: parsed.port, idleMs: parsed.idleMs,
      onIdle: () => {
        options.out(`vmem-ui: no requests for ${parsed.idleMs / 60_000} minutes; stopped. Run vmem-ui again to reopen.`);
        void (provider.close?.() ?? Promise.resolve()).finally(() => options.exit(0));
      },
    });
  } catch (e) {
    await provider.close?.();
    const msg = e instanceof Error ? e.message : String(e);
    options.err(`vmem-ui: could not listen on 127.0.0.1:${parsed.port}: ${msg}; pick another --port or omit it for a free one`);
    return null;
  }
  options.out(`vmem-ui: open this one-time link in your browser (valid 5 minutes):\n${host.issue()}`);
  return host;
}
