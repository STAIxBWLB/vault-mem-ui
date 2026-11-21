import { expect, test } from "bun:test";
import { missingNotices } from "../scripts/check-notices";

test("bundle inputs require a package notice and license", () => {
  const inputs = ["src/client/panel.ts", "node_modules/react/index.js", "node_modules/@scope/pkg/index.js"];
  expect(missingNotices(inputs, "")).toEqual(["react", "@scope/pkg"]);
  expect(missingNotices(inputs, "## react\nLicense: MIT\n\n## @scope/pkg\nLicense: Apache-2.0\n")).toEqual([]);
  expect(missingNotices(["outside/file.js"], "")).toEqual(["outside/file.js"]);
});
