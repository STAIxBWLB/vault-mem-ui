# ForceAtlas2 layout at 10,000 nodes

## Verdict

**The tested main-thread fallback is not responsive enough for an interactive graph.** One iteration per animation frame still occupied a median 27.9 ms and p95 34.0 ms, above the 16.7 ms frame budget for 60 Hz, before rendering an interactive Sigma graph. A button click issued by Playwright during layout took 328-769 ms to complete, versus 30-35 ms after layout. Those end-to-end automation timings include Playwright overhead, but the contrast and frame delays support the conclusion for this machine and fixture. The fastest possible scheduling quantum here is already a whole iteration; yielding between iterations cannot interrupt it.

**Re-measured without probe overhead (spike 2b, last section): the numbers above are superseded, the conclusion is not.** A persistent-matrix loop with nothing else in the timed region costs a median 26.3 ms per iteration at 10,000 nodes / 30,000 edges and 23.4 ms at 100,000 edges, so iteration work alone exceeds the 16.7 ms budget at both sizes; rendering adds 2.4-4.8 ms with Sigma's cheap update path and 11-38 ms with a full refresh. Matrix reuse is worth 0.8 ms, so the earlier 27.9 ms was inflated by the unused traversal and the position and displacement copies, not by the matrix rebuild. A free-running same-origin worker holds the page at 16.7 ms frames and 1-2 ms click actions, while its layout advances at 17-44 iterations per second: enough for a settling graph, not for 60 position updates per second. The worker also showed unexplained 230-275 ms iteration bursts in 10 of 16 runs.

A same-origin module worker did start from acon's existing `panel.js` endpoint, while a `blob:` worker was blocked. A synthetic worker also ran 100 public API iterations while the page remained responsive, but this is not proof that the stock ForceAtlas2 worker supervisor can use that URL: version 0.10.1 creates its worker from a Blob. The proposed one-module contract and acon's actual available asset routes must be resolved for a supported worker integration. The task requests a draft for agent-console rather than a CSP workaround; that draft is below and has not been filed. No change to acon's CSP is implied by the same-origin result.

## Method and results

Tested Chrome 157.0.8103.78 headless on macOS, Apple M5 Max, 64 GB RAM, with acon commit `8babe31f421682670a17ee2498f485e6f9ea20a5`, graphology 0.26.0 and graphology-layout-forceatlas2 0.10.1. A synthetic graph has 10,000 nodes, 30,000 undirected edges (offsets 1, 17 and 101), deterministic seeded initial coordinates, no real note data and inferred ForceAtlas2 settings with Barnes-Hut optimization. This is one sparse graph, not the 100,000-edge worst case.

The panel repeatedly calls the public `forceAtlas2.assign(graph, {iterations: 1, settings})` once per `requestAnimationFrame` for 100 iterations. Each measurement includes copying positions, one assign call and computing displacement, but excludes drawing an interactive Sigma scene. Position snapshots, Graphology events, automation and system scheduling add overhead. Importantly, each public `assign` call rebuilds the matrices, so it resets ForceAtlas2's momentum and is **not** equivalent to a single persistent 100-iteration run or the library's worker. This measures a straightforward public API fallback, not every possible main-thread implementation. Using internal matrices could change performance and convergence and requires separate validation.

- All 100 iterations: 3,336.1 ms elapsed; iteration work p50 27.9 ms, p95 34.0 ms, max 246.2 ms; animation-frame intervals p50 28.2 ms, p95 36.1 ms, max 246.6 ms.
- A nominal 50 ms timer fired 45 times; interval p50 56.6 ms, p95 91.5 ms, max 519.1 ms. Seven actual Playwright button clicks while the layout ran took 438.4, 768.5, 343.6, 328.0, 337.3, 349.4 and 333.4 ms. Five after both layout runs took 30.8, 30.5, 34.8, 31.3 and 35.1 ms. These are automation action durations, not browser Event Timing INP and not a substitute for human input testing.
- As a reproducible movement proxy, compute `sqrt(sum((x_new-x_old)^2 + (y_new-y_old)^2) / sum(x_new^2 + y_new^2))`. The first five consecutive steps below 0.01 ended at iteration 42, 1,707.3 ms after the start. This origin-dependent heuristic is not a validated visual quality or convergence threshold. The canvas drawn after iteration 100 showed a dense cloud of points, with no edges, labels or node selection. **Time to a genuinely usable graph layout remains unverified**; the proxy must not be treated as proof of usability.
- A second worker created the same synthetic graph locally and ran 100 one-iteration public `assign` calls in 3,232.5 ms (3,252.7 ms from worker creation to reply). While it ran, frame intervals were p50 16.7 ms, p95 16.8 ms and max 16.8 ms; 39 Playwright clicks took 24.7-35.8 ms. It did not transfer graph data or positions, emit intermediate layouts, render Sigma or test the stock worker supervisor; its timing excludes the main-thread displacement probes and is not a like-for-like algorithm benchmark.
- The real acon page delivered its panel module and stylesheet from the same origin. A module worker created with `new Worker('/p/spike/panel.js', {type: 'module'})` loaded the same panel module and posted a ready message. A Blob worker produced `securitypolicyviolation` with `effectiveDirective: worker-src` and `blockedURI: blob`. Under acon's policy, absent `worker-src` falls back through `child-src` to `script-src 'self'`; this permits the same-origin URL and excludes `blob:`. This verifies a bootstrap path only; it does not test authentication renewal, static multi-node mode, other browsers, a separate worker asset, worker protocol, cancellation or transfer costs.

