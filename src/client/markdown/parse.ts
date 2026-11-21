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
  | { kind: "wiki"; target: string; heading: string; label: string; embed: boolean }
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
  return parseBlocks(text.replace(/\r\n?/g, "\n").split("\n"));
}

function parseBlocks(lines: string[]): Block[] {
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
      blocks.push({ kind: "quote", children: parseBlocks(inner) });
      continue;
    }

    const head = listHead(line);
    if (head) {
      at = parseList(lines, at, head, blocks);
      continue;
    }

    if (line.includes("|") && at + 1 < lines.length && isTableHead(line, lines[at + 1]!)) {
      const cells = splitRow(line);
      const align = splitRow(lines[at + 1]!).map(cellAlign);
      at += 2;
      const rows: Inline[][][] = [];
      while (at < lines.length && lines[at]!.trim() && lines[at]!.includes("|")) {
        const row = splitRow(lines[at]!);
        rows.push(align.map((_, index) => parseInline(row[index] ?? "")));
        at += 1;
      }
      blocks.push({ kind: "table", align, head: align.map((_, index) => parseInline(cells[index] ?? "")), rows });
      continue;
    }

    // A paragraph, or a setext heading when an underline follows its only line.
    const para: string[] = [];
    let depth: number | null = null;
    while (at < lines.length) {
      const next = lines[at]!;
      if (!next.trim()) break;
      if (para.length) {
        const underline = SETEXT.exec(next);
        if (underline && para.length === 1) {
          depth = underline[1]![0] === "=" ? 1 : 2;
          at += 1;
          break;
        }
        if (startsBlock(next)) break;
      }
      para.push(next);
      at += 1;
    }
    const children = parseInline(para.join("\n"));
    blocks.push(depth ? { kind: "heading", depth, children } : { kind: "paragraph", children });
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

function parseList(lines: string[], start: number, first: Head, blocks: Block[]): number {
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
        // Blank lines stay in the item only while something indented enough follows them.
        let look = at;
        while (look < lines.length && !lines[look]!.trim()) look += 1;
        if (look >= lines.length || leadingSpaces(lines[look]!) < head.indent) break;
        content.push("");
        at += 1;
        continue;
      }
      if (leadingSpaces(next) < head.indent) break;
      content.push(next.slice(head.indent));
      at += 1;
    }
    items.push({ children: parseBlocks(content), checked });
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
      cell += "|";
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

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
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
      if (/ {2,}$/.test(buffer)) {
        buffer = buffer.replace(/ +$/, "");
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
      const span = wikiSpan(text, at) ?? bracketLink(text, at, true);
      if (span) {
        flush();
        out.push(span.node);
        at = span.end;
        continue;
      }
    }
    if (char === "[") {
      const span = (text[at + 1] === "[" ? wikiSpan(text, at) : null) ?? bracketLink(text, at, false);
      if (span) {
        flush();
        out.push(span.node);
        at = span.end;
        continue;
      }
    }
    if (char === "<") {
      const span = autolink(text, at);
      if (span) {
        flush();
        out.push(span.node);
        at = span.end;
        continue;
      }
    }
    if (char === "*" || char === "_") {
      const span = emphasis(text, at);
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
  const heading = hash < 0 ? "" : address.slice(hash + 1).trim();
  return { node: { kind: "wiki", target, heading, label: alias || address, embed }, end: close + 2 };
}

function bracketLink(text: string, at: number, image: boolean): Span | null {
  const open = at + (image ? 2 : 1);
  let depth = 0;
  let cursor = open;
  for (; cursor < text.length; cursor += 1) {
    const char = text[cursor]!;
    if (char === "\\") {
      cursor += 1;
      continue;
    }
    if (char === "[") depth += 1;
    else if (char === "]") {
      if (!depth) break;
      depth -= 1;
    }
  }
  if (cursor >= text.length || text[cursor + 1] !== "(") return null;
  const label = text.slice(open, cursor);
  let dest = "";
  let parens = 1;
  let end = cursor + 2;
  for (; end < text.length; end += 1) {
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
  if (parens) return null;
  const target = linkTarget(dest);
  if (!target) return null;
  // An image target is shown, not fetched, so it is kept as written; a link target has to pass the scheme check.
  if (image) return { node: { kind: "image", alt: label.trim(), src: target }, end: end + 1 };
  const href = safeHref(target);
  if (!href) return null;
  return { node: { kind: "link", href, children: parseInline(label) }, end: end + 1 };
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

function emphasis(text: string, at: number): Span | null {
  const char = text[at]!;
  let run = 0;
  while (text[at + run] === char) run += 1;
  const width = Math.min(run, 2);
  const open = at + width;
  const first = text[open];
  if (!first || /\s/.test(first)) return null;
  if (char === "_" && at > 0 && WORD.test(text[at - 1]!)) return null;
  const close = closingRun(text, open, char, width);
  if (close < 0) return null;
  const children = parseInline(text.slice(open, close));
  return { node: width === 2 ? { kind: "strong", children } : { kind: "em", children }, end: close + width };
}

function closingRun(text: string, from: number, char: string, width: number): number {
  let at = from;
  while (at < text.length) {
    const found = text.indexOf(char, at);
    if (found < 0) return -1;
    const before = text[found - 1];
    let run = 0;
    while (text[found + run] === char) run += 1;
    const after = text[found + run];
    const usable = before !== undefined && !/\s/.test(before) && run === width && !(char === "_" && after !== undefined && WORD.test(after));
    if (usable) return found;
    at = found + run;
  }
  return -1;
}
