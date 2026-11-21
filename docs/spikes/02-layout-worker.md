# ForceAtlas2 layout at 10,000 nodes

## Verdict

**The tested main-thread fallback is not responsive enough for an interactive graph.** One iteration per animation frame still occupied a median 27.9 ms and p95 34.0 ms, above the 16.7 ms frame budget for 60 Hz, before rendering an interactive Sigma graph. A button click issued by Playwright during layout took 328-769 ms to complete, versus 30-35 ms after layout. Those end-to-end automation timings include Playwright overhead, but the contrast and frame delays support the conclusion for this machine and fixture. The fastest possible scheduling quantum here is already a whole iteration; yielding between iterations cannot interrupt it.

**Re-measured without probe overhead (spike 2b, the Re-measurement section below): the numbers above are superseded, the conclusion is not.** A persistent-matrix loop with nothing else in the timed region costs a median 26.6 ms per iteration at 10,000 nodes / 30,000 edges and 24.8 ms at 100,000 edges, so iteration work alone exceeds the 16.7 ms budget at both sizes. Sigma's cheapest repaint path that also updates edge geometry adds 10.1 ms at 30,000 edges and 29.5 ms at 100,000, and a full refresh adds 12.9 ms and 53.3 ms. Matrix reuse is worth 0.7 ms, so the earlier 27.9 ms was inflated by the unused traversal and the position and displacement copies, not by the matrix rebuild. A free-running same-origin worker holds the page at 16-17 ms frames and 1-2 ms clicks, while its layout advances at 6-51 iterations per second, enough for a settling graph and not for 60 position updates per second. At 100,000 edges its batched repaint still costs 19-25 ms on the main thread, and 220-300 ms iteration bursts appear inside most worker runs. An earlier revision of that section measured a repaint path that never updated edge geometry; its rendering figures and its "cheap update" claim are withdrawn.

A same-origin module worker did start from acon's existing `panel.js` endpoint, while a `blob:` worker was blocked. A synthetic worker also ran 100 public API iterations while the page remained responsive, but this is not proof that the stock ForceAtlas2 worker supervisor can use that URL: version 0.10.1 creates its worker from a Blob. The proposed one-module contract and acon's actual available asset routes must be resolved for a supported worker integration. The task requests a draft for agent-console rather than a CSP workaround; that draft is below and has not been filed. No change to acon's CSP is implied by the same-origin result.

## Method and results

The figures in this section are the original spike-2 run, taken with probe work inside the
timed region; the Re-measurement section below supersedes them. The method itself is unchanged.

Tested Chrome 157.0.8103.78 headless on macOS, Apple M5 Max, 64 GB RAM, with acon commit `8babe31f421682670a17ee2498f485e6f9ea20a5`, graphology 0.26.0 and graphology-layout-forceatlas2 0.10.1. A synthetic graph has 10,000 nodes, 30,000 undirected edges (offsets 1, 17 and 101), deterministic seeded initial coordinates, no real note data and inferred ForceAtlas2 settings with Barnes-Hut optimization. This is one sparse graph, not the 100,000-edge worst case.

The panel repeatedly calls the public `forceAtlas2.assign(graph, {iterations: 1, settings})` once per `requestAnimationFrame` for 100 iterations. Each measurement includes copying positions, one assign call and computing displacement, but excludes drawing an interactive Sigma scene. Position snapshots, Graphology events, automation and system scheduling add overhead. Importantly, each public `assign` call rebuilds the matrices, so it resets ForceAtlas2's momentum and is **not** equivalent to a single persistent 100-iteration run or the library's worker. This measures a straightforward public API fallback, not every possible main-thread implementation. Using internal matrices could change performance and convergence and requires separate validation.

