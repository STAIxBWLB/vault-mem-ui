/**
 * The console takes panel assets as strings, so the plugin reads this package's own build output.
 *
 * This is the one file under `src/` allowed to import `node:fs` (see `scripts/import-boundary.ts`): it imports
 * `readFileSync` alone and calls it with these two fixed `dist/` paths, which the boundary check reads off this
 * file. No other path, no other `node:fs` member and no write can pass that check, so the vault itself stays
 * behind the `@staix/vault-mem` provider.
 */

import { readFileSync } from "node:fs";

export interface PanelAssets {
  js: string;
  css: string;
}

/** Both reads go through here so one message covers a missing bundle; the call itself stays at the read site. */
function built(path: string, read: () => string): string {
  try {
    return read();
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new Error(`the panel bundle is missing (${path}): ${cause}. Build it first with \`bun run build\`.`);
  }
}

/** The one ES module and the one stylesheet the console serves for this panel. */
export function panelAssets(): PanelAssets {
  return {
    js: built("dist/panel.js", () => readFileSync(new URL("../../dist/panel.js", import.meta.url), "utf8")),
    css: built("dist/panel.css", () => readFileSync(new URL("../../dist/panel.css", import.meta.url), "utf8")),
  };
}
