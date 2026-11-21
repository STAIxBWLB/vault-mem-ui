/** The note body as React elements: one element per parsed node, so no string of markup is ever assembled. */

import { Fragment, useId, useMemo, type ReactNode } from "react";
import { list, rec, str } from "../data.ts";
import { parseMarkdown, safeHref, type Block, type Inline } from "./parse.ts";

type OpenNote = (path: string) => void;

/**
 * What the provider answered for one written link: the note it resolved to, or why it could not and the note it
 * suggests instead. `vmem_links` states both (`reason`, `suggested`), so the panel repeats them rather than writing a
 * sentence of its own about a link it cannot see.
 */
export type WikiLink =
  | { kind: "resolved"; path: string }
  | { kind: "dead"; reason: string; suggested: string };

export type WikiIndex = Map<string, WikiLink>;

/**
 * The identity the provider resolves: the target and the anchor written with it. `[[Alpha]]` and `[[Alpha#gone]]` are
 * two links to one note and vmem can resolve the first while it refuses the second, so the target alone is not the key.
 * A target cannot contain a newline (vmem's own link scan excludes it), which makes it a safe separator. An empty
 * target is its own identity, not a missing one: `[[#Heading]]` and `[[#^block]]` name the note the body belongs to,
 * and vmem answers them with `target: ""`.
 */
export function wikiKey(target: string, heading: string, block: string): string {
  return `${linkText(target)}\n${linkText(heading)}\n${linkText(block)}`;
}

/** The provider's own bound on a link's text, `LINK_TEXT_BYTES` in vault-mem's index. */
const LINK_TEXT_BYTES = 1024;

/**
 * The same cut `vmem_links` makes before it answers: a target, heading or block past 1024 UTF-8 bytes arrives shortened
 * at a character boundary, so the key has to be shortened the same way or a long link never matches its own answer.
 */
function linkText(value: string): string {
  // A UTF-16 code unit never takes more than three UTF-8 bytes, so short enough in units is short enough in bytes.
  if (value.length * 3 <= LINK_TEXT_BYTES) return value;
  const bytes = new TextEncoder().encode(value);
  if (bytes.length <= LINK_TEXT_BYTES) return value;
  let end = LINK_TEXT_BYTES;
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end -= 1;
  return new TextDecoder().decode(bytes.subarray(0, end));
}

/**
 * Read the note panel's own `links` answer (`out` resolved, `dead` not) into a map keyed by link rather than by note,
 * so each wiki-link in the body shows the resolution vmem computed for that link instead of a guess made here. A link
 * this answer does not list is absent from the map, because `vmem_links` is capped (50 by default): absence means the
 * answer never read that link, not that the provider could not resolve it.
 */
export function wikiIndex(links: unknown): WikiIndex {
  const box = rec(links);
  const index: WikiIndex = new Map();
  for (const row of [...list<unknown>(box.out), ...list<unknown>(box.dead)]) {
    const link = rec(row);
    // A row with no `target` at all is a same-note link (`target: ""`) as far as this map is concerned: vmem answers
    // `[[#Heading]]` and `[[#^block]]` that way, and dropping them left both states rendering as unlisted.
    const target = str(link.target);
    const resolved = str(link.resolved);
    index.set(wikiKey(target, str(link.heading), str(link.block)), resolved
      ? { kind: "resolved", path: resolved }
      : { kind: "dead", reason: str(link.reason), suggested: str(rec(link.suggested).path) });
  }
  return index;
}

export function Markdown(props: { text: string; links?: unknown; onOpenNote?: OpenNote }) {
  const blocks = useMemo(() => parseMarkdown(props.text), [props.text]);
  const wiki = useMemo(() => wikiIndex(props.links), [props.links]);
  return (
    <div className="vmem-md">
      {blocks.map((block, at) => (
        <BlockNode key={at} block={block} wiki={wiki} onOpenNote={props.onOpenNote} />
      ))}
    </div>
  );
}

