import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import DEFAULT_SETTINGS from 'graphology-layout-forceatlas2/defaults';
import iterate from 'graphology-layout-forceatlas2/iterate';
import { graphToByteArrays } from 'graphology-layout-forceatlas2/helpers';
import { EDGE_SETS, makeGraph, toTransferArrays, writePositions } from './graph.js';

const PROXY_THRESHOLD = 0.01;
const PROXY_STREAK = 5;

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * q) - 1)];
  return { p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1], n: sorted.length };
}

function proxyDelta(prevX, prevY, x, y) {
  let moved = 0;
  let scale = 0;
  for (let j = 0; j < x.length; j++) {
    const dx = x[j] - prevX[j];
    const dy = y[j] - prevY[j];
    moved += dx * dx + dy * dy;
    scale += x[j] * x[j] + y[j] * y[j];
  }
  return Math.sqrt(moved / (scale || 1));
}

function readPositions(matrix, stride, order) {
  const x = new Float32Array(order);
  const y = new Float32Array(order);
  for (let n = 0, j = 0; n < matrix.length && j < order; n += stride, j += 1) {
    x[j] = matrix[n];
    y[j] = matrix[n + 1];
  }
  return { x, y };
}

function settingsFor(graph) {
  return { ...DEFAULT_SETTINGS, ...forceAtlas2.inferSettings(graph) };
}

// Sigma 3.0.3 repaint paths. 'nodesonly' is the path that was reported earlier and it is
// wrong for a rendered graph: with skipIndexation it calls addNodeToProgram only, while
// edge geometry lives in the edge programs and is uploaded by addEdgeToProgram, so edges
// keep the endpoints they had at the last process(). It is kept only to measure that.
function refreshSigma(sigma, graph, mode) {
  if (mode === 'full') {
    sigma.refresh();
  } else if (mode === 'nodesonly') {
    sigma.refresh({ skipIndexation: true, partialGraph: { nodes: graph.nodes(), edges: [] } });
  } else if (mode === 'edges') {
    sigma.refresh({ skipIndexation: true, partialGraph: { nodes: graph.nodes(), edges: graph.edges() } });
  } else {
    throw new Error(`unknown render mode ${mode}`);
  }
}

async function mountSigma(graph) {
  const { default: Sigma } = await import('sigma');
  const el = document.getElementById('graph');
  return new Sigma(graph, el, {
    renderEdgeLabels: false,
    labelRenderedSizeThreshold: 1e9,
    defaultNodeColor: '#2456aa',
    defaultEdgeColor: '#c9d2e3'
  });
}

function cpuBench() {
  const samples = [];
  let acc = 0;
  for (let s = 0; s < 5; s++) {
    const before = performance.now();
    for (let i = 0; i < 20_000_000; i++) acc += Math.sqrt(i);
    samples.push(performance.now() - before);
  }
  if (acc < 0) throw new Error('unreachable');
  return stats(samples);
}

function clickProbe() {
  window.clicks = 0;
  window.handlerLag = [];
  const button = document.getElementById('pulse');
  button.addEventListener('pointerdown', (event) => {
    window.clicks += 1;
    window.handlerLag.push(performance.now() - event.timeStamp);
  });
}

function proxySummary(deltas, iterationCounts, elapsedAt) {
  let streak = 0;
  let firstStable = null;
  for (let i = 0; i < deltas.length; i++) {
    streak = deltas[i] < PROXY_THRESHOLD ? streak + 1 : 0;
    if (streak === PROXY_STREAK) {
      firstStable = i + 1;
      break;
    }
  }
  return {
    proxyReached: firstStable !== null,
    firstStableStep: firstStable,
    firstStableIteration: firstStable === null ? null : iterationCounts[firstStable - 1],
    firstStableMs: firstStable === null ? null : elapsedAt[firstStable - 1],
    lastDelta: deltas.length ? deltas[deltas.length - 1] : null
  };
}

