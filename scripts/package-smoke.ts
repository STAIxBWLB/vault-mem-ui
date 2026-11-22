/**
 * Install the packed tarball into an empty consumer project and use it from outside this checkout: the packaged plugin
 * must import and declare panels, and the packaged `vmem-ui` must answer `--help`. `bun run check` proves the checkout
 * works, which is not the same thing: a value import from a devDependency typechecks, builds and ships, and only an
 * install of the published bytes shows it. The release workflow runs this on the staged tarball before anything is
 * published, and running it locally names the tarball the same way.
 *
 * This is not a bundle-content check: every installed file is compared with this checkout's own copy, so stale or
 * incorrect `dist/` bytes can be packed and installed identically and pass here. What the bundle holds is the business of the fresh
 * build that `bun run check` runs before the pack, not of this script.
 */

import { readFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

/**
 * What the published package must carry: the plugin entry, the two built assets the plugin and the command read, and
 * the standalone command's own entry. Anything else in the tarball is a choice (see `files` in package.json).
 */
export const REQUIRED_ENTRIES = [
  "package/package.json",
  "package/src/plugin/index.ts",
  "package/dist/panel.js",
  "package/dist/panel.css",
  "package/bin/vmem-ui.ts",
];

/** Problems with a tarball's entry list; an empty list means it carries what the plugin and the command read. */
export function tarballProblems(entries: readonly string[]): string[] {
  const present = new Set(entries);
  return REQUIRED_ENTRIES.filter((entry) => !present.has(entry)).map((entry) => `the tarball is missing ${entry}`);
}

const repo = resolve(import.meta.dir, "..");

function command(argv: string[], cwd: string, env: NodeJS.ProcessEnv): string {
  const result = Bun.spawnSync(argv, { cwd, env, stdout: "pipe", stderr: "pipe", timeout: 300_000 });
  const stdout = result.stdout.toString().trim();
  if (result.exitCode !== 0) {
    const detail = (result.stderr.toString().trim() || stdout).split("\n").slice(0, 4).join(" ");
    throw new Error(`package smoke: \`${argv.slice(0, 3).join(" ")}\` exited ${result.exitCode}${detail ? `: ${detail}` : ""}`);
  }
  return stdout;
}

export interface SmokeReport {
  /** Installed files, counted from the tarball's own entry list. */
  files: number;
  /** Panel ids the packaged plugin's manifest declares. */
  panels: string[];
}

/**
 * Install `archive` into a fresh consumer and use only the installed copy. The consumer is a real project with the
 * tarball as its dependency, so a missing runtime dependency, an unbuilt asset or a broken entry point fails here.
 */
export async function packageSmoke(archive: string): Promise<SmokeReport> {
  const tarball = resolve(archive);
  const work = mkdtempSync(join(tmpdir(), "vault-mem-ui-smoke-"));
  const consumer = join(work, "consumer");
  // The command's shebang is `#!/usr/bin/env bun`, and the Bun running this script is not always the one on PATH.
  const env = { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}` };
  try {
    mkdirSync(consumer);
    writeFileSync(join(consumer, "package.json"), `${JSON.stringify({ name: "vault-mem-ui-smoke", private: true, type: "module" }, null, 2)}\n`);
    const entries = command(["tar", "-tzf", tarball], work, env).split("\n").filter(Boolean);
    const problems = tarballProblems(entries);
    if (problems.length) throw new Error(`package smoke: ${problems.join("; ")}; run bun run build before packing`);
    command([process.execPath, "add", tarball], consumer, env);
    // The installed copy is what would be published, not this checkout: compare every packed file with its source.
    const installed = join(consumer, "node_modules", "@staix", "vault-mem-ui");
    for (const entry of entries) {
      const relative = entry.slice("package/".length);
      if (!readFileSync(join(installed, relative)).equals(readFileSync(join(repo, relative)))) {
        throw new Error(`package smoke: installed ${relative} differs from the packed file`);
      }
    }
    writeFileSync(
      join(consumer, "probe.ts"),
      [
        'const imported = await import("@staix/vault-mem-ui/ui-plugin");',
        "const plugin = imported.plugin ?? imported.default;",
        "const panels = plugin?.manifest?.panels;",
        'if (!Array.isArray(panels) || panels.length === 0) throw new Error("the packaged plugin declares no panels");',
        "console.log(JSON.stringify(panels.map((panel) => panel.id)));",
        "",
      ].join("\n"),
    );
    const panels = JSON.parse(command([process.execPath, "probe.ts"], consumer, env)) as string[];
    const help = command([join(consumer, "node_modules", ".bin", "vmem-ui"), "--help"], consumer, env);
    if (!help.includes("usage: vmem-ui")) throw new Error(`package smoke: the installed vmem-ui printed no usage: ${help.slice(0, 120)}`);
    return { files: entries.length, panels };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const archive = process.argv[2] ?? process.env.RELEASE_TARBALL;
  if (!archive) {
    throw new Error("Name the tarball to smoke, or set RELEASE_TARBALL: bun scripts/package-smoke.ts <package.tgz>");
  }
  const report = await packageSmoke(archive);
  console.log(`package smoke: ok (${report.files} installed files, panels ${report.panels.join(", ")}, vmem-ui --help exited 0)`);
}
