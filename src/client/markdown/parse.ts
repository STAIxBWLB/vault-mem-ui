/**
 * Markdown to a typed tree: blocks first, then the inline spans inside them.
 *
 * Nothing here produces an HTML string, and an HTML tag in the source is not a construct this parser knows, so it can
 * only ever reach the tree as text. The subset is the one a note uses: headings, paragraphs, fenced code, quotes,
 * lists (with task state), tables with alignment, rules, and inline code, strong, em, links, images and wiki-links.
 */

export type Align = "left" | "center" | "right" | null;

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "strong"; children: Inline[] }
  | { kind: "em"; children: Inline[] }
  | { kind: "link"; href: string; children: Inline[] }
  | { kind: "image"; alt: string; src: string }
  | { kind: "wiki"; target: string; heading: string; block: string; label: string; embed: boolean }
  | { kind: "break" };

export interface ListItem {
  children: Block[];
  /** `true` for `- [x]`, `false` for `- [ ]`, `null` when the item is not a task. */
  checked: boolean | null;
}

export type Block =
  | { kind: "heading"; depth: number; children: Inline[] }
  | { kind: "paragraph"; children: Inline[] }
  | { kind: "code"; lang: string; text: string }
  | { kind: "quote"; children: Block[] }
  | { kind: "list"; ordered: boolean; start: number; items: ListItem[] }
  | { kind: "table"; align: Align[]; head: Inline[][]; rows: Inline[][][] }
  | { kind: "rule" };

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const CLOSING_FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const RULE = /^ {0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/;
const QUOTE = /^ {0,3}>[ ]?/;
const BULLET = /^( *)[-*+]([ \t]+)(.*)$/;
const ORDERED = /^( *)(\d{1,9})[.)]([ \t]+)(.*)$/;
const DELIMITER = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const TASK = /^\[([ xX])\](?:[ \t]+|$)/;
const AUTOLINK = /^<([a-zA-Z][a-zA-Z0-9+.-]*:[^<>\s]+)>/;
const ESCAPABLE = /^[\\`*_{}[\]()#+\-.!|~<>]$/;
const WORD = /[\p{L}\p{N}]/u;

/** The schemes an external link may use. Anything else, including a relative target, stays text. */
const ALLOWED_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/**
 * How deep nesting is followed. Both passes recurse once per level, and a 6 KB note of `- ` or `>` repeats is well
 * inside the provider's 16 KiB body limit, so an unbounded walk overflows the browser stack and the panel has no error
 * boundary to catch it. Past the cap the source is kept as text instead of interpreted, so the bytes still reach the
 * person and nothing recurses further.
 */
export const MAX_BLOCK_DEPTH = 32;
export const MAX_INLINE_DEPTH = 32;

/** The href for a target only when it is an absolute http, https or mailto URL; `null` for everything else. */
export function safeHref(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return ALLOWED_SCHEMES.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function parseMarkdown(text: string): Block[] {
  return parseBlocks(text.replace(/\r\n?/g, "\n").split("\n"), 0);
}

function parseBlocks(lines: string[], depth: number): Block[] {
  if (depth >= MAX_BLOCK_DEPTH) {
    const text = lines.join("\n").trim();
    return text ? [{ kind: "paragraph", children: [{ kind: "text", text }] }] : [];
  }
  const blocks: Block[] = [];
  let at = 0;
  while (at < lines.length) {
    const line = lines[at]!;
    if (!line.trim()) {
      at += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    // A backtick fence's info string cannot hold a backtick, and the same rule keeps ``` inline code a paragraph.
    if (fence && !(fence[1]![0] === "`" && fence[2]!.includes("`"))) {
      const marker = fence[1]!;
      const lang = fence[2]!.trim().split(/[ \t]+/)[0] ?? "";
      const body: string[] = [];
      at += 1;
      while (at < lines.length) {
        const closing = CLOSING_FENCE.exec(lines[at]!);
        if (closing && closing[1]![0] === marker[0] && closing[1]!.length >= marker.length) {
          at += 1;
          break;
        }
        body.push(lines[at]!);
        at += 1;
      }
      blocks.push({ kind: "code", lang, text: body.join("\n") });
      continue;
    }

    const atx = ATX.exec(line);
    if (atx) {
      const heading = (atx[2] ?? "").replace(/[ \t]+#+[ \t]*$/, "").trim();
      blocks.push({ kind: "heading", depth: atx[1]!.length, children: parseInline(heading) });
      at += 1;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ kind: "rule" });
      at += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (at < lines.length) {
        const marker = QUOTE.exec(lines[at]!);
        if (marker) {
          inner.push(lines[at]!.slice(marker[0].length));
          at += 1;
          continue;
        }
        // A blank line keeps the quote open only when the next line is still quoted.
        if (!lines[at]!.trim() && at + 1 < lines.length && QUOTE.test(lines[at + 1]!)) {
          inner.push("");
          at += 1;
          continue;
        }
        break;
      }
      blocks.push({ kind: "quote", children: parseBlocks(inner, depth + 1) });
      continue;
    }

    const head = listHead(line);
    if (head) {
      at = parseList(lines, at, head, blocks, depth);
      continue;
    }

    if (line.includes("|") && at + 1 < lines.length && isTableHead(line, lines[at + 1]!)) {
      const cells = splitRow(line);
      const align = splitRow(lines[at + 1]!).map(cellAlign);
      at += 2;
      const rows: Inline[][][] = [];
      while (at < lines.length && lines[at]!.trim() && lines[at]!.includes("|")) {
        const row = splitRow(lines[at]!);
        rows.push(row.slice(0, align.length).map((cell) => parseInline(cell)));
        at += 1;
      }
      blocks.push({ kind: "table", align, head: align.map((_, index) => parseInline(cells[index] ?? "")), rows });
      continue;
    }

    // A paragraph, or a setext heading when an underline follows its only line.
    const para: string[] = [];
    let setextDepth: number | null = null;
    while (at < lines.length) {
      const next = lines[at]!;
      if (!next.trim()) break;
      if (para.length) {
        const underline = SETEXT.exec(next);
        if (underline && para.length === 1) {
          setextDepth = underline[1]![0] === "=" ? 1 : 2;
          at += 1;
          break;
        }
        if (startsBlock(next)) break;
      }
      para.push(next);
      at += 1;
    }
    const children = parseInline(para.join("\n"));
    blocks.push(setextDepth ? { kind: "heading", depth: setextDepth, children } : { kind: "paragraph", children });
  }
  return blocks;
}

