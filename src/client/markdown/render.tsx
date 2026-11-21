/** The note body as React elements: one element per parsed node, so no string of markup is ever assembled. */

import { Fragment, useMemo, type ReactNode } from "react";
import { list, rec, str } from "../data.ts";
import { parseMarkdown, safeHref, type Block, type Inline } from "./parse.ts";

type OpenNote = (path: string) => void;

/** What the provider itself resolved each wiki-link target to: a note path, or `null` when it could not. */
export type WikiIndex = Map<string, string | null>;

/**
 * Read the note panel's own `links` answer (`out` resolved, `dead` not) into a target-to-path map, so a wiki-link in
 * the body shows the resolution vmem computed instead of one this module guesses. A target the answer does not list
 * is treated as unresolved.
 */
export function wikiIndex(links: unknown): WikiIndex {
  const box = rec(links);
  const index: WikiIndex = new Map();
  for (const row of [...list<unknown>(box.out), ...list<unknown>(box.dead)]) {
    const link = rec(row);
    const target = str(link.target);
    if (target) index.set(target, str(link.resolved) || null);
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

function inline(nodes: Inline[], wiki: WikiIndex, onOpenNote?: OpenNote): ReactNode {
  return nodes.map((node, at) => <Fragment key={at}>{inlineNode(node, wiki, onOpenNote)}</Fragment>);
}

function inlineNode(node: Inline, wiki: WikiIndex, onOpenNote?: OpenNote): ReactNode {
  switch (node.kind) {
    case "text":
      return node.text;
    case "code":
      return <code className="vmem-md-code">{node.text}</code>;
    case "strong":
      return <strong>{inline(node.children, wiki, onOpenNote)}</strong>;
    case "em":
      return <em>{inline(node.children, wiki, onOpenNote)}</em>;
    case "link":
      return (
        <a className="vmem-md-link" href={node.href} target="_blank" rel="noopener noreferrer">
          {inline(node.children, wiki, onOpenNote)}
        </a>
      );
    case "image":
      // The panel's CSP allows no other origin and this module fetches nothing, so an image is its alt text and a
      // readable target rather than a broken frame.
      return (
        <span className="vmem-md-image">
          {node.alt ? <span className="vmem-md-image-alt">{node.alt}</span> : null}
          {imageTarget(node.src)}
        </span>
      );
    case "wiki":
      return <Wiki node={node} wiki={wiki} onOpenNote={onOpenNote} />;
    case "break":
      return <br />;
  }
}

function imageTarget(src: string): ReactNode {
  const href = safeHref(src);
  if (!href) return <span className="vmem-md-image-src">{src}</span>;
  return (
    <a className="vmem-md-link" href={href} target="_blank" rel="noopener noreferrer">
      {src}
    </a>
  );
}

function Wiki(props: { node: Extract<Inline, { kind: "wiki" }>; wiki: WikiIndex; onOpenNote?: OpenNote }) {
  const node = props.node;
  const path = props.wiki.get(node.target) ?? null;
  const kind = node.embed ? " vmem-md-wiki-embed" : "";
  if (!path) {
    return (
      <span className={`vmem-md-wiki${kind} vmem-md-wiki-missing`} title={`${node.target}: vmem could not resolve this link`}>
        {node.label}
      </span>
    );
  }
  if (!props.onOpenNote) return <span className={`vmem-md-wiki${kind}`}>{node.label}</span>;
  const open = props.onOpenNote;
  return (
    <button type="button" className={`vmem-md-wiki${kind}`} onClick={() => open(path)}>
      {node.label}
    </button>
  );
}
