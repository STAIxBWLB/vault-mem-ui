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
  // The loader is refused by name, so no call shape can slip past it: a comma expression, `.call`, `.apply`, the
  // deprecated builtin binding, and an alias all name the same loader the calls above name.
  '(0, require)("node:fs")',
  '(0, process.getBuiltinModule)("node:fs")',
  'require.call(null, "node:fs")',
  'require.apply(null, ["node:fs"])',
  'process.getBuiltinModule.call(process, "node:fs")',
  'process.getBuiltinModule.apply(process, ["node:fs"])',
  'process.binding("fs")',
  'process["binding"]("fs")',
  'const g = process.getBuiltinModule;\ng("node:fs")',
  'const r = require;\nr("node:fs")',
  'const viaModule = module.require;\nviaModule("node:fs")',
  'const cr = createRequire;\ncr(import.meta.url)("node:fs")',
  // A destructuring pattern is where the alias is created, so the key is refused there too: shorthand, renamed, and
  // nested inside another pattern.
  'const { getBuiltinModule } = process;\ngetBuiltinModule("node:fs")',
  'const { getBuiltinModule: g } = process;\ng("node:fs")',
  'const { binding } = process;\nbinding("fs")',
  'function f({ process: { binding } }) { return binding("fs") }',
  // A quoted key is the same key: `{ "getBuiltinModule": g } = process` introduces the alias without an identifier
  // spelling the property's name as a name.
  'const { "getBuiltinModule": g } = process;\ng("node:fs")',
  'const { "binding": b } = process;\nb("fs")',
  'const { "require": r } = module;\nr("node:fs")',
  'const { "createRequire": cr } = mod;\ncr(import.meta.url)("node:fs")',
  // A loader named with a builtin this list allows is still a loader, so these are refused too.
  'const path = process.getBuiltinModule("node:path");',
  'const path = createRequire(import.meta.url)("node:path");',
];

test("boundary catches prohibited access", () => {
  for (const source of bad) expect(boundaryViolations(source, "example.ts")).not.toEqual([]);
  expect(boundaryViolations('import x from "@staix/vault-mem/ui-plugin"', "example.ts")).toEqual([]);
  // What is refused is the loader, not the specifier it is called with, so what stays allowed names no loader at all.
  // An array pattern's elements name no property, so they are not a destructuring alias of anything.
  for (const allowed of ["const flag = process.env.CI;", "const [name] = list;"]) {
    expect(boundaryViolations(allowed, "example.ts")).toEqual([]);
  }
});

