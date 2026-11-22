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
  // A module load that names no import: every one of these hands back the module object, so each answers to the same
  // list, whether the member is written with a dot, with a string key, or read off the global object.
  'process.getBuiltinModule("node:fs")',
  'process.getBuiltinModule("bun:sqlite")',
  'import.meta.require("node:fs")',
  'import.meta.require("@staix/vault-mem/src/private")',
  'process.getBuiltinModule(name)',
  'import.meta.require(name)',
  'createRequire(import.meta.url)("node:fs")',
  'createRequire(import.meta.url)(name)',
  'import { createRequire } from "node:module"',
  'import { createRequire } from "module"',
  'globalThis.process.getBuiltinModule("node:fs")',
  'module.require("node:fs")',
  'module.require(name)',
  'process["getBuiltinModule"]("node:fs")',
  'module["require"]("node:fs")',
  // Under Bun the global object also answers to `global`, and its names reach each other.
  'global.process.getBuiltinModule("node:fs")',
  'globalThis.self.process.getBuiltinModule("node:fs")',
];

test("boundary catches prohibited access", () => {
  for (const source of bad) expect(boundaryViolations(source, "example.ts")).not.toEqual([]);
  expect(boundaryViolations('import x from "@staix/vault-mem/ui-plugin"', "example.ts")).toEqual([]);
  // What is refused is the load, not the name: a builtin this list allows and an ordinary process read both pass.
  for (const allowed of [
    'const path = process.getBuiltinModule("node:path");',
    'const path = createRequire(import.meta.url)("node:path");',
    "const flag = process.env.CI;",
  ]) {
    expect(boundaryViolations(allowed, "example.ts")).toEqual([]);
  }
});

