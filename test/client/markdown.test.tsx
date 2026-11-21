/**
 * The note body: the tree the parser builds, the elements the renderer makes from it, and the two things that must
 * never happen with vault text - an HTML element and a link to a scheme the panel did not allow. Every fixture here is
 * synthetic text; none of it came from a vault.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { parseMarkdown, safeHref } from "../../src/client/markdown/parse.ts";
import { Markdown, wikiIndex } from "../../src/client/markdown/render.tsx";
import { NoteView } from "../../src/client/views/note.tsx";

const html = (text: string, links?: unknown): string =>
  renderToStaticMarkup(<Markdown text={text} links={links} onOpenNote={() => {}} />);

/** What the provider answers for `vmem_links`: resolved targets under `out`, unresolved ones under `dead`. */
const links = {
  out: [{ target: "Beta", resolved: "notes/beta.md" }],
  dead: [{ target: "Missing", resolved: null }],
};

describe("parseMarkdown", () => {
  test("headings keep their depth, including the setext underline", () => {
    expect(parseMarkdown("# One\n\n###### Six").map((block) => block.kind === "heading" && block.depth)).toEqual([1, 6]);
    expect(parseMarkdown("Title\n=====").map((block) => block.kind === "heading" && block.depth)).toEqual([1]);
    expect(parseMarkdown("Sub\n---").map((block) => block.kind === "heading" && block.depth)).toEqual([2]);
    // `a | b` followed by `---` is a heading, not a one-column table: the columns disagree.
    expect(parseMarkdown("a | b\n---")[0]?.kind).toBe("heading");
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

  test("an allowed link leaves the panel with no opener and no referrer", () => {
    const markup = html("[site](https://example.test/a?b=1) and <mailto:someone@example.test>");
    expect(markup).toContain('href="https://example.test/a?b=1"');
    expect(markup).toContain('href="mailto:someone@example.test"');
    expect(markup.match(/target="_blank"/g)?.length).toBe(2);
    expect(markup.match(/rel="noopener noreferrer"/g)?.length).toBe(2);
  });
});

describe("wiki-links are read from the provider's own resolution", () => {
  test("the payload becomes a target-to-path map, and an unlisted target is unresolved", () => {
    const index = wikiIndex(links);
    expect(index.get("Beta")).toBe("notes/beta.md");
    expect(index.get("Missing")).toBeNull();
    expect(wikiIndex(undefined).size).toBe(0);
    expect(wikiIndex({ out: [{ target: "Beta", resolved: "notes/beta.md" }] }).get("Beta")).toBe("notes/beta.md");
  });

  test("a resolved link is a button, in all three spellings, that opens the resolved note", () => {
    const markup = html("[[Beta]] [[Beta|the beta note]] [[Beta#Design|design]]", links);
    expect(markup.match(/<button type="button" class="vmem-md-wiki">/g)?.length).toBe(3);
    expect(markup).toContain("the beta note");
    expect(markup).toContain(">design<");
    expect(markup).not.toContain("vmem-md-wiki-missing");
  });

  test("an unresolved target looks different and is not something to click", () => {
    for (const source of ["[[Missing]]", "[[NotListed]]"]) {
      const markup = html(source, links);
      expect(markup).toContain("vmem-md-wiki-missing");
      expect(markup).not.toContain("<button");
      expect(markup).toContain("vmem could not resolve this link");
    }
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
    act(() =>
      root!.render(
        <NoteView
          reply={{ note: { path: "notes/a.md", body: "See [[Beta]] and [[Missing]]." }, links, orgVaults: [] }}
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
