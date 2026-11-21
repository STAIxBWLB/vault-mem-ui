# Sigma in an acon panel under CSP

## Verdict

**Works with changes.** Sigma 3.0.3 and graphology 0.26.0 rendered a two-node WebGL graph in the actual acon shell and the `clickNode` handler received the clicked node. The panel had one bundled ES module and one stylesheet, both served by acon, and made no cross-origin requests. No change to acon's CSP was needed for this browser. However, unmodified Sigma creates `style` attributes through CSSOM property writes. If the issue's prohibition on `style=` includes runtime DOM attributes, Sigma does not satisfy that contract as-is; the integration must remove or replace those writes and retest resizing, interaction and other supported browsers. This spike does not establish that such a change is feasible without a Sigma fork or patch.

## Evidence and limits

- Tested acon commit `8babe31f421682670a17ee2498f485e6f9ea20a5`, Bun 1.4.4, Chrome 157.0.8103.78 on macOS, headless with SwiftShader. The test instantiated acon's `startServer` with an in-memory synthetic plugin; it exercised its shell, session, panel asset routes and panel lifecycle, but not registration/import scanning or a production vault provider.
- The page header in `src/server.ts:60` is `default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-src 'self'; frame-ancestors 'none'`. `script-src 'self'` permits the same-origin panel module; `style-src 'self'` permits the same-origin stylesheet but blocks an inline style attribute set as text. `default-src 'none'` is the fallback for directives not explicitly present, including workers. The separate Mermaid frame policy is not the panel policy.
- The screenshot showed both colored labeled nodes and the edge. Seven canvas layers had 600 x 400 backing dimensions. A real pointer click at the renderer's calculated node position produced `clicked a` through `clickNode`.
- Sigma's `createLayer` applies positioning with DOM style properties, and `resize` writes `element.style.width` and `element.style.height` (`dist/sigma.esm.js`, around lines 2798 and 3203 in 3.0.3). Chrome applied those writes and exposed attributes such as `style="position: absolute; width: 600px; height: 400px;"`; the mouse layer also contained `touch-action` and `user-select`. They did not produce a CSP violation in this run. A custom `probe.style.color = ...` likewise applied.
- A constructed `CSSStyleSheet` with `replaceSync` and `document.adoptedStyleSheets` applied the test border with no violation. In contrast, the deliberately prohibited `probe.setAttribute('style', ...)` produced one `securitypolicyviolation`: `effectiveDirective: style-src-attr`, `blockedURI: inline`, empty `sample`. Chrome reported: `Applying inline style violates the following Content Security Policy directive 'style-src 'self''.` The requested background remained transparent. This violation was induced by the probe, not observed from Sigma. No other browser errors or CSP events were observed.
- This is one Chromium/WebGL configuration and a tiny static graph, not proof of browser compatibility, large-graph performance, accessibility, CSP behavior in Safari or Firefox, or the static multi-node host. A no-runtime-style-attribute implementation has not been tested.

## Reproduction

Use a clean scratch directory with `sigma@3.0.3`, `graphology@0.26.0`, Bun and Playwright installed, and an agent-console checkout at the commit above. Set `ACON_ROOT` to that checkout. All graph data below is synthetic. Bundle the panel with Bun; the resulting `bundle.js` is the single panel module. The test's `setAttribute` deliberately violates the rule to provide a positive CSP control and is not a recommended implementation.

`panel.js`:

```js
import Sigma from 'sigma';
import Graph from 'graphology';

export default function (host) {
  const box = document.createElement('div');
  box.className = 'spike-graph';
  const result = document.createElement('p');
  result.className = 'spike-result';
  result.textContent = 'waiting';
  host.mount.append(box, result);
  const graph = new Graph();
  graph.addNode('a', {x: 0, y: 0, size: 20, label: 'Alpha', color: '#ff0000'});
  graph.addNode('b', {x: 1, y: 1, size: 20, label: 'Beta', color: '#0000ff'});
  graph.addEdge('a', 'b');
  let renderer;
  return {
    show() {
      if (renderer) return;
      renderer = new Sigma(graph, box, {renderLabels: true});
      renderer.on('clickNode', ({node}) => { result.textContent = 'clicked ' + node; });
      window.spike = renderer;
      const probe = document.createElement('div');
      box.append(probe);
      probe.style.color = 'rgb(1, 2, 3)';
      probe.setAttribute('style', 'background-color: rgb(4, 5, 6)');
      const sheet = new CSSStyleSheet();
      sheet.replaceSync('.spike-result { border: 3px solid rgb(7, 8, 9) }');
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      window.spikeProbe = probe;
    },
    hide() {},
    destroy() { renderer?.kill(); box.remove(); result.remove(); },
  };
}
```

`panel.css`:

```css
.spike-graph { position: relative; width: 600px; height: 400px; }
```

Run `bun build panel.js --target browser --format esm --outfile bundle.js`. Use this `server.ts` from the scratch directory:

```ts
const {startServer} = await import(`${process.env.ACON_ROOT}/src/server.ts`);
const js = await Bun.file('bundle.js').text();
const css = await Bun.file('panel.css').text();
const manifest = {api: 1, tool: 'spike', version: '0.0.1', title: 'Spike', icon: 'vault', panels: [{id: 'graph', title: 'Graph', order: 1}], capabilities: {actions: []}};
const provider = {assets: {js, css}, async snapshot() { return {}; }, async action() { return {ok: false}; }};
const server = startServer({plugins: [{tool: 'spike', file: 'fixture', status: 'ready', manifest, provider}], version: 'test', pluginsDir: '.', log: console.error});
console.log(server.issue());
process.on('SIGTERM', async () => { await server.stop(); process.exit(0); });
```

Start `bun server.ts`, open the printed one-time ticket URL in a browser, then navigate within the same origin to `/#/local/spike/graph`. Before navigating, register `document.addEventListener('securitypolicyviolation', e => console.log(e.effectiveDirective, e.blockedURI, e.sample))` using a browser initialization script. Inspect the graph, click Alpha, and inspect canvas `style` attributes, `getComputedStyle(window.spikeProbe)`, and the result border. The test used Playwright `page.addInitScript` for the listener, captured console errors and clicked the position returned by `window.spike.graphToViewport({x: 0, y: 0})` plus the container's bounding rectangle. Capture the CSP response header and any browser-specific deviations when repeating.
