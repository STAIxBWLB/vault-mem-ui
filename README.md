# vault-mem-ui

Web UI for [vmem](https://github.com/STAIxBWLB/vault-mem): a standalone browser app and an `acon` console panel over the same vault provider, with a graph view. Part of the ahub family.

## Status

Not published yet. The repository contains the package scaffold, checks, standalone host command, client panels and `acon` console plugin. The standalone client integration is still to come; the design is tracked in this repository's issues.

For development, install Bun 1.4.2 or newer, run `bun install`, then `bun run check`.

## Client

`src/client` is the browser client for vmem's existing panels: overview, search, note, promote, lint and log. It is written against one small host interface. The same bundle is intended for both hosts; standalone integration is still pending.

- Host interface (`src/client/host.ts`): `snapshot`, `action`, `theme` and `mount`. `acon`'s `ConsoleHost` is adapted by `createAconHost`; a standalone adapter for the host HTTP endpoints is still pending, and `createFakeHost` stands in for tests.
- Writes go through `action` only. In `acon` the console owns the confirmation: its server mints the confirm token, shows the preview in its own dialog and refuses a page that sets `confirmed` or `fingerprint`, so the panel sends the bare action and reports the outcome — the adapter says `confirm: "host"` and drops those two keys instead of forwarding them. A host that answers the provider directly instead (the fake host today, the standalone adapter once integrated) gets the two-step flow from the client: the preview with its fingerprint and the planned changes, nothing sent until the person confirms, and the confirm re-sending that same fingerprint, so the client cannot confirm a preview it did not show.
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

`bun run build`, then `bun bin/vmem-ui.ts` (installed as `vmem-ui`). It opens the vault-mem provider in process for `$AGENTHUB_HOME` (default `~/.agenthub`), listens on `127.0.0.1` only and prints a one-time sign-in link valid for 5 minutes.

- The link signs in once and sets an HttpOnly, SameSite=Strict session cookie; a reused or expired link is refused.
- Every request is checked for Host (`127.0.0.1` or `localhost` on this port) and Origin; API calls need a same-origin Origin header. Pages carry a strict CSP: `default-src 'none'; script-src 'self'; style-src 'self'`, no inline code, no `blob:`.
- Request bodies are capped at 32 KiB. The server exits after 30 minutes without a request (`--idle-minutes <n>`); `--port <n>` picks the port (default: a free one).
- API: `POST /api/snapshot` and `POST /api/action` relay to the provider unchanged. Writes keep vmem's two-step confirmation: the server never adds `confirmed` or a fingerprint.
- The page is a placeholder until the client UI lands; the settings panel is not implemented yet.

## License

MIT. See [LICENSE](LICENSE).
