# Time-Window Navigator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-optimized:subagent-driven-development (recommended) or superpowers-optimized:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a draggable full-launch time navigator with explicit View and exact worker-backed Analyze modes.

**Architecture:** The selected trace remains parsed and aggregated in one persistent module worker. A dedicated range builder clips exact launch data, while a separate `RangeNavigator` synchronizes a full-launch overview band with `TimelineRenderer`; `app.js` owns mode, URL, and stale-result authority. The Express server and profiler schema remain unchanged.

**Tech Stack:** Browser ES modules, Canvas 2D, semantic HTML/CSS, Express 5, Node.js built-in test runner.

**Assumptions:**

- Assumes schema-v1 dispatches have ordered `atNs` placement when range membership is possible — will NOT invent timestamps for unplaced dispatches.
- Assumes a range belongs to one selected launch — will NOT aggregate across launch boundaries.
- Assumes Web Worker support, as the current application already does — will NOT calculate exact ranges from the bounded client Canvas sample.
- Assumes one active exact trace session — will NOT retain multiple full raw datasets in simultaneous workers.

---

## File structure

- `public/data.js` — exact range clipping, range aggregation, and launch overview bins.
- `public/client-dataset.js` — retain overview and omission metadata while bounding Canvas event arrays.
- `public/dataset-worker.js` — persistent load and `analyze-range` protocol.
- `public/analysis-session.js` — browser-side worker lifecycle, request IDs, and result authority.
- `public/timeline.js` — explicit launch navigation bounds and a public viewport setter.
- `public/range-navigator.js` — overview rendering, band geometry, pointer capture, and slider keyboard behavior.
- `public/app.js` — View/Analyze state machine, URL state, rendering, and worker-session integration.
- `public/index.html` — semantic navigator, mode controls, readouts, and status hooks.
- `public/styles.css` — precision-instrument navigator styling, responsive behavior, and accessible focus/touch targets.
- `test/data.test.mjs` — exact range arithmetic and overview coverage.
- `test/client-dataset.test.mjs` — worker-to-client range payload preservation.
- `test/analysis-session.test.mjs` — persistent worker protocol and stale-result handling.
- `test/timeline.test.mjs` — launch bounds and external viewport synchronization.
- `test/range-navigator.test.mjs` — range geometry, pointer semantics, and keyboard controls.
- `test/app-integration.test.mjs` — application mode/session behavior.
- `test/ui-contract.test.mjs` — semantic hooks, accessible controls, and responsive CSS contract.
- `README.md` — operator instructions for View and Analyze modes.

### Task 1: Exact range arithmetic and overview bins

**Files:**

- Modify: `public/data.js`
- Modify: `public/client-dataset.js`
- Test: `test/data.test.mjs`
- Create: `test/client-dataset.test.mjs`

**Security flag:** none

**Does NOT cover:** Cross-launch aggregation, unanchored wait attribution, or measured per-dispatch timestamps.

- [x] **Step 1: Write failing range-membership and interval-clipping tests**

Append to `test/data.test.mjs`:

```js
import {
  buildOverviewBins,
  buildRangeScope,
} from "../public/data.js";

test("range scope clips intervals and includes points at both selected edges", () => {
  const launch = {
    index: 0,
    startNs: 0,
    endNs: 250,
    commandBuffers: [
      {
        commandBufferIndex: 0,
        encodeStartNs: 0,
        encodeEndNs: 100,
        gpuStartNs: 50,
        gpuEndNs: 150,
        exposedIntervals: [[0, 50]],
        hiddenIntervals: [[50, 100]],
      },
      {
        commandBufferIndex: 1,
        encodeStartNs: 100,
        encodeEndNs: 200,
        gpuStartNs: 150,
        gpuEndNs: 250,
        exposedIntervals: [],
        hiddenIntervals: [[100, 200]],
      },
    ],
    dispatches: [
      { kernel: "edge-a", atNs: 75, setBytesCalls: 1 },
      { kernel: "middle", atNs: 125, bufferBinds: 2 },
      { kernel: "edge-b", atNs: 175, setBytesTotalBytes: 16 },
      { kernel: "outside", atNs: 200 },
      { kernel: "unplaced", atNs: null },
    ],
    waits: [
      {
        bucket: "cap_wait",
        waitClass: "cap",
        headlineCategory: "cap",
        waitNs: 7,
        atNs: 75,
      },
      {
        bucket: "cb_wait_until_completed",
        waitClass: "decision",
        headlineCategory: "decision",
        waitNs: 11,
        atNs: 175,
      },
      { bucket: "dependency_cv_wait", waitNs: 13, atNs: null },
    ],
  };

  const range = buildRangeScope(launch, { startNs: 75, endNs: 175 });

  assert.deepEqual(range.range, { startNs: 75, endNs: 175 });
  assert.equal(range.summary.wallSpanNs, 100);
  assert.equal(range.summary.exposedHostNs, 0);
  assert.equal(range.summary.hiddenHostNs, 100);
  assert.equal(range.summary.gpuBusyNs, 100);
  assert.equal(range.summary.gpuWorkNs, 100);
  assert.equal(range.summary.cbsTotal, 2);
  assert.equal(range.summary.opsTotal, 3);
  assert.equal(range.summary.capWaitNs, 7);
  assert.equal(range.summary.decisionWaitNs, 11);
  assert.deepEqual(
    range.kernelCensus.map(({ kernel, count }) => [kernel, count]),
    [["edge-a", 1], ["edge-b", 1], ["middle", 1]],
  );
  assert.deepEqual(range.gpuIntervals, [[75, 175]]);
  assert.deepEqual(range.omissions, {
    unplacedDispatches: 1,
    unanchoredWaits: 1,
  });
});

test("full-launch range preserves exact launch aggregates", () => {
  const dataset = buildDataset([
    {
      record: "cb",
      command_buffer_index: 0,
      encode_start_ns: 0,
      encode_end_ns: 100,
      gpu_start_ns: 50,
      gpu_end_ns: 150,
    },
    {
      record: "op",
      command_buffer_index: 0,
      seq: 0,
      kernel_name: "first",
    },
    {
      record: "op",
      command_buffer_index: 0,
      seq: 1,
      kernel_name: "last",
    },
  ]);
  const launch = dataset.launchWindows[0];
  const range = buildRangeScope(launch, {
    startNs: launch.startNs,
    endNs: launch.endNs,
  });

  for (const key of [
    "wallSpanNs",
    "exposedHostNs",
    "hiddenHostNs",
    "gpuBusyNs",
    "gpuWorkNs",
    "opsTotal",
    "cbsTotal",
  ]) {
    assert.equal(range.summary[key], launch.summary[key], key);
  }
});

test("overview bins retain exact event totals at fixed resolution", () => {
  const scope = {
    startNs: 0,
    endNs: 100,
    commandBuffers: [{
      encodeStartNs: 0,
      encodeEndNs: 100,
      gpuStartNs: 25,
      gpuEndNs: 75,
      exposedIntervals: [[0, 25], [75, 100]],
      hiddenIntervals: [[25, 75]],
    }],
    dispatches: [{ atNs: 0 }, { atNs: 50 }, { atNs: 100 }],
    waits: [
      { atNs: 25, waitClass: "cap" },
      { atNs: 75, waitClass: "decision" },
    ],
  };

  const overview = buildOverviewBins(scope, 4);

  assert.equal(overview.binCount, 4);
  assert.equal(
    overview.bins.reduce((total, bin) => total + bin.dispatchCount, 0),
    3,
  );
  assert.equal(
    overview.bins.reduce((total, bin) => total + bin.waitCount, 0),
    2,
  );
  assert.equal(
    overview.bins.reduce((total, bin) => total + bin.gpuBusyNs, 0),
    50,
  );
});
```