// Every refusal says where it is, which form was refused, and what to do instead: file and line, the loader name or
// the `URL` key, and the provider route. A name written as a string is the same token, so the message says which string.
test("a refusal names the file, the line, the form and the next step", () => {
  expect(boundaryViolations('const fs = process.binding("fs");', "src/client/probe.ts")).toEqual([
    "src/client/probe.ts:1: binding is forbidden; rename the token or route module loads through the @staix/vault-mem provider (snapshot/action)",
  ]);
  expect(boundaryViolations('const a = 1;\nconst fs = require("node:fs");', "src/client/probe.ts")).toEqual([
    "src/client/probe.ts:2: require is forbidden; rename the token or route module loads through the @staix/vault-mem provider (snapshot/action)",
  ]);
  expect(boundaryViolations('const { "getBuiltinModule": g } = process;\ng("node:fs");', "src/client/probe.ts")).toEqual([
    'src/client/probe.ts:1: the "getBuiltinModule" string is forbidden; rename the token or route module loads through the @staix/vault-mem provider (snapshot/action)',
    "src/client/probe.ts:1: loader owner cannot be passed or aliased; use a direct literal-keyed member such as process.env",
  ]);
  // A private name is refused by the name it spells and reported as it was written, with its `#`.
  expect(boundaryViolations('class Probe { #require() { return 1 } }', "src/client/probe.ts")).toEqual([
    "src/client/probe.ts:1: #require is forbidden; rename the token or route module loads through the @staix/vault-mem provider (snapshot/action)",
  ]);
  expect(boundaryViolations('import { readFileSync } from "node:fs";\nglobalThis["URL"] = class {};', reader)).toEqual([
    'src/plugin/assets.ts:2: the "URL" string is forbidden in the panel asset reader; the reader may only name readFileSync, its two dist asset paths and the global URL constructor',
  ]);
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
  // The forms issue #20's merge gate found still passing. A `URL` key is refused wherever it is written, so the
  // receiver, the destructuring shape and the template key stop mattering; a reflective writer is refused by name, so
  // a `.call` on it and an alias of it are the same reference.
  ['import { readFileSync } from "node:fs";\n(0, globalThis)["URL"] = class {};\nreadFileSync(new URL("../../dist/panel.js", import.meta.url), "utf8")', "a comma-expression receiver writing the global URL"],
  ['import { readFileSync } from "node:fs";\nObject.defineProperty.call(null, globalThis, "URL", { value: class {} });\nreadFileSync(new URL("../../dist/panel.js", import.meta.url), "utf8")', "a defineProperty.call write to the global URL"],
  ['import { readFileSync } from "node:fs";\n({ a: globalThis["URL"] } = { a: class {} });\nreadFileSync(new URL("../../dist/panel.js", import.meta.url), "utf8")', "an object destructuring write to the global URL"],
  ['import { readFileSync } from "node:fs";\n[[globalThis["URL"]]] = [[class {}]];\nreadFileSync(new URL("../../dist/panel.js", import.meta.url), "utf8")', "a nested destructuring write to the global URL"],
  ['import { readFileSync } from "node:fs";\nglobalThis[`URL`] = class {};\nreadFileSync(new URL("../../dist/panel.js", import.meta.url), "utf8")', "a template-keyed write to the global URL"],
  ['import { readFileSync } from "node:fs";\nconst define = Object.defineProperty;\nreadFileSync(new URL("../../dist/panel.js", import.meta.url), "utf8")', "an alias of Object.defineProperty"],
  ['import { readFileSync } from "node:fs";\nconst reflect = Reflect;\nreadFileSync(new URL("../../dist/panel.js", import.meta.url), "utf8")', "an alias of Reflect"],
  // A destructuring pattern introduces the writer too, and `assign` writes a whole properties object whose keys are
  // never the literal this check can read.
  ['import { readFileSync } from "node:fs";\nObject.assign(globalThis, props);\nreadFileSync(new URL("../../dist/panel.js", import.meta.url), "utf8")', "an assign of a properties object the check cannot read"],
  ['import { readFileSync } from "node:fs";\nconst { defineProperty } = Object;\nreadFileSync(new URL("../../dist/panel.js", import.meta.url), "utf8")', "a defineProperty introduced by destructuring"],
  ['import { readFileSync } from "node:fs";\nconst { assign } = Object;\nreadFileSync(new URL("../../dist/panel.js", import.meta.url), "utf8")', "an assign introduced by destructuring"],
  ['import { readFileSync } from "node:fs";\nconst { Reflect } = globalThis;\nreadFileSync(new URL("../../dist/panel.js", import.meta.url), "utf8")', "a Reflect introduced by destructuring"],
  ['import { readFileSync } from "node:fs";\nconst { URL: U } = globalThis;\nreadFileSync(new URL("../../dist/panel.js", import.meta.url), "utf8")', "a URL key read by destructuring"],
  // A quoted key is the same key, in an object literal or in a pattern, and it names the writer or the URL that the
  // identifier rules cannot see because the node is a string.
  ['import { readFileSync } from "node:fs";\nconst { "defineProperty": d } = Object;\nreadFileSync(new URL("../../dist/panel.js", import.meta.url), "utf8")', "a quoted defineProperty introduced by destructuring"],
  ['import { readFileSync } from "node:fs";\nconst { "assign": a } = Object;\nreadFileSync(new URL("../../dist/panel.js", import.meta.url), "utf8")', "a quoted assign introduced by destructuring"],
  ['import { readFileSync } from "node:fs";\nconst { "Reflect": R } = globalThis;\nreadFileSync(new URL("../../dist/panel.js", import.meta.url), "utf8")', "a quoted Reflect introduced by destructuring"],
  ['import { readFileSync } from "node:fs";\nconst { "URL": U } = globalThis;\nreadFileSync(new URL("../../dist/panel.js", import.meta.url), "utf8")', "a quoted URL key read by destructuring"],
  // The same two classes in the shapes codex's rounds named: the other writer that takes a whole properties object, a
  // quoted key inside a pattern, and a quoted URL key in an object literal rather than in a write.
  ['import { readFileSync } from "node:fs";\nObject.defineProperties(globalThis, props);\nreadFileSync(new URL("../../dist/panel.js", import.meta.url), "utf8")', "a defineProperties write of a properties object"],
  ['import { readFileSync } from "node:fs";\nconst { "defineProperties": dp } = Object;\nreadFileSync(new URL("../../dist/panel.js", import.meta.url), "utf8")', "a quoted defineProperties introduced by destructuring"],
  ['import { readFileSync } from "node:fs";\nconst spec = { "URL": 1 };\nreadFileSync(new URL("../../dist/panel.js", import.meta.url), "utf8")', "a quoted URL key in an object literal"],
  // A key the check cannot read on the two objects that hand out loaders, refused for the same reason a global one is.
  ['import { readFileSync } from "node:fs";\nconst loader = process[loaderKey];\nreadFileSync(new URL("../../dist/panel.js", import.meta.url), "utf8")', "a computed key on process"],
  ['import { readFileSync } from "node:fs";\nconst loader = module[loaderKey];\nreadFileSync(new URL("../../dist/panel.js", import.meta.url), "utf8")', "a computed key on module"],
  ['import { readFileSync } from "node:fs";\nglobalThis.self[key] = class {};\nreadFileSync(new URL("../../dist/panel.js", import.meta.url), "utf8")', "a computed key on the global object through globalThis.self"],
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
  expect(found).toEqual([
    "src/plugin/assets.ts:2: a computed key on the global object; write the key as a literal",
    "src/plugin/assets.ts:2: global owner cannot be passed or aliased in the panel asset reader; use a direct literal-keyed member",
  ]);
});

