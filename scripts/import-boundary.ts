import ts from "typescript";

/** The two files the console's panel assets come from; nothing else may be read from this package's build output. */
const PANEL_ASSETS = new Set(["../../dist/panel.js", "../../dist/panel.css"]);

/**
 * The global object under every name it answers to: `globalThis` everywhere, `global` under Bun (where `self` is also
 * that object), and `self` or `window` in a page.
 */
const GLOBAL_NAMES = new Set(["global", "globalThis", "self", "window"]);

/**
 * The names a module loader answers to, refused wherever one is written. A name is refused, not a call shape, so
 * `require("node:fs")`, `(0, require)(...)`, `require.call(...)`, `process.binding("fs")`, `process.getBuiltinModule`,
 * `const g = process.getBuiltinModule`, `const { getBuiltinModule } = process`, `{ "getBuiltinModule": g } = process`
 * and an import of `createRequire` are refused by the same rule: each spells the token.
 */
const LOADER_NAMES = new Set(["require", "createRequire", "getBuiltinModule", "binding"]);

/**
 * The names the panel asset reader may not spell either: `defineProperty`, `defineProperties`, `assign` and `Reflect`
 * write a property without naming a binding, and a `URL` token may replace the constructor its two fixed asset paths
 * are built on.
 */
const READER_NAMES = new Set(["defineProperty", "defineProperties", "Reflect", "assign", "URL"]);

/** The expression without the parentheses around it: `(globalThis)` is still `globalThis`. */
function peel(node: ts.Expression): ts.Expression {
  let current = node;
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isNonNullExpression(current) || ts.isTypeAssertionExpression(current) || (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.CommaToken)) {
    current = ts.isBinaryExpression(current) ? current.right : current.expression;
  }
  return current;
}

/** Known owners must not be passed or aliased: only a direct, readable member access is allowed. */
function unsafeOwner(node: ts.Node, names: ReadonlySet<string>): boolean {
  if (ts.isIdentifier(node)) {
    if (!names.has(node.text) || (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)) return false;
    if (names === LOADER_OWNERS && ts.isPropertyAssignment(node.parent) && node.parent.name === node) {
      let container: ts.Node = node.parent.parent;
      let target: ts.Node = container;
      while (ts.isObjectLiteralExpression(container) || ts.isArrayLiteralExpression(container) || ts.isPropertyAssignment(container) || ts.isParenthesizedExpression(container) || ts.isSpreadElement(container) || ts.isAsExpression(container) || ts.isSatisfiesExpression(container) || ts.isNonNullExpression(container) || ts.isTypeAssertionExpression(container)) { target = container; container = container.parent; }
      const assignment = ts.isBinaryExpression(container) && container.operatorToken.kind === ts.SyntaxKind.EqualsToken && container.left === target;
      const loop = (ts.isForOfStatement(container) || ts.isForInStatement(container)) && container.initializer === target;
      if (!assignment && !loop) return false;
    }
  } else if (ts.isPropertyAccessExpression(node)) {
    if (!globalObject(node.expression) || !names.has(node.name.text)) return false;
  } else if (ts.isElementAccessExpression(node)) {
    if (!globalObject(node.expression) || !names.has(literalKey(node.argumentExpression) ?? "")) return false;
  } else return false;
  const use = node.parent;
  if (ts.isPropertyAccessExpression(use) && use.expression === node) return false;
  if (ts.isElementAccessExpression(use) && use.expression === node && literalKey(use.argumentExpression) !== undefined) return false;
  return true;
}

const LOADER_OWNERS = new Set(["process", "module"]);