function BlockNode(props: { block: Block; wiki: WikiIndex; onOpenNote?: OpenNote }): ReactNode {
  const { block, wiki, onOpenNote } = props;
  switch (block.kind) {
    case "heading": {
      // The note's own title is the panel's h1, so a body heading starts at h2 and stops at h6.
      const content = inline(block.children, wiki, onOpenNote);
      const depth = Math.min(Math.max(block.depth, 1), 6);
      if (depth === 1) return <h2 className="vmem-md-h">{content}</h2>;
      if (depth === 2) return <h3 className="vmem-md-h">{content}</h3>;
      if (depth === 3) return <h4 className="vmem-md-h">{content}</h4>;
      if (depth === 4) return <h5 className="vmem-md-h">{content}</h5>;
      return <h6 className="vmem-md-h">{content}</h6>;
    }
    case "paragraph":
      return <p className="vmem-md-p">{inline(block.children, wiki, onOpenNote)}</p>;
    case "code":
      return (
        <pre className="vmem-md-pre" data-lang={block.lang || undefined}>
          <code>{block.text}</code>
        </pre>
      );
    case "quote":
      return (
        <blockquote className="vmem-md-quote">
          {block.children.map((child, at) => (
            <BlockNode key={at} block={child} wiki={wiki} onOpenNote={onOpenNote} />
          ))}
        </blockquote>
      );
    case "list": {
      const items = block.items.map((item, at) => (
        <li key={at} className={item.checked === null ? undefined : "vmem-md-task"}>
          {item.checked === null ? null : (
            <input className="vmem-md-check" type="checkbox" checked={item.checked} disabled readOnly />
          )}
          {item.children.map((child, index) => (
            <BlockNode key={index} block={child} wiki={wiki} onOpenNote={onOpenNote} />
          ))}
        </li>
      ));
      return block.ordered ? (
        <ol className="vmem-md-list" start={block.start === 1 ? undefined : block.start}>
          {items}
        </ol>
      ) : (
        <ul className="vmem-md-list">{items}</ul>
      );
    }
    case "table":
      return (
        <div className="vmem-md-scroll">
          <table className="vmem-md-table">
            <thead>
              <tr>
                {block.head.map((cell, at) => (
                  <th key={at} className="vmem-md-cell" scope="col" data-align={block.align[at] ?? undefined}>
                    {inline(cell, wiki, onOpenNote)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, at) => (
                <tr key={at}>
                  {row.map((cell, index) => (
                    <td key={index} className="vmem-md-cell" data-align={block.align[index] ?? undefined}>
                      {inline(cell, wiki, onOpenNote)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "rule":
      return <hr className="vmem-md-rule" />;
  }
}

/**
 * `inAnchor` marks the label of a link: an anchor cannot hold an anchor, so inside a label an image's target and a
 * wiki-link keep their text and lose the part that would be clickable, instead of nesting one anchor in another.
 */
function inline(nodes: Inline[], wiki: WikiIndex, onOpenNote?: OpenNote, inAnchor = false): ReactNode {
  return nodes.map((node, at) => <Fragment key={at}>{inlineNode(node, wiki, onOpenNote, inAnchor)}</Fragment>);
}

function inlineNode(node: Inline, wiki: WikiIndex, onOpenNote?: OpenNote, inAnchor = false): ReactNode {
  switch (node.kind) {
    case "text":
      return node.text;
    case "code":
      return <code className="vmem-md-code">{node.text}</code>;
    case "strong":
      return <strong>{inline(node.children, wiki, onOpenNote, inAnchor)}</strong>;
    case "em":
      return <em>{inline(node.children, wiki, onOpenNote, inAnchor)}</em>;
    case "link":
      return (
        <a className="vmem-md-link" href={node.href} target="_blank" rel="noopener noreferrer">
          {inline(node.children, wiki, onOpenNote, true)}
        </a>
      );
    case "image":
      // The panel's CSP allows no other origin and this module fetches nothing, so an image is its alt text and a
      // readable target rather than a broken frame.
      return (
        <span className="vmem-md-image">
          {node.alt ? <span className="vmem-md-image-alt">{node.alt}</span> : null}
          {imageTarget(node.src, inAnchor)}
        </span>
      );
    case "wiki":
      return <Wiki node={node} wiki={wiki} onOpenNote={inAnchor ? undefined : onOpenNote} />;
    case "break":
      return <br />;
  }
}

function imageTarget(src: string, inAnchor: boolean): ReactNode {
  const href = safeHref(src);
  if (!href || inAnchor) return <span className="vmem-md-image-src">{src}</span>;
  return (
    <a className="vmem-md-link" href={href} target="_blank" rel="noopener noreferrer">
      {src}
    </a>
  );
}

/** What vmem says it could not do, in the words the person reads beside the link. */
const DEAD_WHY: Record<string, string> = {
  "missing-note": "no note has this name",
  "ambiguous-note": "more than one note has this name",
  "missing-heading": "the note it names has no such heading",
  "missing-block": "the note it names has no such block",
};

/** A link that names no note at all points at the note the body belongs to, so it is called that rather than by "". */
function linkName(target: string): string {
  return target || "this note";
}

function deadTitle(target: string, answer: { reason: string; suggested: string }): string {
  const why = DEAD_WHY[answer.reason] ?? "vmem could not resolve this link";
  return answer.suggested
    ? `${linkName(target)}: ${why}; vmem suggests ${answer.suggested}`
    : `${linkName(target)}: ${why}`;
}

function Wiki(props: { node: Extract<Inline, { kind: "wiki" }>; wiki: WikiIndex; onOpenNote?: OpenNote }) {
  const node = props.node;
  // A title is a mouse tooltip: the same words are rendered for a screen reader, tied to the span, because the span
  // itself cannot take focus and a reason that only exists in a tooltip reaches nobody using the keyboard.
  const reasonId = useId();
  const answer = props.wiki.get(wikiKey(node.target, node.heading, node.block));
  const kind = node.embed ? " vmem-md-wiki-embed" : "";
  // Absent from the answer is its own state: the link list is capped, so the panel says it cannot place the link rather
  // than calling a link broken that the provider never answered for.
  if (!answer) {
    const title = `${linkName(node.target)}: this note's link list does not include it, so the panel cannot place it`;
    return (
      <>
        <span className={`vmem-md-wiki${kind} vmem-md-wiki-unknown`} title={title} aria-describedby={reasonId}>
          {node.label}
        </span>
        <span className="vmem-md-note" id={reasonId}>{title}</span>
      </>
    );
  }
  if (answer.kind === "dead") {
    const title = deadTitle(node.target, answer);
    return (
      <>
        <span className={`vmem-md-wiki${kind} vmem-md-wiki-missing`} title={title} aria-describedby={reasonId}>
          {node.label}
        </span>
        <span className="vmem-md-note" id={reasonId}>{title}</span>
      </>
    );
  }
  if (!props.onOpenNote) return <span className={`vmem-md-wiki${kind}`}>{node.label}</span>;
  const open = props.onOpenNote;
  return (
    <button type="button" className={`vmem-md-wiki${kind}`} onClick={() => open(answer.path)}>
      {node.label}
    </button>
  );
}
