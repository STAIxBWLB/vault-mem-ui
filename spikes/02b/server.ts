// Serves the panel bundle through the real acon server so the same-origin module worker is
// measured under acon's CSP. Set ACON_ROOT to an agent-console checkout at 8babe31.
const root = process.env.ACON_ROOT;
if (!root) throw new Error('set ACON_ROOT to the agent-console checkout');
const { startServer } = await import(`${root}/src/server.ts`);
const js = await Bun.file(new URL('./bundle.js', import.meta.url)).text();
const css =
  'body{margin:0;font-family:system-ui}.spike{display:flex;flex-direction:column;gap:8px;padding:8px}.graph{width:900px;height:560px}pre{margin:0;white-space:pre-wrap;font-size:11px}';
const manifest = {
  api: 1,
  tool: 'spike2b',
  version: '0.0.1',
  title: 'Spike 2b',
  icon: 'vault',
  panels: [{ id: 'graph', title: 'Graph', order: 1 }],
  capabilities: { actions: [] }
};
const provider = {
  assets: { js, css },
  async snapshot() {
    return {};
  },
  async action() {
    return { ok: false };
  }
};
const server = startServer({
  plugins: [{ tool: 'spike2b', file: 'fixture', status: 'ready', manifest, provider }],
  version: 'test',
  pluginsDir: '.',
  log: console.error
});
// A ticket is single use: reusing one answers 401 "this link was already used".
console.log(JSON.stringify({ url: server.issue() }));
process.on('SIGTERM', async () => {
  await server.stop();
  process.exit(0);
});
