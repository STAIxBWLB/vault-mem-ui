# vault-mem-ui

Web UI for [vmem](https://github.com/STAIxBWLB/vault-mem): a standalone browser app and an `acon` console panel over the same vault provider, with a graph view. Part of the ahub family.

## Status

Not implemented or published yet. The repository contains the package scaffold and checks; the panel, standalone host and console plugin are still to come. The design is tracked in this repository's issues.

For development, install Bun 1.4.2 or newer, run `bun install`, then `bun run check`.

## Scope

- Runs standalone on loopback and inside `acon`, from one bundle.
- Reads and writes only through vmem's provider, so every write passes vmem's validation and two-step confirmation.
- Depends on `@staix/vault-mem`; vault-mem does not depend on this package.

## License

MIT. See [LICENSE](LICENSE).
