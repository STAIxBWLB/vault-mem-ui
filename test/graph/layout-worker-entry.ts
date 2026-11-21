// Test-only worker entry. The panel module uses `if (isLayoutWorkerContext()) runLayoutWorker();`, which keys on the
// worker's `name` (browsers expose it as self.name). Bun's Worker does not expose `name` to the worker, so this entry
// starts the layout worker unconditionally; isLayoutWorkerContext itself is unit-tested in layout.test.ts.
import { runLayoutWorker } from "../../src/graph/layout/worker";

runLayoutWorker();