// The check refuses a name it can read, so a name assembled at runtime is outside it. This test marks the limit rather
// than leaving it implied: the concatenated key and the template with a substitution spell no single banned token.
test("a name built at runtime is an allowed limitation", () => {
  for (const source of [
    'const g = other["get" + "BuiltinModule"];\ng("node:fs");',
    'const g = other[`getBuiltin${"Module"}`];\ng("node:fs");',
    'const g = globalThis; g.process[k];',
  ]) expect(boundaryViolations(source, "example.ts")).toEqual([]);
});

test("literal global owner keys and global destructuring cannot hide owner access", () => {
  for (const source of ['const p = globalThis["process"]; p["getBuiltin" + "Module"]("node:fs")', 'const p = self[`process`]', 'const { "process": p } = globalThis', '({ process: p } = globalThis)', 'Reflect.get(globalThis["process"], k)', 'globalThis["module"]', 'const { ["pro" + "cess"]: p } = globalThis']) {
    expect({ source, refused: boundaryViolations(source, "src/client/probe.ts").length > 0 }).toEqual({ source, refused: true });
  }
  for (const source of ['const g = globalThis["self"]; g["U" + "RL"] = class {}', 'const { "self": g } = globalThis']) expect(boundaryViolations(source, reader)).not.toEqual([]);
  expect(boundaryViolations('console.log("process")', "src/client/probe.ts")).toEqual([]);
  expect(boundaryViolations('globalThis["process"].env', "src/client/probe.ts")).toEqual([]);
});