- All 100 iterations: 3,336.1 ms elapsed; iteration work p50 27.9 ms, p95 34.0 ms, max 246.2 ms; animation-frame intervals p50 28.2 ms, p95 36.1 ms, max 246.6 ms.
- A nominal 50 ms timer fired 45 times; interval p50 56.6 ms, p95 91.5 ms, max 519.1 ms. Seven actual Playwright button clicks while the layout ran took 438.4, 768.5, 343.6, 328.0, 337.3, 349.4 and 333.4 ms. Five after both layout runs took 30.8, 30.5, 34.8, 31.3 and 35.1 ms. These are automation action durations, not browser Event Timing INP and not a substitute for human input testing.
- As a reproducible movement proxy, compute `sqrt(sum((x_new-x_old)^2 + (y_new-y_old)^2) / sum(x_new^2 + y_new^2))`. The first five consecutive steps below 0.01 ended at iteration 42, 1,707.3 ms after the start. This origin-dependent heuristic is not a validated visual quality or convergence threshold. The canvas drawn after iteration 100 showed a dense cloud of points, with no edges, labels or node selection. **Time to a genuinely usable graph layout remains unverified**; the proxy must not be treated as proof of usability.
- A second worker created the same synthetic graph locally and ran 100 one-iteration public `assign` calls in 3,232.5 ms (3,252.7 ms from worker creation to reply). While it ran, frame intervals were p50 16.7 ms, p95 16.8 ms and max 16.8 ms; 39 Playwright clicks took 24.7-35.8 ms. It did not transfer graph data or positions, emit intermediate layouts, render Sigma or test the stock worker supervisor; its timing excludes the main-thread displacement probes and is not a like-for-like algorithm benchmark.
- The real acon page delivered its panel module and stylesheet from the same origin. A module worker created with `new Worker('/p/spike/panel.js', {type: 'module'})` loaded the same panel module and posted a ready message. A Blob worker produced `securitypolicyviolation` with `effectiveDirective: worker-src` and `blockedURI: blob`. Under acon's policy, absent `worker-src` falls back through `child-src` to `script-src 'self'`; this permits the same-origin URL and excludes `blob:`. This verifies a bootstrap path only; it does not test authentication renewal, static multi-node mode, other browsers, a separate worker asset, worker protocol, cancellation or transfer costs.

## Re-measurement without probe overhead (spike 2b)

This section was revised after review. Its first version measured the Sigma repaint path
`refresh({skipIndexation: true, partialGraph: {nodes, edges: []}})`, which updates node programs
and leaves the edge programs holding the endpoints they had at the last full process, so the
rendered graph was not the graph being laid out. The numbers below replace those, and the
"fast update" figure from that version is withdrawn. The harness is now in the repository at
`spikes/02b/` (see Reproduction).

### Setup

Same machine and fixture family as spike 2: Apple M5 Max, 64 GB, Chrome 159.0.8154.6 headless
through Playwright 1.65.1, acon at `8babe31` serving a fixture panel from its real server and
CSP, graphology 0.26.0, graphology-layout-forceatlas2 0.10.1 and Sigma 3.0.3. Synthetic graphs
use spike 2's seeded generator: 10,000 nodes at pseudo-random initial coordinates, edges from
fixed index offsets (30,000 edges: offsets 1, 17, 101; 100,000 edges: offsets 1, 7, 17, 29,
41, 53, 67, 79, 91, 101),
`inferSettings` with Barnes-Hut. Nothing here is real note data.

The headless browser used ANGLE over Metal, the machine's GPU. A software-WebGL (SwiftShader)
pass was measured first and is not reported: its paint put a 20-frame 30,000-edge arm at a median
788 ms per frame, which is a software renderer's cost, not this algorithm's.

APIs used, exactly, both CommonJS subpaths of 0.10.1: `graphToByteArrays` from
`graphology-layout-forceatlas2/helpers` for the one-time matrix build, and
`iterate(settings, NodeMatrix, EdgeMatrix)` from `graphology-layout-forceatlas2/iterate` for one
step. Settings are `{...DEFAULT_SETTINGS, ...forceAtlas2.inferSettings(graph)}` from
`graphology-layout-forceatlas2/defaults`, the same merge the public `assign` performs, and
`iterate` is the function `assign` calls once per iteration, so the arithmetic is identical to
the public API. The node stride is read from the matrix (`nodes.length / graph.order`), not
assumed.

Timing arms run 100 frames, except the rendering arms, which run until the movement proxy is
reached or 150 frames pass. Iteration is the time inside `iterate` (or `assign`), with position
read-back and the proxy computed outside it. Frame interval is the gap between the starts of
consecutive animation frames. A click is a Playwright action on a button, so it includes the
driver's actionability checks and is a latency proxy, not browser Event Timing INP. Handler lag
is `performance.now() - event.timeStamp` inside the `pointerdown` listener. Values are medians
of three runs (two for the 3 s soak arms).

### Which Sigma repaint path actually updates edges

`Sigma#refresh` with `skipIndexation` calls `addNodeToProgram` for each listed node and
`addEdgeToProgram` only for each listed edge, and edge geometry lives in the edge programs:
`addEdgeToProgram` uploads each edge's endpoints from the node display cache at the moment it is
called. So a nodes-only partial refresh moves the nodes and leaves every edge drawn at its old
endpoints until the next `process()`.

