// Ported from STAIxBWLB/maru@b33341df src/components/graph/graphLabels.ts.
// Sigma is not a dependency yet (the canvas lands with M2's Sigma work), so the Sigma shapes these renderers read
// are declared structurally here; Sigma's NodeDisplayData and Settings satisfy them.
import { graphTheme } from "./style";

export interface NodeLabelData {
  x: number;
  y: number;
  size: number;
  label: string | null;
  color: string;
  forceLabel?: boolean;
  highlighted?: boolean;
}
export interface LabelSettings {
  labelFont: string;
  labelSize: number;
  labelWeight: string;
}
// Obsidian-style zoom-linked fade: labels are invisible while a node renders
// small, ramp in as it grows on screen (zoom-in or high degree).
const FADE_START = 6;
const FADE_END = 12;

export function labelAlpha(renderedSize: number, forced: boolean): number {
  if (forced) return 1;
  if (renderedSize <= FADE_START) return 0;
  if (renderedSize >= FADE_END) return 0.3;
  return ((renderedSize - FADE_START) / (FADE_END - FADE_START)) * 0.3;
}

function drawLabelText(
  context: CanvasRenderingContext2D,
  data: NodeLabelData,
  settings: LabelSettings,
  alpha: number,
  sizePx: number,
  weight: string,
): void {
  if (!data.label || alpha <= 0) return;
  const theme = graphTheme();
  context.save();
  context.globalAlpha = alpha;
  context.font = `${weight} ${sizePx}px ${settings.labelFont}`;
  context.textAlign = "center";
  context.textBaseline = "top";
  // bg-colored stroke halo keeps labels readable over edges (cheaper than shadowBlur)
  context.lineJoin = "round";
  context.lineWidth = 3;
  context.strokeStyle = theme.bg;
  const x = data.x;
  const y = data.y + data.size + 3;
  context.strokeText(data.label, x, y);
  context.fillStyle = theme.labelColor;
  context.fillText(data.label, x, y);
  context.restore();
}

export function drawNodeLabel(context: CanvasRenderingContext2D, data: NodeLabelData, settings: LabelSettings): void {
  const forced = data.forceLabel === true || data.highlighted === true;
  drawLabelText(context, data, settings, labelAlpha(data.size, forced), settings.labelSize, settings.labelWeight);
}

export function drawNodeHover(context: CanvasRenderingContext2D, data: NodeLabelData, settings: LabelSettings): void {
  // Hovered node: always-on, slightly larger label; no white box (Obsidian look).
  drawLabelText(context, data, settings, 1, settings.labelSize + 1, "600");
}
