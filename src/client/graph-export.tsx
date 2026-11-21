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

/** Placed by the graph view once the snapshot adapter supplies a model. */
export function GraphExportButton({ model, positions }: { model: GraphModel; positions: GraphPositions }) {
  return <button type="button" className="vmem-button" onClick={() => downloadGraphHtml(model, positions)}>Export HTML</button>;
}