// Proves which repaint paths update edge geometry: the edges are re-uploaded with the
// endpoints they are drawn from, so a path that skips that call leaves them behind.
async function measureEdgeCorrectness() {
  const order = 10000;
  const graph = makeGraph(order, 'sparse');
  const sigma = await mountSigma(graph);
  const mats = graphToByteArrays(graph, () => 1);
  const stride = mats.nodes.length / graph.order;
  const settings = settingsFor(graph);
  const step = () => {
    iterate(settings, mats.nodes, mats.edges);
    writePositions(graph, mats.nodes, stride);
  };
  for (let i = 0; i < 5; i++) step();
  sigma.refresh();

  const proto = Object.getPrototypeOf(sigma);
  const originalAdd = proto.addEdgeToProgram;
  let uploads = new Map();
  let uploadCount = 0;
  proto.addEdgeToProgram = function (edge, fingerprint, position) {
    const [source, target] = this.graph.extremities(edge);
    const sourceData = this.nodeDataCache[source];
    const targetData = this.nodeDataCache[target];
    uploads.set(edge, { sx: sourceData.x, sy: sourceData.y, tx: targetData.x, ty: targetData.y });
    uploadCount += 1;
    return originalAdd.call(this, edge, fingerprint, position);
  };

  const sample = graph.edges().slice(0, 2000);
  const modes = [];
  for (const mode of ['nodesonly', 'edges', 'full']) {
    for (let i = 0; i < 5; i++) step();
    const stale = new Map();
    for (const edge of sample) {
      const [source, target] = graph.extremities(edge);
      if (!stale.has(source)) stale.set(source, sigma.getNodeDisplayData(source));
      if (!stale.has(target)) stale.set(target, sigma.getNodeDisplayData(target));
    }
    uploads = new Map();
    uploadCount = 0;
    const before = performance.now();
    refreshSigma(sigma, graph, mode);
    const refreshMs = performance.now() - before;
    let endpointError = 0;
    let nodeMove = 0;
    for (const [node, point] of stale) {
      const after = sigma.getNodeDisplayData(node);
      const moved = Math.hypot(after.x - point.x, after.y - point.y);
      if (moved > nodeMove) nodeMove = moved;
    }
    for (const edge of sample) {
      const [source, target] = graph.extremities(edge);
      const afterSource = sigma.getNodeDisplayData(source);
      const afterTarget = sigma.getNodeDisplayData(target);
      const drawn = uploads.get(edge) || {
        sx: stale.get(source).x,
        sy: stale.get(source).y,
        tx: stale.get(target).x,
        ty: stale.get(target).y
      };
      const error = Math.max(
        Math.hypot(drawn.sx - afterSource.x, drawn.sy - afterSource.y),
        Math.hypot(drawn.tx - afterTarget.x, drawn.ty - afterTarget.y)
      );
      if (error > endpointError) endpointError = error;
    }
    modes.push({
      mode,
      refreshMs,
      edgeUploads: uploadCount,
      expectedEdgeUploads: graph.size,
      sampledEdges: sample.length,
      nodeMove,
      maxEndpointError: endpointError,
      endpointErrorRatio: nodeMove ? endpointError / nodeMove : 0
    });
  }
  proto.addEdgeToProgram = originalAdd;
  sigma.kill();
  return { label: 'edge-correctness', nodes: graph.order, edges: graph.size, order, modes };
}