- [x] **Step 2: Run the range tests and verify the missing exports fail**

Run:

```bash
node --test test/data.test.mjs
```

Expected: FAIL because `buildRangeScope` and `buildOverviewBins` are not exported.

- [x] **Step 3: Implement exact clipping and overview aggregation**

Add pure helpers and exports to `public/data.js`:

```js
function clipInterval(interval, range) {
  if (
    !Array.isArray(interval) ||
    !Number.isFinite(interval[0]) ||
    !Number.isFinite(interval[1]) ||
    interval[1] <= interval[0]
  ) {
    return null;
  }
  const start = Math.max(interval[0], range.startNs);
  const end = Math.min(interval[1], range.endNs);
  return end > start ? [start, end] : null;
}

function pointInRange(atNs, range) {
  return (
    Number.isFinite(atNs) &&
    atNs >= range.startNs &&
    atNs <= range.endNs
  );
}

function validSelectedRange(scope, requested) {
  if (
    !Number.isFinite(scope?.startNs) ||
    !Number.isFinite(scope?.endNs) ||
    !Number.isFinite(requested?.startNs) ||
    !Number.isFinite(requested?.endNs)
  ) {
    throw new TypeError("Range and launch bounds must be finite.");
  }
  const startNs = Math.max(scope.startNs, requested.startNs);
  const endNs = Math.min(scope.endNs, requested.endNs);
  if (endNs <= startNs) {
    throw new RangeError("Selected range must have positive duration.");
  }
  return Object.freeze({ startNs, endNs });
}

export function buildRangeScope(scope, requestedRange) {
  const range = validSelectedRange(scope, requestedRange);
  const sourceCommandBuffers = Array.isArray(scope.commandBuffers)
    ? scope.commandBuffers
    : [];
  const commandBuffers = sourceCommandBuffers
    .map((commandBuffer) => {
      const encode = clipInterval(
        [commandBuffer.encodeStartNs, commandBuffer.encodeEndNs],
        range,
      );
      const gpu = clipInterval(
        [commandBuffer.gpuStartNs, commandBuffer.gpuEndNs],
        range,
      );
      if (encode === null && gpu === null) return null;
      const hiddenIntervals = (commandBuffer.hiddenIntervals ?? [])
        .map((interval) => clipInterval(interval, range))
        .filter(Boolean);
      const exposedIntervals = (commandBuffer.exposedIntervals ?? [])
        .map((interval) => clipInterval(interval, range))
        .filter(Boolean);
      return Object.freeze({
        ...commandBuffer,
        hiddenIntervals: freezeIntervals(hiddenIntervals),
        exposedIntervals: freezeIntervals(exposedIntervals),
        hiddenHostNs: intervalDuration(hiddenIntervals),
        exposedHostNs: intervalDuration(exposedIntervals),
        rangeGpuInterval: gpu === null ? null : Object.freeze(gpu),
      });
    })
    .filter(Boolean);
  const dispatches = (scope.dispatches ?? []).filter((dispatch) =>
    pointInRange(dispatch.atNs, range));
  const waits = (scope.waits ?? []).filter((wait) =>
    pointInRange(wait.atNs, range));
  const gpuWorkIntervals = commandBuffers
    .map((commandBuffer) => commandBuffer.rangeGpuInterval)
    .filter(Boolean);
  const gpuIntervals = mergeIntervals(gpuWorkIntervals);
  const waitTaxonomy = buildWaitTaxonomy(waits);
  const waitTotals = waitSummary(waits);
  return Object.freeze({
    index: scope.index,
    startNs: range.startNs,
    endNs: range.endNs,
    range,
    commandBuffers: Object.freeze(commandBuffers),
    dispatches: Object.freeze(dispatches),
    waits: Object.freeze(waits),
    gpuIntervals,
    kernelCensus: kernelCensus(dispatches),
    waitTaxonomy,
    omissions: Object.freeze({
      unplacedDispatches: (scope.dispatches ?? [])
        .filter((dispatch) => !Number.isFinite(dispatch.atNs)).length,
      unanchoredWaits: (scope.waits ?? [])
        .filter((wait) => !Number.isFinite(wait.atNs)).length,
    }),
    summary: Object.freeze({
      startNs: range.startNs,
      endNs: range.endNs,
      wallSpanNs: range.endNs - range.startNs,
      exposedHostNs: commandBuffers.reduce(
        (sum, commandBuffer) => sum + commandBuffer.exposedHostNs,
        0,
      ),
      hiddenHostNs: commandBuffers.reduce(
        (sum, commandBuffer) => sum + commandBuffer.hiddenHostNs,
        0,
      ),
      gpuBusyNs: intervalDuration(gpuIntervals),
      gpuWorkNs: intervalDuration(gpuWorkIntervals),
      gpuSpanNs: gpuIntervals.length === 0
        ? 0
        : gpuIntervals.at(-1)[1] - gpuIntervals[0][0],
      ...waitTotals,
      opsTotal: dispatches.length,
      cbsTotal: commandBuffers.length,
    }),
  });
}

function waitSummary(waits) {
  const totals = { cap: 0, dependency: 0, decision: 0, other: 0 };
  for (const wait of waits) {
    if (
      wait.headlineCategory !== null &&
      Object.hasOwn(totals, wait.headlineCategory) &&
      Number.isFinite(wait.waitNs) &&
      wait.waitNs >= 0
    ) {
      totals[wait.headlineCategory] += wait.waitNs;
    }
  }
  return Object.freeze({
    capWaitNs: totals.cap,
    dependencyWaitNs: totals.dependency,
    decisionWaitNs: totals.decision,
    otherWaitNs: totals.other,
    headlineWaitNs:
      totals.cap + totals.dependency + totals.decision + totals.other,
  });
}

function overviewPointIndex(atNs, startNs, endNs, binCount) {
  if (!Number.isFinite(atNs) || atNs < startNs || atNs > endNs) return -1;
  if (atNs === endNs) return binCount - 1;
  return Math.floor(((atNs - startNs) / (endNs - startNs)) * binCount);
}

function addOverviewInterval(bins, interval, field) {
  if (!validInterval(interval)) return;
  for (const bin of bins) {
    const overlapStart = Math.max(interval[0], bin.startNs);
    const overlapEnd = Math.min(interval[1], bin.endNs);
    if (overlapEnd > overlapStart) {
      bin[field] += overlapEnd - overlapStart;
    }
    if (bin.startNs >= interval[1]) break;
  }
}

export function buildOverviewBins(scope, binCount = 512) {
  const count = Math.max(1, Math.trunc(binCount));
  const startNs = scope.startNs;
  const endNs = scope.endNs;
  if (!Number.isFinite(startNs) || !Number.isFinite(endNs) || endNs <= startNs) {
    return Object.freeze({ startNs: 0, endNs: 1, binCount: count, bins: Object.freeze([]) });
  }
  const span = endNs - startNs;
  const bins = Array.from({ length: count }, (_, index) => ({
    startNs: startNs + (index * span) / count,
    endNs: startNs + ((index + 1) * span) / count,
    hostEncodeNs: 0,
    gpuBusyNs: 0,
    dispatchCount: 0,
    waitCount: 0,
    waitClasses: new Set(),
  }));
  for (const commandBuffer of scope.commandBuffers ?? []) {
    for (const interval of [
      ...(commandBuffer.exposedIntervals ?? []),
      ...(commandBuffer.hiddenIntervals ?? []),
    ]) {
      addOverviewInterval(bins, interval, "hostEncodeNs");
    }
  }
  const gpuIntervals = mergeIntervals(
    (scope.commandBuffers ?? [])
      .map(commandBufferGpuInterval)
      .filter(Boolean),
  );
  for (const interval of gpuIntervals) {
    addOverviewInterval(bins, interval, "gpuBusyNs");
  }
  for (const dispatch of scope.dispatches ?? []) {
    const index = overviewPointIndex(dispatch.atNs, startNs, endNs, count);
    if (index >= 0) bins[index].dispatchCount += 1;
  }
  for (const wait of scope.waits ?? []) {
    const index = overviewPointIndex(wait.atNs, startNs, endNs, count);
    if (index < 0) continue;
    bins[index].waitCount += 1;
    bins[index].waitClasses.add(wait.waitClass ?? "other");
  }
  return Object.freeze({
    startNs,
    endNs,
    binCount: count,
    bins: Object.freeze(bins.map((bin) => Object.freeze({
      ...bin,
      waitClasses: Object.freeze([...bin.waitClasses].sort()),
    }))),
  });
}
```

