/**
 * The note body: the tree the parser builds, the elements the renderer makes from it, and the two things that must
 * never happen with vault text - an HTML element and a link to a scheme the panel did not allow. Every fixture here is
 * synthetic text; none of it came from a vault.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MAX_BLOCK_DEPTH, parseInline, parseMarkdown, safeHref, type Block } from "../../src/client/markdown/parse.ts";
import { Markdown, wikiIndex, wikiKey } from "../../src/client/markdown/render.tsx";
import { NoteView } from "../../src/client/views/note.tsx";

const html = (text: string, links?: unknown): string =>
  renderToStaticMarkup(<Markdown text={text} links={links} onOpenNote={() => {}} />);

/** What the provider answers for `vmem_links`: resolved links under `out`, unresolved ones under `dead`. */
const links = {
  out: [
    { target: "Beta", heading: null, block: null, resolved: "notes/beta.md" },
    { target: "Beta", heading: "Design", block: null, resolved: "notes/beta.md" },
  ],
  dead: [{ target: "Missing", heading: null, block: null, resolved: null }],
};

describe("parseMarkdown", () => {
  test("headings keep their depth, including the setext underline", () => {
    expect(parseMarkdown("# One\n\n###### Six").map((block) => block.kind === "heading" && block.depth)).toEqual([1, 6]);
    expect(parseMarkdown("Title\n=====").map((block) => block.kind === "heading" && block.depth)).toEqual([1]);
    expect(parseMarkdown("Sub\n---").map((block) => block.kind === "heading" && block.depth)).toEqual([2]);
    // `a | b` followed by `---` is a heading, not a one-column table: the columns disagree.
    expect(parseMarkdown("a | b\n---")[0]?.kind).toBe("heading");
  });

  test("ATX heading closing markers and unmatched backtick suffixes keep their meaning", () => {
    expect(html("# title ###")).toContain(">title</h2>");
    expect(html("# title###")).toContain(">title###</h2>");
    expect(parseInline("``x`y`")).toEqual([{ kind: "text", text: "`" }, { kind: "code", text: "x" }, { kind: "text", text: "y`" }]);
  });

  test("a list keeps its kind, its start and its task state", () => {
    const bullet = parseMarkdown("- a\n- b")[0];
    expect(bullet?.kind === "list" && bullet.ordered).toBe(false);
    expect(bullet?.kind === "list" && bullet.items.length).toBe(2);

    const ordered = parseMarkdown("3. c\n4. d")[0];
    expect(ordered?.kind === "list" && ordered.start).toBe(3);

    const tasks = parseMarkdown("- [ ] todo\n- [x] done\n- plain")[0];
    expect(tasks?.kind === "list" && tasks.items.map((item) => item.checked)).toEqual([false, true, null]);

    const nested = parseMarkdown("- a\n  - b")[0];
    const inner = nested?.kind === "list" ? nested.items[0]?.children[1] : undefined;
    expect(inner?.kind).toBe("list");
  });

  test("a fence runs to its own marker, or to the end of the note when it never closes", () => {
    const [closed] = parseMarkdown("~~~sh\necho *x*\n~~~").filter((block) => block.kind === "code");
    expect(closed?.kind === "code" && closed.lang).toBe("sh");
    expect(closed?.kind === "code" && closed.text).toBe("echo *x*");
    const [open] = parseMarkdown("```\nstill code").filter((block) => block.kind === "code");
    expect(open?.kind === "code" && open.text).toBe("still code");
  });

  test("a table carries an alignment per column", () => {
    const [table] = parseMarkdown("| a | b |\n| :-- | --: |\n| 1 | 2 |");
    expect(table?.kind === "table" && table.align).toEqual(["left", "right"]);
    expect(table?.kind === "table" && table.rows.length).toBe(1);
  });
});