The harness measures that directly (`edge-correctness` arm, 10,000 nodes / 30,000 edges, one
run). It wraps `Sigma.prototype.addEdgeToProgram`, performs each refresh mode after moving the
nodes, and compares the endpoints Sigma has drawn with the nodes' current display positions:

| repaint mode | edge uploads | refresh median (ms) | node movement | largest endpoint error | error / movement |
|---|---|---|---|---|---|
| nodes only, `skipIndexation` | 0 / 30,000 | 4.1 | 0.258 | 0.258 | 1.00 |
| nodes and edges, `skipIndexation` | 30,000 / 30,000 | 9.1 | 0.262 | 0.000 | 0.00 |
| full `refresh()` | 30,000 / 30,000 | 22.4 | 0.268 | 0.000 | 0.00 |

Positions are Sigma display units. A path that uploads nothing scores an error equal to one
iteration's movement, which is what the first version of this section was measuring while
reporting it as a rendering cost. The edges-correct low-cost path is a partial refresh that
lists both nodes and edges; `refresh()` is the other correct path and costs more.

### Main thread

| arm | frames | iteration p50 / p95 / max (ms) | frame p50 / p95 / max (ms) | render only (ms) | click p50 (n) | handler lag p50 (ms) | movement proxy |
|---|---|---|---|---|---|---|---|
| public `assign` per frame, 10,000 / 30,000 | 42 | 27.3 / 28.3 / 32.3 | 27.8 / 28.9 / 32.9 | - | 199 (14) | 27.2 | iteration 42, 1.2-2.0 s |
| persistent loop, 10,000 / 30,000 | 100 | 26.6 / 28.6 / 29.5 | 26.9 / 28.9 / 30.0 | - | 190 (32) | 26.6 | not within 100 (last 0.011) |
| persistent loop, 10,000 / 100,000 | 90 | 24.8 / 28.2 / 34.9 | 25.0 / 28.6 / 35.2 | - | 181 (28) | 24.5 | iteration 90, 2.2-2.3 s |
| persistent + Sigma full refresh, 10,000 / 30,000 | 112 | 49.7 / 54.1 / 59.6 | 50.1 / 54.8 / 60.1 | 12.9 | 352 (38) | 48.8 | iteration 112, 5.5-5.7 s |
| persistent + Sigma full refresh, 10,000 / 100,000 | 90 | 83.2 / 109.2 / 125.9 | 83.6 / 111.4 / 126.8 | 53.3 | 610 (34) | 84.1 | iteration 90, 7.7-8.0 s |
| persistent + Sigma nodes and edges, 10,000 / 30,000 | 112 | 45.1 / 50.8 / 56.0 | 45.4 / 51.7 / 56.4 | 10.1 | 320 (37) | 43.8 | iteration 112, 5.1-5.3 s |
| persistent + Sigma nodes and edges, 10,000 / 100,000 | 90 | 63.7 / 74.5 / 80.1 | 64.4 / 74.9 / 80.5 | 29.5 | 453 (33) | 62.7 | iteration 90, 5.5-5.9 s |
| persistent + Sigma nodes only (invalid), 10,000 / 30,000 | 112 | 31.4 / 36.9 / 41.1 | 31.8 / 37.1 / 41.5 | 1.3 | 221 (38) | 30.4 | iteration 112, 3.2-3.8 s |

`render only` is the median of three warm-up repaint calls with no layout, and it is also visible
inside the per-frame figure: the rendering arms' iteration column includes the repaint, since
the write-back and the repaint happen inside the timed region for those arms.

What the re-measurement changes in the earlier numbers:

- Matrix reuse is worth 0.7 ms per iteration at 30,000 edges (27.3 to 26.6 ms, p50). The rebuild
  was therefore not the reason the earlier figure looked high: the unused full-graph traversal
  and the position and displacement copies inside spike 2's timed region account for the rest.
  The 27.9 ms figure was real for that loop, not a measurement artifact.
- Resetting momentum every frame changes behaviour, not cost: the public-`assign` arm reaches
  the movement proxy at iteration 42 (1.1-2.0 s across runs, matching spike 2's 42 and
  1,707 ms), while the persistent arm has not reached it after 100 iterations at 30,000 edges
  (last delta 0.011) and reaches it at iteration 90 at 100,000 edges (2.2 s).
- The 100,000-edge fixture is cheaper per layout iteration than the 30,000-edge one (24.8
  against 26.6 ms p50), most likely because the stronger attraction pulls nodes into a tighter
  cluster and keeps the Barnes-Hut tree shallow, so the tree cost falls by more than the extra
  70,000 edges add. With a renderer this reverses: the repaint is three times as expensive at
  100,000 edges (29.5 against 10.1 ms), so 100,000 edges is the slow case end to end.