Use the shown `waitSummary(waits)` helper from both aggregate paths. Add
`overview: buildOverviewBins(launch)` to each launch window after its exact
aggregate exists.

Update `compactScope` in `public/client-dataset.js` to retain:

```js
overview: source.overview,
range: source.range,
omissions: source.omissions,
```

- [x] **Step 4: Add a client compaction test and make it pass**

Create `test/client-dataset.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";

import { compactDatasetForClient } from "../public/client-dataset.js";

test("compaction retains exact range metadata and overview bins", () => {
  const overview = Object.freeze({
    startNs: 0,
    endNs: 10,
    binCount: 1,
    bins: Object.freeze([{ dispatchCount: 10 }]),
  });
  const range = Object.freeze({ startNs: 2, endNs: 8 });
  const omissions = Object.freeze({
    unplacedDispatches: 1,
    unanchoredWaits: 2,
  });
  const compact = compactDatasetForClient({
    dispatches: Array.from({ length: 20 }, (_, atNs) => ({ atNs })),
    commandBuffers: [],
    waits: [],
    launchWindows: [],
    overview,
    range,
    omissions,
  }, { maxDispatches: 4 });

  assert.equal(compact.dispatches.length, 4);
  assert.equal(compact.overview, overview);
  assert.equal(compact.range, range);
  assert.equal(compact.omissions, omissions);
});
```

Run:

```bash
node --test test/data.test.mjs test/client-dataset.test.mjs
```

Expected: PASS.

- [x] **Step 5: Commit exact range analysis**

```bash
git add public/data.js public/client-dataset.js test/data.test.mjs test/client-dataset.test.mjs
git commit -m "Add exact launch range analysis"
```

### Task 2: Persistent worker analysis session

**Files:**

- Create: `public/analysis-session.js`
- Modify: `public/dataset-worker.js`
- Modify: `public/app.js`
- Create: `test/analysis-session.test.mjs`
- Modify: `test/app-integration.test.mjs`

**Security flag:** none

**Does NOT cover:** Simultaneous full-trace workers, server-side range requests, or client-sample arithmetic.

- [x] **Step 1: Write failing session lifecycle and stale-result tests**

Create `test/analysis-session.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";

import { TraceAnalysisSession } from "../public/analysis-session.js";

class FakeWorker {
  constructor() {
    this.listeners = new Map();
    this.messages = [];
    this.terminated = false;
  }
  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }
  removeEventListener(type, listener) {
    if (this.listeners.get(type) === listener) this.listeners.delete(type);
  }
  postMessage(message) {
    this.messages.push(message);
  }
  emit(data) {
    this.listeners.get("message")?.({ data });
  }
  terminate() {
    this.terminated = true;
  }
}

test("session retains its worker after ready and resolves authoritative ranges", async () => {
  const worker = new FakeWorker();
  const session = new TraceAnalysisSession({
    WorkerClass: class { constructor() { return worker; } },
    workerUrl: "dataset-worker.js",
    generation: 4,
  });
  const loading = session.load("/api/traces/a");
  assert.deepEqual(worker.messages[0], {
    type: "load",
    generation: 4,
    url: "/api/traces/a",
  });
  worker.emit({
    type: "ready",
    generation: 4,
    dataset: { launchWindows: [{ index: 0 }] },
    diagnostics: { parsedRows: 1 },
  });
  assert.equal((await loading).dataset.launchWindows[0].index, 0);
  assert.equal(worker.terminated, false);

  const analysis = session.analyzeRange({
    launchIndex: 0,
    startNs: 10,
    endNs: 20,
  });
  const request = worker.messages[1];
  worker.emit({
    type: "range-result",
    generation: 4,
    requestId: request.requestId,
    launchIndex: 0,
    range: { startNs: 10, endNs: 20 },
    dataset: { summary: { wallSpanNs: 10 } },
  });
  assert.equal((await analysis).dataset.summary.wallSpanNs, 10);
  session.terminate();
  assert.equal(worker.terminated, true);
});

test("newer range request rejects and ignores the older request", async () => {
  const worker = new FakeWorker();
  const session = new TraceAnalysisSession({
    WorkerClass: class { constructor() { return worker; } },
    generation: 7,
  });
  const loading = session.load("/api/traces/a");
  worker.emit({ type: "ready", generation: 7, dataset: {}, diagnostics: {} });
  await loading;

  const older = session.analyzeRange({
    launchIndex: 0,
    startNs: 0,
    endNs: 10,
  });
  const newer = session.analyzeRange({
    launchIndex: 0,
    startNs: 10,
    endNs: 20,
  });
  await assert.rejects(older, { name: "AbortError" });

  const [olderMessage, newerMessage] = worker.messages.slice(1);
  worker.emit({
    type: "range-result",
    generation: 7,
    requestId: olderMessage.requestId,
    launchIndex: 0,
    dataset: { summary: { wallSpanNs: 999 } },
  });
  worker.emit({
    type: "range-result",
    generation: 7,
    requestId: newerMessage.requestId,
    launchIndex: 0,
    dataset: { summary: { wallSpanNs: 10 } },
  });
  assert.equal((await newer).dataset.summary.wallSpanNs, 10);
});
```

