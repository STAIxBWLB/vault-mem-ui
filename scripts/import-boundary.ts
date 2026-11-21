import ts from "typescript";

/** Reject direct filesystem access and non-public vault-mem imports in source files. */
export function boundaryViolations(source: string, filename: string): string[] {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, filename.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const violations: string[] = [];
  const checkSpecifier = (node: ts.Node, specifier: string) => {
    if (specifier === "fs" || specifier === "node:fs" || specifier.startsWith("fs/") || specifier.startsWith("node:fs/")) {
      violations.push(`${filename}: filesystem import is forbidden`);
    }
    if (specifier.startsWith("@staix/vault-mem/") && specifier !== "@staix/vault-mem/ui-plugin") {
      violations.push(`${filename}: vault-mem internal import is forbidden`);
    }
    if (/vault-mem(?:\/|\\\\)(?:src|dist|lib)(?:\/|\\\\)/.test(specifier)) {
      violations.push(`${filename}: vault-mem internal path is forbidden`);
    }
  };
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) checkSpecifier(node, node.moduleSpecifier.text);
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteral(arg)) checkSpecifier(node, arg.text);
      else violations.push(`${filename}: nonliteral module loading is forbidden`);
    }
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Bun" && node.name.text === "file") violations.push(`${filename}: Bun.file is forbidden`);
    if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Bun" && ts.isStringLiteral(node.argumentExpression) && node.argumentExpression.text === "file") violations.push(`${filename}: Bun.file is forbidden`);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return violations;
}
