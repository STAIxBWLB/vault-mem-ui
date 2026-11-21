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