- [x] **Step 2: Run the session test and verify the missing module fails**

Run:

```bash
node --test test/analysis-session.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `public/analysis-session.js`.

- [x] **Step 3: Implement the main-thread session controller**

Create `public/analysis-session.js` with:

```js
function abortError(message = "The operation was superseded.") {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function workerError(payload, fallback) {
  const error = new Error(payload?.message ?? fallback);
  error.name = payload?.name ?? "DatasetWorkerError";
  if (Number.isInteger(payload?.status)) error.status = payload.status;
  if (typeof payload?.code === "string") error.code = payload.code;
  return error;
}

export class TraceAnalysisSession {
  constructor({
    WorkerClass = globalThis.Worker,
    workerUrl = new URL("./dataset-worker.js", import.meta.url),
    generation = 1,
    onProgress,
    onStateChange,
  } = {}) {
    if (typeof WorkerClass !== "function") {
      throw new TypeError("Trace analysis requires Web Worker support.");
    }
    this.generation = generation;
    this.onProgress = onProgress;
    this.onStateChange = onStateChange;
    this.worker = new WorkerClass(workerUrl, {
      type: "module",
      name: "metal-dispatch-analysis",
    });
    this.requestId = 0;
    this.loadPending = null;
    this.rangePending = null;
    this.onMessage = (event) => this.handleMessage(event.data);
    this.onError = (event) => this.failAll(
      event?.error ?? new Error(event?.message ?? "Trace worker failed."),
    );
    this.worker.addEventListener("message", this.onMessage);
    this.worker.addEventListener("error", this.onError);
  }

  load(url) {
    if (this.loadPending) {
      return Promise.reject(new Error("Trace session load already started."));
    }
    const promise = new Promise((resolve, reject) => {
      this.loadPending = { resolve, reject };
    });
    this.worker.postMessage({
      type: "load",
      generation: this.generation,
      url,
    });
    this.onStateChange?.("posted");
    return promise;
  }

  analyzeRange({ launchIndex, startNs, endNs }) {
    this.rangePending?.reject(abortError());
    const requestId = ++this.requestId;
    const promise = new Promise((resolve, reject) => {
      this.rangePending = { requestId, launchIndex, resolve, reject };
    });
    this.worker.postMessage({
      type: "analyze-range",
      generation: this.generation,
      requestId,
      launchIndex,
      startNs,
      endNs,
    });
    return promise;
  }

  handleMessage(message) {
    if (message?.generation !== this.generation) return;
    if (message.type === "progress") {
      this.onProgress?.(message.progress);
      return;
    }
    if (message.type === "state") {
      this.onStateChange?.(message.state);
      return;
    }
    if (message.type === "ready" && this.loadPending) {
      const pending = this.loadPending;
      this.loadPending = null;
      pending.resolve({
        dataset: message.dataset,
        diagnostics: message.diagnostics ?? {},
      });
      return;
    }
    if (
      message.type === "range-result" &&
      this.rangePending?.requestId === message.requestId &&
      this.rangePending.launchIndex === message.launchIndex
    ) {
      const pending = this.rangePending;
      this.rangePending = null;
      pending.resolve(message);
      return;
    }
    if (message.type === "complete" && message.ok === false) {
      this.failAll(workerError(message.error, "Trace analysis failed."));
    }
  }

  failAll(error) {
    this.loadPending?.reject(error);
    this.rangePending?.reject(error);
    this.loadPending = null;
    this.rangePending = null;
  }

  terminate() {
    this.failAll(abortError("Trace analysis session terminated."));
    this.worker.removeEventListener("message", this.onMessage);
    this.worker.removeEventListener("error", this.onError);
    this.worker.terminate();
  }
}
```

- [x] **Step 4: Make the dataset worker retain exact data and answer range requests**

Change `public/dataset-worker.js` to retain `exactDataset` and
`activeGeneration` after load:

```js
let exactDataset = null;
let activeGeneration = null;

async function loadTrace(message) {
  const response = await fetch(message.url);
  const parsed = await parseNdjsonResponse(response, {
    onProgress(progress) {
      globalThis.postMessage({
        type: "progress",
        generation: message.generation,
        progress,
      });
    },
  });
  globalThis.postMessage({
    type: "state",
    generation: message.generation,
    state: "analyzing",
  });
  exactDataset = buildDataset(parsed.rows, parsed.diagnostics);
  activeGeneration = message.generation;
  globalThis.postMessage({
    type: "ready",
    generation: message.generation,
    dataset: compactDatasetForClient(exactDataset),
    diagnostics: parsed.diagnostics,
  });
}

function analyzeRange(message) {
  if (exactDataset === null || message.generation !== activeGeneration) {
    throw new Error("Exact trace session is not ready.");
  }
  const launch = exactDataset.launchWindows?.[message.launchIndex];
  if (!launch) throw new RangeError("Selected launch does not exist.");
  const range = buildRangeScope(launch, {
    startNs: message.startNs,
    endNs: message.endNs,
  });
  globalThis.postMessage({
    type: "range-result",
    generation: message.generation,
    requestId: message.requestId,
    launchIndex: message.launchIndex,
    range: range.range,
    dataset: compactScopeForClient(range),
  });
}

globalThis.addEventListener("message", async (event) => {
  const message = event?.data ?? {};
  try {
    if (message.type === "load") {
      await loadTrace(message);
      return;
    }
    if (message.type === "analyze-range") {
      analyzeRange(message);
      return;
    }
    throw new TypeError(`Unsupported worker request: ${String(message.type)}`);
  } catch (error) {
    globalThis.postMessage({
      type: "complete",
      generation: message.generation,
      requestId: message.requestId,
      ok: false,
      error: serializedError(error),
    });
  }
});
```

Export `compactScopeForClient` from `public/client-dataset.js`; keep
`analyzeTraceOffMainThread` in `public/app.js` as a compatibility wrapper that
creates a session, waits for `ready`, then terminates it. Add generation fields
to its existing fake-worker expectations in `test/app-integration.test.mjs`.

- [x] **Step 5: Run worker and existing integration tests**

Run:

```bash
node --test test/analysis-session.test.mjs test/app-integration.test.mjs
```

Expected: PASS.

- [x] **Step 6: Commit the persistent worker session**

```bash
git add public/analysis-session.js public/dataset-worker.js public/client-dataset.js public/app.js test/analysis-session.test.mjs test/app-integration.test.mjs
git commit -m "Keep exact trace analysis in a worker session"
```

### Task 3: Timeline launch bounds and external viewport control

**Files:**

- Modify: `public/timeline.js`
- Test: `test/timeline.test.mjs`

**Security flag:** none

**Does NOT cover:** Range metrics or overview-band pointer interaction.

- [x] **Step 1: Write failing renderer tests**

Append to `test/timeline.test.mjs`:

```js
test("range dataset keeps complete launch navigation bounds", () => {
  const { canvas } = fakeCanvas();
  const changes = [];
  const renderer = new TimelineRenderer(canvas, {
    onViewportChange(range) {
      changes.push(range);
    },
  });
  renderer.setDataset(
    {
      startNs: 40,
      endNs: 60,
      commandBuffers: [],
      dispatches: [],
      waits: [],
    },
    {
      bounds: { startNs: 0, endNs: 100 },
      viewport: { startNs: 40, endNs: 60 },
    },
  );

  assert.deepEqual(renderer.bounds, { startNs: 0, endNs: 100 });
  assert.deepEqual(renderer.viewport, { startNs: 40, endNs: 60 });
  assert.deepEqual(renderer.setViewport({ startNs: 90, endNs: 120 }), {
    startNs: 70,
    endNs: 100,
  });
  assert.deepEqual(changes.at(-1), { startNs: 70, endNs: 100 });
  renderer.destroy();
});

test("external viewport update can avoid a synchronization callback", () => {
  const { canvas } = fakeCanvas();
  let notifications = 0;
  const renderer = new TimelineRenderer(canvas, {
    onViewportChange() {
      notifications += 1;
    },
  });
  renderer.setDataset(
    { startNs: 0, endNs: 100 },
    { bounds: { startNs: 0, endNs: 100 } },
  );
  renderer.setViewport({ startNs: 10, endNs: 30 }, { notify: false });
  assert.equal(notifications, 0);
  assert.deepEqual(renderer.viewport, { startNs: 10, endNs: 30 });
  renderer.destroy();
});
```

- [x] **Step 2: Run the focused renderer tests and verify `setViewport` is missing**

Run:

```bash
node --test test/timeline.test.mjs
```

Expected: FAIL because `TimelineRenderer.setViewport` does not exist.

- [x] **Step 3: Implement explicit bounds and viewport setter**

Update `TimelineRenderer.setDataset`:

```js
const naturalBounds = traceBounds(safeData, this.placedDispatches);
this.bounds = validRange(options.bounds)
  ? normalizedBounds(options.bounds)
  : naturalBounds;
const requestedViewport = validRange(options.viewport)
  ? options.viewport
  : this.selectedWindow ?? this.bounds;
this.setViewport(requestedViewport, { notify: false });
```

Add:

```js
setViewport(viewport, { notify = true } = {}) {
  this.viewport = clampViewport(viewport, this.bounds);
  this.analysisCache = null;
  this.staticLayerCache = null;
  if (notify) this.notifyViewportChange();
  this.requestRender();
  return Object.freeze({ ...this.viewport });
}
```

Route `fit`, wheel zoom, keyboard zoom, and pointer pan through `setViewport`
without changing their existing input semantics.

- [x] **Step 4: Run all timeline tests**

Run:

```bash
node --test test/timeline.test.mjs
```

Expected: PASS.

- [x] **Step 5: Commit viewport synchronization**

```bash
git add public/timeline.js test/timeline.test.mjs
git commit -m "Separate timeline data from launch bounds"
```

### Task 4: Overview range navigator

**Files:**

- Create: `public/range-navigator.js`
- Create: `test/range-navigator.test.mjs`

**Security flag:** none

**Does NOT cover:** Worker requests, metrics, tables, or URL persistence.

- [x] **Step 1: Write failing geometry and keyboard tests**

Create `test/range-navigator.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";

import {
  clampSelectedRange,
  moveSelectedRange,
  resizeSelectedRange,
  sliderStepNs,
} from "../public/range-navigator.js";

const bounds = Object.freeze({ startNs: 0, endNs: 1_000 });

test("selected range clamps without changing duration at launch edges", () => {
  assert.deepEqual(
    clampSelectedRange({ startNs: -50, endNs: 150 }, bounds, 10),
    { startNs: 0, endNs: 200 },
  );
  assert.deepEqual(
    clampSelectedRange({ startNs: 900, endNs: 1_200 }, bounds, 10),
    { startNs: 700, endNs: 1_000 },
  );
});

test("band movement and handle resize stay inside launch bounds", () => {
  assert.deepEqual(
    moveSelectedRange({ startNs: 200, endNs: 400 }, 750, bounds),
    { startNs: 800, endNs: 1_000 },
  );
  assert.deepEqual(
    resizeSelectedRange(
      { startNs: 200, endNs: 400 },
      "start",
      399,
      bounds,
      25,
    ),
    { startNs: 375, endNs: 400 },
  );
  assert.deepEqual(
    resizeSelectedRange(
      { startNs: 200, endNs: 400 },
      "end",
      100,
      bounds,
      25,
    ),
    { startNs: 200, endNs: 225 },
  );
});

test("slider steps are one or ten percent of the launch", () => {
  assert.equal(sliderStepNs(bounds, false), 10);
  assert.equal(sliderStepNs(bounds, true), 100);
});
```

- [x] **Step 2: Run the navigator test and verify the missing module fails**

Run:

```bash
node --test test/range-navigator.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [x] **Step 3: Implement pure range geometry**

Create `public/range-navigator.js` with exported pure functions:

```js
export function clampSelectedRange(range, bounds, minimumSpanNs = 1) {
  const boundSpan = bounds.endNs - bounds.startNs;
  const requestedSpan = Math.max(
    minimumSpanNs,
    Math.min(boundSpan, range.endNs - range.startNs),
  );
  let startNs = range.startNs;
  let endNs = startNs + requestedSpan;
  if (startNs < bounds.startNs) {
    startNs = bounds.startNs;
    endNs = startNs + requestedSpan;
  }
  if (endNs > bounds.endNs) {
    endNs = bounds.endNs;
    startNs = endNs - requestedSpan;
  }
  return Object.freeze({ startNs, endNs });
}

export function moveSelectedRange(range, deltaNs, bounds) {
  return clampSelectedRange({
    startNs: range.startNs + deltaNs,
    endNs: range.endNs + deltaNs,
  }, bounds);
}

export function resizeSelectedRange(
  range,
  edge,
  atNs,
  bounds,
  minimumSpanNs = 1,
) {
  return edge === "start"
    ? Object.freeze({
        startNs: Math.max(
          bounds.startNs,
          Math.min(atNs, range.endNs - minimumSpanNs),
        ),
        endNs: range.endNs,
      })
    : Object.freeze({
        startNs: range.startNs,
        endNs: Math.min(
          bounds.endNs,
          Math.max(atNs, range.startNs + minimumSpanNs),
        ),
      });
}

export function sliderStepNs(bounds, large) {
  return (bounds.endNs - bounds.startNs) * (large ? 0.1 : 0.01);
}
```

- [x] **Step 4: Add failing DOM interaction tests**

Extend `test/range-navigator.test.mjs` with a small fake Canvas/element fixture
matching the style already used by `test/timeline.test.mjs`, then assert:

```js
test("handle keyboard commits an accessible range update", () => {
  const fixture = navigatorFixture();
  const commits = [];
  const navigator = new RangeNavigator(fixture, {
    onRangeCommit(range) {
      commits.push(range);
    },
  });
  navigator.setOverview({
    startNs: 0,
    endNs: 1_000,
    binCount: 1,
    bins: [{ hostEncodeNs: 1_000, gpuBusyNs: 500, dispatchCount: 2, waitCount: 0 }],
  });
  navigator.setRange({ startNs: 200, endNs: 400 });
  fixture.startHandle.dispatch("keydown", {
    key: "ArrowRight",
    shiftKey: false,
    preventDefault() {},
  });

  assert.deepEqual(commits.at(-1), { startNs: 210, endNs: 400 });
  assert.equal(fixture.startHandle.attributes.get("role"), "slider");
  assert.equal(fixture.startHandle.attributes.get("aria-valuenow"), "210");
  navigator.destroy();
});

test("band pointer drag emits transient updates and one committed range", () => {
  const fixture = navigatorFixture({ width: 1_000 });
  const inputs = [];
  const commits = [];
  const navigator = new RangeNavigator(fixture, {
    onRangeInput: (range) => inputs.push(range),
    onRangeCommit: (range) => commits.push(range),
  });
  navigator.setOverview(oneBinOverview(0, 1_000));
  navigator.setRange({ startNs: 200, endNs: 400 });
  fixture.band.dispatch("pointerdown", pointerEvent(1, 300));
  fixture.window.dispatch("pointermove", pointerEvent(1, 500));
  fixture.window.dispatch("pointerup", pointerEvent(1, 500));

  assert.deepEqual(inputs.at(-1), { startNs: 400, endNs: 600 });
  assert.deepEqual(commits, [{ startNs: 400, endNs: 600 }]);
  navigator.destroy();
});
```

- [x] **Step 5: Implement `RangeNavigator` drawing and interaction**

Add a class with this contract:

```js
export class RangeNavigator {
  constructor(
    { canvas, band, startHandle, endHandle, summary, windowObject },
    { onRangeInput, onRangeCommit } = {},
  );
  setOverview(overview);
  setRange(range, { emit = false } = {});
  setDisabled(disabled);
  requestRender();
  destroy();
}
```

Implementation requirements:

- draw 512 overview bins with host coverage above GPU coverage and wait ticks;
- resize the backing store for `devicePixelRatio`;
- derive minimum range span as `max(1ns, launchSpan / cssWidth)`;
- use pointer capture for the band and both handles;
- make visible handle rules 2px while keeping 44px hit areas;
- set slider min/max/current/text attributes after every range update;
- implement Arrow, Shift+Arrow, Home, and End;
- recenter the band when the overview outside it is clicked;
- emit every drag through `onRangeInput` and exactly one release/keyboard
  result through `onRangeCommit`;
- remove all listeners and observers in `destroy`.

- [x] **Step 6: Run navigator tests**

Run:

```bash
node --test test/range-navigator.test.mjs
```

Expected: PASS.

- [x] **Step 7: Commit the navigator**

```bash
git add public/range-navigator.js test/range-navigator.test.mjs
git commit -m "Add accessible timeline range navigator"
```

### Task 5: Application integration, URL state, and polished UI

**Files:**

- Modify: `public/app.js`
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Modify: `test/app-integration.test.mjs`
- Modify: `test/ui-contract.test.mjs`

**Security flag:** none

**Does NOT cover:** Live trace tailing, multi-run overlays, or profiler changes.

- [x] **Step 1: Write failing URL and mode-state tests**

Add exports and tests in `test/app-integration.test.mjs`:

```js
import {
  parseRangeSelection,
  rangeSelectionUrl,
  RangeRequestAuthority,
} from "../public/app.js";

test("range URL stores launch-relative offsets and mode", () => {
  const url = rangeSelectionUrl(
    "http://localhost/?trace=t&window=1",
    {
      mode: "analyze",
      bounds: { startNs: 1_000, endNs: 2_000 },
      range: { startNs: 1_125, endNs: 1_750 },
    },
  );
  assert.equal(url.searchParams.get("range"), "analyze");
  assert.equal(url.searchParams.get("from"), "125");
  assert.equal(url.searchParams.get("to"), "750");
  assert.deepEqual(parseRangeSelection(url, {
    startNs: 1_000,
    endNs: 2_000,
  }), {
    mode: "analyze",
    range: { startNs: 1_125, endNs: 1_750 },
  });
});

test("invalid range URL restores View over the complete launch", () => {
  const bounds = { startNs: 10, endNs: 110 };
  assert.deepEqual(
    parseRangeSelection("http://localhost/?range=analyze&from=90&to=20", bounds),
    { mode: "view", range: bounds },
  );
});

test("range authority accepts only the newest request for the active launch", () => {
  const authority = new RangeRequestAuthority();
  const first = authority.begin(0);
  const second = authority.begin(0);
  assert.equal(authority.isCurrent(first, 0), false);
  assert.equal(authority.isCurrent(second, 0), true);
  authority.invalidate();
  assert.equal(authority.isCurrent(second, 0), false);
});
```

- [x] **Step 2: Add failing semantic UI contract checks**

Extend `test/ui-contract.test.mjs` so the shell must contain:

```js
for (const id of [
  "metric-scope-label",
  "range-navigator",
  "range-overview",
  "range-band",
  "range-start-handle",
  "range-end-handle",
  "range-mode-view",
  "range-mode-analyze",
  "range-start-readout",
  "range-end-readout",
  "range-duration-readout",
  "range-status",
  "range-omissions",
]) {
  assert.ok(byId.has(id), `#${id}`);
}
assert.equal(byId.get("range-overview").name, "canvas");
for (const id of ["range-start-handle", "range-end-handle"]) {
  assert.equal(byId.get(id).attributes.get("role"), "slider");
  assert.equal(byId.get(id).attributes.get("tabindex"), "0");
}
for (const id of ["range-mode-view", "range-mode-analyze"]) {
  assert.equal(byId.get(id).name, "button");
  assert.ok(byId.get(id).attributes.has("aria-pressed"));
}
```

Require CSS rules for `.range-handle`, `.range-band`,
`.range-mode-button[aria-pressed="true"]`, and the existing `760px` responsive
block. Assert `.range-handle` has a `min-width` and `min-height` of at least
`44px`.

- [x] **Step 3: Run integration and UI tests and verify the new contracts fail**

Run:

```bash
node --test test/app-integration.test.mjs test/ui-contract.test.mjs
```

Expected: FAIL because range state exports and DOM hooks do not exist.

- [x] **Step 4: Add the semantic navigator markup**

Insert directly below the plot scroller in `public/index.html`:

```html
<section id="range-navigator" class="range-navigator" aria-labelledby="range-heading" hidden>
  <div class="range-toolbar">
    <div>
      <p class="eyebrow">Time window</p>
      <h3 id="range-heading">Launch overview</h3>
    </div>
    <div class="range-mode" role="group" aria-label="Time window behavior">
      <button id="range-mode-view" class="range-mode-button" type="button" aria-pressed="true">
        View
      </button>
      <button id="range-mode-analyze" class="range-mode-button" type="button" aria-pressed="false" disabled>
        Analyze
      </button>
    </div>
  </div>
  <div class="range-overview-frame">
    <canvas
      id="range-overview"
      width="1120"
      height="58"
      role="img"
      aria-label="Full-launch host, GPU, dispatch, and wait overview"
      aria-describedby="range-status"
    ></canvas>
    <div id="range-band" class="range-band">
      <span
        id="range-start-handle"
        class="range-handle range-handle-start"
        role="slider"
        tabindex="0"
        aria-label="Range start"
      ></span>
      <span
        id="range-end-handle"
        class="range-handle range-handle-end"
        role="slider"
        tabindex="0"
        aria-label="Range end"
      ></span>
    </div>
  </div>
  <div class="range-readouts">
    <output id="range-start-readout">Start —</output>
    <output id="range-end-readout">End —</output>
    <output id="range-duration-readout">Duration —</output>
    <span id="range-status" role="status" aria-live="polite">Complete launch selected</span>
  </div>
  <p id="range-omissions" class="range-omissions" role="note" hidden></p>
