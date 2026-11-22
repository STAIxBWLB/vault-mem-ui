import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ProposalsView } from "../../src/client/views/proposals.tsx";

test("uncertain and truncated proposals name the exact CLI next steps", () => {
  const markup = renderToStaticMarkup(<ProposalsView reply={{ vault: "work", state: "apply_unknown", page: { items: [] }, selected: { id: "abc", state: "apply_unknown", path: "notes/a.md", content: "Synthetic", truncated: true, nextOffset: 1024 } }} params={{}} navigate={() => {}} beginWrite={() => {}} />);
  expect(markup).toContain("vmem proposal reconcile work abc");
  expect(markup).toContain("vmem proposal show work abc --offset 1024");
  expect(markup).toContain("Reconcile before another decision");
});

test("a pending, untruncated proposal names no CLI next step", () => {
  const markup = renderToStaticMarkup(<ProposalsView reply={{ vault: "work", state: "pending", page: { items: [] }, selected: { id: "abc", state: "pending", path: "notes/b.md", content: "Synthetic", truncated: false } }} params={{}} navigate={() => {}} beginWrite={() => {}} />);
  // Reconcile belongs to an unknown outcome and show to truncated content, so neither may leak into a plain pending one.
  expect(markup).not.toContain("vmem proposal");
  expect(markup).toContain("notes/b.md · pending");
  expect(markup).toContain("Preview apply");
});