- The edges-correct repaint path is cheaper than a full refresh (10.1 against 12.9 ms at 30,000
  edges, 29.5 against 53.3 ms at 100,000), and it is the path an animated layout should use,
  provided its partial graph lists both nodes and edges. It is still 10-30 ms of main-thread
  work per frame on top of a 25-27 ms iteration.
- Iteration cost alone is above the 16.7 ms budget at both sizes, with no renderer in the loop,
  and input waits for a whole iteration: clicks land 180-610 ms late and the pointerdown handler
  runs one iteration late (24.5-84.1 ms). The conclusion does not depend on the rendering path,
  the probes or the matrix strategy.

### Same-origin module worker

The panel module was started as its own module worker from the page:
`new Worker(new URL('./panel.js', import.meta.url), {type: 'module'})` under acon's CSP, which
serves that URL and allows it. The worker builds the graph and matrices once, then runs
iterations back to back in chunks of three, yielding between chunks through a `MessageChannel`,
and posts two transferred `Float32Array`s when its batch interval has passed. The main thread
writes the newest batch into the node attributes on each animation frame and, when rendering,
performs the edges-correct Sigma repaint. Layout never blocks the main thread; the repaint does.

Each row is three runs of 400 frames (about 6.7 s), stopped earlier if the movement proxy is
reached. The two soak rows at the end are two runs of 3 s each. Per-run figures are separated
by semicolons.
"Apply" is the main-thread cost of writing a batch and repainting, and "render" is the repaint
alone.

| arm | iterations in window | iteration p50 / p95 / max (ms), per run | frame p50 / p95 / max (ms), per run | apply / render p50 (ms) | click p50 (n) | handler lag p50 (ms) | movement proxy |
|---|---|---|---|---|---|---|---|
| worker, no render, 10,000 / 30,000 | 114; 114; 114 | 26.4 / 40.7 / 242.7; 26.3 / 236.8 / 251.3; 26.3 / 238.3 / 255.5 | 16.7 / 17.5 / 30.9; 16.7 / 16.8 / 18.0; 16.7 / 16.8 / 19.2 | 0 / - | 1 (265) | 0.1 | iteration 112, 4.0-5.1 s |
| worker, no render, 10,000 / 100,000 | 93; 93; 93 | 27.0 / 233.1 / 238.7; 24.9 / 34.4 / 44.2; 25.2 / 236.9 / 281.6 | 16.7 / 16.8 / 17.5; 16.7 / 16.8 / 16.9; 16.7 / 19.3 / 20.1 | 0 / - | 1 (217) | 0.1 | iteration 90, 2.3-5.6 s |
| worker + Sigma nodes and edges, 16 ms batch, 10,000 / 30,000 | 114; 114; 114 | 26.6 / 37.3 / 240.2; 26.6 / 237.9 / 243.9; 28.0 / 236.7 / 288.7 | 16.5 / 19.7 / 20.2; 16.3 / 20.3 / 20.5; 16.0 / 20.4 / 20.6 | 0.1 / 5.2-6.0 | 1 (248) | 0.1 | iteration 112, 4.1-4.7 s |
| worker + Sigma nodes and edges, 16 ms batch, 10,000 / 100,000 | 93; 93; 93 | 25.2 / 216.9 / 236.2; 24.6 / 218.6 / 231.3; 28.0 / 240.2 / 253.7 | 16.2 / 22.3 / 24.0; 16.7 / 21.5 / 24.6; 17.0 / 28.1 / 31.3 | 0.1 / 19.2-24.1 | 1 (194) | 0.1 | iteration 90, 3.2-5.6 s |
| worker + Sigma nodes and edges, 100 ms batch, 10,000 / 100,000 | 102; 264; 270 | 27.5 / 283.1 / 306.3; 17.5 / 29.3 / 239.5; 17.5 / 28.0 / 39.5 | 16.7 / 24.8 / 37.1; 16.7 / 21.1 / 25.6; 16.7 / 21.0 / 24.3 | 0.1 / 19.7-25.0 | 1 (334) | 0.1 | iteration 261-266, 5.3-6.4 s (one run not reached, last 0.042) |
| worker, 3 s soak, 10,000 / 30,000 | 90; 54 | 26.8 / 35.0 / 232.6; 27.2 / 247.4 / 257.3 | 16.7 / 17.7 / 18.6; 16.7 / 17.3 / 17.9 | 0 / - | 1 (114) | 0.1 | not reached in 3 s (last 0.013) |
| worker, 3 s soak, 10,000 / 100,000 | 93; 18 | 24.9 / 33.4 / 39.9; 230.9 / 254.0 / 254.0 | 16.7 / 17.3 / 18.9; 16.7 / 17.7 / 18.8 | 0 / - | 1 (100) | 0.1 | iteration 90 at 2.2 s in the clean run, not reached in the burst run |

