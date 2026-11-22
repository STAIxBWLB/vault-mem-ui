import { expect, test } from "bun:test";
import { REQUIRED_ENTRIES, tarballProblems } from "../scripts/package-smoke.ts";

// The smoke install is proved by running it; this pins the rule it refuses on, so a required entry cannot be dropped
// from the list without a test naming it.
test("a tarball is refused by name for every entry it is missing", () => {
  expect(tarballProblems(REQUIRED_ENTRIES)).toEqual([]);
  for (const missing of REQUIRED_ENTRIES) {
    expect(tarballProblems(REQUIRED_ENTRIES.filter((entry) => entry !== missing))).toEqual([`the tarball is missing ${missing}`]);
  }
  expect(tarballProblems([...REQUIRED_ENTRIES, "package/dist/metafile.json"])).toEqual([]);
});
