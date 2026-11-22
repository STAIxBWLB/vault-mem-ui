# vault-mem-ui

Web UI for [vmem](https://github.com/STAIxBWLB/vault-mem): a standalone browser app and an `acon` console panel over the same vault provider, with a graph view. Part of the ahub family.

## Status

Not published yet. The repository contains the package scaffold, checks, standalone host command, client panels and `acon` console plugin. The design is tracked in this repository's issues.

The graph panel loads the vmem provider's paged graph snapshot and offers a Sigma canvas, ForceAtlas2 in the panel's own module worker, local view, shortest path, pins and level of detail above 30,000 edges. Older providers without graph snapshots show "Graph not available". In the static multi-node host the panel shows cached positions only, because the layout worker cannot start there.

For development, install Bun 1.4.2 or newer, run `bun install`, then `bun run check`.

## Client

`src/client` is the browser client for vmem's existing panels: overview, search, note, promote, lint, log, settings, proposals, assertions and history. It is written against one small host interface and runs in both hosts from the same bundle. Settings edits write permission, graph resolution and enrichment for the selected vault, and the default vault and PII patterns for all vaults. Every change is previewed and confirmed; default vault and permission changes require restarting the console and MCP server. Proposals can be listed, inspected, applied or rejected with a preview and confirmation. Assertions shows the journal's answer for the vault with every coverage gap named, and History shows a note's revisions plus the changes between two of them picked from that list; both are read-only.

Reconciling an `apply_unknown` proposal and reading beyond truncated proposal content are available through the vmem CLI.

- Host interface (`src/client/host.ts`): `snapshot`, `action`, `theme` and `mount`. `acon`'s `ConsoleHost` is adapted by `createAconHost`; the standalone adapter uses the same-origin HTTP endpoints, and `createFakeHost` is available for tests.
- What the provider declares it can do reaches the panel in its graph snapshot reply as `capabilities.actions` (the manifest's list), because neither host hands the manifest to a panel. A host that serves the graph panel must pass that field through; a reply without it means nothing is offered.
- Writes go through `action` only. In `acon` the console owns the confirmation: its server mints the confirm token, shows the preview in its own dialog and refuses a page that sets `confirmed` or `fingerprint`, so the panel sends the bare action and reports the outcome — the adapter says `confirm: "host"` and drops those two keys instead of forwarding them. A host that answers the provider directly instead (the fake host today, the standalone adapter) gets the two-step flow from the client: the preview with its fingerprint and the planned changes, nothing sent until the person confirms, and the confirm re-sending that same fingerprint, so the client cannot confirm a preview it did not show.
- A panel or parameter change drops the previous reply and any open preview, so a note you left cannot be read or acted on under the vault or panel you opened next. A pending preview is dropped on navigation or cancellation; a pending confirmation is dropped on navigation or after its waiting notice is closed. The panel says it is loading, and a snapshot that fails says so with the next step.
- Per-viewer preferences (theme and last panel) live in `localStorage` behind a guarded wrapper: when storage is unavailable or full the panel still works, and the preference applies to the session only.
- Keyboard: arrow keys, Home and End move through a list, Enter or Space opens the row, `/` focuses search and `Escape` closes the write dialog. While a confirmation is applying, Confirm, Cancel and Escape are inactive until it answers or a 30-second waiting notice permits closing. The dialog takes the focus when it opens, keeps Tab inside it and hands the focus back to the control that opened it. Reduced motion follows `prefers-reduced-motion`, and the toolbar switch turns it on manually.
- Panel rule: the build emits one ES module (`dist/panel.js`) and one stylesheet (`dist/panel.css`), with no inline script, no inline style markup, no `innerHTML` with data and no other origin. Colour comes from acon's `--acon-*` tokens, with fallbacks and a light/dark override for the standalone host.
- Note body: the note's Markdown is parsed into a tree and rendered as React elements, never as an HTML string, so an HTML tag in a note is shown as text. `[[wiki-links]]` open the note panel through the same navigation, each one read against vmem's answer for that link (target plus heading or block), so `[[A]]` and `[[A#gone]]` can differ; a link vmem could not resolve is marked as missing instead of followed and repeats the provider's own reason and its suggested note when it gives one, and a link the note's capped link list does not include is shown as text the panel cannot place rather than called broken; an `![[embed]]` is a link to that note, because the panel fetches nothing else. A link is external only for `http`, `https` and `mailto` and then carries `rel="noopener noreferrer"` and `target="_blank"`; every other scheme, and a relative target, stays text. An image is its alt text and target, since the panel loads nothing from another origin. Nesting stops being interpreted past 32 levels and the rest is shown as text, so a deeply nested note cannot overflow the panel's stack. The parser is this package's own code, so the bundle gains no dependency.

The `acon` plugin in `src/plugin` keeps `@staix/vault-mem/ui-plugin`'s provider — and so vmem's validation, receipts and two-step confirmation — and replaces only the panel assets with this bundle. It reads `dist/`, so run `bun run build` before starting the console; `bun run check` builds first for the same reason.

## Graph controls

The graph view provides search, domain, type, relation and community filters, a legend, a selected-note inspector, read-only insights and a decision chains mode. The panel supports up to 10,000 notes and 100,000 links; chains follow provider supersedes edges. Chain, member and unlinked-decision lists show at most 50 entries each; search or filter to narrow the results. Level of detail uses the full graph edge count even when filters are active. Possible-link analysis is limited to graphs with at most 30,000 edges; narrow larger graphs with filters.

The inspector links the selected note to a second one through the provider's two-step `link` action. Pick a target and one of the relations the provider accepts (`supports`, `contradicts`, `extends`, `applies-to`, `context-for`) and propose it: the shared write dialog shows the preview, the changes planned for both notes and the log event the write would append, and nothing is sent until Confirm. Both directions is the default and can be turned off. The control appears only when the provider declares the `link` action, only notes the provider reported a path for can be linked (an unresolved link has no file to write to), and the target list shows at most 200 notes by label, so search or filter to narrow it. After a write the graph is read from its first page again, so the new edge appears without a reload.

## Scope

- Runs standalone on loopback and inside `acon`, from one bundle.
- Reads and writes only through vmem's provider, so every write passes vmem's validation and two-step confirmation.
- Depends on `@staix/vault-mem`; vault-mem does not depend on this package.

## Offline graph export

The graph view exports nodes and links selected by the current filters, search and view mode as one self-contained HTML file containing graph metadata and positions, without note bodies. Link counts in the file reflect that filtered view, and links temporarily hidden by level of detail are included. It works in both `acon` and the standalone host. While layout is running, export captures the canvas positions at the moment of the click; the button is unavailable until the canvas is ready or if the canvas fails.

## Standalone host (vmem-ui)

`bun run build`, then `bun bin/vmem-ui.ts` (installed as `vmem-ui`). It opens the vault-mem provider in process, listens on `127.0.0.1` only and prints a one-time sign-in link valid for 5 minutes.

The vault it serves is the one vmem resolves for this process, not `$AGENTHUB_HOME`: `VMEM_HOME` if set, else the `home` pointer in the default home's config, else `$AGENTHUB_HOME/vmem` (default `~/.agenthub/vmem`). Set `VMEM_HOME` to serve another vault home; the command's own context carries the family home only.

- The link signs in once and sets an HttpOnly, SameSite=Strict session cookie; a reused or expired link is refused.
- Every request is checked for Host (`127.0.0.1` or `localhost` on this port) and Origin; API calls need a same-origin Origin header. A default port is checked without it, so `--port 80` is reached as `127.0.0.1` rather than `127.0.0.1:80`. Pages carry a strict CSP: `default-src 'none'; script-src 'self'; style-src 'self'`, no inline code, no `blob:`.
- Request bodies must be `application/json` and are capped at 32 KiB. The server exits after 30 minutes without a request (`--idle-minutes <n>`). A visible page polls and counts as use; hidden or closed pages stop polling; `--port <n>` picks the port (default: a free one).
- API: `POST /api/snapshot` and `POST /api/action` relay to the provider. A snapshot names one of the manifest's panels, plus `inbox` and `search` when the plugin advertises those capabilities; `after` is how many items the page already has, as a whole number 0 or more.
- Confirmation in standalone mode belongs to the page: the server relays `confirmed` and `fingerprint` exactly as the page sent them, and never adds either. It cannot tell what the browser displayed, so a caller holding the session cookie can confirm without any preview having been rendered. What protects the write is vmem's own check: it recomputes the preview from the current vault and writes only when the fingerprint still matches, so a stale or invented fingerprint is answered with the fresh preview instead of a write. Reaching the API at all takes the one-time sign-in link's cookie, a same-origin `Origin` and the loopback Host, which bounds who can call but does not prove that a person looked. `acon` does this differently (its server mints a confirm token) because the console renders the preview itself.
- A provider failure is logged to the terminal and answered with the reason and the next step.
- The page runs every panel this bundle implements; a provider panel without a view stays out of the manifest instead of appearing as an empty tab.

## Releasing

A release is one tag on a green `main`: the tag runs the checks again, packs once and publishes that exact tarball to npm with provenance, then creates the GitHub release from the changelog section.

1. Release-prep PR: bump `version` in `package.json` and move the `## [Unreleased]` entries under `## [x.y.z] - YYYY-MM-DD`. Until that dated section exists the tag is refused, because `Unreleased` alone is not a release.
2. Merge it, then on a clean, up-to-date `main`: `bun run release:tag --push`. Without `--push` the annotated tag stays local. The script refuses a tree that is not clean, a `main` behind `origin/main`, a tag that already exists, a version that does not increase over the existing release tags, and a missing dated section, and each refusal names the next step.
3. `.github/workflows/release.yml` re-checks the tag against the package version and the changelog, requires the commit to be on `main` with a green `Check` run for it, runs `bun run check`, shows the `npm pack` file list, stages the tarball with a SHA-256 manifest, and installs that tarball in an empty consumer project (`bun scripts/package-smoke.ts`) so the packaged plugin imports and `vmem-ui --help` runs before anything is published.

### The first publish

`@staix/vault-mem-ui` has never been published (`npm view @staix/vault-mem-ui` answers 404), and npm's trusted publishing is configured on a package that already exists, which the flow here needs: the publish job has no npm token and reaches the registry only through OIDC. So the first release is three steps, all of them a person's:

1. Bootstrap the package name once, from a clean `main` checkout that still holds the placeholder version `0.0.0`. `dist/` is not in git (it is ignored), so publishing the checkout would ship whatever build it happens to hold; run the gates and publish the bytes the smoke test installed instead:

   ```sh
   bun install --frozen-lockfile && bun run check
   mkdir -p /tmp/vmem-bootstrap
   npm pack --ignore-scripts --pack-destination /tmp/vmem-bootstrap
   bun scripts/package-smoke.ts /tmp/vmem-bootstrap/staix-vault-mem-ui-0.0.0.tgz
   npm publish /tmp/vmem-bootstrap/staix-vault-mem-ui-0.0.0.tgz --access public --provenance=false --tag bootstrap
   ```

   That publishes the placeholder `0.0.0`, not the release-prep version: npm never lets a published version be reused, so spending `0.0.0` here keeps the release-prep version free for the tag flow. `--tag bootstrap` publishes under the `bootstrap` dist-tag instead of `latest`, though a first publish may still leave the registry pointing `latest` at `0.0.0`; if it does, `npm i @staix/vault-mem-ui` installs `0.0.0` until the first non-prerelease moves `latest` itself. Read the tags with `npm view @staix/vault-mem-ui dist-tags` (or `npm dist-tag ls @staix/vault-mem-ui`). A non-prerelease tag publishes with `--tag latest` and moves it for you. A prerelease publishes under `next`; only if you intend to make that prerelease the default, point `latest` at it with `npm dist-tag add @staix/vault-mem-ui@<that version> latest`. `--provenance=false` overrides `publishConfig.provenance`, which asks for an OIDC identity a local shell does not have. If that checkout's `package.json` already names a release version, stop before publishing: that version belongs to the tag flow, and publishing it here would make the tag release fail as already on the registry.
2. Attach the trusted publisher, the same configuration as the list below: `npm trust github @staix/vault-mem-ui --file release.yml --repository STAIxBWLB/vault-mem-ui --environment npm-production --allow-publish` (npm 12 has this command; `npm trust --help` lists its flags).
3. Set `NPM_PUBLISH_ENABLED=true`. The release-prep PR then sets the first real version and its dated changelog section, and the first tag release publishes that version with provenance.

Unverified from this repository, and none of it attempted here: whether the gated bootstrap publish in step 1 succeeds, whether a first publish under `--tag bootstrap` also sets `latest`, whether `npm trust` accepts a package before any release version exists rather than requiring one, and how long an unvalidated configuration lasts. What is measured: `npm view @staix/vault-mem-ui` answers 404, `dist/` is ignored by git, `npm trust github` takes exactly those flags in npm 12.2.2, `npm dist-tag` in npm 12.2.2 takes `add <package-spec (with version)> [<tag>]` and `ls [<package-spec>]`, and `scripts/package-smoke.ts` installs and runs a packed tarball (see the release PR).

The `Publish approved artifact with npm OIDC` job runs only when the repository variable `NPM_PUBLISH_ENABLED` is `true`; `Publish the GitHub release` follows it. Settings a person configures once, none of which this repository sets up:

- npm trusted publisher for `@staix/vault-mem-ui`: publisher GitHub, repository `STAIxBWLB/vault-mem-ui`, workflow `release.yml`, environment `npm-production`.
- Repository variable `NPM_PUBLISH_ENABLED=true`; unset or any other value keeps publication off.
- The `npm-production` environment, with whatever protection rules it should carry.
- Provenance comes from the publish job's own `id-token: write`, so no npm token secret is stored.

## License

MIT. See [LICENSE](LICENSE).
