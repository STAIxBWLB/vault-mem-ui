/**
 * The console takes panel assets as strings, so the plugin reads this package's own build output.
 *
 * This is the one file under `src/` allowed to import `node:fs` (see `scripts/import-boundary.ts`): it reads
 * `dist/` only, never a vault path, and the vault itself stays behind the `@staix/vault-mem` provider.
 */

import { readFileSync } from "node:fs";

export interface PanelAssets {
  js: string;
  css: string;
}

const BUILT = new URL("../../dist/", import.meta.url);

function read(name: string): string {
  try {
    return readFileSync(new URL(name, BUILT), "utf8");
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new Error(`the panel bundle is missing (dist/${name}): ${cause}. Build it first with \`bun run build\`.`);
  }
}

/** The one ES module and the one stylesheet the console serves for this panel. */
export function panelAssets(): PanelAssets {
  return { js: read("panel.js"), css: read("panel.css") };
}
