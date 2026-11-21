# ForceAtlas2 layout at 10,000 nodes

## Verdict

**The tested main-thread fallback is not responsive enough for an interactive graph.** One iteration per animation frame still occupied a median 27.9 ms and p95 34.0 ms, above the 16.7 ms frame budget for 60 Hz, before rendering an interactive Sigma graph. A button click issued by Playwright during layout took 328-769 ms to complete, versus 30-35 ms after layout. Those end-to-end automation timings include Playwright overhead, but the contrast and frame delays support the conclusion for this machine and fixture. The fastest possible scheduling quantum here is already a whole iteration; yielding between iterations cannot interrupt it.

A same-origin module worker did start from acon's existing `panel.js` endpoint, while a `blob:` worker was blocked. A synthetic worker also ran 100 public API iterations while the page remained responsive, but this is not proof that the stock ForceAtlas2 worker supervisor can use that URL: version 0.10.1 creates its worker from a Blob. The proposed one-module contract and acon's actual available asset routes must be resolved for a supported worker integration. The task requests a draft for agent-console rather than a CSP workaround; that draft is below and has not been filed. No change to acon's CSP is implied by the same-origin result.

## Method and results

Tested Chrome 157.0.8103.78 headless on macOS, Apple M5 Max, 64 GB RAM, with acon commit `8babe31f421682670a17ee2498f485e6f9ea20a5`, graphology 0.26.0 and graphology-layout-forceatlas2 0.10.1. A synthetic graph has 10,000 nodes, 30,000 undirected edges (offsets 1, 17 and 101), deterministic seeded initial coordinates, no real note data and inferred ForceAtlas2 settings with Barnes-Hut optimization. This is one sparse graph, not the 100,000-edge worst case.

The panel repeatedly calls the public `forceAtlas2.assign(graph, {iterations: 1, settings})` once per `requestAnimationFrame` for 100 iterations. Each measurement includes copying positions, one assign call and computing displacement, but excludes drawing an interactive Sigma scene. Position snapshots, Graphology events, automation and system scheduling add overhead. Importantly, each public `assign` call rebuilds the matrices, so it resets ForceAtlas2's momentum and is **not** equivalent to a single persistent 100-iteration run or the library's worker. This measures a straightforward public API fallback, not every possible main-thread implementation. Using internal matrices could change performance and convergence and requires separate validation.

- All 100 iterations: 3,336.1 ms elapsed; iteration work p50 27.9 ms, p95 34.0 ms, max 246.2 ms; animation-frame intervals p50 28.2 ms, p95 36.1 ms, max 246.6 ms.
- A nominal 50 ms timer fired 45 times; interval p50 56.6 ms, p95 91.5 ms, max 519.1 ms. Seven actual Playwright button clicks while the layout ran took 438.4, 768.5, 343.6, 328.0, 337.3, 349.4 and 333.4 ms. Five after both layout runs took 30.8, 30.5, 34.8, 31.3 and 35.1 ms. These are automation action durations, not browser Event Timing INP and not a substitute for human input testing.
- As a reproducible movement proxy, compute `sqrt(sum((x_new-x_old)^2 + (y_new-y_old)^2) / sum(x_new^2 + y_new^2))`. The first five consecutive steps below 0.01 ended at iteration 42, 1,707.3 ms after the start. This origin-dependent heuristic is not a validated visual quality or convergence threshold. The canvas drawn after iteration 100 showed a dense cloud of points, with no edges, labels or node selection. **Time to a genuinely usable graph layout remains unverified**; the proxy must not be treated as proof of usability.
- A second worker created the same synthetic graph locally and ran 100 one-iteration public `assign` calls in 3,232.5 ms (3,252.7 ms from worker creation to reply). While it ran, frame intervals were p50 16.7 ms, p95 16.8 ms and max 16.8 ms; 39 Playwright clicks took 24.7-35.8 ms. It did not transfer graph data or positions, emit intermediate layouts, render Sigma or test the stock worker supervisor; its timing excludes the main-thread displacement probes and is not a like-for-like algorithm benchmark.
- The real acon page delivered its panel module and stylesheet from the same origin. A module worker created with `new Worker('/p/spike/panel.js', {type: 'module'})` loaded the same panel module and posted a ready message. A Blob worker produced `securitypolicyviolation` with `effectiveDirective: worker-src` and `blockedURI: blob`. Under acon's policy, absent `worker-src` falls back through `child-src` to `script-src 'self'`; this permits the same-origin URL and excludes `blob:`. This verifies a bootstrap path only; it does not test authentication renewal, static multi-node mode, other browsers, a separate worker asset, worker protocol, cancellation or transfer costs.

## Draft for agent-console

**Title:** Define a supported same-origin module worker asset for console panels

**Body:**

A graph panel needs to run ForceAtlas2 at 10,000 nodes without blocking the UI. A synthetic main-thread probe exceeded a 16.7 ms frame budget even with one iteration per frame. The existing console CSP blocks the library's Blob worker. A same-origin module worker loaded from a panel module in a local synthetic fixture, but the console contract does not describe worker assets or their lifecycle.

Please define and test a supported same-origin module worker loading mechanism for plugin panels, including authentication in local and static multi-node hosts, MIME type, CSP, cache/version pinning, teardown and failure behavior. Keep the CSP restrictive and document the plugin asset and conformance requirements. The UI project will need to adapt its layout worker to the supported contract and test cancellation and data transfer. This request does not require allowing `blob:` or broadening external origins.

## Reproduction

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