## Re-measurement without probe overhead (spike 2b)

### Setup

Same machine and fixture family as spike 2: Apple M5 Max, 64 GB, Chrome 159.0.8154.6 headless through Playwright 1.65.1, acon at `8babe31` serving a fixture panel from its real server and CSP, graphology 0.26.0, graphology-layout-forceatlas2 0.10.1 and Sigma 3.0.3. Synthetic graphs use spike 2's seeded generator: 10,000 nodes at pseudo-random initial coordinates, edges from fixed index offsets (30,000 edges: offsets 1, 17, 101; 100,000 edges: ten offsets), `inferSettings` with Barnes-Hut. Nothing here is real note data.

The headless browser used ANGLE over Metal, the machine's GPU. A software-WebGL (SwiftShader) pass was measured first and is not reported: its paint put a 20-frame 30,000-edge arm at a median 788 ms per frame, which is a software renderer's cost, not this algorithm's. Spike 2's layout-only numbers are unaffected by the backend choice.

APIs used, exactly, both CommonJS subpaths of 0.10.1: `graphToByteArrays` from `graphology-layout-forceatlas2/helpers` for the one-time matrix build, and `iterate(settings, NodeMatrix, EdgeMatrix)` from `graphology-layout-forceatlas2/iterate` for one step. Settings are `{...DEFAULT_SETTINGS, ...forceAtlas2.inferSettings(graph)}` from `graphology-layout-forceatlas2/defaults`, which is the merge the public `assign` performs, and `iterate` is the function `assign` calls once per iteration, so the arithmetic is identical to the public API.

### Main thread

Frame interval is the gap between the starts of consecutive animation frames; iteration is the time inside the timed call, with the movement probe computed outside it; a click is a Playwright action on a button, and handler lag is `performance.now() - event.timeStamp` inside the `pointerdown` listener. Medians over three runs (two for the sustained arms).

| arm | frames | iteration p50 / p95 / max (ms) | frame p50 / p95 / max (ms) | click p50 (n) | handler lag p50 (ms) |
|---|---|---|---|---|---|
| public `assign` per frame, 10,000 / 30,000 | 100 | 27.1 / 28.4 / 30.1 | 27.6 / 28.9 / 30.9 | 195 (33) | 27.2 |
| persistent loop, 10,000 / 30,000 | 100 | 26.3 / 27.7 / 30.1 | 26.5 / 28.0 / 30.3 | 187 (32) | 26.3 |
| persistent loop, 10,000 / 100,000 | 100 | 23.4 / 27.6 / 30.3 | 23.7 / 27.9 / 30.7 | 173 (31) | 23.3 |
| persistent + Sigma full refresh, 10,000 / 30,000 | 20 | 37.0 / 38.4 / 42.5 | 37.2 / 38.7 / 43.0 | 269 (7) | 36.6 |
| persistent + Sigma full refresh, 10,000 / 100,000 | 20 | 60.9 / 73.2 / 80.3 | 60.5 / 73.6 / 80.8 | 445 (7) | 57.4 |
| persistent + Sigma fast update, 10,000 / 30,000 | 20 | 28.7 / 29.4 / 30.1 | 28.9 / 29.6 / 30.5 | 205 (7) | 28.7 |
| persistent + Sigma fast update, 10,000 / 100,000 | 20 | 28.2 / 29.3 / 33.7 | 28.5 / 29.6 / 34.1 | 201 (7) | 28.5 |

