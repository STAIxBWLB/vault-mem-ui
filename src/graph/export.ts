import type { GraphModel } from "./model";

export type GraphPositions = Readonly<Record<string, readonly [number, number]>>;

/** Export graph metadata only. Strings are UTF-8/base64 encoded inside JSON so HTML cannot terminate its data element. */
export function exportGraphHtml(model: GraphModel, positions: GraphPositions): string {
  const data = {
    nodes: model.nodes.map((node) => {
      const point = Object.hasOwn(positions, node.id) ? positions[node.id] : undefined;
      return {
        id: node.id, label: node.label, type: node.type, domain: node.domain,
        community: node.community, degree: node.degree,
        position: point && Number.isFinite(point[0]) && Number.isFinite(point[1]) ? [point[0], point[1]] : null,
      };
    }),
    edges: model.edges.map((edge) => ({ source: edge.source, target: edge.target, relation: edge.relation })),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  const payload = JSON.stringify({ encoding: "base64-utf8", data: btoa(binary) });
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vault graph</title>
<style>body{font:16px system-ui,sans-serif;margin:2rem;max-width:70rem}canvas{width:100%;height:auto;border:1px solid #aaa}li{margin:.3rem 0}</style></head>
<body><h1>Vault graph</h1><p>Offline graph metadata. Note contents are not included.</p><canvas id="graph" width="1000" height="600" aria-label="Graph visualization"></canvas><h2>Nodes</h2><ul id="nodes"></ul>
<script id="graph-data" type="application/json">${payload}</script>
<script>
const packet = JSON.parse(document.getElementById("graph-data").textContent);
const bytes = Uint8Array.from(atob(packet.data), c => c.charCodeAt(0));
const graph = JSON.parse(new TextDecoder().decode(bytes));
const canvas = document.getElementById("graph"), ctx = canvas.getContext("2d");
const points = new Map();
const raw = graph.nodes.map((node, i) => node.position || [Math.cos(i * 2.4) * Math.sqrt(i + 1), Math.sin(i * 2.4) * Math.sqrt(i + 1)]);
let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
for (const [x, y] of raw) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
const span = Math.max(maxX - minX, maxY - minY, 1), scale = 520 / span;
// Graph coordinates use y-up, while a 2D canvas uses y-down.
graph.nodes.forEach((node, i) => points.set(node.id, [500 + (raw[i][0] - (minX + maxX) / 2) * scale, 300 - (raw[i][1] - (minY + maxY) / 2) * scale]));
ctx.strokeStyle = "#aaa";
for (const edge of graph.edges) { const a = points.get(edge.source), b = points.get(edge.target); if (!a || !b) continue; ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke(); }
ctx.fillStyle = "#2458a2"; ctx.font = "12px sans-serif";
for (const node of graph.nodes) { const p = points.get(node.id); ctx.beginPath(); ctx.arc(p[0], p[1], 4, 0, Math.PI * 2); ctx.fill(); ctx.fillText(node.label, p[0] + 6, p[1] - 6); const li = document.createElement("li"); li.textContent = node.label + " (" + node.type + ", " + node.degree + " links)"; document.getElementById("nodes").append(li); }
</script></body></html>`;
}