Worker initialisation, which builds the graph and the matrices from transferred arrays, took
71-116 ms. Each position batch is 80,000 bytes, transferred rather than copied. With 25-27 ms
iterations the "16 ms" batch interval is bounded by the iteration, so those arms post about one
batch per iteration; the 100 ms arm posts about five iterations per batch and lets the worker
run at 40-50 iterations per second instead of 17-29.

The page stays at 60 Hz in every worker arm and input latency drops to about a millisecond,
against 24.5-84.1 ms of handler lag and 181-610 ms of click action on the main thread. Layout
throughput is the price: across runs it spans 6-51 iterations per second, with clean runs at
20-30 under 16 ms batches and 40-51 under 100 ms batches, and a burst-stopped run as low as 5.
The price of showing the result is
a 5-6 ms repaint per batch at 30,000 edges but 19-25 ms at 100,000, which pushes the frame p95 to
21-28 ms. Moving the layout off the main thread does not by itself make the 100,000-edge render
frame-rate safe: the repaint has to be batched or kept off the frame path too.

**A cost burst runs through the worker numbers.** In 12 of 19 worker runs some iterations jump
from about 27 ms to 220-300 ms, mostly in bursts of a few consecutive iterations; when a run ends
inside a burst, its own median is also 230-270 ms and it completes only 18 iterations in the
window (that is the 18-iteration soak run, whose own median is 230.9 ms). Four candidate
causes were checked and none explains it:

- Thread CPU throughput is the same: a 20-million-iteration floating-point probe took 10.7 ms
  p50 on the main thread and 10.3-12.6 ms in the worker.
- It is not timer throttling: the gap between iteration chunks stayed at 0.1-0.4 ms p50 (max
  6.1 ms) with both the `MessageChannel` and `setTimeout` yield styles.
- It is not the worker heap limit: a run with `--js-flags=--max-old-space-size=4096` still
  produced 230-243 ms iterations between 27-38 ms ones.
- It is not the repaint: it appears in the no-render arms with no main-thread work per batch.

Garbage collection inside the worker's heap is the leading explanation, since each `iterate`
call allocates its region array and the worker holds its own matrices, but that is a hypothesis
and not a measurement: `--trace-gc` was not run. Until it is settled, the worker's median
iteration time understates the average, and its throughput is not predictable enough to promise
a settling time.

### Verdict for the worker decision

- A main-thread fallback does not fit a 60 Hz budget at 10,000 nodes, at 30,000 or 100,000
  edges, even before rendering: 24.8-26.6 ms per iteration, a 38-40 frames per second ceiling,
  and the edges-correct Sigma repaint adds 10.1-29.5 ms.
- Removing the probe overhead and reusing matrices improves the figure by under a millisecond,
  so the earlier verdict was right for the wrong reason: the cost is the algorithm iteration
  itself, and no scheduling inside the iteration can cut it below a whole iteration.
- A same-origin module worker keeps the page at 16-17 ms frames and input at about 1 ms, and its
  iteration cost sits inside the main thread's run-to-run spread: 26.3-28.0 ms p50 against
  26.6 ms at 30,000 edges, and 24.6-28.0 ms against 24.8 ms at 100,000. The stock 0.10.1
  supervisor is still not usable because it creates its worker from a `blob:`. The same-origin
  panel-module worker is the only worker route that works in the console's local host, and it is
  not available as things stand in the static multi-node host: there the panel module is served
  from the node origin with an `acon_resource` grant, so a worker started from that module is
  cross-origin to the page and loses the grant.
- Showing worker results at 100,000 edges costs 19-25 ms of main-thread repaint per batch, so the
  panel needs a batch cadence that fits the frame budget: 100 ms batches held frames at 16.7 ms
  p50 (21-25 ms p95) and let the worker run at 40-50 iterations per second, while 16 ms batches
  put a 20 ms block on every frame.
- The unexplained bursts mean the worker's throughput is not bounded by the p50. A production
  layout needs a soak test and probably a smaller allocation per iteration, or an explicit GC
  experiment, before the panel depends on a settling time.