async function runMainCase({ label, order, edgeSet, render, baseline, maxIterations, sustainMs }) {
  const graph = makeGraph(order, edgeSet);
  const settings = settingsFor(graph);
  const mats = baseline ? null : graphToByteArrays(graph, () => 1);
  const stride = mats ? mats.nodes.length / graph.order : 0;
  const sigma = render ? await mountSigma(graph) : null;
  let renderOnlyMs = null;
  if (sigma) {
    const samples = [];
    for (let i = 0; i < 3; i++) {
      writePositions(graph, mats.nodes, stride);
      const before = performance.now();
      refreshSigma(sigma, graph, render);
      samples.push(performance.now() - before);
    }
    samples.sort((a, b) => a - b);
    renderOnlyMs = samples[1];
  }
  const iterations = [];
  const frames = [];
  const deltas = [];
  const iterationCounts = [];
  const elapsedAt = [];
  let prev = null;
  if (!baseline) {
    prev = readPositions(mats.nodes, stride, order);
  } else {
    const nodes = graph.nodes();
    prev = {
      x: Float32Array.from(nodes.map((node) => graph.getNodeAttribute(node, 'x'))),
      y: Float32Array.from(nodes.map((node) => graph.getNodeAttribute(node, 'y')))
    };
  }
  clickProbe();
  window.caseLabel = label;
  window.caseRunning = true;
  const t0 = performance.now();
  let prior = t0;
  for (let i = 0; maxIterations === null || i < maxIterations; i++) {
    if (sustainMs && performance.now() - t0 >= sustainMs) break;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const before = performance.now();
    frames.push(before - prior);
    prior = before;
    if (baseline) {
      forceAtlas2.assign(graph, { iterations: 1, settings });
    } else {
      iterate(settings, mats.nodes, mats.edges);
      if (render) {
        writePositions(graph, mats.nodes, stride);
        refreshSigma(sigma, graph, render);
      }
    }
    iterations.push(performance.now() - before);
    // Probe outside the timed region.
    let next;
    if (baseline) {
      const nodes = graph.nodes();
      next = {
        x: Float32Array.from(nodes.map((node) => graph.getNodeAttribute(node, 'x'))),
        y: Float32Array.from(nodes.map((node) => graph.getNodeAttribute(node, 'y')))
      };
    } else {
      next = readPositions(mats.nodes, stride, order);
    }
    deltas.push(proxyDelta(prev.x, prev.y, next.x, next.y));
    iterationCounts.push(i + 1);
    elapsedAt.push(performance.now() - t0);
    prev = next;
    if (deltas.length >= PROXY_STREAK && deltas.slice(-PROXY_STREAK).every((value) => value < PROXY_THRESHOLD)) break;
  }
  window.caseRunning = false;
  const elapsed = performance.now() - t0;
  if (sigma) sigma.kill();
  return {
    label,
    nodes: graph.order,
    edges: graph.size,
    edgeSet,
    render: render || false,
    baseline: Boolean(baseline),
    renderOnlyMs,
    elapsedMs: elapsed,
    iterationMs: stats(iterations),
    iterationSeries: iterations.slice(0, 10).map((value) => Math.round(value * 10) / 10),
    frameGapMs: stats(frames),
    framesMeasured: iterations.length,
    clicks: window.clicks,
    handlerLagMs: window.handlerLag.length ? stats(window.handlerLag) : null,
    ...proxySummary(deltas, iterationCounts, elapsedAt)
  };
}

