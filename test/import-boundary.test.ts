import { expect, test } from "bun:test";
import { boundaryViolations } from "../scripts/import-boundary";

const bad = [
  'import fs from "node:fs"',
  'export * from "node:fs/promises"',
  'await import("fs")',
  'require("@staix/vault-mem/src/private")',
  'import x from "@staix/vault-mem/dist/private"',
  'Bun.file(path)',
  'Bun["file"](path)',
  'Bun.write(p, x)',
  'import {spawn} from "node:child_process"',
  'import {spawn} from "child_process"',
  'Bun.spawn(["cat", p])',
  'Bun.spawnSync(["cat", p])',
  'Bun.$`cat ${p}`',
  'Bun["write"](p, x)',
  'Bun["spawn"](["cat", p])',
  'Bun["spawnSync"](["cat", p])',
  'Bun["$"]`cat ${p}`',
  'const {file} = Bun; file(p)',
  'const runtime = Bun',
  'import {Database} from "bun:sqlite"',
  String.raw`import x from "../vault-mem\\src\\private"`,
  'await import(name)',
];

test("boundary catches prohibited access", () => {
  for (const source of bad) expect(boundaryViolations(source, "example.ts")).not.toEqual([]);
  expect(boundaryViolations('import x from "@staix/vault-mem/ui-plugin"', "example.ts")).toEqual([]);
});

// The asset reader is the one file where `node:fs` is allowed, so the exception is checked at the call, not granted
// to the file: another member, a variable path, a write or a dynamic import stays a violation there too.
const reader = "src/plugin/assets.ts";
const allows = [
  'import { readFileSync } from "node:fs";\nconst js = readFileSync(new URL("../../dist/panel.js", import.meta.url), "utf8");',
  'import { readFileSync } from "node:fs";\nconst css = readFileSync("../../dist/panel.css", "utf8");',
];
const refuses: [string, string][] = [
  ['import { writeFileSync } from "node:fs";\nwriteFileSync(vaultPath, data)', "a write through node:fs"],
  ['import { readFileSync, writeFileSync } from "node:fs";\nconst js = readFileSync(new URL("../../dist/panel.js", import.meta.url), "utf8");\nwriteFileSync("notes/a.md", "x")', "readFileSync smuggled in with a write"],
  ['import fs from "node:fs";\nfs.readFileSync("../../dist/panel.js", "utf8")', "a default import"],
  ['import * as fs from "node:fs";\nfs.readFileSync("../../dist/panel.js", "utf8")', "a namespace import"],
  ['import { readFileSync } from "node:fs";\nconst js = readFileSync(vaultPath, "utf8")', "a variable path"],
  ['import { readFileSync } from "node:fs";\nconst js = readFileSync(new URL("../../notes/a.md", import.meta.url), "utf8")', "a path outside dist"],
  ['import { readFileSync } from "node:fs";\nconst js = readFileSync("../../dist/../notes/a.md", "utf8")', "a traversal to the vault"],
  ['import { readFileSync } from "node:fs";\nconst js = readFileSync(new URL("../../dist/panel.js", import.meta.url))', "a read without the utf8 encoding"],
  ['import { readFileSync } from "node:fs";\nconst js = readFileSync(new URL("../../dist/panel.js", someBase), "utf8")', "a base that is not import.meta.url"],
  ['import { readdirSync } from "node:fs";\nreaddirSync("../../dist")', "another read-only member"],
  ['const fs = await import("node:fs");\nfs.readFileSync("../../dist/panel.js", "utf8")', "a dynamic import"],
];

test("the panel asset reader may only read its two fixed dist paths", () => {
  for (const source of allows) expect(boundaryViolations(source, reader)).toEqual([]);
  for (const [source, what] of refuses) {
    const found = boundaryViolations(source, reader);
    expect({ what, caught: found.length > 0 }).toEqual({ what, caught: true });
  }
});

test("the same sources are violations outside the asset reader", () => {
  for (const source of allows) expect(boundaryViolations(source, "src/client/panel.tsx")).not.toEqual([]);
});

test("every source file, including this package's own reader, passes the boundary", async () => {
  const files = new Bun.Glob("**/*.{ts,tsx,js,jsx,mts,cts}");
  const errors: string[] = [];
  for await (const file of files.scan({ cwd: "src", absolute: true })) {
    errors.push(...boundaryViolations(await Bun.file(file).text(), file));
  }
  expect(errors).toEqual([]);
  expect(errors).not.toContain("src/plugin/assets.ts");
});

test("source uses the provider boundary", async () => {
  const files = new Bun.Glob("**/*.{ts,tsx,js,jsx,mts,cts}");
  const errors: string[] = [];
  for await (const file of files.scan({ cwd: "src", absolute: true })) {
    errors.push(...boundaryViolations(await Bun.file(file).text(), file));
  }
  expect(errors).toEqual([]);
});