/** Keys read directly from a global object by destructuring, including computed unreadable keys. */
function globalPatternKeys(node: ts.Node, names: ReadonlySet<string>): ts.Node[] {
  let pattern: ts.Node | undefined;
  if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer && globalObject(node.initializer)) pattern = node.name;
  if (ts.isParameter(node) && ts.isObjectBindingPattern(node.name) && node.initializer && globalObject(node.initializer)) pattern = node.name;
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isObjectLiteralExpression(peel(node.left)) && globalObject(node.right)) pattern = peel(node.left);
  if (!pattern) return [];
  const refused: ts.Node[] = [];
  const visitPattern = (current: ts.Node) => {
    const members = ts.isObjectBindingPattern(current) ? current.elements : ts.isObjectLiteralExpression(current) ? current.properties : [];
    for (const member of members) {
      const key = ts.isBindingElement(member) ? member.propertyName ?? member.name : ts.isPropertyAssignment(member) || ts.isShorthandPropertyAssignment(member) ? member.name : undefined;
      if (!key) continue;
      if (ts.isComputedPropertyName(key)) {
        const value = literalKey(key.expression);
        if (value === undefined || names.has(value)) refused.push(key);
      } else if ((ts.isIdentifier(key) || ts.isStringLiteral(key)) && names.has(key.text)) refused.push(key);
      if (ts.isParameter(node) && ts.isBindingElement(member) && ts.isObjectBindingPattern(member.name)) visitPattern(member.name);
    }
  };
  visitPattern(pattern);
  return refused;
}

/**
 * The text of a token that spells a name. A comment and JSX text are not tokens of these kinds, so prose may name a
 * loader; an identifier, a private name, a string and a template without substitutions may not.
 */
function nameToken(node: ts.Node): string | undefined {
  // A private name carries its `#` in the node's text, while the name it spells is what follows it.
  if (ts.isPrivateIdentifier(node)) return node.text.slice(1);
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return undefined;
}

/** How a refusal names the token: the name as it was written, or the string it was written as. */
function tokenForm(node: ts.Node): string {
  if (ts.isPrivateIdentifier(node)) return node.text;
  const text = nameToken(node) ?? "";
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? `the ${JSON.stringify(text)} string` : text;
}

/** The loader this node names, if it names one. */
function loaderName(node: ts.Node): string | undefined {
  const text = nameToken(node);
  return text !== undefined && LOADER_NAMES.has(text) ? tokenForm(node) : undefined;
}

/** The global object by any of its names; `globalThis.self` and `window.window` reach the same object. */
function globalObject(expression: ts.Expression): boolean {
  const node = peel(expression);
  if (ts.isIdentifier(node)) return GLOBAL_NAMES.has(node.text);
  if (ts.isPropertyAccessExpression(node)) return GLOBAL_NAMES.has(node.name.text) && globalObject(node.expression);
  if (ts.isElementAccessExpression(node)) return GLOBAL_NAMES.has(literalKey(node.argumentExpression) ?? "") && globalObject(node.expression);
  return false;
}

/** A key the check can read: `owner["name"]` names the same property as `owner.name`. */
function literalKey(expression: ts.Expression | undefined): string | undefined {
  if (!expression) return undefined;
  const node = peel(expression);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return undefined;
}

/**
 * A member whose key the check cannot read. `globalThis[key]` may be the global URL and `process[key]` may be
 * `process.getBuiltinModule`, so on those objects a key that is not written out is refused instead of assumed harmless.
 */
function unreadableMemberKey(node: ts.Node): string | undefined {
  if (!ts.isElementAccessExpression(node)) return undefined;
  if (literalKey(node.argumentExpression) !== undefined) return undefined;
  const owner = peel(node.expression);
  if (ts.isIdentifier(owner) && (owner.text === "process" || owner.text === "module")) return owner.text;
  if (ts.isPropertyAccessExpression(owner) && (owner.name.text === "process" || owner.name.text === "module") && globalObject(owner.expression)) return owner.name.text;
  if (ts.isElementAccessExpression(owner) && globalObject(owner.expression)) {
    const name = literalKey(owner.argumentExpression);
    if (name === "process" || name === "module") return name;
  }
  return globalObject(owner) ? "the global object" : undefined;
}

/**
 * An `import(...)` call. Every loader form is refused by its own name, so this is the load that still needs its
 * specifier checked: it spells no loader token.
 */
function dynamicImport(node: ts.Node): ts.CallExpression | undefined {
  if (!ts.isCallExpression(node)) return undefined;
  return peel(node.expression).kind === ts.SyntaxKind.ImportKeyword ? node : undefined;
}

