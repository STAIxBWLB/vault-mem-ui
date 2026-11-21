/** Narrow readers for provider snapshots: the client never trusts a shape it has not checked. */

export type Json = Record<string, unknown>;

export const rec = (value: unknown): Json => (value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {});

export const str = (value: unknown): string => (typeof value === "string" ? value : typeof value === "number" ? String(value) : "");

export const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

export const list = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

export interface NoteRow {
  path: string;
  title?: string;
  type?: string;
  domain?: string;
  description?: string;
}

export interface VaultRow {
  id: string;
  kind?: string;
  write?: string;
  health?: string;
}

export interface LogRow {
  raw?: string;
  at?: string;
  type?: string;
  project?: string;
  source?: string;
  dest?: string;
  note?: string;
  agent?: boolean;
}

export interface CandidateRow {
  id: string;
  kind?: string;
  title?: string;
  project?: string;
  at?: number;
}

export interface FindingRow {
  code: string;
  severity: string;
  path?: string;
  message: string;
}

export interface LinkRow {
  resolved?: string;
  source?: string;
  target?: string;
}

/** ISO time for a log timestamp that arrived as text, or the text itself when it is not a date. */
export function when(value: unknown): string {
  const text = str(value);
  if (!text) return "";
  const at = new Date(text);
  return Number.isNaN(at.getTime()) ? text : at.toISOString().slice(0, 16).replace("T", " ");
}
