# Review

- Compare the complete diff against the linked issue and its explicitly scoped increment.
- Vault access: every read and write goes through the `@staix/vault-mem` provider (`snapshot`, `action`). Direct vault file access, or a write that skips vmem's two-step confirmation, is an Important finding.
- Hosts: a change to the client must work in both hosts, standalone and `acon`. The `acon` panel stays one ES module and one stylesheet, with no inline script, no inline styles, no `innerHTML` with data and no other origin. "No inline styles" covers runtime writes too: no `style=` in markup, no `element.style.*` or `cssText` writes, no `setAttribute('style', ...)` and no constructed stylesheets; sizing, positioning and state go through classes in the one stylesheet, and canvas backing size through the `width`/`height` attributes.
- Standalone server: check loopback binding, the one-time ticket and session cookie, Host and Origin checks on every request, the CSP, bounded request bodies and idle exit.
- Dependencies: a new bundled library needs its licence in the third-party notices and a reason in the PR. `@staix/vault-mem` never depends on this package.
- Ported code: code taken from the maru graph view names its source path in the PR description.
- Require typecheck, tests and a production bundle build. Distinguish local evidence from hosted CI.
- Error messages: a new or changed error or refusal a person sees names the cause and the next step.
- Documentation: a user-facing change updates the README in the same PR. Keep unimplemented capabilities explicit there.