describe("safeHref", () => {
  test("keeps http, https and mailto, and refuses every other target", () => {
    expect(safeHref("https://example.test/a?b=1")).toBe("https://example.test/a?b=1");
    expect(safeHref("http://example.test")).toBe("http://example.test/");
    expect(safeHref("mailto:someone@example.test")).toBe("mailto:someone@example.test");
    for (const refused of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      " javascript:alert(1) ",
      "java\tscript:alert(1)",
      "data:text/html,<b>x</b>",
      "file:///etc/passwd",
      "vbscript:msgbox(1)",
      "/relative/path",
      "//example.test/x",
      "",
    ]) {
      expect({ refused, href: safeHref(refused) }).toEqual({ refused, href: null });
    }
  });
});

describe("Markdown", () => {
  test("a heading is an element under the panel's own h1, never above it", () => {
    expect(html("# One")).toContain('<h2 class="vmem-md-h">One</h2>');
    expect(html("###### Six")).toContain('<h6 class="vmem-md-h">Six</h6>');
  });

  test("a soft line break is a space and a hard one is a br", () => {
    expect(html("one\ntwo")).toContain("one two");
    expect(html("one\ntwo")).not.toContain("<br/>");
    expect(html("one  \ntwo")).toContain("<br/>");
  });

  test("lists, tasks, quotes, rules and code come out as their own elements", () => {
    const list = html("- a\n- b");
    expect(list).toContain('<ul class="vmem-md-list">');
    expect(html("3. c\n4. d")).toContain('<ol class="vmem-md-list" start="3">');
    expect(html("- a\n  - b").match(/<ul /g)?.length).toBe(2);

    const todo = html("- [ ] todo");
    expect(todo).toContain('type="checkbox"');
    expect(todo).toContain("disabled");
    expect(todo).not.toContain('checked=""');
    expect(html("- [x] done")).toContain('checked=""');

    expect(html("> quoted **bold**")).toContain('<blockquote class="vmem-md-quote">');
    expect(html("> quoted **bold**")).toContain("<strong>bold</strong>");
    expect(html("---")).toContain('<hr class="vmem-md-rule"/>');
  });

  test("a fence is text: no emphasis, no link, no element from what it contains", () => {
    const markup = html("```ts\nconst a = *not em* <b>href</b>;\n```");
    expect(markup).toContain('<pre class="vmem-md-pre" data-lang="ts">');
    expect(markup).toContain("*not em*");
    expect(markup).not.toContain("<em>");
    expect(markup).not.toContain("<b>");
    expect(markup).toContain("&lt;b&gt;");
    expect(html("use `a*b*`")).toContain('<code class="vmem-md-code">a*b*</code>');
  });

  test("a table lays its columns out with an attribute, because the stylesheet cannot take an inline style", () => {
    const markup = html("| a | b |\n| :-- | --: |\n| 1 | 2 |");
    expect(markup).toContain('<table class="vmem-md-table">');
    expect(markup).toContain('data-align="left"');
    expect(markup).toContain('data-align="right"');
    expect(markup.match(/<td /g)?.length).toBe(2);
  });

  test("a table row wider than the header renders only the header's columns", () => {
    const markup = html("| a | b |\n| --- | --- |\n| one | two | extra |");
    expect(markup.match(/<td\b/g)).toHaveLength(2);
    expect(markup).toContain("one");
    expect(markup).toContain("two");
    expect(markup).not.toContain("extra");
  });
});