interface Head {
  ordered: boolean;
  start: number;
  /** The column the item's own content starts at, which is also what a continuation line has to reach. */
  indent: number;
  text: string;
}

function listHead(line: string): Head | null {
  if (RULE.test(line)) return null;
  const bullet = BULLET.exec(line);
  if (bullet) return { ordered: false, start: 1, indent: bullet[1]!.length + 1 + bullet[2]!.length, text: bullet[3]! };
  const ordered = ORDERED.exec(line);
  if (ordered) {
    const marker = ordered[2]!;
    return { ordered: true, start: Number(marker), indent: ordered[1]!.length + marker.length + 1 + ordered[3]!.length, text: ordered[4]! };
  }
  return null;
}

function parseList(lines: string[], start: number, first: Head, blocks: Block[], depth: number): number {
  const items: ListItem[] = [];
  let at = start;
  while (at < lines.length) {
    const head = listHead(lines[at]!);
    if (!head || head.ordered !== first.ordered) break;
    const task = TASK.exec(head.text);
    const checked = task ? task[1]!.toLowerCase() === "x" : null;
    const content: string[] = [task ? head.text.slice(task[0].length) : head.text];
    at += 1;
    while (at < lines.length) {
      const next = lines[at]!;
      if (!next.trim()) {
        // Blank lines stay in the item only while something indented enough follows them. The run is read once and
        // kept whole: adding it a line at a time re-read the rest of the run for every blank line, so a note of blank
        // lines cost the square of its length at every nesting level.
        let look = at;
        while (look < lines.length && !lines[look]!.trim()) look += 1;
        if (look >= lines.length || leadingSpaces(lines[look]!) < head.indent) break;
        while (at < look) {
          content.push("");
          at += 1;
        }
        continue;
      }
      if (leadingSpaces(next) < head.indent) break;
      content.push(next.slice(head.indent));
      at += 1;
    }
    items.push({ children: parseBlocks(content, depth + 1), checked });
  }
  blocks.push({ kind: "list", ordered: first.ordered, start: first.start, items });
  return at;
}

function startsBlock(line: string): boolean {
  return FENCE.test(line) || ATX.test(line) || RULE.test(line) || QUOTE.test(line) || listHead(line) !== null;
}