### Reproduction (spike 2b)

The harness is in the repository at `spikes/02b/`, so the reproduction is the committed code
rather than a quotation that can drift from it. Each piece the tables depend on:

| piece | file | entry point |
|---|---|---|
| graph construction, seeded coordinates, edge offsets | `spikes/02b/graph.js` | `makeGraph(order, edgeSet, seed)` and `EDGE_SETS` (`sparse` = 1, 17, 101 giving 30,000 edges; `dense` = 1, 7, 17, 29, 41, 53, 67, 79, 91, 101 giving 100,000) |
| worker transfer arrays | `spikes/02b/graph.js` | `toTransferArrays(graph)`: node order, `Float32Array` x and y, `Uint32Array` edge endpoint pairs |
| position write-back | `spikes/02b/graph.js` | `writePositions(graph, matrix, stride)` with `stride = matrix.length / graph.order` |
| main-thread arms and the edge-correctness instrumentation | `spikes/02b/panel.js` | `runMainCase`, `measureEdgeCorrectness`, `refreshSigma(sigma, graph, mode)` |
| worker branch and protocol | `spikes/02b/panel.js` | the `typeof document === 'undefined'` branch: `init`, `start`, `stop`, `cpu` inbound; `boot`, `ready`, `batch`, `stopped`, `cpu`, `failure` outbound; `iterate` in chunks of three with a `MessageChannel` yield and one transferred batch per interval |
| worker driver on the page | `spikes/02b/panel.js` | `runWorkerCase`: applies the newest batch in `requestAnimationFrame`, repaints, records apply and render cost |
| server | `spikes/02b/server.ts` | acon `startServer` with an in-memory plugin that serves `bundle.js` as `/p/spike2b/panel.js` |
| measurement driver | `spikes/02b/measure.ts` | spawns the server, reads the ticket, loads the page once, routes by hash, clicks `#pulse` every 50 ms, writes `result.json` |
| pinned dependencies | `spikes/02b/package.json`, `spikes/02b/bun.lock` | `bun install` |

```sh
cd spikes/02b
bun install
ACON_ROOT=/path/to/agent-console bun run measure
```

Bun 1.4.4, `graphology@0.26.0`, `graphology-layout-forceatlas2@0.10.1`, `sigma@3.0.3`,
`playwright@1.65.1`, acon at `8babe31`. The driver starts `server.ts`, opens the ticket URL once,
changes route by hash, clicks `#pulse` every 50 ms while a case runs, reads `window.partialResults`
per case and writes `result.json` plus a screenshot. `SPIKE_CASES`, `SPIKE_RUNS`,
`SPIKE_ITERATIONS` and `SPIKE_OUT` select arms, repetitions and the output file; `GL_ARGS`
selects the browser's GL backend (default `--use-gl=angle --use-angle=metal`, a software backend
is not comparable).

The driver fails a run on any HTTP 4xx/5xx, console error, page error or unfinished arm. This
matters here: an acon ticket is single use and rides in the URL hash, and loading the console at
`/` without it makes the shell post an empty `/session`, which acon answers with 401 "this link
was already used or has expired". A driver that reloads the page after login therefore produces
a 401 in the console while its cases still complete, which is what an earlier scratch-copy run
of this harness reported. The committed driver loads the page once and routes by hash, so a clean
run has zero 4xx responses.

Two further defects found while making the reproduction durable are fixed in it: the graph
position write-back was handed the matrix bundle instead of the node matrix in an intermediate
revision (which left the Sigma arms drawing a still graph, and is why the first version of this
section under-reported their cost), and worker runs that ended inside a cost burst were reported
as if the burst were the median.

An independent run of the same scratch copy by the reviewer measured a 29.2 ms p50 iteration on a
20-iteration persistent 30,000-edge case and a 15.2 ms worker frame interval, alongside two 401s.
The iteration figure is within this section's 26.3-27.2 ms per-run spread for that arm and the
frame figure is a slightly faster frame cadence than 16.7 ms; the 401s are the reload defect
described above.

## Draft for agent-console

**Title:** Define a supported same-origin module worker asset for console panels

**Body:**

A graph panel needs to run ForceAtlas2 at 10,000 nodes without blocking the UI. Re-measured on 2026-11-21 (Chrome 159, ANGLE/Metal), one layout iteration in a persistent-matrix loop costs a median 26.6 ms at 30,000 edges and 24.8 ms at 100,000 edges on the main thread, before any rendering, and Sigma's cheapest repaint that also moves the edges adds another 10.1-29.5 ms. That is above the 16.7 ms frame budget, so the work has to leave the main thread. The library's own worker supervisor cannot help, because it creates its worker from a `blob:` that the console CSP blocks.

