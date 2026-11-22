import { expect, test } from "bun:test";
import { releaseProblems } from "../scripts/release-check";

const sha = "0123456789abcdef0123456789abcdef01234567";
const other = "fedcba9876543210fedcba9876543210fedcba98";
const dated = "## [Unreleased]\n\n- pending\n\n## [0.1.0] - 2026-12-01\n\n- first release\n";
const facts = { tag: "v0.1.0", sha, head: sha, version: "0.1.0", changelog: dated };

test("a tag that names its version, its commit and a dated section passes", () => {
  expect(releaseProblems(facts)).toEqual([]);
});

test("a tag that is not v plus the package version is refused with the next step", () => {
  const problems = releaseProblems({ ...facts, tag: "v0.2.0" });
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain("must equal v + the package.json version");
  expect(problems[0]).toContain("release-prep PR");
});

test("a checkout that is not the tag's commit is refused", () => {
  const problems = releaseProblems({ ...facts, sha: other });
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain("is not the commit the tag points at");
});

test("Unreleased on its own is not a release", () => {
  const problems = releaseProblems({ ...facts, changelog: "## [Unreleased]\n\n- pending\n" });
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain("no dated section for 0.1.0");
  expect(problems[0]).toContain("Unreleased on its own is not a release");
});

test("a section for another version, or a heading with no date, does not count", () => {
  for (const changelog of [
    "## [0.0.1] - 2026-01-01\n\n- an older release\n",
    "## [0.1.0]\n\n- undated\n",
    "## [0.1.0] - not-a-date\n\n- not a date\n",
  ]) {
    expect(releaseProblems({ ...facts, changelog })).toHaveLength(1);
  }
});

test("an invalid package version is refused, and every other problem is still named", () => {
  const problems = releaseProblems({ tag: "v0.1.0", sha: other, head: sha, version: "0.1", changelog: "## [Unreleased]\n\n- pending\n" });
  expect(problems).toHaveLength(4);
  expect(problems[0]).toContain("is not a release version");
  expect(problems[1]).toContain("must equal v + the package.json version");
  expect(problems[2]).toContain("is not the commit the tag points at");
  expect(problems[3]).toContain("no dated section for 0.1");
});

test("a prerelease version with its own dated section passes", () => {
  expect(
    releaseProblems({
      tag: "v0.2.0-rc.1",
      sha,
      head: sha,
      version: "0.2.0-rc.1",
      changelog: "## [Unreleased]\n\n## [0.2.0-rc.1] - 2026-12-02\n\n- candidate\n",
    }),
  ).toEqual([]);
});
