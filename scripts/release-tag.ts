/**
 * Cut a release tag on `main`, mirroring vault-mem's `release:tag`: an annotated tag at a clean, up-to-date `main`
 * whose package version increases over the existing release tags and has a dated changelog section. Every refusal names
 * the next step. Nothing is published here; pushing the tag is what starts `.github/workflows/release.yml`.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RELEASE_VERSION, hasDatedSection } from "./release-check.ts";

export function releaseTag(cwd: string, push: boolean): string {
  const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", timeout: 30_000 }).trim();
  if (git("branch", "--show-current") !== "main") throw new Error("Release tags require main. Run git switch main.");
  if (git("status", "--porcelain", "--untracked-files=all")) {
    throw new Error("Release tags require a clean tree. Commit or stash all changes, including untracked files, then retry.");
  }
  git("fetch", "--no-tags", "origin", "+refs/heads/main:refs/remotes/origin/main");
  const head = git("rev-parse", "HEAD");
  if (head !== git("rev-parse", "refs/remotes/origin/main")) {
    throw new Error("Main must be up to date with origin/main. Run git pull --ff-only; if main has local-only commits, move them to a PR branch first.");
  }
  const { version } = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")) as { version: string };
  if (typeof version !== "string" || !RELEASE_VERSION.test(version)) {
    throw new Error("Invalid package version. Bump package.json to a valid release version and add ## [x.y.z] - YYYY-MM-DD to CHANGELOG.md in a release-prep PR first.");
  }
  const tag = `v${version}`;
  if (git("ls-remote", "--tags", "origin", `refs/tags/${tag}`)) {
    throw new Error(`${tag} already exists on origin. Bump package.json and add a dated CHANGELOG entry in a release-prep PR first.`);
  }
  git("fetch", "origin", "--tags");
  const tags = git("tag", "--list", "v*").split("\n").filter(Boolean);
  const reuse = push && tags.includes(tag);
  if (tags.includes(tag) && !push) {
    throw new Error(`${tag} already exists locally. Run bun run release:tag --push to publish it after validation, or bump the version in a release-prep PR.`);
  }
  if (reuse && git("cat-file", "-t", `refs/tags/${tag}`) !== "tag") {
    throw new Error(`${tag} is not an annotated tag. Inspect and delete the unpublished local tag, then recreate it with bun run release:tag --push.`);
  }
  if (reuse && git("rev-parse", `refs/tags/${tag}^{commit}`) !== head) {
    throw new Error(`${tag} points elsewhere, not at HEAD ${head}. Inspect and delete the unpublished local tag, then recreate it with bun run release:tag --push.`);
  }
  const versions = tags.filter((value) => !reuse || value !== tag).map((value) => value.slice(1)).filter((value) => RELEASE_VERSION.test(value));
  if (versions.some((previous) => Bun.semver.order(version, previous) <= 0)) {
    throw new Error("Package version must be bumped above the existing release tags. Bump package.json and add ## [x.y.z] - YYYY-MM-DD to CHANGELOG.md in a release-prep PR first.");
  }
  if (!hasDatedSection(readFileSync(join(cwd, "CHANGELOG.md"), "utf8"), version)) {
    throw new Error("CHANGELOG needs a dated entry for the package version. Bump package.json and add ## [x.y.z] - YYYY-MM-DD to CHANGELOG.md in a release-prep PR first.");
  }
  if (!reuse) git("tag", "-a", tag, head, "-m", `Release ${tag}`);
  if (push) {
    try {
      git("push", "origin", `refs/tags/${tag}:refs/tags/${tag}`);
    } catch (cause) {
      throw new Error(
        `Push of ${tag} failed; the local tag is preserved. Check origin access and connectivity, then retry bun run release:tag --push.`,
        { cause },
      );
    }
  }
  return tag;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--push") || args.length > 1) throw new Error("Unknown or repeated release:tag argument. Use bun run release:tag [--push].");
  const tag = releaseTag(process.cwd(), args.includes("--push"));
  console.log(`${tag} created${args.includes("--push") ? " and pushed" : " locally; use --push explicitly to publish the tag"}`);
}
