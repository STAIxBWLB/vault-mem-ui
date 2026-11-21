import ts from "typescript";

/** Reject direct filesystem access and non-public vault-mem imports in source files. */
export function boundaryViolations(source: string, filename: string): string[] {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, filename.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const violations: string[] = [];
  const reject = (cause: string) => violations.push(`${filename}: ${cause} is forbidden; read and write the vault through the @staix/vault-mem provider (snapshot/action)`);
  const checkSpecifier = (specifier: string) => {
    if (/^(?:node:)?(?:fs(?:\/|$)|child_process(?:\/|$))/.test(specifier) || specifier === "bun:sqlite") reject(`import ${specifier}`);
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
  return violations;
}
