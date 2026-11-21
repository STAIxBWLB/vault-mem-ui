# vault-mem-ui

Web UI for [vmem](https://github.com/STAIxBWLB/vault-mem): a standalone browser app and an `acon` console panel over the same vault provider, with a graph view. Part of the ahub family.

## Status

Planned. Nothing is implemented or published yet; the package `@staix/vault-mem-ui` does not exist on npm. The design is tracked in this repository's issues.

## Scope

- Runs standalone on loopback and inside `acon`, from one bundle.
- Reads and writes only through vmem's provider, so every write passes vmem's validation and two-step confirmation.
- Depends on `@staix/vault-mem`; vault-mem does not depend on this package.

## License

MIT. See [LICENSE](LICENSE).