async function runWorkerCase({ label, order, edgeSet, render, maxFrames, sustainMs, batchMs }) {
  const graph = makeGraph(order, edgeSet);
  const transfer = toTransferArrays(graph);
  const sigma = render ? await mountSigma(graph) : null;
  const worker = new Worker(new URL('./panel.js', import.meta.url), { type: 'module' });
  const waiters = {};
  const wait = (type, ms = 20_000) =>
    new Promise((resolve) => {
      const timer = setTimeout(() => {
        delete waiters[type];
        resolve({ type: 'timeout' });
      }, ms);
      waiters[type] = (value) => {
        clearTimeout(timer);
        delete waiters[type];
        resolve(value);
      };
    });
  let latest = null;
  let latestSeq = 0;
  const transferBytes = [];
  const workerTimings = [];
  const workerGaps = [];
  const workerDeltas = [];
  const workerCounts = [];
  const workerBatchAt = [];
  const applyCosts = [];
  const batchCosts = [];
  const renderCosts = [];
  worker.onmessageerror = () => {
    window.workerFailure = 'worker messageerror';
  };
  worker.onerror = (event) => {
    window.workerFailure = 'worker error: ' + (event && event.message ? event.message : 'unknown');
    for (const key of Object.keys(waiters)) waiters[key]({ type: 'error' });
  };
  worker.onmessage = (event) => {
    const message = event.data;
    if (message.type === 'boot') {
      window.workerBoot = message.href;
      return;
    }
    if (message.type === 'failure') {
      window.workerFailure = `worker failure: ${message.error || 'unknown error'}`;
      for (const key of Object.keys(waiters)) waiters[key]({ type: 'error' });
      return;
    }
    if (message.type === 'batch') {
      latest = message;
      latestSeq += 1;
      transferBytes.push(message.x.byteLength + message.y.byteLength);
      for (const value of message.iterations) workerTimings.push(value);
      if (message.gaps) for (const value of message.gaps) workerGaps.push(value);
      if (typeof message.delta === 'number') {
        workerDeltas.push(message.delta);
        workerCounts.push(message.iterationCount);
        workerBatchAt.push(performance.now());
      }
      return;
    }
    if (waiters[message.type]) waiters[message.type](message);
  };

  const yieldMode =
    (window.__spikeConfig && window.__spikeConfig.yieldMode) || new URLSearchParams(location.search).get('workerYield') || 'channel';
  const cpuPromise = wait('cpu');
  worker.postMessage({ type: 'cpu' });
  const cpuResult = await cpuPromise;
  const setupStart = performance.now();
  const readyPromise = wait('ready');
  worker.postMessage({ type: 'init', order, edgePairs: transfer.edgePairs, x: transfer.x, y: transfer.y, yieldMode, batchMs }, [
    transfer.edgePairs.buffer,
    transfer.x.buffer,
    transfer.y.buffer
  ]);
  const ready = await readyPromise;
  const setupMs = performance.now() - setupStart;
  if (ready.type !== 'ready') { worker.terminate(); if (sigma) sigma.kill(); throw new Error(window.workerFailure || 'worker init failed: ' + JSON.stringify(ready)); }

  const frames = [];
  let appliedSeq = 0;
  clickProbe();
  window.caseLabel = label;
  window.caseRunning = true;
  worker.postMessage({ type: 'start' });
  const t0 = performance.now();
  let prior = t0;
  for (let i = 0; maxFrames === null || i < maxFrames; i++) {
    if (window.workerFailure || (sustainMs && performance.now() - t0 >= sustainMs)) break;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (window.workerFailure) break;
    const frameStart = performance.now();
    frames.push(frameStart - prior);
    prior = frameStart;
    let applied = false;
    if (latest && latestSeq !== appliedSeq) {
      appliedSeq = latestSeq;
      applied = true;
      const x = latest.x;
      const y = latest.y;
      let n = 0;
      graph.forEachNode((_node, attr) => {
        attr.x = x[n];
        attr.y = y[n];
        n += 1;
      });
      if (render) {
        const before = performance.now();
        refreshSigma(sigma, graph, render);
        renderCosts.push(performance.now() - before);
      }
    }
    applyCosts.push(performance.now() - frameStart);
    if (applied) batchCosts.push(performance.now() - frameStart);
    if (workerDeltas.length >= PROXY_STREAK && workerDeltas.slice(-PROXY_STREAK).every((value) => value < PROXY_THRESHOLD)) break;
  }
  window.caseRunning = false;
  if (window.workerFailure) { worker.terminate(); if (sigma) sigma.kill(); throw new Error(window.workerFailure); }
  const elapsed = performance.now() - t0;
  const stoppedPromise = wait('stopped', 60_000);
  worker.postMessage({ type: 'stop' });
  const stopped = await stoppedPromise;
  if (stopped.type !== 'stopped') { worker.terminate(); if (sigma) sigma.kill(); throw new Error(window.workerFailure || 'worker did not stop'); }
  for (const value of stopped.iterations || []) workerTimings.push(value);
  if (stopped.gaps) for (const value of stopped.gaps) workerGaps.push(value);
  worker.terminate();
  if (sigma) sigma.kill();
  return {
    label,
    nodes: graph.order,
    edges: graph.size,
    edgeSet,
    render: render || false,
    batchMs,
    setupMs,
    elapsedMs: elapsed,
    iterationMs: workerTimings.length ? stats(workerTimings) : null,
    iterationSeries: workerTimings.slice(0, 10).map((value) => Math.round(value * 10) / 10),
    iterationCount: workerTimings.length,
    iterationsPerSecond: workerTimings.length / (elapsed / 1000),
    yieldGapMs: workerGaps.length > 1 ? stats(workerGaps.slice(1)) : null,
    yieldMode,
    frameCostMs: stats(applyCosts),
    batchFrameCostMs: batchCosts.length ? stats(batchCosts) : null,
    batchFrames: batchCosts.length,
    batchFrameShare: frames.length ? batchCosts.length / frames.length : 0,
    renderCostMs: renderCosts.length ? stats(renderCosts) : null,
    frameGapMs: stats(frames),
    framesMeasured: frames.length,
    cpuBenchMs: cpuResult.stats || null,
    batches: transferBytes.length,
    transferBytes: transferBytes.length ? stats(transferBytes) : null,
    clicks: window.clicks,
    handlerLagMs: window.handlerLag.length ? stats(window.handlerLag) : null,
    ...proxySummary(
      workerDeltas,
      workerCounts,
      workerBatchAt.map((at) => at - t0)
    )
  };
}

