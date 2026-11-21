/**
 * The write flow. A host that answers the provider directly (`confirm: "client"`, the default) gets the two-step
 * round trip here: every write is previewed with its fingerprint and the planned changes, and nothing is sent until
 * the person confirms. `acon` answers that round trip itself (`confirm: "host"`): its console shows the preview and
 * holds the fingerprint, and refusing a page that sets `confirmed`/`fingerprint` is the console's own rule, so this
 * client only sends the bare action and reports the outcome.
 */

import type { ActionInput, ActionResult, Change, Host } from "./host.ts";

export type WriteState =
  | { phase: "idle" }
  | {
      phase: "preview";
      input: ActionInput;
      fingerprint: string;
      verb: string;
      preview: string[];
      changes: Change[];
      warnings: string[];
      confirmToken?: string;
    }
  /** `quiet` means the host already reported the outcome to the person (the console's own toast), so no dialog. */
  | { phase: "done"; message: string; quiet?: boolean }
  | { phase: "cancelled"; message: string }
  | { phase: "error"; message: string };

/** A refusal names what failed and what to do next; the host's own words come first, unchanged. */
export function problemText(cause: unknown, fallback: string): string {
  const text = cause instanceof Error ? cause.message : String(cause ?? "").trim();
  return text
    ? `${fallback}: ${text}. Check the host connection and try again.`
    : `${fallback}. Check the host connection and try again.`;
}

/**
 * The refusal text a person acts on. A provider that refused a write named its cause, so that text stays first and
 * the next step follows it; a refusal that came without a reason says so rather than inventing one.
 */
export function refusalText(error: unknown, action: string): string {
  const cause = typeof error === "string" ? error.trim() : "";
  return cause
    ? `${cause}. Fix that and start the write again, or reload the panel first if it may already have been applied.`
    : `${action} was refused without a reason. Reload the panel and try again; if it repeats, check the vault's log.`;
}

function fromReply(reply: ActionResult, input: ActionInput): WriteState {
  if (reply.needsConfirm === true) {
    if (!reply.fingerprint) {
      return {
        phase: "error",
        message: `${input.action}: the provider asked for confirmation without a fingerprint, so this preview cannot be confirmed and nothing was sent. Start the write again; if it repeats, check the host version.`,
      };
    }
    return {
      phase: "preview",
      input,
      fingerprint: reply.fingerprint,
      verb: reply.verb ?? input.action,
      preview: reply.preview ?? [],
      changes: reply.changes ?? [],
      warnings: reply.warnings ?? [],
      ...(reply.confirmToken ? { confirmToken: reply.confirmToken } : {}),
    };
  }
  if (reply.ok === false) return { phase: "error", message: refusalText(reply.error, input.action) };
  return { phase: "done", message: reply.message ?? `${input.action}: done` };
}

/**
 * `acon`'s `host.action` runs the console's own confirmation before it resolves: the preview is shown there, the
 * person confirms or cancels, and the result is the outcome. A cancellation is the person's decision, not a failure.
 */
function fromHostReply(reply: ActionResult, input: ActionInput): WriteState {
  if (reply.needsConfirm === true) {
    // Only possible when a host claims to confirm and then hands the preview back: say so rather than loop.
    return {
      phase: "error",
      message: `${input.action}: the host returned the preview instead of an outcome, so nothing was written. This host's confirmation and the console's disagree; reload the panel and try again.`,
    };
  }
  if (reply.cancelled === true) return { phase: "cancelled", message: `${input.action}: cancelled, so nothing was written.` };
  if (reply.ok === false) return { phase: "error", message: refusalText(reply.error, input.action) };
  return { phase: "done", message: reply.message ?? `${input.action}: done`, quiet: true };
}

/** Ask for the preview of a write, or let the host run the whole round trip when it owns the confirmation. */
export async function startWrite(host: Host, input: ActionInput): Promise<WriteState> {
  const owned = host.confirm === "host";
  try {
    const reply = await host.action(input);
    return owned ? fromHostReply(reply, input) : fromReply(reply, input);
  } catch (error) {
    return { phase: "error", message: problemText(error, `${input.action} was not sent`) };
  }
}

/** Perform the previewed write, re-sending the fingerprint the preview produced. */
export async function confirmWrite(host: Host, state: WriteState): Promise<WriteState> {
  if (state.phase !== "preview" || host.confirm === "host") return state;
  try {
    const reply = await host.action({
      ...state.input,
      confirmed: true,
      fingerprint: state.fingerprint,
      ...(state.confirmToken ? { confirmToken: state.confirmToken } : {}),
    });
    // A retried confirmation can answer `needsConfirm` again (a fingerprint recomputed to the same value);
    // showing that preview again is safer than treating it as done.
    return fromReply(reply, state.input);
  } catch (error) {
    return { phase: "error", message: problemText(error, `${state.verb} was not confirmed`) };
  }
}
