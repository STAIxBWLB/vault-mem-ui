/**
 * What a release tag must satisfy before anything is packed or published: the tag names the package version, the
 * checkout is the commit the tag points at, and the changelog carries a dated section for that version. The release
 * workflow and the local dry run call the same function, so the rules cannot drift apart between them.
 *
 * Mirrored from vault-mem's release workflow, whose refusals are a tag that does not match the package version and a
 * changelog whose only section is `Unreleased`.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export interface ReleaseFacts {
  /** The tag being released, as `github.ref_name` reads it, e.g. `v0.1.0`. */
  tag: string;
  /** The commit the workflow checked out. */
  sha: string;
  /** The commit the tag points at. */
  head: string;
  /** The package.json version. */
  version: string;
  /** The whole changelog, one line per entry. */
  changelog: string;
}

/** Every problem the tag has; an empty list means it may be packed. */
export function releaseProblems({ tag, sha, head, version, changelog }: ReleaseFacts): string[] {
  const problems: string[] = [];
  if (!VERSION.test(version)) {
    problems.push(
      `package.json version ${JSON.stringify(version)} is not a release version. Set a valid version and its dated changelog section in a release-prep PR, then tag that commit.`,
    );
  }
  if (tag !== `v${version}`) {
    problems.push(
      `Tag ${tag} must equal v + the package.json version. Bump package.json and its changelog section in a release-prep PR, then tag v${version}.`,
    );
  }
  if (sha !== head) {
    problems.push(`Checkout ${sha} is not the commit the tag points at (${head}). Re-run this workflow from the tag rather than from a branch.`);
  }
  const heading = `## [${version}] - `;
  const dated = changelog
    .split("\n")
    .some((line) => line.startsWith(heading) && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(line.slice(heading.length)));
  if (!dated) {
    problems.push(
      `CHANGELOG.md has no dated section for ${version}. Move the Unreleased entries under ## [${version}] - YYYY-MM-DD in a release-prep PR; Unreleased on its own is not a release.`,
    );
  }
  return problems;
}

if (import.meta.main) {
  const tag = process.env.RELEASE_TAG;
  const sha = process.env.RELEASE_SHA;
  if (!tag || !sha) {
    throw new Error(
      "RELEASE_TAG and RELEASE_SHA are missing. Run this in the tag-triggered release workflow, or set both to the tag and its commit for a local dry run.",
    );
  }
  const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const problems = releaseProblems({ tag, sha, head, version, changelog: readFileSync("CHANGELOG.md", "utf8") });
  if (problems.length) {
    for (const problem of problems) console.error(problem);
    process.exitCode = 1;
  } else {
    console.log(`${tag} names ${version}, the checkout is its commit, and CHANGELOG.md has a dated section for it.`);
  }
}
