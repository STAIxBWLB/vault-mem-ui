#!/usr/bin/env bun
// Thin entry: reads exactly this package's two built client files, then hands off to src/server/cli.ts.
// This is the only filesystem read in the command, and it never touches the vault.
import { run, shutdown } from "../src/server/cli.ts";

export const CLIENT_FILES = { js: new URL("../dist/panel.js", import.meta.url), css: new URL("../dist/panel.css", import.meta.url) } as const;

async function readClient(): Promise<{ js: string; css: string } | null> {
  const js = Bun.file(CLIENT_FILES.js), css = Bun.file(CLIENT_FILES.css);
  if (!(await js.exists()) || !(await css.exists())) return null;
  return { js: await js.text(), css: await css.text() };
}

if (import.meta.main) {
  const assets = await readClient();
  if (!assets) {
    console.error("vmem-ui: the client bundle is missing (dist/panel.js, dist/panel.css); run `bun run build` in the vault-mem-ui package first");
    process.exit(1);
  }
  const host = await run({ assets, argv: process.argv.slice(2), env: process.env, out: console.log, err: console.error, exit: (c) => process.exit(c) });
  if (!host) process.exit(process.argv.includes("--help") || process.argv.includes("-h") ? 0 : 2);
  // Ctrl-C and a termination request go through the same close as the idle exit: the provider is closed either way.
  const stop = () => void shutdown(host, (code) => process.exit(code), console.error);
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
