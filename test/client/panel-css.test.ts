import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../../src/client/panel.css", import.meta.url), "utf8");

describe("panel.css", () => {
  test("loads nothing remote and imports nothing, so the panel is one file the host serves", () => {
    expect(css).not.toMatch(/@import/i);
    expect(css).not.toMatch(/url\(/i);
    expect(css).not.toMatch(/https?:/i);
  });

  test("takes every colour and metric from acon's tokens with a standalone fallback", () => {
    const block = /\.vmem \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    const defined = [...block.matchAll(/--vmem-([a-z0-9-]+):/g)].map((match) => match[1]!);
    expect(defined.length).toBeGreaterThan(10);
    const withoutToken = defined.filter((name) => !new RegExp(`--vmem-${name}: var\\(--acon-`).test(block));
    expect(withoutToken).toEqual([]);
  });

  test("the person's own light/dark choice overrides the host's tokens", () => {
    const dark = /\.vmem\[data-theme="dark"\] \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    for (const name of ["bg", "surface", "text", "accent"]) {
      expect(dark).toContain(`--vmem-${name}:`);
    }
    expect(dark).not.toContain("var(--acon-");
  });

  test("reduced motion turns off both transitions and animations, for the whole panel", () => {
    const rule = /\.vmem\[data-motion="reduced"\] \* \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    expect(rule).toMatch(/transition:\s*none/);
    expect(rule).toMatch(/animation:\s*none/);
  });

  test("every control that takes focus shows where the focus is", () => {
    const focus = /:focus-visible/.test(css);
    expect(focus).toBe(true);
    const selectors = /([^{}]*:focus-visible[^{}]*)\{/.exec(css)?.[1] ?? "";
    for (const className of [".vmem-button", ".vmem-input", ".vmem-row", ".vmem-nav-item"]) {
      expect(selectors).toContain(className);
    }
    expect(css).toMatch(/outline:\s*2px solid var\(--vmem-accent\)/);
  });
});