Two Sigma update paths were measured. `sigma.refresh()` re-indexes every node and edge on each call (8.2 ms at 30,000 edges and 28.4 ms at 100,000 synchronously, with the paint landing in the browser's frame); `sigma.refresh({skipIndexation: true, partialGraph: {nodes: graph.nodes(), edges: []}})` re-indexes nodes only and is the path an animated layout should use (1.4 ms at both sizes). Position writes go straight to the node attributes without graph events, so the refresh is the only re-indexation and Sigma does not schedule a second one.

What the re-measurement changes in the earlier numbers:

- Matrix reuse is worth 0.8 ms per iteration at 30,000 edges (27.1 to 26.3 ms, p50). The rebuild was therefore not the reason the earlier figure looked high; the unused full-graph traversal and the position and displacement copies inside spike 2's timed region account for roughly another millisecond. The 27.9 ms figure was real for that loop, not a measurement artifact of a different order of magnitude.
- Resetting momentum every frame changes behaviour, not cost: the public-`assign` arm reaches the movement proxy at iteration 42 (1.1-1.7 s across runs, matching spike 2's 42 and 1,707 ms), while the persistent arm has not reached it after 100 iterations at 30,000 edges (last delta 0.011) and reaches it at iteration 90 at 100,000 edges (2.15 s). The sustained arms reach it at 112 iterations / 2.9 s (30,000) and 90 / 2.16 s (100,000). The proxy is still an origin-dependent heuristic, not a usability threshold.
- The 100,000-edge fixture is cheaper per iteration than the 30,000-edge one (23.4 against 26.3 ms p50), most likely because the stronger attraction pulls nodes into a tighter cluster and keeps the Barnes-Hut tree shallow, so the tree cost falls by more than the extra 70,000 edges add. A denser graph is not automatically the slower one.
- Iteration cost alone is above the 16.7 ms budget at both sizes, with no renderer in the loop. The conclusion does not depend on the rendering path, the probes or the matrix strategy.

### Same-origin module worker

The panel module was started as its own module worker from the page: `new Worker(new URL('./panel.js', import.meta.url), {type: 'module'})` under acon's CSP, which serves that URL as `/p/spike2b/panel.js` and allowed it. The worker builds the graph and matrices once, then runs iterations back to back in chunks of three, yielding between chunks through a `MessageChannel` (a `setTimeout` yield was also tested and showed no inter-chunk throttling either: 33 iterations per second against 36 at 30,000 edges), and posts two transferred `Float32Array`s whenever 16 ms have passed since the last post. The main thread applies the latest batch on each animation frame, writes positions into the node attributes and, when rendering, performs the fast Sigma update. Layout never blocks the main thread.

| arm (2 s unless noted) | frames | frame p50 / p95 / max (ms) | worker iteration p50 (iterations, per second) | transfer per batch | click p50 (n) | handler lag p50 (ms) |
|---|---|---|---|---|---|---|
| worker + Sigma fast, 10,000 / 30,000 | 120 | 16.7 / 20.1 / 20.6 | 28.2 (33, 16.6/s) | 80,000 B | 2.0 (108) | 0.1 |
| worker + Sigma fast, 10,000 / 100,000 | 120 | 16.7 / 19.1 / 20.4 | 27.9 (33, 16.7/s) | 80,000 B | 1.0 (111) | 0.1 |
| worker, no render, 10,000 / 30,000 | 120 | 16.7 / 19.0 / 20.0 | 28.1 (48, 24.3/s) | 80,000 B | 2.0 (109) | 0.1 |
| worker, no render, 10,000 / 100,000 | 120 | 16.7 / 19.0 / 19.6 | 28.0 (72, 36.2/s) | 80,000 B | 1.0 (111) | 0.1 |
| worker, 3 s soak, 10,000 / 30,000 | 182 | 16.7 / 18.3 / 19.6 | 27.5 (73.5, 24.4/s) | 80,000 B | 1.0 (111) | 0.1 |
| worker, 3 s soak, 10,000 / 100,000 | 182 | 16.7 / 17.2 / 18.9 | 21.7 (132, 43.9/s) | 80,000 B | 1.0 (112) | 0.1 |

Worker initialisation, which builds the graph and the matrices from transferred arrays, took 74-99 ms. Each position batch is 80,000 bytes, transferred rather than copied.

The page stays at 60 Hz in every worker arm and input latency drops to about a millisecond, against 21-29 ms of handler lag and 150-195 ms of click action on the main thread. Click figures are Playwright action durations, which include the driver's actionability checks; they are a latency proxy, not browser Event Timing INP. Layout throughput is the price: 17-44 iterations per second. A graph that needs tens of iterations to settle takes one to three seconds, which is acceptable for a settling layout and cannot deliver 60 position updates per second.

**An unexplained cost burst runs through the worker numbers.** In 10 of 16 worker runs, iterations jump from about 30 ms to 230-275 ms in bursts of two to five consecutive iterations and then return to about 30 ms. On the main thread only the first iteration of a case ever exceeded 100 ms (255-265 ms, a warm-up effect in 2 of 25 runs). Three candidate causes were checked and none explains it:

- Thread CPU throughput is the same: a 20-million-iteration floating-point probe took 10.4 ms p50 on the main thread and 10.6 ms in the worker.
- It is not timer throttling: the gap between iteration chunks stayed at 0.1-0.4 ms p50 (max 6.1 ms) with both the `MessageChannel` and `setTimeout` yield styles.
- It is not the worker heap limit: a run with `--js-flags=--max-old-space-size=4096` still produced 230-243 ms iterations between 27-38 ms ones.

Garbage collection inside the worker's heap is the leading explanation, since each `iterate` call allocates its region array and the worker holds its own matrices, but that is a hypothesis and not a measurement. Until it is settled with a longer soak and `--js-flags=--trace-gc`, the worker's median iteration time understates its average: the p50 of 28 ms coexists with 17 iterations per second, because the bursts consume the rest.

### Verdict for the worker decision

- A main-thread fallback does not fit a 60 Hz budget at 10,000 nodes, at 30,000 or 100,000 edges, even before rendering: 23-26 ms per iteration, 38-43 frames per second ceiling, and a Sigma fast update adds 2-5 ms.
- Removing the probe overhead and reusing matrices improves the figure by about 1 ms, so the earlier verdict was right for the wrong reason: the cost is the algorithm iteration itself, and no scheduling inside the iteration can cut it below a whole iteration.
- A same-origin module worker keeps the page at 60 Hz and input at about 1 ms, and its iteration cost is the same as the main thread's. The stock 0.10.1 supervisor is still not usable because it creates its worker from a `blob:`; the same-origin panel-module worker is the supported path this project can use.
- The unexplained bursts mean the worker's throughput is not bounded by the p50. A production layout needs a soak test, and possibly a smaller chunk size or a longer term between batches, before the panel depends on it.

### Reproduction (spike 2b)

Bun 1.4.4, `graphology@0.26.0`, `graphology-layout-forceatlas2@0.10.1`, `sigma@3.0.3`, `playwright@1.65.1`. The harness lives outside the repository; the panel below is the persistent loop and the worker branch, with the measurement scaffolding removed.

```js
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import DEFAULT_SETTINGS from 'graphology-layout-forceatlas2/defaults';
import iterate from 'graphology-layout-forceatlas2/iterate';
import {graphToByteArrays} from 'graphology-layout-forceatlas2/helpers';

// One build, one step per frame.
const graph = makeGraph(10000, [1, 17, 101]);          // order, edge offsets: 30,000 edges
const settings = {...DEFAULT_SETTINGS, ...forceAtlas2.inferSettings(graph)};
const mats = graphToByteArrays(graph, () => 1);
for (let i = 0; i < 100; i++) {
  await new Promise(requestAnimationFrame);
  iterate(settings, mats.nodes, mats.edges);          // timed
  if (rendering) {
    writeBack(graph, mats);                            // node attributes, no events
    sigma.refresh({skipIndexation: true, partialGraph: {nodes: graph.nodes(), edges: []}});
  }
}
```

The worker branch of the same module, selected by `typeof document === 'undefined'`, builds the graph from the transferred node positions and edge pairs, runs `iterate` in chunks of three, yields with `channel.port2.postMessage(0)`, and posts two `Float32Array`s (80,000 bytes at 10,000 nodes) every 16 ms. The page mounts it with `new Worker(new URL('./panel.js', import.meta.url), {type: 'module'})` and applies the newest batch on each animation frame.

Bundle with `bun build panel.js --target browser --format esm --outfile bundle.js` and serve it through the acon fixture from the spike-2 reproduction (`startServer` with an in-memory plugin, ticket URL, then `/#/local/spike2b/graph`). Launch Playwright with `--use-gl=angle --use-angle=metal`; the software path is not comparable. The driver clicks the `Pulse` button every 50 ms while `window.caseRunning` is true and records action durations, then reads `window.result` for per-case distributions.

## Draft for agent-console

**Title:** Define a supported same-origin module worker asset for console panels

**Body:**

A graph panel needs to run ForceAtlas2 at 10,000 nodes without blocking the UI. Re-measured on 2026-11-21 (Chrome 159, ANGLE/Metal), one layout iteration in a persistent-matrix loop costs a median 26.3 ms at 30,000 edges and 23.4 ms at 100,000 edges on the main thread, before any rendering. That is above the 16.7 ms frame budget, so the work has to leave the main thread. The library's own worker supervisor cannot help, because it creates its worker from a `blob:` that the console CSP blocks.

A module worker started from the panel's own same-origin URL does work in the console. A synthetic run kept the page at 16.7 ms frames and about 1 ms click actions while the layout ran, and positions came back as two transferred `Float32Array`s (80,000 bytes per update at 10,000 nodes). The console contract does not describe that route or its lifecycle.

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
