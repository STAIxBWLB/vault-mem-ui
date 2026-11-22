/** Shared pieces of the panel: a keyboard-navigable list, notices, chips, fields and the write dialog. */

import { useEffect, useRef, type ReactNode } from "react";
import { isListKey, nextFocus } from "./a11y.ts";
import type { WriteState } from "./write.ts";

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "err"; children: ReactNode }) {
  return (
    <p className={`vmem-notice vmem-notice-${tone}`} role={tone === "err" ? "alert" : "status"}>
      {children}
    </p>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="vmem-empty">
      <p className="vmem-empty-title">{title}</p>
      {hint ? <p className="vmem-sub">{hint}</p> : null}
    </div>
  );
}

export function Chip({ text, tone = "neutral" }: { text: string; tone?: "neutral" | "warn" | "err" }) {
  return <span className={`vmem-chip vmem-chip-${tone}`}>{text}</span>;
}

export interface ListItem {
  key: string;
  title: ReactNode;
  sub?: ReactNode;
  chip?: { text: string; tone?: "neutral" | "warn" | "err" };
  verbs?: ReactNode;
  onOpen?: () => void;
}

/**
 * A list where the arrow keys, Home and End move between rows and Enter or Space opens the focused one.
 * Rows are buttons, so the list also works with Tab alone when a keyboard layout has no arrows.
 */
export function List({ items, label, empty }: { items: ListItem[]; label: string; empty?: ReactNode }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  if (!items.length) return <>{empty ?? null}</>;
  const move = (event: React.KeyboardEvent<HTMLUListElement>) => {
    if (!isListKey(event.key)) return;
    const at = refs.current.findIndex((el) => el === document.activeElement);
    const next = nextFocus(items.length, at, event.key);
    if (next < 0) return;
    event.preventDefault();
    refs.current[next]?.focus();
  };
  return (
    <ul className="vmem-list" aria-label={label} onKeyDown={move}>
      {items.map((item, index) => (
        <li className="vmem-list-item" key={item.key}>
          <button
            type="button"
            className={`vmem-row${item.onOpen ? "" : " vmem-row-static"}`}
            ref={(el) => {
              refs.current[index] = el;
            }}
            onClick={item.onOpen}
            aria-disabled={item.onOpen ? undefined : true}
          >
            <span className="vmem-row-title">{item.title}</span>
            {item.sub ? <span className="vmem-row-sub">{item.sub}</span> : null}
            {item.chip ? <Chip text={item.chip.text} tone={item.chip.tone} /> : null}
          </button>
          {item.verbs ? <span className="vmem-row-verbs">{item.verbs}</span> : null}
        </li>
      ))}
    </ul>
  );
}

export function Field(props: {
  name: string;
  label: string;
  value?: string;
  placeholder?: string;
  required?: boolean;
  type?: string;
  onChange?(value: string): void;
}) {
  const id = `vmem-${props.name}`;
  return (
    <p className="vmem-field">
      <label className="vmem-label" htmlFor={id}>
        {props.label}
        {props.required ? <span className="vmem-required"> (required)</span> : null}
      </label>
      <input
        id={id}
        name={props.name}
        className="vmem-input"
        type={props.type ?? "text"}
        value={props.value ?? ""}
        placeholder={props.placeholder}
        required={props.required}
        onChange={(event) => props.onChange?.(event.currentTarget.value)}
      />
    </p>
  );
}

export function SearchForm({ value, onSubmit }: { value: string; onSubmit(q: string): void }) {
  return (
    <form
      className="vmem-bar"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        const field = event.currentTarget.elements.namedItem("q");
        onSubmit(field instanceof HTMLInputElement ? field.value.trim() : "");
      }}
    >
      <input
        className="vmem-input vmem-search"
        type="search"
        name="q"
        defaultValue={value}
        placeholder="Search notes"
        aria-label="Search notes"
      />
      <button type="submit" className="vmem-button">
        Search
      </button>
    </form>
  );
}

/**
 * The person's decision on a write: what will change, any warning, and the two buttons. Nothing is sent until
 * Confirm, and Confirm re-sends the fingerprint the preview produced.
 */
export function WriteDialog(props: { state: WriteState; onConfirm(): void; onCancel(): void }) {
  const state = props.state;
  const open = state.phase !== "idle" && !(state.phase === "done" && state.quiet);
  const box = useRef<HTMLElement | null>(null);
  const returnTo = useRef<Element | null>(null);

  // Focus moves into the dialog when it opens and back to the control that opened it when it closes; Tab is
  // contained, so the panel behind the overlay cannot be reached or activated by keyboard.
  useEffect(() => {
    if (!open) return;
    returnTo.current = typeof document === "undefined" ? null : document.activeElement;
    const inside = box.current;
    inside?.focus();
    return () => {
      const back = returnTo.current;
      if (back instanceof HTMLElement && back.isConnected) back.focus();
    };
  }, [open]);
  useEffect(() => { if (state.phase === "confirming") box.current?.focus(); }, [state.phase]);

  if (!open) return null;
  const heading = state.phase === "preview" || state.phase === "confirming" ? state.verb : state.phase === "done" ? "Done" : state.phase === "cancelled" ? "Cancelled" : "Refused";
  const trap = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;
    const inside = box.current;
    if (!inside) return;
    const focusable = [...inside.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')];
    if (!focusable.length) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const at = document.activeElement;
    // The dialog itself holds the focus after opening, so the first Tab enters the controls.
    if (at === inside || !inside.contains(at)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
      return;
    }
    if (!event.shiftKey && at === last) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && at === first) {
      event.preventDefault();
      last.focus();
    }
  };
  return (
    <div className="vmem-dialog-backdrop">
      <section
        className="vmem-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={heading}
        tabIndex={-1}
        ref={box}
        onKeyDown={trap}
      >
        <h2 className="vmem-dialog-title">{heading}</h2>
        {state.phase === "confirming" ? (
          <><p role="status">Applying changes...</p><div className="vmem-bar"><button type="button" className="vmem-button vmem-button-danger" disabled>Confirm</button><button type="button" className="vmem-button" disabled>Cancel</button></div></>
        ) : state.phase === "preview" ? (
          <>
            <p className="vmem-sub">Nothing has been written yet. These are the planned changes:</p>
            <ul className="vmem-changes">
              {state.preview.map((line) => (
                <li key={line}>{line}</li>
              ))}
              {state.changes.map((change) => (
                <li key={`${change.op}:${change.target}`}>
                  {change.op} {change.target}
                  {change.note ? <span className="vmem-sub"> · {change.note}</span> : null}
                </li>
              ))}
            </ul>
            {state.warnings.length ? (
              <ul className="vmem-warnings">
                {state.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
            <div className="vmem-bar">
              <button type="button" className="vmem-button vmem-button-danger" onClick={props.onConfirm}>
                Confirm
              </button>
              <button type="button" className="vmem-button" onClick={props.onCancel}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <p
              className={state.phase === "error" ? "vmem-notice vmem-notice-err" : "vmem-notice"}
              role={state.phase === "error" ? "alert" : "status"}
            >
              {state.message}
            </p>
            <div className="vmem-bar">
              <button type="button" className="vmem-button" onClick={props.onCancel}>
                Close
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
