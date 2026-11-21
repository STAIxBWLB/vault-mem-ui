# vault-mem-ui

Web UI for [vmem](https://github.com/STAIxBWLB/vault-mem): a standalone browser app and an `acon` console panel over the same vault provider, with a graph view. Part of the ahub family.

## Status

Not implemented or published yet. The repository contains the package scaffold, checks and the standalone host command; the panel UI and console plugin are still to come. The design is tracked in this repository's issues.

For development, install Bun 1.4.2 or newer, run `bun install`, then `bun run check`.

## Scope

- Runs standalone on loopback and inside `acon`, from one bundle.
- Reads and writes only through vmem's provider, so every write passes vmem's validation and two-step confirmation.
- Depends on `@staix/vault-mem`; vault-mem does not depend on this package.

## Standalone host (vmem-ui)

`bun run build`, then `bun bin/vmem-ui.ts` (installed as `vmem-ui`). It opens the vault-mem provider in process, listens on `127.0.0.1` only and prints a one-time sign-in link valid for 5 minutes.

The vault it serves is the one vmem resolves for this process, not `$AGENTHUB_HOME`: `VMEM_HOME` if set, else the `home` pointer in the default home's config, else `$AGENTHUB_HOME/vmem` (default `~/.agenthub/vmem`). Set `VMEM_HOME` to serve another vault home; the command's own context carries the family home only.

- The link signs in once and sets an HttpOnly, SameSite=Strict session cookie; a reused or expired link is refused.
- Every request is checked for Host (`127.0.0.1` or `localhost` on this port) and Origin; API calls need a same-origin Origin header. A default port is checked without it, so `--port 80` is reached as `127.0.0.1` rather than `127.0.0.1:80`. Pages carry a strict CSP: `default-src 'none'; script-src 'self'; style-src 'self'`, no inline code, no `blob:`.
- Request bodies must be `application/json` and are capped at 32 KiB. The server exits after 30 minutes without a request (`--idle-minutes <n>`); `--port <n>` picks the port (default: a free one).
- API: `POST /api/snapshot` and `POST /api/action` relay to the provider. A snapshot names one of the manifest's panels, plus `inbox` and `search` when the plugin advertises those capabilities; `after` is how many items the page already has, as a whole number 0 or more.
- Confirmation in standalone mode belongs to the page: the server relays `confirmed` and `fingerprint` exactly as the page sent them, and vmem recomputes the preview and writes only when the fingerprint still matches, otherwise it answers with the fresh preview. Nothing can confirm a write it was not shown, because only a signed-in, same-origin page can reach the API. `acon` does this differently (its server mints a confirm token) because the console renders the preview itself.
- A provider failure is logged to the terminal and answered with the reason and the next step.
- The page is a placeholder until the client UI lands; the settings panel is not implemented yet.

## License

MIT. See [LICENSE](LICENSE).