</section>
```

Add a visible `<span id="metric-scope-label">Launch totals</span>` beside the
metric-band heading.

- [x] **Step 5: Style the navigator within the existing design system**

Add CSS using current custom properties:

```css
.range-navigator {
  border-top: 1px solid var(--rule);
  padding: 12px 16px 14px;
  background: var(--canvas);
}

.range-toolbar,
.range-readouts {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.range-overview-frame {
  position: relative;
  height: 58px;
  margin-top: 10px;
  overflow: hidden;
  border: 1px solid var(--rule);
  background: var(--panel);
}

#range-overview {
  display: block;
  width: 100%;
  height: 58px;
}

.range-band {
  position: absolute;
  inset-block: 0;
  border-inline: 2px solid var(--selection);
  background: color-mix(in srgb, var(--selection) 10%, transparent);
  cursor: grab;
  touch-action: none;
}

.range-band.is-dragging {
  cursor: grabbing;
}

.range-handle {
  position: absolute;
  top: 50%;
  width: 44px;
  min-width: 44px;
  height: 44px;
  min-height: 44px;
  transform: translate(-50%, -50%);
  cursor: ew-resize;
  touch-action: none;
}

.range-handle::after {
  content: "";
  position: absolute;
  inset-block: 8px;
  left: 21px;
  width: 2px;
  background: var(--selection);
}