describe("vault text cannot become markup", () => {
  const hostile = [
    "<script>alert(1)</script>",
    '<img src=x onerror="alert(1)">',
    '<a href="javascript:alert(1)">x</a>',
    '<style>body{display:none}</style>',
    '<iframe src="data:text/html,x"></iframe>',
  ];

  test("an HTML tag in a note is shown as text, in every construct that carries text", () => {
    for (const source of hostile) {
      const markup = html(`${source}\n\n# ${source}\n\n- ${source}\n\n> ${source}`);
      expect({ source, script: markup.includes("<script") }).toEqual({ source, script: false });
      expect({ source, img: markup.includes("<img") }).toEqual({ source, img: false });
      expect({ source, iframe: markup.includes("<iframe") }).toEqual({ source, iframe: false });
      expect({ source, style: markup.includes("<style") }).toEqual({ source, style: false });
      expect({ source, anchor: /<a[\s>]/.test(markup) }).toEqual({ source, anchor: false });
      // Attribute position is what matters: the source's own `onerror=` survives as escaped text, inside no tag.
      expect({ source, handler: /<[a-z][^<>]*\son[a-z]+=/i.test(markup) }).toEqual({ source, handler: false });
      expect({ source, inlineStyle: /<[a-z][^<>]*\sstyle=/i.test(markup) }).toEqual({ source, inlineStyle: false });
      expect(markup).toContain("&lt;");
    }
  });

  test("a link to any other scheme stays the text it was, with no href at all", () => {
    for (const target of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "data:text/html,x",
      "file:///etc/passwd",
      "vbscript:msgbox(1)",
      "/notes/a.md",
    ]) {
      const markup = html(`[click](${target})`);
      expect({ target, href: markup.includes("href=") }).toEqual({ target, href: false });
      expect({ target, anchor: /<a[\s>]/.test(markup) }).toEqual({ target, anchor: false });
      expect(markup).toContain("[click](");
    }
  });

  test("a delimiter run with nothing between its characters stays literal text", () => {
    // `****` can open and close at the same character, which built an empty <strong> and ate the four asterisks.
    const markup = html("a **** b");
    expect(markup).not.toContain("<strong></strong>");
    expect(markup).toContain("a **** b");
  });

  test("an allowed link leaves the panel with no opener and no referrer", () => {
    const markup = html("[site](https://example.test/a?b=1) and <mailto:someone@example.test>");
    expect(markup).toContain('href="https://example.test/a?b=1"');
    expect(markup).toContain('href="mailto:someone@example.test"');
    expect(markup.match(/target="_blank"/g)?.length).toBe(2);
    expect(markup.match(/rel="noopener noreferrer"/g)?.length).toBe(2);
  });

  test("a link inside a link label stays one anchor: the outer link wins and the inner one is text", () => {
    const markup = html("[outer [inner](https://example.test/in)](https://example.test/out)");
    expect(markup.match(/<a[\s>]/g)?.length).toBe(1);
    expect(markup).toContain('href="https://example.test/out"');
    // The label is read with links off, so the inner link keeps the characters it was written with.
    expect(markup).not.toContain('href="https://example.test/in"');
    expect(markup).toContain("[inner](https://example.test/in)");
  });
});

