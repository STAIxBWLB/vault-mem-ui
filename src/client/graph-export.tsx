import type { GraphModel } from "../graph/model";
import { exportGraphHtml, type GraphPositions } from "../graph/export";

/** Start a local download without changing the panel's script or worker policy. */
export function downloadGraphHtml(model: GraphModel, positions: GraphPositions): void {
  const url = URL.createObjectURL(new Blob([exportGraphHtml(model, positions)], { type: "text/html;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "vault-graph.html";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Read positions at the click, so a running layout exports its current canvas coordinates. */
export function GraphExportButton({ model, positions, disabled = false }: { model: GraphModel; positions: GraphPositions | (() => GraphPositions); disabled?: boolean }) {
  return <button type="button" className="vmem-button" disabled={disabled} title={disabled ? "Graph canvas is unavailable or not ready" : undefined} onClick={() => downloadGraphHtml(model, typeof positions === "function" ? positions() : positions)}>Export filtered graph HTML</button>;
}