.range-handle-end {
  left: 100%;
}

.range-mode {
  display: inline-flex;
  border: 1px solid var(--control-border);
}

.range-mode-button {
  min-width: 76px;
  min-height: 44px;
  border: 0;
  border-radius: 0;
}

.range-mode-button[aria-pressed="true"] {
  color: var(--canvas);
  background: var(--selection);
  font-weight: 700;
}

.range-readouts {
  justify-content: flex-start;
  margin-top: 8px;
  color: var(--secondary);
  font: 11px/1.4 "SFMono-Regular", ui-monospace, monospace;
}

.range-readouts #range-status {
  margin-left: auto;
}

@media (max-width: 760px) {
  .range-toolbar,
  .range-readouts {
    align-items: flex-start;
    flex-wrap: wrap;
  }
  .range-overview-frame,
  #range-overview {
    height: 52px;
  }
  .range-readouts #range-status {
    width: 100%;
    margin-left: 0;
  }
}
```

Use the project’s existing forced-colors and focus-visible rules for both
handles and the segmented buttons.

- [x] **Step 6: Implement URL helpers and range authority**

Add pure exports to `public/app.js`:

```js
export function rangeSelectionUrl(input, { mode, bounds, range }) {
  const url = new URL(input, "http://localhost/");
  url.searchParams.set("range", mode === "analyze" ? "analyze" : "view");
  url.searchParams.set("from", String(Math.round(range.startNs - bounds.startNs)));
  url.searchParams.set("to", String(Math.round(range.endNs - bounds.startNs)));
  return url;
}

