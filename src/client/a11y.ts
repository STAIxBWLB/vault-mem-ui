/** Keyboard navigation and reduced-motion helpers, kept pure so the views stay testable without a DOM. */

/**
 * The next focus index in a list for one key, or the current index when the key is not a list key.
 * `-1` means "nothing focused", and the first arrow press enters the list.
 */
export function nextFocus(count: number, current: number, key: string): number {
  if (count <= 0) return -1;
  const inside = current >= 0 && current < count;
  switch (key) {
    case "ArrowDown":
      return inside ? Math.min(count - 1, current + 1) : 0;
    case "ArrowUp":
      return inside ? Math.max(0, current - 1) : count - 1;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return current;
  }
}

const LIST_KEYS = new Set(["ArrowDown", "ArrowUp", "Home", "End"]);

export function isListKey(key: string): boolean {
  return LIST_KEYS.has(key);
}

export interface MediaQueryLike {
  matches: boolean;
}

/**
 * Reduced motion for this view. A host that cannot answer (no `matchMedia`) is treated as "no preference",
 * which keeps animation on rather than guessing.
 */
export function prefersReducedMotion(
  query?: (query: string) => MediaQueryLike | null,
): boolean {
  try {
    const ask = query ?? ((text: string) => (globalThis as { matchMedia?: (q: string) => MediaQueryLike }).matchMedia?.(text) ?? null);
    return ask("(prefers-reduced-motion: reduce)")?.matches === true;
  } catch {
    return false;
  }
}

/** Keys the panel handles globally: `/` opens search, `Escape` closes the write dialog. */
export function globalKey(key: string, hasDialog: boolean): "search" | "close" | null {
  if (key === "Escape" && hasDialog) return "close";
  if (key === "/" && !hasDialog) return "search";
  return null;
}