describe("wiki-links are read from the provider's own resolution", () => {
  test("the payload is keyed by the link, not by the note, so one target can be two answers", () => {
    const index = wikiIndex(links);
    expect(index.get(wikiKey("Beta", "", ""))).toEqual({ kind: "resolved", path: "notes/beta.md" });
    expect(index.get(wikiKey("Missing", "", ""))).toEqual({ kind: "dead", reason: "", suggested: "" });
    expect(index.has(wikiKey("NotListed", "", ""))).toBe(false);
    expect(wikiIndex(undefined).size).toBe(0);
    // A null anchor in the payload and no anchor in the note are the same link.
    const bare = wikiIndex({ out: [{ target: "Beta", heading: null, block: null, resolved: "notes/beta.md" }] });
    expect(bare.get(wikiKey("Beta", "", ""))).toEqual({ kind: "resolved", path: "notes/beta.md" });
  });

  test("the review's reproduction: a resolved link and a dead one to the same note stay apart", () => {
    const mixed = {
      out: [{ target: "Alpha", heading: null, block: null, resolved: "notes/a.md" }],
      dead: [{ target: "Alpha", heading: "missing", block: null, resolved: null }],
    };
    expect(wikiIndex(mixed).get(wikiKey("Alpha", "", ""))).toEqual({ kind: "resolved", path: "notes/a.md" });
    expect(wikiIndex(mixed).get(wikiKey("Alpha", "missing", ""))).toEqual({ kind: "dead", reason: "", suggested: "" });

    const markup = html("[[Alpha]] and [[Alpha#missing]]", mixed);
    expect(markup.match(/<button type="button" class="vmem-md-wiki">/g)?.length).toBe(1);
    expect(markup).toContain('<button type="button" class="vmem-md-wiki">Alpha</button>');
    expect(markup).toContain("vmem-md-wiki-missing");
    expect(markup).toContain("vmem could not resolve this link");
  });

  test("a block reference is its own identity too", () => {
    const paragraph = parseMarkdown("[[Alpha#^b1]]")[0];
    expect(paragraph?.kind === "paragraph" ? paragraph.children[0] : undefined).toEqual({
      kind: "wiki",
      target: "Alpha",
      heading: "",
      block: "b1",
      label: "Alpha#^b1",
      embed: false,
    });
    const deadBlock = { dead: [{ target: "Alpha", heading: null, block: "b1", resolved: null }] };
    expect(html("[[Alpha#^b1]]", deadBlock)).toContain("vmem-md-wiki-missing");
    // An answer for the bare target does not speak for the block link.
    const bareTarget = { dead: [{ target: "Alpha", heading: null, block: null, resolved: null }] };
    expect(html("[[Alpha#^b1]]", bareTarget)).not.toContain("vmem-md-wiki-missing");
    expect(html("[[Alpha#^b1]]", bareTarget)).toContain("vmem-md-wiki-unknown");
  });

  test("a resolved link is a button, in all three spellings, that opens the resolved note", () => {
    const markup = html("[[Beta]] [[Beta|the beta note]] [[Beta#Design|design]]", links);
    expect(markup.match(/<button type="button" class="vmem-md-wiki">/g)?.length).toBe(3);
    expect(markup).toContain("the beta note");
    expect(markup).toContain(">design<");
    expect(markup).not.toContain("vmem-md-wiki-missing");
  });

  test("a link the provider could not resolve looks different and is not something to click", () => {
    const markup = html("[[Missing]]", links);
    expect(markup).toContain("vmem-md-wiki-missing");
    expect(markup).not.toContain("<button");
    expect(markup).toContain("vmem could not resolve this link");
  });

  test("a link the capped answer never listed is unknown, not broken", () => {
    const markup = html("[[NotListed]]", links);
    expect(markup).toContain("vmem-md-wiki-unknown");
    expect(markup).not.toContain("vmem-md-wiki-missing");
    expect(markup).not.toContain("<button");
    // It says what the panel knows: the list it was given does not include this link.
    expect(markup).toContain("link list does not include it");
    expect(markup).not.toContain("could not resolve");
  });

  test("a dead link shows vmem's own reason and the note it suggests", () => {
    const dead = (reason: string, suggested?: string) => ({
      dead: [{
        target: "Alpha",
        heading: null,
        block: null,
        resolved: null,
        reason,
        suggested: suggested ? { path: suggested, score: 0.8 } : null,
      }],
    });
    const cases: [string, string][] = [
      ["missing-note", "no note has this name"],
      ["ambiguous-note", "more than one note has this name"],
      ["missing-heading", "the note it names has no such heading"],
      ["missing-block", "the note it names has no such block"],
    ];
    for (const [reason, why] of cases) {
      const markup = html("[[Alpha]]", dead(reason));
      expect({ reason, why: markup.includes(why) }).toEqual({ reason, why: true });
      expect({ reason, generic: markup.includes("vmem could not resolve this link") }).toEqual({ reason, generic: false });
    }
    const hinted = html("[[Alpha]]", dead("missing-note", "notes/alpha.md"));
    expect(hinted).toContain("no note has this name");
    expect(hinted).toContain("vmem suggests notes/alpha.md");
    // An answer with no reason at all keeps the sentence the panel already had.
    const bare = { dead: [{ target: "Alpha", heading: null, block: null, resolved: null }] };
    expect(html("[[Alpha]]", bare)).toContain("vmem could not resolve this link");
  });

  test("a link to the note the body belongs to is keyed by its empty target", () => {
    // vmem answers `[[#Heading]]` and `[[#^block]]` with `target: ""`, meaning the note the body belongs to; the map
    // used to drop those rows, so both states rendered as unlisted.
    const self = {
      out: [{ target: "", heading: "Design", block: null, resolved: "notes/a.md" }],
      dead: [{ target: "", heading: null, block: "b1", resolved: null, reason: "missing-block", suggested: null }],
    };
    const index = wikiIndex(self);
    expect(index.get(wikiKey("", "Design", ""))).toEqual({ kind: "resolved", path: "notes/a.md" });
    expect(index.get(wikiKey("", "", "b1"))).toEqual({ kind: "dead", reason: "missing-block", suggested: "" });

    const markup = html("[[#Design]] and [[#^b1]]", self);
    expect(markup).toContain('<button type="button" class="vmem-md-wiki">#Design</button>');
    expect(markup).toContain("this note: the note it names has no such block");
    expect(markup).not.toContain("vmem-md-wiki-unknown");
  });

  test("a target past the provider's own bound keys the way the provider answered it", () => {
    // `vmem_links` answers with each of target, heading and block cut at 1024 UTF-8 bytes, so the note's own spelling
    // has to be cut the same way or a long link never matches its own answer.
    const ascii = "a".repeat(1100);
    const hangul = "가".repeat(600);
    const answer = {
      out: [
        { target: ascii.slice(0, 1024), heading: null, block: null, resolved: "notes/ascii.md" },
        // 1024 bytes is 341 of these characters (1023 bytes): the cut lands on a character boundary, not mid-character.
        { target: "가".repeat(341), heading: null, block: null, resolved: "notes/hangul.md" },
      ],
    };
    const markup = html(`[[${ascii}]] and [[${hangul}]]`, answer);
    expect(markup.match(/<button type="button" class="vmem-md-wiki">/g)?.length).toBe(2);
    expect(markup).not.toContain("vmem-md-wiki-unknown");
  });

  test("a reason a tooltip would hide is tied to the link for a keyboard and a screen reader", () => {
    const markup = html("[[Missing]]", {
      dead: [{ target: "Missing", heading: null, block: null, resolved: null, reason: "missing-note" }],
    });
    const described = /aria-describedby="([^"]+)"/.exec(markup);
    expect(described).not.toBeNull();
    expect(markup).toContain(`id="${described![1]}"`);
    expect(markup).toContain("Missing: no note has this name");
    // The description is separate from the label, so the link still reads as what the note wrote.
    expect(markup).toContain(">Missing</span>");
  });

  test("a table keeps the escape vmem's own scan sees, so the link keys the same way", () => {
    const table = "| link |\n| --- |\n| [[A\\|alias]] |";
    const cell = parseMarkdown(table)[0];
    const first = cell?.kind === "table" ? cell.rows[0]?.[0]?.[0] : undefined;
    expect(first?.kind === "wiki" ? [first.target, first.label] : null).toEqual(["A\\", "alias"]);

    // vmem's scan of the note reports `A\`, so that key resolves the cell...
    const asProvider = { out: [{ target: "A\\", heading: null, block: null, resolved: "notes/a.md" }] };
    expect(html(table, asProvider)).toContain('<button type="button" class="vmem-md-wiki">alias</button>');
    // ...and the unescaped key does not, which is the mismatch the earlier version of this cell had.
    const asUnescaped = { out: [{ target: "A", heading: null, block: null, resolved: "notes/a.md" }] };
    expect(html(table, asUnescaped)).toContain("vmem-md-wiki-unknown");
  });

  test("an embed is a link to its note, marked as an embed, because the panel fetches nothing else", () => {
    const markup = html("![[Beta]]", links);
    expect(markup).toContain("vmem-md-wiki-embed");
    expect(markup).toContain("<button");
  });
});