A module worker started from the panel's own same-origin URL does work in the console. A synthetic run kept the page at 16-17 ms frames and about 1 ms click actions while the layout ran, and positions came back as two transferred `Float32Array`s (80,000 bytes per update at 10,000 nodes), with the layout advancing at 6-51 iterations per second. Showing those positions still costs the main thread 19-25 ms per repaint at 100,000 edges, so the panel will batch updates rather than repaint every frame. The console contract does not describe that route or its lifecycle.

In the static multi-node host the same-origin property does not hold today: the panel module is
served from the node origin with an `acon_resource` grant, so a worker started from that module
is cross-origin to the page and loses the grant. The contract should say what a panel may do
there, or state that the worker route is local-host only.

Please make the same-origin panel-module worker a supported contract. Document that a panel may start a module worker from its own asset URL, and define and test the rest of it: authentication in local and static multi-node hosts, MIME type, CSP, cache and version pinning, teardown and failure behaviour. Keeping the CSP restrictive and stating that `blob:` workers stay blocked are both fine for this request. The UI project will adapt its layout worker to the documented contract and test cancellation, throughput and data transfer.

## Reproduction (spike 2)

Run the scripts below in a scratch directory with Bun 1.4.4, Playwright, Chrome, graphology 0.26.0 and graphology-layout-forceatlas2 0.10.1. Set `ACON_ROOT` to a checkout of agent-console at the commit above. The server creates an in-memory plugin and prints a one-time ticket; it does not load a vault. The sample browser executable can be adjusted for the local system. The same module runs a second, synthetic layout in a worker for the responsiveness comparison. The harness deliberately exposes probe state on `window` for Playwright.

`panel.js`:

