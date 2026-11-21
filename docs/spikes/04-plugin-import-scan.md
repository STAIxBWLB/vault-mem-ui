# Plugin import scan for vault-mem

## Verdict

**Accepted for an installed dependency.** With Bun 1.4.4 and `@staix/vault-mem@0.10.2` installed in the plugin package's `node_modules`, the actual acon scan returned `verified`, the loader returned `ready`, and `acon ui --no-open --json` reported the registered `vmem` plugin as `ready`. The plugin entry imported `@staix/vault-mem/ui-plugin` and re-exported its real provider; acon opened that provider against an isolated empty temporary home. No acon change is needed for this installed layout.

**A symlink to a checkout outside `node_modules` was rejected.** In a separate fixture, the same import resolved to the checkout's real path outside the plugin package and the allowed dependency directories. The scan returned `invalid` with `plugin.ts imports @staix/vault-mem/ui-plugin, which is outside the plugin package`; the loader did not open it. This is a separate development layout, not a failure of the installed package. A different package manager's symlink layout needs its own test: the decisive value is what `Bun.resolveSync` returns, not merely the visible symlink path.

## Rule and evidence

- Tested agent-console commit [`8babe31f421682670a17ee2498f485e6f9ea20a5`](https://github.com/STAIxBWLB/agent-console/blob/8babe31f421682670a17ee2498f485e6f9ea20a5/src/plugins.ts#L97-L137). `src/plugins.ts:87-91` chooses the nearest ancestor with `package.json` as the entry's package root. `replaceableBy` checks ownership, permissions and package-tree links, skipping `.git` and `node_modules` during the tree walk (`:43-84`).
- `importEscapes` scans static imports and literal dynamic imports (`:97-123`). It accepts built-ins (`:125`), rejects non-file schemes (`:126-127`), resolves other imports with `Bun.resolveSync` (`:128-130`), and accepts a resolved path under a `node_modules` directory at the root or an ancestor, or Bun's install cache (`:103-107`, `:131`). Otherwise its real path must be in the package walk's verified files (`:132-134`). An unresolved import is skipped by this scan (`:129`), but can fail later when acon imports the plugin. Computed dynamic imports cannot be followed by this static scan (`:101`).
- In the installed fixture, `Bun.resolveSync` returned a path under the plugin's own `node_modules/@staix/vault-mem/src/ui/plugin.ts`. The registration passed hash and safety checks, then `loadPlugins` opened the provider; its six panels were `overview`, `notes`, `note`, `promote`, `lint` and `log`. A separate invocation of the actual CLI reported `ready`. No snapshot or write was invoked, and the home contained no real vault data.
- In the checkout-symlink fixture, `Bun.resolveSync` returned the checkout's real `src/ui/plugin.ts`, outside the permitted directories. `scanPlugins` returned `invalid`, and `loadPlugins` retained `invalid`. Only these two layouts and this Bun version were tested; this does not prove behavior for pnpm, other symlink arrangements, future versions, packaged distribution of this UI, or a wrapped production panel.

## Required layout and trust boundary

A minimal installed layout is:

```text
plugin-package/
  package.json
  plugin.ts
  node_modules/
    @staix/vault-mem/
      package.json
      src/ui/plugin.ts
```

The registered entry must be an absolute `.ts`, `.js` or `.mjs` path, owned and permissioned according to acon's checks. The registration under `AGENTHUB_HOME/console/plugins/vmem.json` contains `api`, `tool`, `module`, and the lowercase SHA-256 of the entry file. The entry's plugin manifest tool must match the registration, and `open()` must return a valid provider. The fixture uses `import {plugin} from '@staix/vault-mem/ui-plugin'; export default plugin;`. A UI wrapper may adapt it but was not tested here.

The entry-file hash does not cover imported dependencies. The dependency directory is intentionally outside the verified package-tree walk; package installation and dependency integrity remain the installer's responsibility. This spike is not an endorsement of untrusted plugin code or a test of reproducible dependency installation. If the project requires outside-checkout symlinks as a supported deployment, acon would need an explicit trusted dependency-root or equivalent policy that preserves ownership and integrity checks; do not simply disable the escape check. No change is required for the tested installed layout.

## Reproduction

Use a scratch directory, not a real vault or existing agent-hub home. The example needs Bun 1.4.4, an agent-console checkout at the cited commit, network access or a pre-populated Bun cache, and `@staix/vault-mem@0.10.2`. Set `ACON_ROOT` to the checkout and `SPIKE_ROOT` to a new absolute scratch directory. Run the dependency install through the local resource admission policy when applicable.

```sh
mkdir -p "$SPIKE_ROOT/plugin" "$SPIKE_ROOT/home/console/plugins" "$SPIKE_ROOT/vmem"
chmod 700 "$SPIKE_ROOT/home/console/plugins"
cat > "$SPIKE_ROOT/plugin/package.json" <<'JSON'
{"name":"import-spike","version":"1.0.0","type":"module","dependencies":{"@staix/vault-mem":"0.10.2"}}
JSON
bun install --cwd "$SPIKE_ROOT/plugin" --no-save
cat > "$SPIKE_ROOT/plugin/plugin.ts" <<'TS'
import {plugin} from '@staix/vault-mem/ui-plugin';
export default plugin;
TS
```

Save this as `check.ts` in the scratch directory, then run `VMEM_HOME="$SPIKE_ROOT/vmem" AGENTHUB_HOME="$SPIKE_ROOT/home" bun "$SPIKE_ROOT/check.ts"`. It prints statuses and resolved path, not a vault snapshot.

```ts
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
const root = process.env.SPIKE_ROOT!;
const acon = process.env.ACON_ROOT!;
const {scanPlugins, loadPlugins} = await import(`${acon}/src/plugins.ts`);
const module = join(root, 'plugin', 'plugin.ts');
const home = join(root, 'home');
const sha256 = createHash('sha256').update(readFileSync(module)).digest('hex');
writeFileSync(join(home, 'console', 'plugins', 'vmem.json'), JSON.stringify({api: 1, tool: 'vmem', module, sha256}), {mode: 0o600});
const resolved = Bun.resolveSync('@staix/vault-mem/ui-plugin', join(root, 'plugin'));
const scan = scanPlugins(home);
console.log({resolved, scan: scan.entries.map(({status, reason}) => ({status, reason}))});
const loaded = await loadPlugins(scan, {home, log: console.error});
console.log({loaded: loaded.map(({status, reason, manifest, provider}) => ({status, reason, panels: manifest?.panels.map(p => p.id), snapshot: typeof provider?.snapshot}))});
for (const entry of loaded) await entry.provider?.close?.();
```

Expected installed result: `verified`, then `ready`, with `snapshot: 'function'`. To independently exercise the CLI, run `VMEM_HOME="$SPIKE_ROOT/vmem" AGENTHUB_HOME="$SPIKE_ROOT/home" bun "$ACON_ROOT/bin/acon.js" ui --no-open --json`, inspect the plugin status, then terminate that process. Its one-time URL is a credential; do not copy it into a report. To reproduce the negative case, make a separate scratch package whose `node_modules/@staix/vault-mem` symlinks to a checkout outside that package, register its identical entry under a separate temporary home, and run the same scan. Check the resolved path and rejection; do not modify the checkout.