describe("images are described, never fetched", () => {
  test("an image is its alt text and a readable target", () => {
    const remote = html("![A diagram](https://example.test/d.png)");
    expect(remote).not.toContain("<img");
    expect(remote).toContain("A diagram");
    expect(remote).toContain('href="https://example.test/d.png"');

    const local = html("![A diagram](assets/d.png)");
    expect(local).not.toContain("<img");
    expect(local).toContain("assets/d.png");
    expect(local).not.toMatch(/<a[\s>]/);
  });

  test("an image target with a refused scheme is text as well", () => {
    const markup = html("![x](javascript:alert(1))");
    expect(markup).not.toContain("<img");
    expect(markup).not.toMatch(/<a[\s>]/);
    expect(markup).toContain("javascript:alert(1)");
  });

  test("a label holds no second anchor and no button, because an anchor cannot hold either", () => {
    // A badge written as an image inside a link is the shape that used to nest one anchor in another.
    const badge = html("[![alt](https://example.test/image)](https://example.test/)");
    expect(badge.match(/<a[\s>]/g)?.length ?? 0).toBe(1);
    expect(badge).toContain('href="https://example.test/"');
    expect(badge).toContain("alt");
    expect(badge).toContain("https://example.test/image");
    expect(badge).not.toContain('href="https://example.test/image"');

    // An embed inside a link is a button in the old reading, which is a second focusable target inside the first.
    const embed = html("[![[Beta]]](https://example.test/)", links);
    expect(embed.match(/<a[\s>]/g)?.length ?? 0).toBe(1);
    expect(embed.match(/<button/g)?.length ?? 0).toBe(0);
    expect(embed).toContain("Beta");
  });
});