if (typeof document === 'undefined') {
  self.postMessage({ type: 'boot', href: self.location.href });
  let graph = null;
  let mats = null;
  let settings = null;
  let order = 0;
  let stride = 0;
  let running = false;
  let timings = [];
  let gaps = [];
  let lastPost = 0;
  let lastEnd = 0;
  let totalIterations = 0;
  let batchMs = 16;
  let yieldMode = 'channel';
  let prevX = null;
  let prevY = null;
  const channel = new MessageChannel();
  const CHUNK = 3;
  channel.port1.onmessage = () => loop();

  function postBatch() {
    const outX = new Float32Array(order);
    const outY = new Float32Array(order);
    for (let n = 0, j = 0; n < mats.nodes.length && j < order; n += stride, j += 1) {
      outX[j] = mats.nodes[n];
      outY[j] = mats.nodes[n + 1];
    }
    let delta = null;
    if (prevX) delta = proxyDelta(prevX, prevY, outX, outY);
    if (!prevX) {
      prevX = new Float32Array(order);
      prevY = new Float32Array(order);
    }
    prevX.set(outX);
    prevY.set(outY);
    self.postMessage(
      { type: 'batch', x: outX, y: outY, iterations: timings.splice(0), gaps: gaps.splice(0), delta, iterationCount: totalIterations },
      [outX.buffer, outY.buffer]
    );
  }

  function loop() {
    if (!running) return;
    try {
      gaps.push(lastEnd ? performance.now() - lastEnd : 0);
      for (let i = 0; i < CHUNK; i++) {
        const before = performance.now();
        iterate(settings, mats.nodes, mats.edges);
        timings.push(performance.now() - before);
        totalIterations += 1;
        const now = performance.now();
        if (now - lastPost >= batchMs) {
          lastPost = now;
          postBatch();
        }
      }
    } catch (error) {
      running = false;
      self.postMessage({ type: 'failure', error: String(error && error.stack ? error.stack : error) });
      return;
    }
    lastEnd = performance.now();
    if (yieldMode === 'channel') channel.port2.postMessage(0);
    else setTimeout(loop, 0);
  }

  self.onmessage = (event) => {
    const message = event.data;
    try {
      if (message.type === 'init') {
        order = message.order;
        yieldMode = message.yieldMode || 'channel';
        batchMs = message.batchMs || 16;
        graph = new Graph({ type: 'undirected', multi: true });
        for (let i = 0; i < order; i++) graph.addNode(String(i), { x: message.x[i], y: message.y[i], size: 1 });
        for (let i = 0; i < message.edgePairs.length; i += 2) {
          graph.addUndirectedEdge(String(message.edgePairs[i]), String(message.edgePairs[i + 1]));
        }
        settings = settingsFor(graph);
        mats = graphToByteArrays(graph, () => 1);
        stride = mats.nodes.length / graph.order;
        self.postMessage({ type: 'ready', order, edges: graph.size, settings });
        return;
      }
      if (message.type === 'cpu') {
        self.postMessage({ type: 'cpu', stats: cpuBench() });
        return;
      }
      if (message.type === 'start') {
        if (!running) {
          running = true;
          timings = [];
          gaps = [];
          lastPost = 0;
          lastEnd = 0;
          totalIterations = 0;
          prevX = null;
          prevY = null;
          if (yieldMode === 'channel') channel.port2.postMessage(0);
          else setTimeout(loop, 0);
        }
        return;
      }
      if (message.type === 'stop') {
        running = false;
        self.postMessage({ type: 'stopped', iterations: timings.splice(0), gaps: gaps.splice(0) });
        return;
      }
    } catch (error) {
      self.postMessage({ type: 'failure', error: String(error && error.stack ? error.stack : error) });
    }
  };
}

