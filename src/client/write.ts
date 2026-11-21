/**
 * The two-step write flow: every write is previewed with its fingerprint, then confirmed with that same
 * fingerprint. The client never sends `confirmed` without a preview the person has seen.
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
  | { phase: "done"; message: string }
  | { phase: "error"; message: string };

/** A refusal the person sees names what failed and what to do next. */
export function problemText(error: unknown, fallback: string): string {
  const cause = error instanceof Error ? error.message : String(error ?? "").trim();
  return cause ? `${fallback}: ${cause}. Check the host connection and try again.` : `${fallback}. Check the host connection and try again.`;
}

function fromReply(reply: ActionResult, input: ActionInput): WriteState {
  if (reply.needsConfirm === true) {
    if (!reply.fingerprint) return { phase: "error", message: `${input.action}: the provider asked for confirmation without a fingerprint, so the write cannot be confirmed safely` };
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
  if (reply.ok === false) return { phase: "error", message: reply.error ?? `${input.action}: the provider refused the write` };
  return { phase: "done", message: reply.message ?? `${input.action}: done` };
}

/** Ask for the preview of a write (or perform it, when the provider does not ask for confirmation). */
export async function startWrite(host: Host, input: ActionInput): Promise<WriteState> {
  try {
    return fromReply(await host.action(input), input);
  } catch (error) {
    return { phase: "error", message: problemText(error, `${input.action} was not sent`) };
  }
}

/** Perform the previewed write, re-sending the fingerprint the preview produced. */
export async function confirmWrite(host: Host, state: WriteState): Promise<WriteState> {
  if (state.phase !== "preview") return state;
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
