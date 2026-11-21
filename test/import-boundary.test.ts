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

test("source uses the provider boundary", async () => {
  const files = new Bun.Glob("**/*.{ts,tsx,js,jsx,mts,cts}");
  const errors: string[] = [];
  for await (const file of files.scan({ cwd: "src", absolute: true })) {
    errors.push(...boundaryViolations(await Bun.file(file).text(), file));
  }
  expect(errors).toEqual([]);
});
