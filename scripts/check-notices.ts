/** Every external bundle input must name its package and license in the notices. */
export function missingNotices(inputs: string[], notices: string): string[] {
  const missing = new Set<string>();
  for (const input of inputs) {
    const normalized = input.replaceAll("\\", "/");
    if (normalized.startsWith("src/") || normalized.startsWith("./src/")) continue;
    // Bun bundles its own browser polyfill for a `node:` builtin (for example `node:events`); it needs a notice too.
    const builtin = /^node:[a-z_/]+$/.test(normalized) ? normalized : null;
    const match = normalized.match(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)(?:\/|$)/);
    if (builtin) {
      if (!new RegExp(`^## ${builtin}\\s*\\n+License: \\S`, "m").test(notices)) missing.add(builtin);
      continue;
    }
    if (!match) {
      missing.add(input);
      continue;
    }
    const name = match[1]!;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(`^## ${escaped}\\s*\\n+License: \\S`, "m").test(notices)) missing.add(name);
  }
  return [...missing];
}

if (import.meta.main) {
  const metafile = await Bun.file("dist/metafile.json").json() as { inputs: Record<string, unknown> };
  const notices = await Bun.file("THIRD_PARTY_NOTICES.md").text();
  const missing = missingNotices(Object.keys(metafile.inputs), notices);
  if (missing.length) {
    console.error(`Missing third-party notices for: ${missing.join(", ")}. Add a heading and license to THIRD_PARTY_NOTICES.md.`);
    process.exitCode = 1;
  }
}