describe("no client source can build markup", () => {
  test("the client holds no HTML sink, which is what keeps vault text text", async () => {
    const cwd = new URL("../../src/client", import.meta.url).pathname;
    const sink = /dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|outerHTML|document\.write|createContextualFragment/;
    const found: string[] = [];
    for await (const file of new Bun.Glob("**/*.{ts,tsx}").scan({ cwd })) {
      const source = await Bun.file(`${cwd}/${file}`).text();
      if (sink.test(source)) found.push(file);
    }
    expect(found).toEqual([]);
  });
});

describe("nesting is capped, so a small note cannot overflow the stack", () => {
  const depthOf = (blocks: Block[], level = 1): number => {
    let deepest = level;
    for (const block of blocks) {
      const children = block.kind === "quote"
        ? block.children
        : block.kind === "list"
          ? block.items.flatMap((item) => item.children)
          : [];
      if (children.length) deepest = Math.max(deepest, depthOf(children, level + 1));
    }
    return deepest;
  };

  test("a 5000-deep list and quote are text, not a recursion", () => {
    for (const source of ["- ".repeat(5000) + "x", ">".repeat(5000) + "x"]) {
      const blocks = parseMarkdown(source);
      expect({ marker: source.slice(0, 2), blocks: blocks.length > 0 }).toEqual({ marker: source.slice(0, 2), blocks: true });
      expect(depthOf(blocks)).toBeLessThanOrEqual(MAX_BLOCK_DEPTH + 1);
      // What sits past the cap is still shown, as the text it was.
      expect(html(source)).toContain("x");
    }
  });

  test.skipIf(!Bun.which("node"))("the same depths under V8, the engine the panel runs in", async () => {
    const out = `${tmpdir()}/vmem-md-depth-${process.pid}.mjs`;
    const built = Bun.spawnSync([
      process.execPath, "build", "src/client/markdown/parse.ts", "--target=node", "--format=esm", `--outfile=${out}`,
    ]);
    expect({ built: built.exitCode, err: built.stderr.toString().slice(0, 300) }).toEqual({ built: 0, err: "" });
    const script = [
      `const { parseInline, parseMarkdown } = await import(${JSON.stringify(out)});`,
      'for (const text of ["- ".repeat(5000) + "x", ">".repeat(5000) + "x"]) {',
      "  const blocks = parseMarkdown(text);",
      '  if (!blocks.length) throw new Error("no blocks");',
      "}",
      // The same engine check for the nested-label chain: exponential work is only visible as time, not as a throw.
      'const nested = "[".repeat(3000) + "x" + "](http://a)".repeat(3000);',
      "const start = Date.now();",
      "const blocks = parseMarkdown(nested);",
      'if (!blocks.length) throw new Error("no blocks");',
      'if (Date.now() - start > 2000) throw new Error("nested labels took " + (Date.now() - start) + " ms");',
      // And the partial-bracket case measured here: 218 ms at 16k, 678 ms at 32k, 1.9 s at 48k before the pairing pass.
      'const partial = "[".repeat(48000) + "]";',
      "const before = Date.now();",
      "parseInline(partial);",
      'if (Date.now() - before > 1000) throw new Error("one close took " + (Date.now() - before) + " ms");',
      'const destinations = "[a](".repeat(12000);',
      "const destinationStart = Date.now();",
      "parseInline(destinations);",
      'if (Date.now() - destinationStart > 1000) throw new Error("unclosed destinations took " + (Date.now() - destinationStart) + " ms");',
      'const overlapStart = Date.now();',
      'parseInline("[a](".repeat(12000) + ")".repeat(12000));',
      'if (Date.now() - overlapStart > 1000) throw new Error("overlapping destinations took " + (Date.now() - overlapStart) + " ms");',
      // Median of seven warmed runs makes the 50 ms bound less sensitive to a single scheduler interruption.
      'for (const [name, run] of [["heading", () => parseMarkdown("# " + " ".repeat(16384) + "x")], ["backticks", () => parseInline("`".repeat(16384))]]) {',
      '  for (let i = 0; i < 3; i++) run();',
      '  const times = []; for (let i = 0; i < 7; i++) { const start = performance.now(); run(); times.push(performance.now() - start); }',
      '  times.sort((a, b) => a - b); if (times[3] >= 50) throw new Error(name + " took " + times[3] + " ms");',
      '}',
      'const breakStart = Date.now();',
      'parseInline("a" + " ".repeat(8000) + "b\\n" + "x\\n".repeat(3000));',
      'if (Date.now() - breakStart > 1000) throw new Error("hard break scan took " + (Date.now() - breakStart) + " ms");',
      'const header = Array(1000).fill("x").join("|");',
      'const separator = Array(1000).fill("---").join("|");',
      'const table = parseMarkdown(header + "\\n" + separator + "\\n" + "|\\n".repeat(1000))[0];',
      'if (table.kind !== "table" || table.rows.reduce((n, row) => n + row.length, 0) > 2000) throw new Error("table cell amplification");',
      'console.log("ok");',
    ].join("\n");
    const run = Bun.spawnSync([Bun.which("node")!, "--input-type=module", "-e", script]);
    await Bun.file(out).delete();
    expect({ code: run.exitCode, out: run.stdout.toString().trim(), err: run.stderr.toString().slice(0, 300) })
      .toEqual({ code: 0, out: "ok", err: "" });
  });

  test("a note that repeats an opener is read once and stays literal text", () => {
    const nodes = parseInline("*a ".repeat(5400));
    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes.every((node) => node.kind === "text")).toBe(true);
  });
});

