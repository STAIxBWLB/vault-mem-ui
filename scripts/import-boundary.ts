import ts from "typescript";

/** The two files the console's panel assets come from; nothing else may be read from this package's build output. */
const PANEL_ASSETS = new Set(["../../dist/panel.js", "../../dist/panel.css"]);

/**
 * A call that loads a module without an import declaration: `import(...)`, `require(...)`,
 * `process.getBuiltinModule(...)` and `import.meta.require(...)`. Each hands back the module object, so each is
 * checked against the same list as a static import; `form` is how the message names the construct.
 */
function moduleLoadCall(node: ts.Node): { call: ts.CallExpression; form: string } | undefined {
  if (!ts.isCallExpression(node)) return undefined;
  const callee = node.expression;
  if (callee.kind === ts.SyntaxKind.ImportKeyword) return { call: node, form: "import" };
  if (ts.isIdentifier(callee) && callee.text === "require") return { call: node, form: "require" };
  if (!ts.isPropertyAccessExpression(callee)) return undefined;
  if (callee.name.text === "getBuiltinModule" && ts.isIdentifier(callee.expression) && callee.expression.text === "process") {
    return { call: node, form: "process.getBuiltinModule" };
  }
  if (callee.name.text === "require" && ts.isMetaProperty(callee.expression) && callee.expression.keywordToken === ts.SyntaxKind.ImportKeyword) {
    return { call: node, form: "import.meta.require" };
  }
  return undefined;
}

