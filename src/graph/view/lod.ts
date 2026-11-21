// Level of detail for large graphs (issue #1 "Supported size"). Above LOD_EDGE_THRESHOLD edges LOD is mandatory:
// while the layout runs, or when zoomed out past LOD_ZOOMED_OUT_RATIO, the canvas draws a sample of the edges and
// fewer labels; zoomed in or settled it draws everything. The view tunes these constants.

import { LARGE_GRAPH_EDGES } from "../layout/protocol";

export const LOD_EDGE_THRESHOLD = LARGE_GRAPH_EDGES;
/** Sigma camera ratio above which the view counts as zoomed out (1 = fitted, larger = further out). */
export const LOD_ZOOMED_OUT_RATIO = 0.6;
/** While reduced, keep roughly one edge in this many. */
export const LOD_EDGE_STRIDE = 8;
/** Label density while reduced, and in full detail (Sigma's labelDensity setting). */
export const LOD_LABEL_DENSITY_REDUCED = 0.15;
export const LOD_LABEL_DENSITY_FULL = 0.55;

export interface Lod {
  reduced: boolean;
  /** Draw edge i only when i % edgeStride === 0; 1 draws all. */
  edgeStride: number;
  labelDensity: number;
  /** Hide all labels while the layout moves nodes on a reduced graph. */
  renderLabels: boolean;
}

export function lodFor(edgeCount: number, view: { ratio: number; layoutRunning: boolean }): Lod {
  const reduced = edgeCount > LOD_EDGE_THRESHOLD && (view.layoutRunning || view.ratio > LOD_ZOOMED_OUT_RATIO);
  return reduced
    ? { reduced, edgeStride: LOD_EDGE_STRIDE, labelDensity: LOD_LABEL_DENSITY_REDUCED, renderLabels: !view.layoutRunning }
    : { reduced, edgeStride: 1, labelDensity: LOD_LABEL_DENSITY_FULL, renderLabels: true };
}