// The asset reader is the one file where `node:fs` is allowed, so the exception is checked at the call, not granted
// to the file: another member, a variable path, a write or a dynamic import stays a violation there too.
const reader = "src/plugin/assets.ts";
const allows = [
  'import { readFileSync } from "node:fs";\nconst js = readFileSync(new URL("../../dist/panel.js", import.meta.url), "utf8");',
  'const css = readFileSync(new URL("../../dist/panel.css", import.meta.url), "utf8");\nimport { readFileSync } from "node:fs";',
];
const refuses: [string, string][] = [
  ['class URL { constructor() { return new globalThis.URL("file:///tmp/other") } }; import { readFileSync } from "node:fs"; readFileSync(new URL("../../dist/panel.js", import.meta.url), "utf8")', "a shadowing URL class"],
  ['import { readFileSync } from "./other.ts"; readFileSync(new URL("../../dist/panel.js", import.meta.url), "utf8")', "a reader imported from another module"],
  ['import { readFileSync } from "node:fs"; function f(URL: unknown) { return URL }', "a URL parameter"],
  ['import { readFileSync } from "node:fs"; const URL = globalThis.URL;', "a URL variable"],
  ['import { URL } from "./other.ts"; import { readFileSync } from "node:fs";', "an imported URL"],
  ['readFileSync(vaultPath, "utf8"); import { readFileSync } from "node:fs";', "a variable read before its hoisted import"],
  ['const read = readFileSync; read(vaultPath, "utf8"); import { readFileSync } from "node:fs";', "an alias before its hoisted import"],
  ['import { readFileSync } from "node:fs"; readFileSync("../../dist/panel.js", "utf8");', "a working-directory-relative asset path"],
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
  // The binding itself: aliasing it, or handing it to something else, would move the read out from under the path check.
  ['import { readFileSync } from "node:fs";\nconst read = readFileSync;\nread(vaultPath, "utf8")', "an alias called with a variable path"],
  ['import { readFileSync } from "node:fs";\nconst read = readFileSync;\nread(new URL("../../dist/panel.js", import.meta.url), "utf8")', "an alias called with the fixed path"],
  ['import { readFileSync } from "node:fs";\nreadFileSync.apply(null, [vaultPath, "utf8"])', "a Function.prototype call"],
  ['import { readFileSync } from "node:fs";\nconst read = readFileSync.bind(null);\nread(vaultPath, "utf8")', "a bound copy"],
  ['import { readFileSync } from "node:fs";\nconst readers = [readFileSync];\nreaders[0](vaultPath, "utf8")', "a reference held in a list"],
  ['import { readFileSync } from "node:fs";\nrun(readFileSync)', "a reference passed as an argument"],
  // The global URL again, through a key or a reflective writer instead of an identifier. Each line keeps the two
  // legal reads the file is allowed, so the only thing left to fail on is the write above it.
  ['import { readFileSync } from "node:fs";\nglobalThis["URL"] = class { constructor() { this.href = "" } };\nreadFileSync(new URL("../../dist/panel.js", import.meta.url), "utf8")', "a bracketed write to the global URL"],
  ['import { readFileSync } from "node:fs";\nObject.defineProperty(globalThis, "URL", { value: class {} });\nreadFileSync(new URL("../../dist/panel.js", import.meta.url), "utf8")', "a defineProperty write to the global URL"],
  ['import { readFileSync } from "node:fs";\nReflect.set(globalThis, "URL", class {});\nreadFileSync(new URL("../../dist/panel.js", import.meta.url), "utf8")', "a Reflect.set write to the global URL"],
  ['import { readFileSync } from "node:fs";\nglobalThis[key] = class {};\nreadFileSync(new URL("../../dist/panel.js", import.meta.url), "utf8")', "a computed write to an unknown global key"],
  ['import { readFileSync } from "node:fs";\nObject.assign(globalThis, { ["URL"]: class {} });\nreadFileSync(new URL("../../dist/panel.js", import.meta.url), "utf8")', "an assign of a computed global key"],
  // The same global reached another way: parenthesized, through a destructuring target, through its own `globalThis`
  // property, and under the names `self` and `window` answer to. Each is the same write, so each is refused the same.
  ['import { readFileSync } from "node:fs";\n(globalThis)["URL"] = class {};\nreadFileSync(new URL("../../dist/panel.js", import.meta.url), "utf8")', "a parenthesized write to the global URL"],
  ['import { readFileSync } from "node:fs";\n[globalThis["URL"]] = [class {}];\nreadFileSync(new URL("../../dist/panel.js", import.meta.url), "utf8")', "a destructuring write to the global URL"],
  ['import { readFileSync } from "node:fs";\nObject["defineProperty"](globalThis, "URL", { value: class {} });\nreadFileSync(new URL("../../dist/panel.js", import.meta.url), "utf8")', "a bracketed defineProperty on the global URL"],
  ['import { readFileSync } from "node:fs";\nglobalThis.globalThis["URL"] = class {};\nreadFileSync(new URL("../../dist/panel.js", import.meta.url), "utf8")', "a write to the global URL through globalThis.globalThis"],
  ['import { readFileSync } from "node:fs";\nself["URL"] = class {};\nreadFileSync(new URL("../../dist/panel.js", import.meta.url), "utf8")', "a write to the global URL through self"],
  ['import { readFileSync } from "node:fs";\nwindow["URL"] = class {};\nreadFileSync(new URL("../../dist/panel.js", import.meta.url), "utf8")', "a write to the global URL through window"],
  ['import { readFileSync } from "node:fs";\n[self["URL"]] = [class {}];\nreadFileSync(new URL("../../dist/panel.js", import.meta.url), "utf8")', "a destructuring write to the global URL through self"],
  ['import { readFileSync } from "node:fs";\n[window["URL"]] = [class {}];\nreadFileSync(new URL("../../dist/panel.js", import.meta.url), "utf8")', "a destructuring write to the global URL through window"],
  ['import { readFileSync } from "node:fs";\nObject["defineProperty"](self, "URL", { value: class {} });\nreadFileSync(new URL("../../dist/panel.js", import.meta.url), "utf8")', "a bracketed defineProperty on the global URL through self"],
  ['import { readFileSync } from "node:fs";\nReflect["set"](window, "URL", class {});\nreadFileSync(new URL("../../dist/panel.js", import.meta.url), "utf8")', "a bracketed Reflect.set on the global URL through window"],
  // Under Bun the global object also answers to `global`, and each of its names reaches the others, so
  // `globalThis.self` and `window.window` are the same object a bare `globalThis` names.
  ['import { readFileSync } from "node:fs";\nglobal["URL"] = class {};\nreadFileSync(new URL("../../dist/panel.js", import.meta.url), "utf8")', "a write to the global URL through Bun's global"],
  ['import { readFileSync } from "node:fs";\nglobalThis.self["URL"] = class {};\nreadFileSync(new URL("../../dist/panel.js", import.meta.url), "utf8")', "a write to the global URL through globalThis.self"],
  ['import { readFileSync } from "node:fs";\nwindow.window["URL"] = class {};\nreadFileSync(new URL("../../dist/panel.js", import.meta.url), "utf8")', "a write to the global URL through window.window"],
  // A loop target is written on every iteration, so it rebinds the global without an assignment operator.
  ['import { readFileSync } from "node:fs";\nfor (globalThis["URL"] of [class {}]) {}\nreadFileSync(new URL("../../dist/panel.js", import.meta.url), "utf8")', "a for-of target writing the global URL"],
  ['import { readFileSync } from "node:fs";\nfor (globalThis["URL"] in { own: class {} }) {}\nreadFileSync(new URL("../../dist/panel.js", import.meta.url), "utf8")', "a for-in target writing the global URL"],
  ['import { readFileSync } from "node:fs";\nfor ([globalThis["URL"]] of [[class {}]]) {}\nreadFileSync(new URL("../../dist/panel.js", import.meta.url), "utf8")', "a destructuring for-of target writing the global URL"],
  ['import { readFileSync } from "node:fs";\nconst fs = process.getBuiltinModule("node:fs");\nfs.writeFileSync("notes/a.md", "x")', "a builtin module load"],
  ['import { readFileSync } from "node:fs";\nconst fs = import.meta.require("node:fs");', "an import.meta.require load"],
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

// `globalThis[key] = ...` is not a string key: the key is an expression this check cannot read, and the message has to
// say that rather than name a form the source does not use.
test("a global key the check cannot read is described as computed", () => {
  const found = boundaryViolations(
    'import { readFileSync } from "node:fs";\nglobalThis[key] = class {};\nreadFileSync(new URL("../../dist/panel.js", import.meta.url), "utf8")',
    reader,
  );
  expect(found.filter((problem) => problem.includes("to a computed global key"))).not.toEqual([]);
  expect(found.filter((problem) => problem.includes("string-keyed"))).toEqual([]);
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