export function parseRangeSelection(input, bounds) {
  const url = new URL(input, "http://localhost/");
  const from = Number(url.searchParams.get("from"));
  const to = Number(url.searchParams.get("to"));
  const valid =
    Number.isSafeInteger(from) &&
    Number.isSafeInteger(to) &&
    to > from;
  if (!valid) return { mode: "view", range: Object.freeze({ ...bounds }) };
  const range = clampViewport({
    startNs: bounds.startNs + from,
    endNs: bounds.startNs + to,
  }, bounds);
  return {
    mode: url.searchParams.get("range") === "analyze" ? "analyze" : "view",
    range,
  };
}

export class RangeRequestAuthority {
  constructor() {
    this.generation = 0;
  }
  begin(launchIndex) {
    return Object.freeze({
      generation: ++this.generation,
      launchIndex,
    });
  }
  isCurrent(token, launchIndex) {
    return token?.generation === this.generation &&
      token.launchIndex === launchIndex;
  }
  invalidate() {
    this.generation += 1;
  }
}
```

Compose these range parameters with the existing `selectionUrl` instead of
creating competing history writes.

- [x] **Step 7: Integrate the session, navigator, and modes**

In `bootstrap`:

- create one `RangeNavigator`;
- create one `TraceAnalysisSession` for every selected trace generation;
- terminate the previous session before selection state is cleared;
- render cached compact data immediately in View mode, but keep Analyze
  disabled until the exact session reaches `ready`;
- store `launchScope`, `activeScope`, `selectedRange`, `confirmedRange`,
  `rangeMode`, `analysisReady`, and `rangePending`;
- on a navigator transient update, set the timeline viewport immediately and
  use the compact launch dataset;
- on a committed View update, update URL and keep launch totals/tables;
- on a committed Analyze update, mark metrics/tables busy, debounce transient
  requests by 100ms, issue the final request immediately, and accept only the
  newest `RangeRequestAuthority` token;
- on a confirmed result, render exact range metrics/tables, set the
  range-focused Canvas data with complete-launch `bounds`, and restore the
  selected viewport;
- clear a pinned inspector item only when a confirmed Analyze result replaces
  the active Canvas scope; preserve the pin during View-only navigation;
- on Analyze failure, switch to View, restore launch totals, retain the selected
  viewport, and announce the exact-analysis error;
- synchronize wheel, pan, zoom, and Fit from `TimelineRenderer` back into the
  navigator without callback loops;
- reset range and invalidate authority on trace or launch change;
- apply a valid initial URL range only after the matching trace and launch
  bounds are known, otherwise restore View over the complete launch;
- clear timers, terminate the session, and destroy the navigator on `pagehide`.

Use these visible labels:

```js
elements.metricScopeLabel.textContent =
  state.rangeMode === "analyze" ? "Selected range" : "Launch totals";
