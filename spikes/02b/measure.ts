import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

// Drives the page: reads per-case progress from window.partialResults, clicks #pulse every
// 50 ms while a case runs, and fails the run on any HTTP 4xx/5xx or console/page error, so a
// dirty run cannot be reported as a clean one.
const server = Bun.spawn(['bun', 'server.ts'], {
  cwd: import.meta.dir,
  stdout: 'pipe',
  stderr: 'inherit',
  env: { ...process.env }
});
const decoder = new TextDecoder();
const reader = server.stdout.getReader();
let buffered = '';
let ticket = null;
const deadline = Date.now() + 60_000;
while (!ticket && Date.now() < deadline) {
  const { value, done } = await reader.read();
  if (done) break;
  buffered += decoder.decode(value);
  const line = buffered.split('\n').find((entry) => entry.includes('"url"'));
  if (line) ticket = JSON.parse(line).url;
}
if (!ticket) throw new Error('acon fixture server did not print a ticket URL: ' + buffered);

const glArgs = process.env.GL_ARGS
  ? process.env.GL_ARGS.split(' ').filter(Boolean)
  : ['--use-gl=angle', '--use-angle=metal'];
const browser = await chromium.launch({ headless: true, args: glArgs });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
// The console rewrites the URL hash on login, so case filters travel as an injected config
// rather than as query parameters.
const query = new URLSearchParams(process.env.SPIKE_QUERY || '');
await context.addInitScript(
  (cfg) => {
    window.__spikeConfig = cfg;
  },
  {
    cases: process.env.SPIKE_CASES || '',
    runs: Number(process.env.SPIKE_RUNS || 3),
    iterations: Number(process.env.SPIKE_ITERATIONS || 100),
    yieldMode: query.get('workerYield') || 'channel'
  }
);
const page = await context.newPage();
const errors = [];
const httpErrors = [];
const outputName = process.env.SPIKE_OUT || 'result';
if (!/^[A-Za-z0-9_-]+$/.test(outputName)) throw new Error('SPIKE_OUT must contain only letters, numbers, underscores or hyphens');
const outputDir = new URL('./results/', import.meta.url);
mkdirSync(outputDir, { recursive: true });
const outFile = new URL(`${outputName}.json`, outputDir).pathname;

page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});
page.on('pageerror', (error) => errors.push(`pageerror: ${String(error)}`));
page.on('crash', () => errors.push('page crashed'));
page.on('requestfailed', (request) => errors.push(`requestfailed ${request.url()} ${request.failure()?.errorText}`));
page.on('response', async (response) => {
  if (response.status() >= 400) {
    let body = '';
    try {
      body = (await response.text()).slice(0, 200);
    } catch {
      body = '<unreadable>';
    }
    const entry = `http ${response.status()} ${response.request().method()} ${response.url()} :: ${body}`;
    httpErrors.push(entry);
    errors.push(entry);
  }
});

const abort = async (reason) => {
  const partial = await page
    .evaluate(() => ({ results: window.partialResults || [], failure: window.failure || null, done: Boolean(window.done) }))
    .catch(() => ({ results: [], failure: 'page unreachable', done: false }));
  writeFileSync(outFile, JSON.stringify({ reason, errors, httpErrors, partial }, null, 2));
  console.error(`RUN FAILED: ${reason}`);
  for (const entry of httpErrors) console.error(`  ${entry}`);
  await browser.close();
  server.kill();
  process.exit(1);
};

// The ticket is single use and rides in the hash. Loading the console at `/` without it makes
// the shell post an empty /session, which acon answers with 401, so the driver loads once with
// the ticket and then changes route by hash: a second navigation would be a reload.
const base = new URL(ticket);
await page.goto(`${base.origin}/#${base.hash.slice(1)}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => location.hash.startsWith('#/local/'), null, { timeout: 60_000 });
await page.evaluate(() => {
  location.hash = '#/local/spike2b/graph';
});
await page.waitForSelector('#pulse', { timeout: 120_000 });
if (errors.length) await abort('errors before the first case');

const clickDurations = {};
const clickFailures = [];
let finished = false;
let announced = 0;
const started = Date.now();
while (!finished && Date.now() - started < 10 * 60_000) {
  if (errors.length) await abort('errors during the run');
  const state = await page.evaluate(() => ({
    running: Boolean(window.caseRunning),
    label: window.caseLabel || null,
    done: Boolean(window.done),
    completed: (window.partialResults || []).map((entry, index) => ({
      index,
      label: entry.label,
      run: entry.run,
      iterationP50: entry.iterationMs && entry.iterationMs.p50,
      frameP50: entry.frameGapMs && entry.frameGapMs.p50,
      elapsedMs: entry.elapsedMs,
      renderOnlyMs: entry.renderOnlyMs ?? null
    }))
  }));
  if (state.completed.length > announced) {
    for (const entry of state.completed.slice(announced)) console.log(JSON.stringify(entry));
    announced = state.completed.length;
  }
  if (state.done) {
    finished = true;
    break;
  }
  if (state.running && state.label) {
    const before = Date.now();
    try {
      await page.click('#pulse', { timeout: 15_000, force: true });
      (clickDurations[state.label] ||= []).push(Date.now() - before);
    } catch (error) {
      clickFailures.push({ label: state.label, error: String(error).slice(0, 200) });
    }
    await page.waitForTimeout(50);
  } else {
    await page.waitForTimeout(50);
  }
}

const result = await page.evaluate(() => ({
  result: window.result,
  failure: window.failure,
  workerFailure: window.workerFailure,
  workerBoot: window.workerBoot
}));
await page.screenshot({ path: new URL('screenshot.png', outputDir).pathname, fullPage: false });
writeFileSync(outFile, JSON.stringify({ errors, httpErrors, clickDurations, clickFailures, ...result }, null, 2));
const cases = result.result ? result.result.results.length : 0;
console.log(JSON.stringify({ done: finished, cases, errors: errors.length, clickFailures: clickFailures.length }));

await browser.close();
server.kill();
if (!finished || errors.length || clickFailures.length || result.failure || result.workerFailure) process.exit(1);
