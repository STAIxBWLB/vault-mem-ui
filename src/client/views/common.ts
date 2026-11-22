/** What every panel view receives: its snapshot, the panel parameters, navigation and the write entry point. */

import type { ActionInput, SnapshotReply, Theme } from "../host.ts";

export interface ViewProps {
  reply: SnapshotReply;
  params: Record<string, string>;
  navigate(panel: string, params?: Record<string, string>): void;
  beginWrite(input: ActionInput): void;
  graphSnapshot?(params: Record<string, unknown>): Promise<SnapshotReply>;
  /** The resolved theme; views that paint outside CSS (the graph canvas) redraw when it changes. */
  theme?: Theme;
}

export const vaultParam = (params: Record<string, string>): Record<string, string> =>
  params.vault ? { vault: params.vault } : {};