const GLOBAL_ASSIGNMENTS = new Set([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

/**
 * A write that replaces the global `URL` without naming an identifier: `globalThis["URL"] = ...` is a string key, and
 * `Object.defineProperty` / `Reflect.set` never mention the binding at all, so the identifier rule below sees neither.
 * A literal `URL` key is the one this file is protected against; a key the check cannot read is refused as well,
 * because an unknown key may be that one.
 */
function reflectiveGlobalWrite(node: ts.Node): string | undefined {
  const target = (expression: ts.Expression | undefined) =>
    !!expression && ts.isIdentifier(expression) && expression.text === "globalThis";
  const cause = (manner: string, key: ts.Expression | undefined): string | undefined => {
    if (key && ts.isStringLiteral(key)) return key.text === "URL" ? `a ${manner} write to the global URL` : undefined;
    return `a ${manner} write to a computed global key`;
  };
  if (ts.isBinaryExpression(node) && GLOBAL_ASSIGNMENTS.has(node.operatorToken.kind)) {
    const left = node.left;
    return ts.isElementAccessExpression(left) && target(left.expression) ? cause("string-keyed", left.argumentExpression) : undefined;
  }
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return undefined;
  const owner = node.expression.expression;
  const member = node.expression.name.text;
  if (!ts.isIdentifier(owner) || !target(node.arguments[0])) return undefined;
  const reflective = (owner.text === "Object" && (member === "defineProperty" || member === "defineProperties" || member === "assign")) ||
    (owner.text === "Reflect" && (member === "set" || member === "defineProperty"));
  if (!reflective) return undefined;
  // `assign` takes a whole properties object, whose keys are never the literal this check can read.
  return member === "assign" ? "a reflective write to a computed global key" : cause("reflective", node.arguments[1]);
}

/**
 * The filesystem exception is a read of exactly those two paths, so the check verifies the call rather than trusting
 * the file name: `readFileSync` name-imported from `node:fs`, called with a fixed asset URL
 * (`new URL(<literal>, import.meta.url)`) and the `"utf8"` encoding. The binding may only appear as that call's callee:
 * an alias, or a reference passed on, would carry the read out from under the path check. Another `node:fs` member, a
 * variable path, a write or a dynamic import is a violation in that file like it would be anywhere else.
 */
export function assetReadProblems(source: ts.SourceFile, filename: string): string[] {
  const problems: string[] = [];
  const local = new Set<string>();
  const at = (node: ts.Node) => `${filename}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`;
  const fixedPath = (node: ts.Expression): string | undefined => {
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "URL") {
      const [target, base] = node.arguments ?? [];
      if (node.arguments?.length !== 2 || !target || !base || !ts.isStringLiteral(target)) return undefined;
      const fromModule = ts.isPropertyAccessExpression(base) && base.name.text === "url" && ts.isMetaProperty(base.expression);
      return fromModule ? target.text : undefined;
    }
    return undefined;
  };
  // ES module imports are hoisted, so collect the binding before checking any use, regardless of source order.
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const named = statement.importClause?.namedBindings;
    if (named && ts.isNamedImports(named)) {
      for (const element of named.elements) {
        if (!element.propertyName && element.name.text === "readFileSync") local.add(element.name.text);
      }
    }
  }
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      if (node.moduleSpecifier.text !== "node:fs") {
        problems.push(`${at(node)}: the panel asset reader must import readFileSync from node:fs`);
      }
      const clause = node.importClause;
      const named = clause?.namedBindings;
      if (!clause || clause.isTypeOnly || clause.name || !named || !ts.isNamedImports(named)) {
        problems.push(`${at(node)}: the panel asset reader may only name-import readFileSync`);
        return;
      }
      for (const element of named.elements) {
        if (element.propertyName || element.name.text !== "readFileSync") {
          problems.push(`${at(node)}: ${element.name.text} is not a read-only panel asset read`);
          continue;
        }
        local.add(element.name.text);
      }
    }
    // Only the global URL constructor at a new-expression site is allowed here. A local declaration,
    // parameter, import or other reference named URL could redirect a supposedly fixed asset read.
    if (ts.isIdentifier(node) && node.text === "URL" &&
        !(ts.isNewExpression(node.parent) && node.parent.expression === node)) {
      problems.push(`${at(node)}: URL must be the global constructor and may not be rebound`);
    }
    // The same rebinding without an identifier: a string key or a reflective writer names no binding, so the rule
    // above cannot see it.
    const globalWrite = reflectiveGlobalWrite(node);
    if (globalWrite) {
      problems.push(`${at(node)}: ${globalWrite}; URL must be the global constructor and may not be rebound`);
    }
    // A dynamic import, require or builtin-module load would reach every member of the module without naming one.
    if (moduleLoadCall(node)) {
      problems.push(`${at(node)}: the panel asset reader may only name-import readFileSync`);
    }
    // The binding is usable only as the callee of one of those calls: an alias, a `Function.prototype` helper, or a
    // reference handed to something else would carry the read out from under the path check.
    if (ts.isIdentifier(node) && local.has(node.text)) {
      const parent = node.parent;
      const bindingSite = ts.isImportSpecifier(parent) && parent.name === node;
      const callee = ts.isCallExpression(parent) && parent.expression === node;
      if (!bindingSite && !callee) {
        problems.push(`${at(node)}: readFileSync may only be called directly on a panel asset path, not aliased or passed on`);
      }
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && local.has(node.expression.text)) {
      const [target, encoding] = node.arguments;
      const path = target ? fixedPath(target) : undefined;
      if (!path || !PANEL_ASSETS.has(path)) {
        problems.push(`${at(node)}: readFileSync may only read a fixed panel asset path (dist/panel.js, dist/panel.css)`);
      } else if (!encoding || !ts.isStringLiteral(encoding) || encoding.text !== "utf8") {
        problems.push(`${at(node)}: readFileSync of ${path} must ask for utf8 text`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return problems;
}

/** Reject direct filesystem access and non-public vault-mem imports in source files. */
export function boundaryViolations(source: string, filename: string): string[] {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, filename.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const violations: string[] = [];
  // The console takes panel assets as strings, so exactly one source file reads this package's own build output,
  // and only the two dist assets through calls this check verifies. It never names a vault path.
  const assetReader = /(?:^|[\\/])src[\\/]plugin[\\/]assets\.ts$/.test(filename);
  const reject = (cause: string) => violations.push(`${filename}: ${cause} is forbidden; read and write the vault through the @staix/vault-mem provider (snapshot/action)`);
  // `named` is the construct the message holds responsible: a declaration reads `import node:fs`, while a call names
  // itself and its specifier, so a load-form message cannot be mistaken for a static import the file does not have.
  const checkSpecifier = (specifier: string, named = `import ${specifier}`) => {
    const childProcess = /^(?:node:)?child_process(?:\/|$)/.test(specifier);
    const fileSystem = /^(?:node:)?fs(?:\/|$)/.test(specifier);
    if (childProcess || (fileSystem && !(assetReader && /^(?:node:)?fs$/.test(specifier)))) reject(named);
    if (specifier === "bun:sqlite") reject(named);
    if (specifier.startsWith("@staix/vault-mem/") && specifier !== "@staix/vault-mem/ui-plugin") reject("vault-mem internal import");
    if (/vault-mem[\\/](?:src|dist|lib)[\\/]/.test(specifier)) reject("vault-mem internal path");
  };
  const forbidden = new Set(["file", "write", "spawn", "spawnSync", "$"]);
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) checkSpecifier(node.moduleSpecifier.text);
    // `process.getBuiltinModule(...)` and `import.meta.require(...)` hand back the same module object as an import,
    // so they are held to the same list; a specifier the check cannot read is refused like any other.
    const load = moduleLoadCall(node);
    if (load) {
      const arg = load.call.arguments[0];
      if (arg && ts.isStringLiteral(arg)) checkSpecifier(arg.text, `${load.form}(${JSON.stringify(arg.text)})`);
      else reject("nonliteral module loading");
    }
    if (ts.isIdentifier(node) && node.text === "Bun") {
      const parent = node.parent;
      if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
        if (forbidden.has(parent.name.text)) reject(`Bun.${parent.name.text}`);
      } else if (ts.isElementAccessExpression(parent) && parent.expression === node) {
        if (!ts.isStringLiteral(parent.argumentExpression) || forbidden.has(parent.argumentExpression.text)) reject("Bun computed access");
      } else reject("Bun alias or destructuring");
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (assetReader) violations.push(...assetReadProblems(file, filename));
  return violations;
}