function leadingSpaces(line: string): number {
  return /^ */.exec(line)![0].length;
}

function isTableHead(header: string, delimiter: string): boolean {
  if (!DELIMITER.test(delimiter)) return false;
  return splitRow(header).length === splitRow(delimiter).length;
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cell = "";
  for (let at = 0; at < trimmed.length; at += 1) {
    const char = trimmed[at]!;
    if (char === "\\" && trimmed[at + 1] === "|") {
      // The escape stays in the cell: an inline pass turns `\|` into `|` where it is text, while a wiki-link target
      // keeps the backslash exactly as vmem's own scan of the note reads it.
      cell += "\\|";
      at += 1;
      continue;
    }
    if (char === "|") {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

function cellAlign(delimiter: string): Align {
  const value = delimiter.trim();
  if (value.startsWith(":") && value.endsWith(":")) return "center";
  if (value.endsWith(":")) return "right";
  if (value.startsWith(":")) return "left";
  return null;
}

export function parseInline(text: string, depth = 0): Inline[] {
  return inlinePass(text, depth, true);
}

/**
 * The inline pass. `links` is off while a link's own label is read: an anchor cannot hold an anchor, so a link written
 * inside a label stays the text it was, and skipping it there is also what keeps nested labels from being parsed once
 * per level.
 */
function inlinePass(text: string, depth: number, links: boolean): Inline[] {
  if (depth >= MAX_INLINE_DEPTH) return text ? [{ kind: "text", text }] : [];
  const out: Inline[] = [];
  const delimiters = delimiterIndex(text);
  // Every `[` is paired with its closing `]` in this one pass, so a candidate link start is a lookup rather than a scan
  // to the end of the text: a note of many `[` and a single `]` re-read the same tail from each opening, which took 1.9 s
  // at 48 KB under V8 with the old guard (that guard only helped when no `]` existed at all).
  const pairs = text.includes("[") ? bracketPairs(text) : null;
  const parens = pairs ? parenPairs(text) : null;
  // Successful and rejected destinations may overlap; bound total substring decoding per inline pass.
  const budget = { remaining: text.length * 4 };
  const lastWiki = text.lastIndexOf("]]");
  let buffer = "";
  const flush = () => {
    if (!buffer) return;
    out.push({ kind: "text", text: buffer });
    buffer = "";
  };
  let at = 0;
  while (at < text.length) {
    const char = text[at]!;
    if (char === "\\" && text[at + 1] === "\n") {
      flush();
      out.push({ kind: "break" });
      at += 2;
      continue;
    }
    if (char === "\\" && text[at + 1] && ESCAPABLE.test(text[at + 1]!)) {
      buffer += text[at + 1]!;
      at += 2;
      continue;
    }
    if (char === "\n") {
      if (buffer.endsWith("  ")) {
        let end = buffer.length;
        while (end > 0 && buffer[end - 1] === " ") end -= 1;
        buffer = buffer.slice(0, end);
        flush();
        out.push({ kind: "break" });
      } else buffer += " ";
      at += 1;
      continue;
    }
    if (char === "`") {
      const span = codeSpan(text, at);
      if (span) {
        flush();
        out.push(span.node);
        at = span.end;
        continue;
      }
    }
    if (char === "!" && text[at + 1] === "[") {
      const span = (lastWiki >= at + 3 ? wikiSpan(text, at) : null) ??
        (pairs && parens ? bracketLink(text, at, true, depth, pairs, parens, budget) : null);
      if (span) {
        flush();
        out.push(span.node);
        at = span.end;
        continue;
      }
    }
    if (char === "[" && links) {
      const span = (lastWiki >= at + 2 && text[at + 1] === "[" ? wikiSpan(text, at) : null) ??
        (pairs && parens ? bracketLink(text, at, false, depth, pairs, parens, budget) : null);
      if (span) {
        flush();
        out.push(span.node);
        at = span.end;
        continue;
      }
    }
    if (char === "<" && links) {
      const span = autolink(text, at);
      if (span) {
        flush();
        out.push(span.node);
        at = span.end;
        continue;
      }
    }
    if (char === "*" || char === "_") {
      const span = emphasis(text, at, delimiters, depth, links);
      if (span) {
        flush();
        out.push(span.node);
        at = span.end;
        continue;
      }
    }
    buffer += char;
    at += 1;
  }
  flush();
  return out;
}

interface Span {
  node: Inline;
  end: number;
}

function codeSpan(text: string, at: number): Span | null {
  let size = 0;
  while (text[at + size] === "`") size += 1;
  let cursor = at + size;
  while (cursor < text.length) {
    if (text[cursor] !== "`") {
      cursor += 1;
      continue;
    }
    let run = 0;
    while (text[cursor + run] === "`") run += 1;
    if (run === size) return { node: { kind: "code", text: text.slice(at + size, cursor).replace(/\n/g, " ") }, end: cursor + run };
    cursor += run;
  }
  return null;
}

/** `[[target]]`, `[[target|alias]]`, `[[target#heading]]` and the `![[…]]` embed, read the way vmem reads them. */
function wikiSpan(text: string, at: number): Span | null {
  const embed = text[at] === "!";
  const open = at + (embed ? 1 : 0);
  if (text[open] !== "[" || text[open + 1] !== "[") return null;
  const close = text.indexOf("]]", open + 2);
  if (close < 0) return null;
  const inner = text.slice(open + 2, close);
  if (!inner.trim() || inner.includes("[") || inner.includes("\n")) return null;
  const bar = inner.indexOf("|");
  const address = (bar < 0 ? inner : inner.slice(0, bar)).trim();
  const alias = bar < 0 ? "" : inner.slice(bar + 1).trim();
  if (!address) return null;
  const hash = address.indexOf("#");
  const target = (hash < 0 ? address : address.slice(0, hash)).trim();
  const anchor = hash < 0 ? "" : address.slice(hash + 1).trim();
  // vmem splits the anchor into a heading and a `^block` reference, and resolves each link by both, so the tree keeps
  // them apart: two links to one note with different anchors can resolve differently.
  const block = anchor.startsWith("^") ? anchor.slice(1) : "";
  const heading = anchor && !anchor.startsWith("^") ? anchor : "";
  return { node: { kind: "wiki", target, heading, block, label: alias || address, embed }, end: close + 2 };
}

/**
 * The `]` that closes each `[`, in one pass: `pairs[i]` is that index, or -1 when the bracket is never closed. The
 * nesting rule is the one the label reader had: a `[` holds a `]` that arrived after it, so `[[a]](u)` labels `[a]`.
 * An escaped character closes nothing.
 */
function bracketPairs(text: string): Int32Array {
  const pairs = new Int32Array(text.length).fill(-1);
  const open: number[] = [];
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at]!;
    if (char === "\\") {
      at += 1;
      continue;
    }
    if (char === "[") open.push(at);
    else if (char === "]" && open.length) pairs[open.pop()!] = at;
  }
  return pairs;
}

/** Match unescaped parentheses in one pass; destinations never cross a newline. */
function parenPairs(text: string): Int32Array {
  const pairs = new Int32Array(text.length).fill(-1);
  const stack: number[] = [];
  for (let at = 0; at < text.length; at += 1) {
    if (text[at] === "\\") { at += 1; continue; }
    if (text[at] === "\n") { stack.length = 0; continue; }
    if (text[at] === "(") stack.push(at);
    else if (text[at] === ")" && stack.length) pairs[stack.pop()!] = at;
  }
  return pairs;
}

function bracketLink(text: string, at: number, image: boolean, depth: number, pairs: Int32Array, parens: Int32Array, budget: { remaining: number }): Span | null {
  const bracket = at + (image ? 1 : 0);
  const open = bracket + 1;
  const close = pairs[bracket]!;
  if (close < 0 || text[close + 1] !== "(") return null;
  const end = parens[close + 1]!;
  if (end < 0 || end - open > budget.remaining) return null;
  budget.remaining -= end - open;
  const label = text.slice(open, close);
  const inside = destination(text, close + 1, end);
  if (!inside) return null;
  const target = linkTarget(inside.dest);
  if (!target) return null;
  // An image target is shown, not fetched, so it is kept as written; a link target has to pass the scheme check.
  if (image) return { node: { kind: "image", alt: label.trim(), src: target }, end: end + 1 };
  const href = safeHref(target);
  if (!href) return null;
  // An anchor cannot hold an anchor, so a link inside this label is left as the text it was written as. The label is
  // read with links off for that reason, and also for cost: refusing this outer link instead (letting the inner one
  // win, as CommonMark has it) meant the label was parsed and then re-parsed again from the next character at every
  // nesting level, which doubles the work per level — 320 ms at depth 20 and minutes at depth 3000.
  return { node: { kind: "link", href, children: inlinePass(label, depth + 1, false) }, end: end + 1 };
}

/** The destination of `(…)` starting at `open`, read the way a link target is, and the index of its closing paren. */
function destination(text: string, open: number, closing: number): { dest: string; end: number } | null {
  let dest = "";
  let parens = 1;
  let end = open + 1;
  for (; end <= closing; end += 1) {
    const char = text[end]!;
    if (char === "\\") {
      dest += text[end + 1] ?? "";
      end += 1;
      continue;
    }
    if (char === "\n") return null;
    if (char === "(") {
      parens += 1;
      dest += char;
      continue;
    }
    if (char === ")") {
      parens -= 1;
      if (!parens) break;
      dest += char;
      continue;
    }
    dest += char;
  }
  return parens ? null : { dest, end };
}

/** The target of `[label](target "title")`, without the optional title. */
function linkTarget(dest: string): string {
  const trimmed = dest.trim();
  const angle = /^<([^>]*)>/.exec(trimmed);
  if (angle) return (angle[1] ?? "").trim();
  return trimmed.split(/\s+/)[0] ?? "";
}

function autolink(text: string, at: number): Span | null {
  const match = AUTOLINK.exec(text.slice(at));
  if (!match) return null;
  const href = safeHref(match[1]!);
  if (!href) return null;
  return { node: { kind: "link", href, children: [{ kind: "text", text: match[1]! }] }, end: at + match[0].length };
}

interface Delimiters {
  /** How many `char` characters start at `at`. */
  runAt(at: number, char: string): number;
  /** The first usable closing run at or after `from`, or -1 when the opener never closes. */
  closeAt(from: number, char: string, width: number): number;
}

/**
 * The `*` and `_` runs of one text, each read in a single pass. Without it every opener that never closes rescans the
 * rest of the run, which is quadratic on a note that repeats `*a `; here the positions are computed once and each
 * lookup is a binary search.
 */
function delimiterIndex(text: string): Delimiters {
  const runs = new Map<string, Int32Array>();
  const starts = new Map<string, number[]>();
  const runAt = (at: number, char: string): number => {
    let table = runs.get(char);
    if (!table) {
      table = new Int32Array(text.length + 1);
      for (let index = text.length - 1; index >= 0; index -= 1) {
        table[index] = text[index] === char ? table[index + 1]! + 1 : 0;
      }
      runs.set(char, table);
    }
    return table[at] ?? 0;
  };
  const usable = (found: number, char: string, width: number): boolean => {
    const run = runAt(found, char);
    const before = text[found - 1];
    const after = text[found + run];
    return before !== undefined && !/\s/.test(before) && run === width && !(char === "_" && after !== undefined && WORD.test(after));
  };
  const closeAt = (from: number, char: string, width: number): number => {
    // An opener can start inside a longer run (`***a***`), where the run remaining from here is the one that counts.
    if (text[from] === char && usable(from, char, width)) return from;
    const key = `${char}\u0000${width}`;
    let list = starts.get(key);
    if (!list) {
      list = [];
      for (let at = 0; at < text.length; ) {
        if (text[at] !== char) {
          at += 1;
          continue;
        }
        const run = runAt(at, char);
        if (usable(at, char, width)) list.push(at);
        at += run;
      }
      starts.set(key, list);
    }
    let low = 0;
    let high = list.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (list[middle]! < from) low = middle + 1;
      else high = middle;
    }
    return low < list.length ? list[low]! : -1;
  };
  return { runAt, closeAt };
}

function emphasis(text: string, at: number, delimiters: Delimiters, depth: number, links: boolean): Span | null {
  const char = text[at]!;
  const run = delimiters.runAt(at, char);
  const width = Math.min(run, 2);
  const open = at + width;
  const first = text[open];
  if (!first || /\s/.test(first)) return null;
  if (char === "_" && at > 0 && WORD.test(text[at - 1]!)) return null;
  const close = delimiters.closeAt(open, char, width);
  // A run that closes on itself (`****`, which can open and close at the same character) holds nothing, and an
  // emphasis with no content would swallow its own delimiters and render nothing at all.
  if (close < 0 || close === open) return null;
  const children = inlinePass(text.slice(open, close), depth + 1, links);
  return { node: width === 2 ? { kind: "strong", children } : { kind: "em", children }, end: close + width };
}
