// Pin and layout cache in per-viewer browser storage. Positions are keyed by node id under a key the caller derives
// from the graph (graphTopologySignature), so a changed graph never reuses stale coordinates by index. Storage that
// is missing, full or refuses access degrades to "no cache", never an error.

import { sanitizePositions } from "../positions";

export interface CacheStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const PREFIX = "vmem-ui:graph:";

export interface CachedLayout {
  positions: Record<string, [number, number]>;
  pinned: string[];
}

export function readLayoutCache(storage: CacheStorage | undefined, key: string): CachedLayout {
  const empty: CachedLayout = { positions: {}, pinned: [] };
  if (!storage) return empty;
  try {
    const raw = JSON.parse(storage.getItem(PREFIX + key) ?? "null") as Partial<CachedLayout> | null;
    if (!raw || typeof raw !== "object") return empty;
    const positions = raw.positions && typeof raw.positions === "object" ? sanitizePositions(raw.positions) : {};
    const pinned = Array.isArray(raw.pinned) ? raw.pinned.filter((id): id is string => typeof id === "string") : [];
    return { positions, pinned };
  } catch {
    return empty;
  }
}

/** Returns false when the storage refused the write (full or blocked); the view keeps working without a cache. */
export function writeLayoutCache(storage: CacheStorage | undefined, key: string, layout: CachedLayout): boolean {
  if (!storage) return false;
  try {
    storage.setItem(PREFIX + key, JSON.stringify({ positions: sanitizePositions(layout.positions), pinned: layout.pinned }));
    return true;
  } catch {
    return false;
  }
}