elements.rangeStatus.textContent = state.rangePending
  ? `Analyzing ${formatDuration(range.startNs - bounds.startNs)} – ` +
    formatDuration(range.endNs - bounds.startNs)
  : state.rangeMode === "analyze"
    ? "Exact selected-range aggregates"
    : "Viewport only; metrics show launch totals";
```

For omitted records:

```js
const omissions = result.dataset.omissions ?? {};
const omitted = (omissions.unplacedDispatches ?? 0) +
  (omissions.unanchoredWaits ?? 0);
elements.rangeOmissions.hidden = omitted === 0;
elements.rangeOmissions.textContent =
  `${omissions.unplacedDispatches ?? 0} dispatches lack ordered placement; ` +
  `${omissions.unanchoredWaits ?? 0} waits lack an anchor and are excluded ` +
  "from selected-range analysis.";
```

- [x] **Step 8: Run focused integration and UI tests**

Run:

```bash
node --test test/app-integration.test.mjs test/ui-contract.test.mjs test/range-navigator.test.mjs test/timeline.test.mjs
```

Expected: PASS.

- [x] **Step 9: Commit the integrated UI**

```bash
git add public/app.js public/index.html public/styles.css test/app-integration.test.mjs test/ui-contract.test.mjs
git commit -m "Integrate View and Analyze time windows"
```

### Task 6: Operator documentation and release verification

**Files:**

- Modify: `README.md`

**Security flag:** none

- [x] **Step 1: Add renderer-side operating instructions**

Document under the existing usage section:

```markdown
### Time-window control

The overview strip always represents the selected launch.

- Drag the selection band to pan; drag either edge to resize it.
- **View** changes the timeline viewport while metrics and tables remain labeled
  **Launch totals**.
- **Analyze** recomputes metrics and tables from the full worker-side trace for
  the selected range. It never calculates from the bounded Canvas sample.
- Wheel zoom and timeline drag update the same selection band. **Fit** restores
  the complete launch.
- Focus either range handle and use Arrow keys for 1% steps,
  Shift+Arrow for 10%, Home for launch start, and End for launch end.
- The URL stores the trace, launch, mode, and launch-relative range.

Schema-v1 dispatch membership uses ordered placement, not measured per-op
timestamps. Analyze reports any dispatches or waits that cannot be placed.
```

- [x] **Step 2: Run the complete test suite**

Run:

```bash
npm test
```

Expected: all Node tests pass with zero failures.

- [x] **Step 3: Run production dependency audit**

Run:

```bash
npm audit --omit=dev
```

Expected: zero known production vulnerabilities.

- [x] **Step 4: Start the application and smoke-test HTTP endpoints**

Run in one terminal:

```bash
npm start
```

Then run:

```bash
curl --fail --silent http://127.0.0.1:4173/api/health
curl --fail --silent http://127.0.0.1:4173/api/traces
curl --fail --silent http://127.0.0.1:4173/ | grep -q 'range-navigator'
```

Expected: both API calls return JSON and the HTML contains the navigator.

- [ ] **Step 5: Perform browser interaction checks**

At `http://127.0.0.1:4173` verify:

1. all five showcase traces still load;
2. overview drag, both handles, wheel zoom, timeline pan, and Fit remain
   synchronized;
3. View retains Launch totals;
4. Analyze updates Selected range metrics and both tables;
5. rapid drags never allow an older result to overwrite the newest band;
6. switching traces during analysis cannot publish the old result;
7. keyboard handle controls and screen-reader attributes update;
8. desktop and 760px layouts work in dark and light themes;
9. Canvas-sampling and unplaced-row disclosures remain explicit.

Not completed in this lane: Safari remote automation is disabled and no
capturable display is available. The deterministic DOM, pointer, resize, DPR,
and ARIA harness remains green, but it does not replace this real-browser gate.

- [x] **Step 6: Commit documentation**

```bash
git add README.md
git commit -m "Document time-window analysis controls"
```

- [x] **Step 7: Run final clean-tree verification**

Run:

```bash
git diff --check
npm test
npm audit --omit=dev
git status --short --branch
```

Expected: no whitespace errors, all tests pass, audit is clean, and the branch
contains no uncommitted changes.
