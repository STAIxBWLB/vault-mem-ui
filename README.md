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

`bun run build`, then `bun bin/vmem-ui.ts` (installed as `vmem-ui`). It opens the vault-mem provider in process for `$AGENTHUB_HOME` (default `~/.agenthub`), listens on `127.0.0.1` only and prints a one-time sign-in link valid for 5 minutes.

- The link signs in once and sets an HttpOnly, SameSite=Strict session cookie; a reused or expired link is refused.
- Every request is checked for Host (`127.0.0.1` or `localhost` on this port) and Origin; API calls need a same-origin Origin header. Pages carry a strict CSP: `default-src 'none'; script-src 'self'; style-src 'self'`, no inline code, no `blob:`.
- Request bodies are capped at 32 KiB. The server exits after 30 minutes without a request (`--idle-minutes <n>`); `--port <n>` picks the port (default: a free one).
- API: `POST /api/snapshot` and `POST /api/action` relay to the provider unchanged. Writes keep vmem's two-step confirmation: the server never adds `confirmed` or a fingerprint.
- The page is a placeholder until the client UI lands; the settings panel is not implemented yet.

## License

MIT. See [LICENSE](LICENSE).
