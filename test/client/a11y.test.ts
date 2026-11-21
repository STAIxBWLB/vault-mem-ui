import { describe, expect, test } from "bun:test";
import { globalKey, isListKey, nextFocus, prefersReducedMotion } from "../../src/client/a11y.ts";

describe("nextFocus", () => {
  test("an arrow enters a list at the end it points from, because -1 means nothing is focused", () => {
    expect(nextFocus(3, -1, "ArrowDown")).toBe(0);
    expect(nextFocus(3, -1, "ArrowUp")).toBe(2);
  });

  test("the arrows move one row and stop at the ends instead of wrapping", () => {
    expect(nextFocus(3, 0, "ArrowDown")).toBe(1);
    expect(nextFocus(3, 1, "ArrowUp")).toBe(0);
    expect(nextFocus(3, 2, "ArrowDown")).toBe(2);
    expect(nextFocus(3, 0, "ArrowUp")).toBe(0);
  });

  test("Home and End reach the ends, and a key that is not a list key keeps the focus where it is", () => {
    expect(nextFocus(5, 2, "Home")).toBe(0);
    expect(nextFocus(5, 2, "End")).toBe(4);
    expect(nextFocus(5, 2, "Enter")).toBe(2);
    expect(nextFocus(5, 2, "Tab")).toBe(2);
  });

  test("an empty list has nowhere to focus, and an index past the end is treated as not inside", () => {
    expect(nextFocus(0, 0, "ArrowDown")).toBe(-1);
    expect(nextFocus(3, 9, "ArrowDown")).toBe(0);
    expect(nextFocus(3, 9, "End")).toBe(2);
  });
});

describe("isListKey", () => {
  test("covers the keys the list handles and no others", () => {
    for (const key of ["ArrowDown", "ArrowUp", "Home", "End"]) expect(isListKey(key)).toBe(true);
    for (const key of ["Enter", " ", "Tab", "PageDown", "/"]) expect(isListKey(key)).toBe(false);
  });
});

describe("prefersReducedMotion", () => {
  test("follows the media query it is given", () => {
    expect(prefersReducedMotion(() => ({ matches: true }))).toBe(true);
    expect(prefersReducedMotion(() => ({ matches: false }))).toBe(false);
  });

  test("a host that cannot answer keeps animation on rather than guessing", () => {
    expect(prefersReducedMotion(() => null)).toBe(false);
    expect(
      prefersReducedMotion(() => {
        throw new Error("matchMedia is not a function");
      }),
    ).toBe(false);
  });

  test("asks for the reduced-motion query itself", () => {
    const asked: string[] = [];
    prefersReducedMotion((query) => {
      asked.push(query);
      return { matches: false };
    });
    expect(asked).toEqual(["(prefers-reduced-motion: reduce)"]);
  });
});

describe("globalKey", () => {
  test("Escape closes a dialog, and nothing else happens while one is open", () => {
    expect(globalKey("Escape", true)).toBe("close");
    expect(globalKey("Escape", false)).toBeNull();
    // `/` must not steal the key from a field inside the dialog.
    expect(globalKey("/", true)).toBeNull();
  });

  test("slash opens search only when no dialog is in the way", () => {
    expect(globalKey("/", false)).toBe("search");
    for (const key of ["?", "Escape", "Enter", "k"]) expect(globalKey(key, false)).toBeNull();
  });
});
