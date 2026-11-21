import { expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { createStore } from "../../src/client/store";
import { createFakeHost } from "../../src/client/fake";

test("hidden standalone pages stop polling and refresh once when visible again", async () => {
  GlobalRegistrator.register();
  let hidden = false;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  const host = createFakeHost();
  delete host.subscribe;
  const store = createStore(host, { intervalMs: 30 });
  const stop = store.start();
  try {
    await Bun.sleep(75);
    expect(host.calls.snapshot.length).toBeGreaterThan(0);
    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    const count = host.calls.snapshot.length;
    await Bun.sleep(90);
    expect(host.calls.snapshot.length).toBe(count);
    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(host.calls.snapshot.length).toBe(count + 1);
    stop();
    document.dispatchEvent(new Event("visibilitychange"));
    await Bun.sleep(50);
    expect(host.calls.snapshot.length).toBe(count + 1);
  } finally {
    stop();
    await GlobalRegistrator.unregister();
  }
});
