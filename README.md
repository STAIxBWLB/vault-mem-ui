# vault-mem-ui

Web UI for [vmem](https://github.com/STAIxBWLB/vault-mem): a standalone browser app and an `acon` console panel over the same vault provider, with a graph view. Part of the ahub family.

## Status

Not published yet. The repository contains the package scaffold, checks, standalone host command, client panels and `acon` console plugin. The design is tracked in this repository's issues.

For development, install Bun 1.4.2 or newer, run `bun install`, then `bun run check`.

## Client

`src/client` is the browser client for vmem's existing panels: overview, search, note, promote, lint and log. It is written against one small host interface and runs in both hosts from the same bundle.

- Host interface (`src/client/host.ts`): `snapshot`, `action`, `theme` and `mount`. `acon`'s `ConsoleHost` is adapted by `createAconHost`; the standalone adapter uses the same-origin HTTP endpoints, and `createFakeHost` is available for tests.
- Writes go through `action` only. In `acon` the console owns the confirmation: its server mints the confirm token, shows the preview in its own dialog and refuses a page that sets `confirmed` or `fingerprint`, so the panel sends the bare action and reports the outcome — the adapter says `confirm: "host"` and drops those two keys instead of forwarding them. A host that answers the provider directly instead (the fake host today, the standalone adapter) gets the two-step flow from the client: the preview with its fingerprint and the planned changes, nothing sent until the person confirms, and the confirm re-sending that same fingerprint, so the client cannot confirm a preview it did not show.
- A panel or parameter change drops the previous reply and any open preview, so a note you left cannot be read or acted on under the vault or panel you opened next. A preview or confirmation that was still in flight when the person navigated or cancelled is dropped the same way instead of landing on the new panel. The panel says it is loading, and a snapshot that fails says so with the next step.
- Per-viewer preferences (theme and last panel) live in `localStorage` behind a guarded wrapper: when storage is unavailable or full the panel still works, and the preference applies to the session only.
- Keyboard: arrow keys, Home and End move through a list, Enter or Space opens the row, `/` focuses search and `Escape` closes the write dialog. The dialog takes the focus when it opens, keeps Tab inside it and hands the focus back to the control that opened it. Reduced motion follows `prefers-reduced-motion`, and the toolbar switch turns it on manually.
- Panel rule: the build emits one ES module (`dist/panel.js`) and one stylesheet (`dist/panel.css`), with no inline script, no inline style markup, no `innerHTML` with data and no other origin. Colour comes from acon's `--acon-*` tokens, with fallbacks and a light/dark override for the standalone host.

The `acon` plugin in `src/plugin` keeps `@staix/vault-mem/ui-plugin`'s provider — and so vmem's validation, receipts and two-step confirmation — and replaces only the panel assets with this bundle. It reads `dist/`, so run `bun run build` before starting the console; `bun run check` builds first for the same reason.

## Scope

- Runs standalone on loopback and inside `acon`, from one bundle.
- Reads and writes only through vmem's provider, so every write passes vmem's validation and two-step confirmation.
- Depends on `@staix/vault-mem`; vault-mem does not depend on this package.

## Standalone host (vmem-ui)

`bun run build`, then `bun bin/vmem-ui.ts` (installed as `vmem-ui`). It opens the vault-mem provider in process, listens on `127.0.0.1` only and prints a one-time sign-in link valid for 5 minutes.

The vault it serves is the one vmem resolves for this process, not `$AGENTHUB_HOME`: `VMEM_HOME` if set, else the `home` pointer in the default home's config, else `$AGENTHUB_HOME/vmem` (default `~/.agenthub/vmem`). Set `VMEM_HOME` to serve another vault home; the command's own context carries the family home only.

- The link signs in once and sets an HttpOnly, SameSite=Strict session cookie; a reused or expired link is refused.
- Every request is checked for Host (`127.0.0.1` or `localhost` on this port) and Origin; API calls need a same-origin Origin header. A default port is checked without it, so `--port 80` is reached as `127.0.0.1` rather than `127.0.0.1:80`. Pages carry a strict CSP: `default-src 'none'; script-src 'self'; style-src 'self'`, no inline code, no `blob:`.
- Request bodies must be `application/json` and are capped at 32 KiB. The server exits after 30 minutes without a request (`--idle-minutes <n>`). A visible page polls and counts as use; hidden or closed pages stop polling; `--port <n>` picks the port (default: a free one).
- API: `POST /api/snapshot` and `POST /api/action` relay to the provider. A snapshot names one of the manifest's panels, plus `inbox` and `search` when the plugin advertises those capabilities; `after` is how many items the page already has, as a whole number 0 or more.
- Confirmation in standalone mode belongs to the page: the server relays `confirmed` and `fingerprint` exactly as the page sent them, and never adds either. It cannot tell what the browser displayed, so a caller holding the session cookie can confirm without any preview having been rendered. What protects the write is vmem's own check: it recomputes the preview from the current vault and writes only when the fingerprint still matches, so a stale or invented fingerprint is answered with the fresh preview instead of a write. Reaching the API at all takes the one-time sign-in link's cookie, a same-origin `Origin` and the loopback Host, which bounds who can call but does not prove that a person looked. `acon` does this differently (its server mints a confirm token) because the console renders the preview itself.
- A provider failure is logged to the terminal and answered with the reason and the next step.
- The page runs the existing client panels; the settings panel is not implemented yet.

## License

MIT. See [LICENSE](LICENSE).
