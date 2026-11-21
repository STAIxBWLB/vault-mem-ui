/**
 * The small host interface the client is written against (spec: issue #1, milestone 1).
 *
 * `acon` supplies its `ConsoleHost` through `createAconHost`; the standalone shell supplies the same four
 * members over its HTTP endpoints. Nothing here knows about either transport, so a fake host runs the views
 * in tests and the standalone build until M1-b merges.
 */

/** Query parameters carried by a panel navigation; the shell also keeps them in the URL. */
export type Params = Record<string, unknown>;

export interface SnapshotInput extends Params {
  panel: string;
}

export interface SnapshotReply extends Record<string, unknown> {}

export interface Theme {
  mode: "light" | "dark";
  tokens?: Record<string, string>;
}

/** A planned file change of a previewed write, as the provider reports it. */
export interface Change {
  op: string;
  target: string;
  note?: string;
}

/**
 * The provider's answer to one `action` call. A write first answers `needsConfirm` with a fingerprint and the
 * preview the person decides on; the same call with `confirmed: true` and that fingerprint performs it.
 */
export interface ActionResult {
  ok?: boolean;
  error?: string;
  message?: string;
  needsConfirm?: boolean;
  fingerprint?: string;
  confirmToken?: string;
  verb?: string;
  preview?: string[];
  changes?: Change[];
  warnings?: string[];
  applied?: boolean;
}

export interface ActionInput extends Params {
  action: string;
  confirmed?: boolean;
  fingerprint?: string;
  confirmToken?: string;
}

export interface Host {
  /** Element the client renders into. The client owns its contents and removes them on `destroy`. */
  mount: HTMLElement;
  /** Ask for the current panel's data. `panel` is used by hosts that route it themselves (standalone, fake). */
  snapshot(input: SnapshotInput): Promise<SnapshotReply>;
  /** One provider call, including the confirm round trip of a write. */
  action(input: ActionInput): Promise<ActionResult>;
  /** The host's current theme; the person's own preference may override it for this panel. */
  theme(): Theme;
  /** Push from the host. When absent the client polls `snapshot` instead. */
  subscribe?(listener: (reply: SnapshotReply) => void): () => void;
  /** Switch to a panel. When absent the client switches in place. */
  navigate?(panel: string, params?: Record<string, string>): void;
  /** Theme changes from the host, so the panel follows a console theme switch without a reload. */
  onTheme?(listener: (theme: Theme) => void): () => void;
}