export default function (host) {
  const panel = document.createElement('div');
  panel.className = 'spike';
  const button = document.createElement('button');
  button.id = 'pulse';
  button.textContent = 'Pulse';
  const graphEl = document.createElement('div');
  graphEl.id = 'graph';
  graphEl.className = 'graph';
  const log = document.createElement('pre');
  panel.append(button, graphEl, log);
  host.mount.append(panel);

  const mainCases = [
    { label: 'public-assign-10k-30k', order: 10000, edgeSet: 'sparse', baseline: true },
    { label: 'persistent-10k-30k', order: 10000, edgeSet: 'sparse' },
    { label: 'persistent-10k-100k', order: 10000, edgeSet: 'dense' },
    { label: 'sigma-full-10k-30k', order: 10000, edgeSet: 'sparse', render: 'full', maxIterations: 150 },
    { label: 'sigma-full-10k-100k', order: 10000, edgeSet: 'dense', render: 'full', maxIterations: 150 },
    { label: 'sigma-edges-10k-30k', order: 10000, edgeSet: 'sparse', render: 'edges', maxIterations: 150 },
    { label: 'sigma-edges-10k-100k', order: 10000, edgeSet: 'dense', render: 'edges', maxIterations: 150 },
    { label: 'sigma-nodesonly-10k-30k', order: 10000, edgeSet: 'sparse', render: 'nodesonly', maxIterations: 150 },
    { label: 'sustain-main-10k-30k', order: 10000, edgeSet: 'sparse', maxIterations: null, sustainMs: 3000 },
    { label: 'sustain-main-10k-100k', order: 10000, edgeSet: 'dense', maxIterations: null, sustainMs: 3000 }
  ];
  const workerCases = [
    { label: 'worker-norender-10k-30k', order: 10000, edgeSet: 'sparse', maxFrames: 400 },
    { label: 'worker-norender-10k-100k', order: 10000, edgeSet: 'dense', maxFrames: 400 },
    { label: 'worker-sigma-16ms-10k-30k', order: 10000, edgeSet: 'sparse', render: 'edges', batchMs: 16, maxFrames: 400 },
    { label: 'worker-sigma-16ms-10k-100k', order: 10000, edgeSet: 'dense', render: 'edges', batchMs: 16, maxFrames: 400 },
    { label: 'worker-sigma-100ms-10k-100k', order: 10000, edgeSet: 'dense', render: 'edges', batchMs: 100, maxFrames: 400 },
    { label: 'sustain-worker-10k-30k', order: 10000, edgeSet: 'sparse', maxFrames: null, sustainMs: 3000 },
    { label: 'sustain-worker-10k-100k', order: 10000, edgeSet: 'dense', maxFrames: null, sustainMs: 3000 }
  ];

  return {
    show() {
      if (window.started) return;
      window.started = true;
      (async () => {
        // The driver injects window.__spikeConfig; URL parameters are the fallback.
        const cfg = window.__spikeConfig || {};
        const params = new URLSearchParams(location.search);
        const iterations = Number(cfg.iterations ?? params.get('iterations') ?? 100);
        const runsPerCase = Number(cfg.runs ?? params.get('runs') ?? 3);
        const only = String(cfg.cases ?? params.get('cases') ?? '')
          .split(',')
          .filter(Boolean);
        const keep = (label) => only.length === 0 || only.some((entry) => label.includes(entry));
        const results = [];
        window.partialResults = results;
        if (keep('cpu-probe')) {
          window.caseLabel = 'cpu-probe-main';
          results.push({ label: 'cpu-probe-main', run: 1, cpuBenchMs: cpuBench() });
        }
        if (keep('edge-correctness')) {
          log.textContent = 'edge-correctness';
          results.push({ ...(await measureEdgeCorrectness()), run: 1 });
        }
        for (const spec of mainCases.filter((spec) => keep(spec.label))) {
          const runsForSpec = spec.sustainMs ? Math.min(runsPerCase, 2) : runsPerCase;
          for (let run = 1; run <= runsForSpec; run++) {
            log.textContent = `${spec.label} run ${run}`;
            results.push({
              ...(await runMainCase({ ...spec, maxIterations: spec.sustainMs ? null : (spec.maxIterations ?? iterations) })),
              run
            });
          }
        }
        for (const spec of workerCases.filter((spec) => keep(spec.label))) {
          const runsForSpec = spec.sustainMs ? Math.min(runsPerCase, 2) : runsPerCase;
          for (let run = 1; run <= runsForSpec; run++) {
            log.textContent = `${spec.label} run ${run}`;
            results.push({ ...(await runWorkerCase({ ...spec, batchMs: spec.batchMs ?? 16 })), run });
          }
        }
        if (window.workerFailure) log.textContent = 'worker failure: ' + window.workerFailure;
        window.result = {
          env: {
            userAgent: navigator.userAgent,
            iterations,
            runsPerCase,
            edgeSets: EDGE_SETS,
            devicePixelRatio: window.devicePixelRatio
          },
          results
        };
        log.textContent = JSON.stringify(window.result);
        window.done = true;
      })().catch((error) => {
        window.failure = String(error && error.stack ? error.stack : error);
        log.textContent = window.failure;
        window.done = true;
      });
    },
    hide() {},
    destroy() {
      panel.remove();
    }
  };
}
