# Spike 2b harness: ForceAtlas2 layout on the main thread and in a same-origin module worker

Executable reproduction for `docs/spikes/02-layout-worker.md` (section "Re-measurement
without probe overhead"). Synthetic data only; nothing here reads a vault.

## Run

```sh
bun install
bunx playwright install chromium
ACON_ROOT=/path/to/agent-console bun run measure
```

`ACON_ROOT` must point at an agent-console checkout at `8babe31`. The driver starts
`server.ts`, which serves the bundle as a plugin panel through the real acon server (CSP
included), opens the ticket URL once, and drives the page. A ticket is single use: a second
navigation to it answers 401, which the driver treats as a failed run.

Environment:

- `GL_ARGS`: browser flags, default `--use-gl=angle --use-angle=metal`. A software renderer
  (SwiftShader) is not comparable and is rejected by the numbers, not by the driver.
- `SPIKE_CASES`: comma-separated label substrings; empty runs every arm.
- `SPIKE_RUNS`: runs per arm, default 3 (2 for sustained arms).
- `SPIKE_ITERATIONS`: per-frame iterations for the arms without their own cap, default 100.
- `SPIKE_QUERY`: configuration parsed by the driver and injected into the page; for example
  `workerYield=timer`. It is not appended to the console URL.

Output: `results/result.json` (per-arm distributions, click durations, errors) and `results/screenshot.png`.
`SPIKE_OUT` selects the result basename using letters, numbers, underscores or hyphens.
The ignored `results/` directory holds all output, and result JSON does not contain the ticket.
The driver exits non-zero on any HTTP 4xx/5xx, console error, page error, worker failure, click failure or unfinished run.

## Arms

Main thread, one `iterate` call per animation frame on a persistent matrix:

- `public-assign-10k-30k`: `forceAtlas2.assign(graph, {iterations: 1})` per frame, the
  public-API fallback the original spike measured.
- `persistent-10k-30k`, `persistent-10k-100k`: `graphToByteArrays` once, then
  `iterate(settings, nodes, edges)` per frame.
- `sigma-full-*`: the same loop plus `sigma.refresh()` each frame.
- `sigma-edges-*`: the same loop plus `sigma.refresh({skipIndexation: true, partialGraph:
  {nodes, edges}})`, which re-uploads every edge with its current endpoints.
- `sigma-nodesonly-*`: the same loop plus `sigma.refresh({skipIndexation: true,
  partialGraph: {nodes, edges: []}})`. Measured only to show that it leaves edge geometry
  stale; it is not a candidate.
- `sustain-main-*`: 3 s of the persistent loop at 30,000 and 100,000 edges.

Worker, the same module started as `new Worker(new URL('./panel.js', import.meta.url),
{type: 'module'})`:

- `worker-norender-*`: layout only, positions posted as two transferred `Float32Array`s.
- `worker-sigma-16ms-*`: batched position updates applied on the main thread every 16 ms,
  each followed by the edges-correct Sigma refresh.
- `worker-sigma-100ms-10k-100k`: the same at a 100 ms visual cadence.
- `sustain-worker-*`: 3 s soak.

`edge-correctness` is not a timing arm: it wraps `Sigma.prototype.addEdgeToProgram`,
performs each refresh mode after moving the nodes, and reports the number of edge uploads and
the largest distance between the endpoints Sigma has drawn and the nodes' current display
positions. A mode that uploads nothing scores an error equal to one iteration's movement.

## Metric definitions

- Iteration: `performance.now()` around `iterate` (or `assign`); Sigma arms also include
  position write-back and refresh. The movement probe is computed outside the timed region.
- Frame interval: start-to-start gap between consecutive `requestAnimationFrame` callbacks.
- Click: a Playwright action on `#pulse`, a latency proxy with `force: true`, which skips Playwright actionability checks,
  not browser Event Timing INP.
- Handler lag: `performance.now() - event.timeStamp` inside a `pointerdown` listener.
- Movement proxy: `sqrt(sum(|p_new - p_old|^2) / sum(|p_new|^2))`, first of five consecutive
  steps below 0.01. Origin dependent and not a usability threshold. In worker arms it is
  computed per posted batch, so its resolution is one batch and its step count is batches.
