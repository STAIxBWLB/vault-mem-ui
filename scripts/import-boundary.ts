import ts from "typescript";

/** The two files the console's panel assets come from; nothing else may be read from this package's build output. */
const PANEL_ASSETS = new Set(["../../dist/panel.js", "../../dist/panel.css"]);

/**
 * The filesystem exception is a read of exactly those two paths, so the check verifies the call rather than trusting
 * the file name: `readFileSync` name-imported from `node:fs`, called with a fixed asset path (a string literal, or
 * `new URL(<literal>, import.meta.url)`) and the `"utf8"` encoding. Another `node:fs` member, a variable path, a
 * write or a dynamic import is a violation in that file like it would be anywhere else.
 */
export function assetReadProblems(source: ts.SourceFile, filename: string): string[] {
  const problems: string[] = [];
  const local = new Set<string>();
  const at = (node: ts.Node) => `${filename}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`;
  const fixedPath = (node: ts.Expression): string | undefined => {
    if (ts.isStringLiteral(node)) return node.text;
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "URL") {
      const [target, base] = node.arguments ?? [];
      if (!target || !base || !ts.isStringLiteral(target)) return undefined;
      const fromModule = ts.isPropertyAccessExpression(base) && base.name.text === "url" && ts.isMetaProperty(base.expression);
      return fromModule ? target.text : undefined;
    }
    return undefined;
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
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
    // A dynamic import or require would reach every member of the module without naming one.
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      problems.push(`${at(node)}: the panel asset reader may only name-import readFileSync`);
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
  const checkSpecifier = (specifier: string) => {
    const childProcess = /^(?:node:)?child_process(?:\/|$)/.test(specifier);
    const fileSystem = /^(?:node:)?fs(?:\/|$)/.test(specifier);
    if (childProcess || (fileSystem && !(assetReader && /^(?:node:)?fs$/.test(specifier)))) reject(`import ${specifier}`);
    if (specifier === "bun:sqlite") reject(`import ${specifier}`);
    if (specifier.startsWith("@staix/vault-mem/") && specifier !== "@staix/vault-mem/ui-plugin") reject("vault-mem internal import");
    if (/vault-mem[\\/](?:src|dist|lib)[\\/]/.test(specifier)) reject("vault-mem internal path");
  };
  const forbidden = new Set(["file", "write", "spawn", "spawnSync", "$"]);
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) checkSpecifier(node.moduleSpecifier.text);
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteral(arg)) checkSpecifier(arg.text);
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