describe("a pathological note takes bounded work", () => {
  test("short table rows are not padded to the header width", () => {
    const header = Array(100).fill("x").join("|");
    const separator = Array(100).fill("---").join("|");
    const table = parseMarkdown(`${header}\n${separator}\n${"|\n".repeat(100)}`)[0];
    expect(table?.kind).toBe("table");
    if (table?.kind === "table") expect(table.rows.reduce((n, row) => n + row.length, 0)).toBeLessThanOrEqual(200);
  });
  test("unterminated destinations stay literal while nested and escaped parentheses parse", () => {
    expect(parseInline("[a](".repeat(12000)).map((node) => node.kind)).toEqual(["text"]);
    expect(parseInline("[nested](https://example.test/a(b))")[0]).toMatchObject({ kind: "link", href: "https://example.test/a(b)" });
    expect(parseInline("[escaped](https://example.test/a\\)b)")[0]).toMatchObject({ kind: "link", href: "https://example.test/a)b" });
    expect(parseInline("[broken](x\n[good](https://example.test)").some((node) => node.kind === "link")).toBe(true);
  });
  const took = (fn: () => void): number => {
    const start = performance.now();
    fn();
    return performance.now() - start;
  };

  test("a chain of nested labels is read once per level, never doubled", () => {
    const depth = 3000;
    const source = "[".repeat(depth) + "x" + "](http://a)".repeat(depth);
    let blocks: Block[] = [];
    // Before: 320 ms at depth 20 and still running after 3 minutes at 3000. The bound is loose for a slow machine and
    // far under any form that doubles per level.
    const ms = took(() => {
      blocks = parseMarkdown(source);
    });
    expect({ depth, blocks: blocks.length }).toEqual({ depth, blocks: 1 });
    expect(html(source)).toContain("x");
    expect({ depth, under: ms < 2000 }).toEqual({ depth, under: true });
  });

  test("a blank run inside a list item is read once, however deep the item is", () => {
    const body = (levels: number): string => {
      const lines: string[] = [];
      for (let level = 0; level < levels; level += 1) lines.push(`${"  ".repeat(level)}- x`);
      lines.push("", ...Array(16000).fill(""), `${"  ".repeat(levels)}y`);
      return lines.join("\n");
    };
    for (const levels of [1, 31]) {
      const source = body(levels);
      let blocks: Block[] = [];
      // Before: 295 ms at one level and 9 s at 31, because every blank line re-read the rest of the run.
      const ms = took(() => {
        blocks = parseMarkdown(source);
      });
      expect({ levels, blocks: blocks.length > 0 }).toEqual({ levels, blocks: true });
      expect({ levels, kept: html(source).includes("y") }).toEqual({ levels, kept: true });
      expect({ levels, under: ms < 4000 }).toEqual({ levels, under: true });
    }
  });

  test("unclosed brackets are not rescanned once no close is left", () => {
    const source = "[".repeat(64 * 1024);
    let nodes = 0;
    // Before: 215 ms at 16 KiB and 3.4 s at 64 KiB, because every `[` scanned to the end of the text; with the guard the
    // same input is a single pass, so the bound sits well under the old cost and far over the new one.
    const ms = took(() => {
      nodes = parseInline(source).length;
    });
    expect({ length: source.length, nodes }).toEqual({ length: 64 * 1024, nodes: 1 });
    expect({ under: ms < 1000 }).toEqual({ under: true });
  });

  test("a run of openings with one close at the end is a lookup per opening, not a scan", () => {
    // The guard above only helped when no `]` existed at all: with a single close at the end every opening rescanned the
    // same tail, which took 218 ms at 16k, 678 ms at 32k and 1.9 s at 48k under V8. Pairing the brackets once makes
    // each opening a table lookup.
    for (const size of [48 * 1024, 64 * 1024]) {
      const source = "[".repeat(size) + "]";
      let nodes = 0;
      const ms = took(() => {
        nodes = parseInline(source).length;
      });
      expect({ size, nodes }).toEqual({ size, nodes: 1 });
      expect({ size, kept: html(source).includes(source) }).toEqual({ size, kept: true });
      expect({ size, under: ms < 1000 }).toEqual({ size, under: true });
    }
  });
});