/**
 * The filesystem exception is a read of exactly those two paths, so the check verifies the call rather than trusting
 * the file name: `readFileSync` name-imported from `node:fs`, called with a fixed asset URL
 * (`new URL(<literal>, import.meta.url)`) and the `"utf8"` encoding. The binding may only appear as that call's callee:
 * an alias, or a reference passed on, would carry the read out from under the path check. Every other name the reader
 * would need to write through is refused here by its token, and a `new URL(<literal>, import.meta.url)` callee is the
 * one place a `URL` is allowed to stand.
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
    if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      problems.push(`${at(node)}: the panel asset reader cannot re-export modules; remove the export and use its fixed asset reads`);
    }
    if (unsafeOwner(node, GLOBAL_NAMES)) problems.push(`${at(node)}: global owner cannot be passed or aliased in the panel asset reader; use a direct literal-keyed member`);
    for (const key of globalPatternKeys(node, GLOBAL_NAMES)) problems.push(`${at(key)}: global owner cannot be destructured in the panel asset reader; use a direct literal-keyed member`);
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
    // A dynamic import reaches every member of a module without naming one.
    if (dynamicImport(node)) {
      problems.push(`${at(node)}: the panel asset reader may only name-import readFileSync`);
    }
    // A writer or the URL constructor by name, in any spelling: `Object.defineProperty`, `Object["defineProperty"]`,
    // `const { defineProperty } = Object`, `{ "defineProperty": d } = Object`, `Reflect.set`, `const r = Reflect`, an
    // alias of `Object.assign`, `globalThis["URL"]`, a template key and `{ "URL": 1 }` all spell the token.
    const named = nameToken(node);
    if (named !== undefined && READER_NAMES.has(named)) {
      const newUrlCallee = named === "URL" && ts.isIdentifier(node) &&
        ts.isNewExpression(node.parent) && node.parent.expression === node;
      if (!newUrlCallee) {
        // Only the global URL constructor at a new-expression site is allowed here, because a local declaration,
        // parameter, import or other reference named URL could redirect a supposedly fixed asset read.
        problems.push(`${at(node)}: ${tokenForm(node)} is forbidden in the panel asset reader; the reader may only name readFileSync, its two dist asset paths and the global URL constructor`);
      }
    }
    // The same rebinding without a name to refuse: a key the check cannot read names no property, so the rule above
    // cannot see it.
    const unreadable = unreadableMemberKey(node);
    if (unreadable) {
      problems.push(`${at(node)}: a computed key on ${unreadable}; write the key as a literal`);
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
 * Reject direct filesystem access, non-public vault-mem imports and module-loader names in source files.
 *
 * Every message names the file and line, the form that was refused, and the next step.
 *
 * Computed keys on known global or loader objects are refused, but a name built at runtime on another object is out of
 * reach of a syntactic check. `eval`, `new Function`, `module.constructor._load` and `import.meta` rewrites are outside
 * this check; a shape that names no loader at all but loads one needs a runtime guard.
 * Aliasing the global object outside the asset reader is also outside this check.
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
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) violations.push(`${at(node)}: import-equals module loading is forbidden; use an import declaration`);
    // A loader name, in whatever spelling the source reaches it: `(0, require)(...)`, `require.call(...)`,
    // `process.binding("fs")`, `const g = process.getBuiltinModule`, `{ "getBuiltinModule": g } = process` and an
    // alias are one token each, so the class closes on the name instead of on the shape of the call around it.
    const loader = loaderName(node);
    if (loader) violations.push(`${at(node)}: ${loader} is forbidden; rename the token or route module loads through the @staix/vault-mem provider (snapshot/action)`);
    if (unsafeOwner(node, LOADER_OWNERS)) violations.push(`${at(node)}: loader owner cannot be passed or aliased; use a direct literal-keyed member such as process.env`);
    for (const key of globalPatternKeys(node, LOADER_OWNERS)) violations.push(`${at(key)}: global owner key cannot be destructured; use a direct literal-keyed member such as process.env`);
    const unreadable = !assetReader && unreadableMemberKey(node);
    if (unreadable) violations.push(`${at(node)}: a computed key on ${unreadable} is forbidden; write the key as a literal`);
    // A dynamic import hands back the same module object as a static one, so it is held to the same list, and a
    // specifier the check cannot read is refused like any other.
    const load = dynamicImport(node);
    if (load) {
      const arg = load.arguments[0];
      if (arg && ts.isStringLiteral(arg)) checkSpecifier(arg.text, arg, `import(${JSON.stringify(arg.text)})`);
      else reject(arg ?? load, "nonliteral module loading");
    }
    if (nameToken(node) === "Bun" && !ts.isIdentifier(node)) violations.push(`${at(node)}: ${tokenForm(node)} is forbidden; rename it`);
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
