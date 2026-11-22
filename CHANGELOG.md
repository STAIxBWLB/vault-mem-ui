# Changelog

All notable changes to `@staix/vault-mem-ui` go here. Entries are grouped under a version heading that carries the
release date, in the shape `## [x.y.z] - YYYY-MM-DD`, and the release workflow publishes only a version with such a
section. `## [Unreleased]` holds the work that no release has shipped yet.

## [Unreleased]

## [0.2.0] - 2026-11-23

Requires `@staix/vault-mem` 0.14.0.

### Added

- Similar notes in the graph inspector and an optional weighted semantic graph layout for enrichment-enabled vaults.
- Inferred links are distinguished from extracted links and can be hidden from the graph and export.

### Changed

- The import boundary check refuses loader names, computed keys on known owners and global aliases by name; runtime-assembled names on other objects and global aliases outside the asset reader remain stated limits.

### Fixed

- Semantic layouts keep the canvas and camera, avoid writing semantic positions to the plain layout cache, and recover from stale graph revisions.
- Markdown heading and inline code-span scans run in linear time on long inputs.
- The import boundary check handles default parameter destructuring without refusing ordinary object keys, while retaining assignment-target protections.
- Semantic layout waits for a live layout worker; history does not offer a cursor reset for an unknown vault.

## [0.1.0] - 2026-11-22

Requires `@staix/vault-mem` 0.13.1.

### Added

- The `acon` console plugin that keeps `@staix/vault-mem/ui-plugin` as its provider and serves this package's own panel bundle.
- The client panels for vmem's overview, search, note, promote, lint, log, settings, proposals, assertions and history, the note body rendered as Markdown, and the graph view with its search, filters, legend, inspector and insights, local view, shortest path, pins and level of detail.
- The graph's decision chains mode, ordering notes along the provider's `supersedes` and `superseded_by` relations.
- Typed link authoring from the graph inspector through the provider's two-step `link` action.
- Offline export of the filtered graph as one self-contained HTML file.
- The standalone `vmem-ui` host and its `bin` entry, serving the same bundle on loopback through the provider.
- The import boundary check that keeps `src/` on the provider, and the third-party notices check on the bundle's inputs.
- The tag-driven release workflow, its release scripts, and this changelog.
