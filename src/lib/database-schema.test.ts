import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? sourceFiles(join(directory,entry.name)) : /\.tsx?$/.test(entry.name) ? [join(directory,entry.name)] : []);
}
it("every literal application RPC exists in the generated database contract", () => {
  const generated = readFileSync("src/lib/database.generated.ts", "utf8");
  const missing = new Set<string>();
  for (const path of sourceFiles("src")) {
    if (path.endsWith(".test.ts") || path.endsWith(".test.tsx")) continue;
    const source = readFileSync(path, "utf8");
    if (!source.includes(".rpc(")) continue;
    const ast = ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "rpc" && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        const name = node.arguments[0].text;
        if (!new RegExp(`\\b${name}:\\s*\\{`).test(generated)) missing.add(name);
      }
      ts.forEachChild(node,visit);
    };
    visit(ast);
  }
  expect([...missing]).toEqual([]);
});