describe("the note panel navigates through its wiki-links", () => {
  let root: Root | null = null;
  let container: HTMLElement;

  beforeAll(() => {
    GlobalRegistrator.register();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(async () => {
    await GlobalRegistrator.unregister();
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container?.remove();
    document.body.replaceChildren();
  });

  test("clicking a resolved wiki-link opens that note in the panel the person is already in", () => {
    const calls: [string, Record<string, string> | undefined][] = [];
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    // The panel lists its own outgoing links keyed by resolved path, so one link per note here keeps that list unique.
    const panelLinks = {
      out: [{ target: "Beta", heading: null, block: null, resolved: "notes/beta.md" }],
      dead: [{ target: "Missing", heading: null, block: null, resolved: null }],
    };
    act(() =>
      root!.render(
        <NoteView
          reply={{ note: { path: "notes/a.md", body: "See [[Beta]] and [[Missing]]." }, links: panelLinks, orgVaults: [] }}
          params={{ vault: "work" }}
          navigate={(panel, params) => calls.push([panel, params])}
          beginWrite={() => {}}
        />,
      ),
    );
    const button = container.querySelector<HTMLButtonElement>("button.vmem-md-wiki");
    expect(button?.textContent).toBe("Beta");
    act(() => button!.click());
    expect(calls).toEqual([["note", { path: "notes/beta.md", vault: "work" }]]);
    expect(container.querySelector("span.vmem-md-wiki-missing")?.textContent).toBe("Missing");
  });
});
