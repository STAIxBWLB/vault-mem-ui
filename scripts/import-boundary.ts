import ts from "typescript";

/** The two files the console's panel assets come from; nothing else may be read from this package's build output. */
const PANEL_ASSETS = new Set(["../../dist/panel.js", "../../dist/panel.css"]);

/**
 * The global object under every name it answers to: `globalThis` everywhere, `global` under Bun (where `self` is also
 * that object), and `self` or `window` in a page.
 */
const GLOBAL_NAMES = new Set(["global", "globalThis", "self", "window"]);

/** The expression without the parentheses around it: `(globalThis)` is still `globalThis`. */
function peel(node: ts.Expression): ts.Expression {
  let current = node;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

/** A member named either way: `owner.name` and `owner["name"]` reach the same property. */
function memberName(expression: ts.Expression): { owner: ts.Expression; name: string } | undefined {
  const node = peel(expression);
  if (ts.isPropertyAccessExpression(node)) return { owner: peel(node.expression), name: node.name.text };
  if (ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteral(node.argumentExpression)) {
    return { owner: peel(node.expression), name: node.argumentExpression.text };
  }
  return undefined;
}

/** The global object by any of its names; `globalThis.globalThis` and `globalThis.self` reach the same object. */
function globalObject(expression: ts.Expression): boolean {
  const node = peel(expression);
  if (ts.isIdentifier(node)) return GLOBAL_NAMES.has(node.text);
  const member = memberName(node);
  return !!member && GLOBAL_NAMES.has(member.name) && globalObject(member.owner);
}

/** `process` (or `module`) itself, and the same property read off the global object. */
function globalMember(expression: ts.Expression, name: string): boolean {
  const node = peel(expression);
  if (ts.isIdentifier(node)) return node.text === name;
  const member = memberName(node);
  return !!member && member.name === name && globalObject(member.owner);
}

/** A key the check can read: `owner["name"]` and `{ ["name"]: ... }` name the same property as `owner.name`. */
function literalKey(expression: ts.Expression | undefined): string | undefined {
  if (!expression) return undefined;
  const node = peel(expression);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return undefined;
}

/** The key of an element access or of a computed property name, when it is written out. */
function propertyKey(node: ts.Node): string | undefined {
  if (ts.isElementAccessExpression(node)) return literalKey(node.argumentExpression);
  if (ts.isComputedPropertyName(node)) return literalKey(node.expression);
  return undefined;
}

/** The names a module loader answers to on its own, whichever way the reference is written. */
const LOADER_IDENTIFIERS = new Set(["require", "createRequire"]);
/** The names a property may carry: `process.getBuiltinModule`, `process.binding`, `module.require`, `require.resolve`. */
const LOADER_PROPERTIES = new Set(["require", "getBuiltinModule", "binding", "createRequire"]);
/** The writers that reach a property without naming a binding. */
const REFLECTIVE_PROPERTIES = new Set(["defineProperty", "defineProperties"]);

/**
 * A reference to a module loader, not only a call to one. This is the rule that closes the class: `(0, require)(...)`,
 * `require.call(...)`, `require.apply(...)`, `process.binding("fs")` and `const g = process.getBuiltinModule` all name
 * the loader itself, so each is refused by name instead of by the shape of the call around it. Runtime code under src/
 * names none of these (the boundary test scans every source file), and `require` and `createRequire` are refused as bare
 * identifiers as well, because an import binding or an alias is the same name.
 */
function loaderReference(node: ts.Node): string | undefined {
  if (ts.isIdentifier(node) && LOADER_IDENTIFIERS.has(node.text)) {
    // A property name is reported as the property it is by the branch below, so `module.require` counts once.
    const written = ts.isPropertyAccessExpression(node.parent) && node.parent.name === node;
    if (!written) return node.text;
  }
  const named = ts.isPropertyAccessExpression(node) && LOADER_PROPERTIES.has(node.name.text) ? node.name.text : undefined;
  const keyed = propertyKey(node);
  const name = named ?? (keyed !== undefined && LOADER_PROPERTIES.has(keyed) ? keyed : undefined);
  return name === undefined ? undefined : `the ${name} property`;
}

/**
 * A reflective writer by name: `Object.defineProperty`, `Object.defineProperties` and `Reflect` reach a property without
 * naming a binding, so `Object.defineProperty.call(null, globalThis, "URL", ...)` and an alias of either are refused by
 * the reference rather than by the shape of the call.
 */
function reflectiveReference(node: ts.Node): string | undefined {
  if (ts.isIdentifier(node) && node.text === "Reflect") return "Reflect";
  const named = ts.isPropertyAccessExpression(node) && REFLECTIVE_PROPERTIES.has(node.name.text) ? node.name.text : undefined;
  const keyed = propertyKey(node);
  const name = named ?? (keyed !== undefined && REFLECTIVE_PROPERTIES.has(keyed) ? keyed : undefined);
  return name === undefined ? undefined : `the ${name} property`;
}

/**
 * Whether a call is made through a loader's own name, counting a factory: `createRequire(...)(...)` names `createRequire`
 * inside its callee. Such a load is refused by the name, so its specifier needs no second message.
 */
function loadsByLoaderName(node: ts.CallExpression): boolean {
  let callee: ts.Expression = peel(node.expression);
  while (ts.isCallExpression(callee)) callee = peel(callee.expression);
  return loaderReference(callee) !== undefined;
}

/**
 * A call that loads a module without an import declaration: `import(...)`, `require(...)`,
 * `process.getBuiltinModule(...)`, `import.meta.require(...)`, `module.require(...)` and `createRequire(...)(...)`.
 * Each hands back the module object, so each is checked against the same list as a static import; `form` is how the
 * message names the construct. A member may be written with a string key, and `process` and `module` may be read off the
 * global object, because `process["getBuiltinModule"]` and `globalThis.process.getBuiltinModule` are that same function.
 */
function moduleLoadCall(node: ts.Node): { call: ts.CallExpression; form: string } | undefined {
  if (!ts.isCallExpression(node)) return undefined;
  const callee = peel(node.expression);
  if (callee.kind === ts.SyntaxKind.ImportKeyword) return { call: node, form: "import" };
  if (ts.isIdentifier(callee) && callee.text === "require") return { call: node, form: "require" };
  // `createRequire(...)` hands back that same require function, so the call holding it as callee is itself a load.
  if (ts.isCallExpression(callee)) {
    const factory = peel(callee.expression);
    const name = memberName(factory)?.name ?? (ts.isIdentifier(factory) ? factory.text : undefined);
    return name === "createRequire" ? { call: node, form: "createRequire(...)" } : undefined;
  }
  const member = memberName(callee);
  if (!member) return undefined;
  if (member.name === "getBuiltinModule" && globalMember(member.owner, "process")) {
    return { call: node, form: "process.getBuiltinModule" };
  }
  if (member.name === "require") {
    if (ts.isMetaProperty(member.owner) && member.owner.keywordToken === ts.SyntaxKind.ImportKeyword) {
      return { call: node, form: "import.meta.require" };
    }
    if (globalMember(member.owner, "module")) return { call: node, form: "module.require" };
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
 * A write into the global object at a key the check cannot read. A literal or template `"URL"` key is refused wherever
 * it appears, and a reflective writer is refused by name, so what is left here is `globalThis[key] = ...`, whose key
 * may be that same URL. A destructuring target writes through each of its parts, and a loop target is written on every
 * iteration without an assignment of its own, so both are walked to the same write.
 */
function reflectiveGlobalWrite(node: ts.Node): string | undefined {
  const throughTarget = (left: ts.Expression): string | undefined => {
    const target = peel(left);
    if (ts.isArrayLiteralExpression(target)) {
      for (const element of target.elements) {
        if (ts.isOmittedExpression(element) || ts.isSpreadElement(element)) continue;
        const written = throughTarget(element);
        if (written) return written;
      }
      return undefined;
    }
    if (ts.isObjectLiteralExpression(target)) {
      for (const property of target.properties) {
        if (ts.isSpreadAssignment(property)) continue;
        const written = ts.isPropertyAssignment(property) ? throughTarget(property.initializer)
          : ts.isShorthandPropertyAssignment(property) ? throughTarget(property.name)
          : undefined;
        if (written) return written;
      }
      return undefined;
    }
    if (!ts.isElementAccessExpression(target) || !globalObject(target.expression)) return undefined;
    // A key the check can read is refused by its own rule, which applies to every object, not only the global one.
    if (literalKey(target.argumentExpression) !== undefined) return undefined;
    return "a write to a computed global key";
  };
  if (ts.isBinaryExpression(node) && GLOBAL_ASSIGNMENTS.has(node.operatorToken.kind)) return throughTarget(node.left);
  if ((ts.isForOfStatement(node) || ts.isForInStatement(node)) && !ts.isVariableDeclarationList(node.initializer)) {
    return throughTarget(node.initializer);
  }
  return undefined;
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
    // A `"URL"` key names the property without naming a binding, wherever it is written: `globalThis["URL"]`,
    // `(0, globalThis)["URL"]`, a template key, an object's computed key and a destructuring target all land here.
    if (propertyKey(node) === "URL") {
      problems.push(`${at(node)}: a URL property key may not replace the global URL; URL must be the global constructor and may not be rebound`);
    }
    // A reflective writer reaches the property without a key this check can read, so it is refused by name rather
    // than by the shape of the call: `Object.defineProperty`, `.call` on it, `Reflect.set` and an alias of either.
    const reflective = reflectiveReference(node);
    if (reflective) {
      problems.push(`${at(node)}: ${reflective} may not redefine the global URL; URL must be the global constructor and may not be rebound`);
    }
    // The same rebinding without an identifier or a readable key: a key the check cannot read names no property, so
    // the rules above cannot see it.
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

/**
 * Reject direct filesystem access, non-public vault-mem imports and module-loader references in source files.
 *
 * Every message names the file and line, the form that was refused, and the next step.
 */
export function boundaryViolations(source: string, filename: string): string[] {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, filename.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const violations: string[] = [];
  // The console takes panel assets as strings, so exactly one source file reads this package's own build output,
  // and only the two dist assets through calls this check verifies. It never names a vault path.
  const assetReader = /(?:^|[\\/])src[\\/]plugin[\\/]assets\.ts$/.test(filename);
  const at = (node: ts.Node) => `${filename}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}`;
  const reject = (node: ts.Node, cause: string) => violations.push(`${at(node)}: ${cause} is forbidden; read and write the vault through the @staix/vault-mem provider (snapshot/action)`);
  // `named` is the construct the message holds responsible: a declaration reads `import node:fs`, while a call names
  // itself and its specifier, so a load-form message cannot be mistaken for a static import the file does not have.
  const checkSpecifier = (specifier: string, node: ts.Node, named = `import ${specifier}`) => {
    const childProcess = /^(?:node:)?child_process(?:\/|$)/.test(specifier);
    const fileSystem = /^(?:node:)?fs(?:\/|$)/.test(specifier);
    if (childProcess || (fileSystem && !(assetReader && /^(?:node:)?fs$/.test(specifier)))) reject(node, named);
    // `node:module` is how `createRequire` is obtained, and its `require` loads anything the list above refuses.
    if (/^(?:node:)?module$/.test(specifier)) reject(node, named);
    if (specifier === "bun:sqlite") reject(node, named);
    if (specifier.startsWith("@staix/vault-mem/") && specifier !== "@staix/vault-mem/ui-plugin") reject(node, "vault-mem internal import");
    if (/vault-mem[\\/](?:src|dist|lib)[\\/]/.test(specifier)) reject(node, "vault-mem internal path");
  };
  const forbidden = new Set(["file", "write", "spawn", "spawnSync", "$"]);
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) checkSpecifier(node.moduleSpecifier.text, node.moduleSpecifier);
    // The loader by name, whatever the call around it looks like: `(0, require)(...)`, `require.call(...)`,
    // `process.binding("fs")` and an alias all name it, so the class is closed here rather than call shape by call shape.
    const loader = loaderReference(node);
    if (loader) reject(node, loader);
    // A module load hands back the same module object as an import, whichever form reaches it, so each is held to the
    // same list; a specifier the check cannot read is refused like any other. A call made through a refused loader name
    // is already refused there, and the line says it once.
    const load = loader || (ts.isCallExpression(node) && loadsByLoaderName(node)) ? undefined : moduleLoadCall(node);
    if (load) {
      const arg = load.call.arguments[0];
      if (arg && ts.isStringLiteral(arg)) checkSpecifier(arg.text, arg, `${load.form}(${JSON.stringify(arg.text)})`);
      else reject(arg ?? load.call, "nonliteral module loading");
    }
    if (ts.isIdentifier(node) && node.text === "Bun") {
      const parent = node.parent;
      if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
        if (forbidden.has(parent.name.text)) reject(node, `Bun.${parent.name.text}`);
      } else if (ts.isElementAccessExpression(parent) && parent.expression === node) {
        if (!ts.isStringLiteral(parent.argumentExpression) || forbidden.has(parent.argumentExpression.text)) reject(node, "Bun computed access");
      } else reject(node, "Bun alias or destructuring");
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (assetReader) violations.push(...assetReadProblems(file, filename));
  return violations;
}