test("parameter defaults check global destructuring without refusing plain object keys", () => {
  for (const source of ['function f({ ["pro" + "cess"]: p } = globalThis) {}', 'const f = ({ [k]: p } = globalThis) => p', 'class C { f({ [k]: p } = globalThis) {} }', 'function f({ nested: { [k]: p } } = globalThis) {}', 'function f({ [k]: p } = (globalThis as any)) {}', '({ process: p } = globalThis)', '({ process: p } = other)']) {
    expect({ source, refused: boundaryViolations(source, "src/client/probe.ts").length > 0 }).toEqual({ source, refused: true });
  }
  for (const source of ['const o = { process: 2, module: 1 }', 'const o = { "process": 1 }']) expect(boundaryViolations(source, "src/client/probe.ts")).toEqual([]);
  for (const source of ['let p; for ({ process: p } of [globalThis]) p["getBuiltin" + "Module"]("node:fs");', 'let p; for ({ process: p } in globalThis) {}', 'let p; for ([{ process: p }] of [[globalThis]]) {}']) expect(boundaryViolations(source, "src/client/probe.ts")).not.toEqual([]);
});

test("unknown computed keys on known global and loader objects are refused throughout src", () => {
  for (const owner of ["process", "module", "globalThis", "self", "window", "global", "globalThis.self", 'globalThis["self"]', "globalThis.process", 'globalThis["module"]']) {
    const found = boundaryViolations(`const key = "safe"; ${owner}[key];`, "src/client/probe.ts");
    expect({ owner, refused: found.some((message) => message.includes("computed key")) }).toEqual({ owner, refused: true });
  }
  expect(boundaryViolations('const key="getBuiltinModule"; process[key]("node:fs")', "src/client/probe.ts")).not.toEqual([]);
  expect(boundaryViolations('process["get" + "BuiltinModule"]', "src/client/probe.ts")).not.toEqual([]);
});

test("casts, comma receivers, owner aliases and computed destructuring are refused", () => {
  for (const source of ['(process as any)[k]', 'process![k]', '(0, process)[k]', '(<any>process)[k]', '(process satisfies any)[k]', 'const { [k]: g } = process', 'const p = process', 'const p = globalThis.process', 'Reflect.get(process, k)', 'Object.getOwnPropertyDescriptor(module, k)']) {
    expect({ source, refused: boundaryViolations(source, "src/client/probe.ts").length > 0 }).toEqual({ source, refused: true });
  }
  for (const source of ['(globalThis as any)["U" + "RL"] = class {}', 'const g = globalThis', 'Object.getOwnPropertyDescriptor(globalThis, k)']) {
    expect({ source, refused: boundaryViolations(source, reader).length > 0 }).toEqual({ source, refused: true });
  }
});

test("asset exports, quoted Bun aliases and import-equals are refused", () => {
  for (const source of ['export { writeFileSync } from "node:fs"', 'export * from "node:fs"']) expect(boundaryViolations(source, reader).join(" ")).toContain("cannot re-export");
  for (const source of ['globalThis["Bun"].write(p, x)', 'const { "Bun": B } = globalThis', 'globalThis[`Bun`].write(p, x)', 'import fs = require("node:fs")']) expect(boundaryViolations(source, "src/client/probe.ts")).not.toEqual([]);
  expect(boundaryViolations('const binding = 1', "src/client/probe.ts").join(" ")).toContain("rename the token");
  expect(boundaryViolations('process[key]', "src/client/probe.ts").join(" ")).toContain("write the key as a literal");
  expect(boundaryViolations('const { "Bun": B } = globalThis', "src/client/probe.ts").join(" ")).toContain('the "Bun" string is forbidden; rename it');
  expect(boundaryViolations('const p = process', "src/client/probe.ts").join(" ")).toContain("such as process.env");
  expect(boundaryViolations('import fs = require("node:fs")', "src/client/probe.ts").join(" ")).toContain("use an import declaration");
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
