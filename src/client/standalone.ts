/** Same-origin transport for the standalone loopback server. */
import type { ActionInput, ActionResult, Host, SnapshotInput, SnapshotReply, Theme } from "./host.ts";

export function createStandaloneHost(mount: HTMLElement, request: (url: string, init: RequestInit) => Promise<Response> = fetch): Host {
  const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
  const theme = (): Theme => ({ mode: media?.matches ? "dark" : "light" });

  async function post(endpoint: "/api/snapshot" | "/api/action", input: SnapshotInput | ActionInput): Promise<Record<string, unknown>> {
    const response = await request(endpoint, {
      method: "POST",
      credentials: "same-origin",
      mode: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message = data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error : `Request failed (${response.status}); reopen the standalone page and retry`;
      throw new Error(message);
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("The server returned invalid data; reopen the page and retry");
    return data as Record<string, unknown>;
  }

  return {
    mount,
    confirm: "client",
    snapshot: (input) => post("/api/snapshot", input) as Promise<SnapshotReply>,
    action: (input) => post("/api/action", input) as Promise<ActionResult>,
    theme,
    onTheme(listener) {
      if (!media) return () => {};
      const changed = () => listener(theme());
      media.addEventListener("change", changed);
      return () => media.removeEventListener("change", changed);
    },
  };
}