```js
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
if (typeof document === 'undefined') {
 postMessage('same-origin-worker-ok');
 onmessage=()=>{const g=new Graph({type:'undirected'});let seed=123456;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);for(let i=0;i<10000;i++)g.addNode(String(i),{x:random()*1000,y:random()*1000,size:1});for(let i=0;i<10000;i++)for(const d of [1,17,101])g.addUndirectedEdge(String(i),String((i+d)%10000));const settings=forceAtlas2.inferSettings(g),start=performance.now();for(let i=0;i<100;i++)forceAtlas2.assign(g,{iterations:1,settings});postMessage({iterations:100,layoutMs:performance.now()-start})};
}
export default function(host) {
 const el=document.createElement('pre');el.textContent='Preparing';const button=document.createElement('button');button.textContent='Pulse';button.onclick=()=>{window.clicks=(window.clicks||0)+1};const canvas=document.createElement('canvas');canvas.width=800;canvas.height=500;host.mount.append(button,canvas,el);
 return {show(){if(window.started)return;window.started=true;(async()=>{
 const violations=[];document.addEventListener('securitypolicyviolation',e=>violations.push({directive:e.effectiveDirective,blocked:e.blockedURI}));
 const same=await new Promise(resolve=>{const w=new Worker('/p/spike/panel.js',{type:'module'});w.onmessage=e=>{resolve(e.data);w.terminate()};w.onerror=()=>resolve('error');setTimeout(()=>resolve('timeout'),3000)});
 const blob=await new Promise(resolve=>{const u=URL.createObjectURL(new Blob(['postMessage(1)'],{type:'text/javascript'}));try{const w=new Worker(u);w.onmessage=()=>{resolve('unexpected success');w.terminate()};w.onerror=()=>resolve('blocked');setTimeout(()=>resolve('timeout'),3000)}catch(e){resolve(e.name)}finally{URL.revokeObjectURL(u)}});
 const graph=new Graph({type:'undirected'});let seed=123456;const rand=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
 for(let i=0;i<10000;i++)graph.addNode(String(i),{x:rand()*1000,y:rand()*1000,size:1});
 for(let i=0;i<10000;i++)for(const d of [1,17,101])graph.addUndirectedEdge(String(i),String((i+d)%10000));
 const settings=forceAtlas2.inferSettings(graph), frames=[], iterations=[], gaps=[], deltas=[], pulses=[], elapsedAt=[];let last=0, ticks=0;
 const timer=setInterval(()=>{const now=performance.now();if(last)gaps.push(now-last);last=now;ticks++},50);
 const t0=performance.now();let prior=performance.now();window.benchmarkRunning=true;
 for(let i=0;i<100;i++) {await new Promise(requestAnimationFrame);const before=performance.now();frames.push(before-prior);prior=before;let old=0;graph.forEachNode((_,a)=>{old+=a.x*a.x+a.y*a.y});let positions=[];graph.forEachNode((_,a)=>positions.push(a.x,a.y));forceAtlas2.assign(graph,{iterations:1,settings});let ds=0,scale=0,j=0;graph.forEachNode((_,a)=>{let dx=a.x-positions[j++],dy=a.y-positions[j++];ds+=dx*dx+dy*dy;scale+=a.x*a.x+a.y*a.y});deltas.push(Math.sqrt(ds/scale));elapsedAt.push(performance.now()-t0);iterations.push(performance.now()-before);if([9,19,49,99].includes(i))pulses.push({iteration:i+1,elapsedMs:performance.now()-t0,delta:deltas.at(-1)});}
 window.benchmarkRunning=false;clearInterval(timer);const elapsed=performance.now()-t0;const stats=a=>{const s=[...a].sort((a,b)=>a-b);return {p50:s[Math.ceil(s.length*.5)-1],p95:s[Math.ceil(s.length*.95)-1],max:s.at(-1)}};
 const context=canvas.getContext('2d');let xmin=Infinity,xmax=-Infinity,ymin=Infinity,ymax=-Infinity;graph.forEachNode((_,a)=>{xmin=Math.min(xmin,a.x);xmax=Math.max(xmax,a.x);ymin=Math.min(ymin,a.y);ymax=Math.max(ymax,a.y)});context.fillStyle='#2456aa';graph.forEachNode((_,a)=>context.fillRect(10+780*(a.x-xmin)/(xmax-xmin),10+480*(a.y-ymin)/(ymax-ymin),2,2));let streak=0,firstStable=null;for(let i=0;i<deltas.length;i++){streak=deltas[i]<0.01?streak+1:0;if(streak===5){firstStable=i+1;break}};window.result={firstStable,firstStableMs:elapsedAt[firstStable-1],clicks:window.clicks||0,nodes:graph.order,edges:graph.size,settings,iterations:100,elapsed,iterationMs:stats(iterations),frameGapMs:stats(frames),timerGapMs:stats(gaps),ticks,checkpoints:pulses,same,blob,violations};el.textContent=JSON.stringify(window.result);
 const w=new Worker('/p/spike/panel.js',{type:'module'});window.workerRunning=true;let lastFrame=performance.now(),workerFrames=[];function frame(t){if(!window.workerRunning)return;workerFrames.push(t-lastFrame);lastFrame=t;requestAnimationFrame(frame)}requestAnimationFrame(frame);const ws=performance.now();w.onmessage=e=>{if(e.data==='same-origin-worker-ok'){w.postMessage('run');return}window.workerRunning=false;window.workerResult={...e.data,wallMs:performance.now()-ws,frameMs:stats(workerFrames)};w.terminate()};
 })().catch(e=>{window.failure=e.stack;el.textContent=window.failure})},hide(){},destroy(){el.remove()}};
}
```

Bundle with `bun build panel.js --target browser --format esm --outfile bundle.js`. Serve it with `server.ts`:

```ts
const {startServer} = await import(`${process.env.ACON_ROOT}/src/server.ts`);
const js = await Bun.file('bundle.js').text();
const css = 'pre { white-space: pre-wrap; }';
const manifest = {api: 1, tool: 'spike', version: '0.0.1', title: 'Spike', icon: 'vault', panels: [{id: 'graph', title: 'Graph', order: 1}], capabilities: {actions: []}};
const provider = {assets: {js, css}, async snapshot() { return {}; }, async action() { return {ok: false}; }};
const server = startServer({plugins: [{tool: 'spike', file: 'fixture', status: 'ready', manifest, provider}], version: 'test', pluginsDir: '.', log: console.error});
console.log(JSON.stringify({url: server.issue()}));
process.on('SIGTERM', async () => { await server.stop(); process.exit(0); });
```

Start `bun server.ts`; use the printed ticket URL to establish the session, then navigate to `/#/local/spike/graph`. A Playwright driver should wait for `window.benchmarkRunning`, click the `Pulse` button repeatedly with a 50 ms pause, wait for `window.result`, then click throughout `window.workerRunning`, wait for `window.workerResult`, and perform five baseline clicks. Record action durations, `window.result`, browser errors and the page screenshot. `window.workerResult` is the separate worker experiment; it does not alter the main-thread measurements. The test uses `performance.now()` for wall and frame intervals and records the CSP event before starting either worker.
