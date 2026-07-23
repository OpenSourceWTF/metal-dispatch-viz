# Trace-folder profiler workbench implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers-optimized:subagent-driven-development` or
> `superpowers-optimized:executing-plans` to implement this plan task-by-task.
> Steps use checkbox syntax for tracking.

**Goal:** Replace the static one-file visualizer with a polished Express app
that discovers every census trace in a configured folder and toggles between
large traces without preloading them.

**Architecture:** A localhost Express process owns a read-only trace registry
and streams selected JSONL files. Browser modules normalize both profiler
schemas, compute overlap metrics, and render one selected trace with a density-
aware Canvas timeline plus semantic tables. The UI has no hardcoded model list;
the folder and optional `traces.json` manifest are authoritative.

**Tech stack:** Node.js 20, Express 5.2.1, browser ES modules, Canvas 2D, CSS,
Node's built-in `node:test`.

**Assumptions:**

- Assumes Node.js >=18 — will not run on older Node releases unsupported by
  Express 5.
- Assumes trace data is trusted local profiler output — this app does not expose
  the server publicly by default and does not render trace strings as HTML.
- Assumes one selected trace can fit in browser memory — files larger than the
  cache budget remain usable but are reparsed when revisited.
- Assumes output-critical tensor identities are absent from schema v1 — the UI
  will not invent producer/consumer analysis.
- No task commits or pushes. The working branch remains local until David
  explicitly requests publication.

---

## File structure

```text
package.json                    exact runtime and test commands
package-lock.json               reproducible Express dependency graph
server.mjs                      CLI configuration and listener lifecycle
server/app.mjs                  Express routes and structured errors
server/trace-registry.mjs       safe recursive discovery and manifest merge
public/index.html               semantic workbench shell
public/styles.css               responsive dark/light visual system
public/data.js                  schema normalization and overlap math
public/client-dataset.js        bounded Canvas payload with exact aggregates
public/dataset-worker.js        fetch, parse, normalize, and compact off-main
public/trace-loader.js          streamed NDJSON parser, abort, and cache
public/timeline.js              viewport, density bins, Canvas renderer
public/app.js                   registry, selection, rendering orchestration
test/package-contract.test.mjs  dependency and script contract
test/trace-registry.test.mjs    folder discovery and containment
test/server.test.mjs            real HTTP API behavior
test/data.test.mjs              normalization and timing math
test/trace-loader.test.mjs      streaming, progress, cancellation, LRU
test/timeline.test.mjs          density and viewport geometry
test/ui-contract.test.mjs       semantic DOM and styling contract
```

## Render-worker instructions

The worker responsible for `public/index.html`, `public/styles.css`,
`public/timeline.js`, and render wiring in `public/app.js` must treat the design
spec's renderer contract as acceptance criteria. Preserve the data module's
truth labels: measured timestamps, interval-derived overlap, sequence-
interpolated dispatch placement, and manifest metadata must never be styled as
equivalent evidence.

At 1440px, the chart is the visual center of gravity: trace controls and metrics
fit above it in roughly 230px, the timeline is 360–440px high, and the inspector
occupies a 304px right rail. At 390px, do not shrink the Canvas until labels are
illegible; place its minimum 720px drawing surface inside a labeled horizontal
scroller and stack the inspector below it. Use the exact semantic colors,
patterns, marker shapes, lane sizes, and draw order in the design spec.

Before handing render work back, the worker must provide desktop and narrow
screenshots plus a brief visual audit answering these questions:

1. Can exposed host, hidden host, GPU, cap wait, dependency wait, and decision
   sync be distinguished in grayscale or by shape/pattern alone?
2. Does a selected CB visibly link host, GPU, and dispatch lanes?
3. Does any label imply that ordered dispatch placement is a timestamp?
4. Can five long model labels be toggled without wrapping the whole page?
5. Are provenance and invalid-evidence badges visible before the chart is used
   for a verdict?
6. Does the first desktop viewport prioritize the timeline over decorative
   header space or repeated cards?

If any answer is no, render work is not complete even when unit tests pass.

### Task 1: Establish the locked Express runtime

**Files:**

- Create: `package.json`
- Create: `package-lock.json`
- Create: `test/package-contract.test.mjs`

**Security flag:** none

**Does NOT cover:** Express routes or trace filesystem access.

- [x] **Step 1: Write the failing package contract test**

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("runtime stays build-free and pins Express 5.2.1", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url)));
  assert.equal(pkg.type, "module");
  assert.equal(pkg.engines.node, ">=18");
  assert.equal(pkg.dependencies.express, "5.2.1");
  assert.equal(pkg.scripts.start, "node server.mjs");
  assert.equal(pkg.scripts.test, "node --test");
});
```

- [x] **Step 2: Prove the test fails before the package exists**

Run: `node --test test/package-contract.test.mjs`  
Expected: FAIL with `ENOENT` for `package.json`.

- [x] **Step 3: Add the package and install exactly one dependency**

```json
{
  "name": "metal-dispatch-viz",
  "version": "2.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=18" },
  "scripts": {
    "start": "node server.mjs",
    "test": "node --test"
  },
  "dependencies": { "express": "5.2.1" }
}
```

Run: `npm install --save-exact express@5.2.1`

- [x] **Step 4: Verify dependency integrity**

Run: `node --test test/package-contract.test.mjs && npm ls --depth=0 && npm audit --omit=dev`  
Expected: PASS, one top-level dependency, zero known production vulnerabilities.

### Task 2: Build the contained trace registry

**Files:**

- Create: `server/trace-registry.mjs`
- Create: `test/trace-registry.test.mjs`

**Security flag:** security

**Does NOT cover:** serving trace bytes; registry IDs alone grant no arbitrary
filesystem path access.

- [x] **Step 1: Write discovery, manifest, refresh, and symlink tests**

```js
import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { TraceRegistry } from "../server/trace-registry.mjs";

test("discovers nested traces, merges metadata, and excludes escaping symlinks", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "mdv-registry-"));
  const outside = await mkdtemp(path.join(tmpdir(), "mdv-outside-"));
  t.after(async () => (await import("node:fs/promises")).rm(root, { recursive: true }));
  await mkdir(path.join(root, "nested"));
  await writeFile(path.join(root, "nested", "hy3.jsonl"), '{"record":"summary"}\n');
  await writeFile(path.join(outside, "secret.jsonl"), "{}\n");
  await symlink(path.join(outside, "secret.jsonl"), path.join(root, "escape.jsonl"));
  await writeFile(path.join(root, "traces.json"), JSON.stringify({
    schema_version: 1,
    traces: { "nested/hy3.jsonl": { label: "Hy3 2-bit", mode: "MTP K3" } }
  }));

  const registry = new TraceRegistry(root);
  const payload = await registry.refresh();
  assert.equal(payload.traces.length, 1);
  assert.equal(payload.traces[0].label, "Hy3 2-bit");
  assert.equal(payload.traces[0].relativePath, "nested/hy3.jsonl");
  assert.match(payload.traces[0].id, /^[a-f0-9]{24}$/);
  assert.equal(registry.get(payload.traces[0].id).realPath.endsWith("hy3.jsonl"), true);
});

test("a second refresh discovers a newly added trace", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mdv-refresh-"));
  const registry = new TraceRegistry(root);
  assert.equal((await registry.refresh()).traces.length, 0);
  await writeFile(path.join(root, "qwen.ndjson"), "{}\n");
  assert.equal((await registry.refresh()).traces.length, 1);
});
```

- [x] **Step 2: Prove the registry tests fail**

Run: `node --test test/trace-registry.test.mjs`  
Expected: FAIL with module-not-found for `server/trace-registry.mjs`.

- [x] **Step 3: Implement the exact registry interface**

```js
export class TraceRegistry {
  constructor(root) {}
  async refresh() {} // returns { schemaVersion: 1, rootLabel, traces, warnings }
  get(id) {}         // returns the private registry entry or undefined
}

export async function readManifest(root) {}
export async function discoverTraceFiles(root) {}
export function stableTraceId(relativePath) {} // sha256 hex prefix, 24 chars
export function isContained(rootRealPath, candidateRealPath) {}
```

Discovery must sort by normalized POSIX relative path, accept `.jsonl` and
`.ndjson` case-insensitively, ignore dot-prefixed path segments, `realpath()`
every candidate, exclude directories and outward symlinks, and merge only plain
object metadata from manifest key matches. A malformed manifest returns a
warning and no metadata rather than terminating discovery.

- [x] **Step 4: Verify registry behavior and leak resistance**

Run: `node --test test/trace-registry.test.mjs`  
Expected: PASS with nested discovery, stable IDs, refresh, malformed-manifest
warning, and outward-symlink exclusion covered.

### Task 3: Expose the read-only HTTP API

**Files:**

- Create: `server/app.mjs`
- Create: `server.mjs`
- Create: `test/server.test.mjs`

**Security flag:** security

**Does NOT cover:** remote authentication. The default listener is loopback-
only; explicitly setting another host is an operator decision.

- [x] **Step 1: Write real HTTP tests against an ephemeral listener**

```js
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "../server/app.mjs";

test("registry lists and streams one trace without accepting a path", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "mdv-api-"));
  await writeFile(path.join(root, "trace.jsonl"), '{"record":"summary","complete":true}\n');
  const server = createApp({ traceRoot: root }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const list = await (await fetch(`${base}/api/traces`)).json();
  assert.equal(list.traces.length, 1);
  const trace = await fetch(`${base}/api/traces/${list.traces[0].id}`);
  assert.equal(trace.status, 200);
  assert.match(trace.headers.get("content-type"), /ndjson/);
  assert.equal(trace.headers.get("cache-control"), "no-store");
  assert.match(await trace.text(), /"complete":true/);
  assert.equal((await fetch(`${base}/api/traces/not-an-id`)).status, 404);
  assert.equal((await fetch(`${base}/api/traces/..%2F..%2Fetc%2Fpasswd`)).status, 404);
});
```

- [x] **Step 2: Prove the API test fails**

Run: `node --test test/server.test.mjs`  
Expected: FAIL with module-not-found for `server/app.mjs`.

- [x] **Step 3: Implement app creation and listener configuration**

```js
export function createApp({ traceRoot, publicDir = new URL("../public/", import.meta.url) }) {}
export function parseRuntimeConfig(argv = process.argv.slice(2), env = process.env) {}
```

`createApp` must create one `TraceRegistry`, refresh on every `/api/traces`,
stream only a current registry entry through `createReadStream`, set
`application/x-ndjson; charset=utf-8` and `Cache-Control: no-store`, expose
`/api/health`, and serve `public/` with Express static middleware. Errors use
`{ error: { code, message } }` and never include absolute filesystem paths.

`parseRuntimeConfig` accepts `--trace-dir <path>` and `--trace-dir=<path>`, then
`TRACE_DIR`, then `./traces/showcase`; it accepts numeric `PORT` and `HOST`,
defaults to port 4173 and `127.0.0.1`, and rejects a missing flag value or port
outside 1..65535 before listening.

- [x] **Step 4: Verify HTTP and CLI behavior**

Run: `node --test test/server.test.mjs`  
Expected: PASS for health, discovery, streaming, 404, traversal-shaped IDs,
structured missing-root errors, and CLI precedence.

### Task 4: Normalize schema and price overlap correctly

**Files:**

- Create: `public/data.js`
- Create: `test/data.test.mjs`

**Security flag:** none

**Does NOT cover:** tensor dependency analysis because schema v1 lacks tensor
producer and consumer identities.

- [x] **Step 1: Write public-schema, legacy-schema, and interval tests**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { buildDataset, normalizeRow, partitionLaunchWindows, subtractIntervals } from "../public/data.js";

test("normalizes the public profiler field names", () => {
  const raw = { record: "op", command_buffer_index: 7,
    seq: 11, setBytes_calls: 2, setBytes_total_bytes: 48, kernel_name: "qmv" };
  assert.deepEqual(normalizeRow(raw),
    { type: "op", commandBufferIndex: 7, setBytesCalls: 2,
      setBytesTotalBytes: 48, seq: 11, kernel: "qmv", raw });
});

test("splits exposed host around merged GPU coverage", () => {
  assert.deepEqual(subtractIntervals([[0, 10]], [[2, 4], [3, 7]]), [[0, 2], [7, 10]]);
});

test("prices waits by taxonomy and preserves incomplete evidence", () => {
  const rows = [
    { record: "cb", command_buffer_index: 0, encode_start_ns: 0,
      encode_end_ns: 10, gpu_start_ns: 2, gpu_end_ns: 7, op_count: 1 },
    { record: "wait", bucket: "cap_wait", wait_ns: 3, at_ns: 11 },
    { record: "summary", complete: false, dropped_rows: 4 }
  ];
  const data = buildDataset(rows);
  assert.equal(data.summary.exposedHostNs, 5);
  assert.equal(data.summary.hiddenHostNs, 5);
  assert.equal(data.summary.capWaitNs, 3);
  assert.equal(data.health.validEvidence, false);
});

test("separates launches without treating a decision drain as a launch gap", () => {
  const cbs = [
    { commandBufferIndex: 0, encodeStartNs: 0, encodeEndNs: 10, gpuEndNs: 20 },
    { commandBufferIndex: 1, encodeStartNs: 30, encodeEndNs: 40, gpuEndNs: 50 },
    { commandBufferIndex: 2, encodeStartNs: 2_000_000_000,
      encodeEndNs: 2_000_000_010, gpuEndNs: 2_000_000_020 }
  ];
  assert.deepEqual(partitionLaunchWindows(cbs).map((window) => window.commandBufferIndices),
    [[0, 1], [2]]);
});
```

- [x] **Step 2: Prove the math test fails**

Run: `node --test test/data.test.mjs`  
Expected: FAIL with module-not-found for `public/data.js`.

- [x] **Step 3: Implement immutable normalization and analysis functions**

```js
export function normalizeRow(row) {}
export function mergeIntervals(intervals) {}
export function intersectIntervals(left, right) {}
export function subtractIntervals(left, right) {}
export function classifyWait(bucket) {} // cap, dependency, decision, other
export function partitionLaunchWindows(commandBuffers) {}
export function buildDataset(rows, diagnostics = {}) {}
export function formatDuration(ns) {}
export function formatBytes(bytes) {}
```

Use finite-number guards, never mutate parsed rows, preserve unknown fields in
`raw`, accept public and legacy aliases, compute union-based GPU busy time, and
separate encode coverage into exposed and hidden intervals. Treat
`cb_wait_until_completed` as decision drain, `cap_wait` as cap wait,
`memory_wait`/`dependency_cv_wait` as dependency, and retain unknown waits as
other rather than discarding them. `sched_backpressure` is the scheduler-level
mirror underneath cap or memory waits and `sched_worker_wait` is worker-idle
time; show both in the taxonomy table but never add them again to headline wait
totals.

Partition launch windows from sorted command buffers using the larger of 100 ms
and 20 times the median positive inter-CB gap. A gap is measured from the prior
maximum encode/GPU end to the next encode start. Single-window traces return one
window; decision waits do not affect partitioning. After CB normalization,
derive each op's ordered `atNs` by its sequence fraction across the parent CB's
encode interval and set `placement: "ordered"`.

- [x] **Step 4: Verify all timing invariants**

Run: `node --test test/data.test.mjs`  
Expected: PASS for overlap, adjacency merge, zero-length rejection, old/new
aliases, unknown rows, wait classes, dropped rows, and empty datasets.

### Task 5: Stream, cancel, and cache trace loads

**Files:**

- Create: `public/trace-loader.js`
- Create: `test/trace-loader.test.mjs`

**Security flag:** none

**Does NOT cover:** server-side tailing of a trace that is still being written.
Each response is treated as one bounded read.

- [x] **Step 1: Write chunk-boundary, progress, abort, and LRU tests**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { parseNdjsonResponse, TraceCache, SelectionCoordinator } from "../public/trace-loader.js";

test("parses JSON split across byte chunks and counts malformed rows", async () => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({ start(controller) {
    controller.enqueue(encoder.encode('{"record":"op","kernel":"q'));
    controller.enqueue(encoder.encode('mv"}\nnot-json\n'));
    controller.close();
  }});
  const progress = [];
  const result = await parseNdjsonResponse(new Response(stream), {
    onProgress: (value) => progress.push(value)
  });
  assert.equal(result.rows.length, 1);
  assert.equal(result.diagnostics.malformedRows, 1);
  assert.ok(progress.at(-1).parsedRows >= 1);
});

test("only the latest selection can publish", async () => {
  const coordinator = new SelectionCoordinator();
  const first = coordinator.begin("a");
  const second = coordinator.begin("b");
  assert.equal(first.signal.aborted, true);
  assert.equal(coordinator.isCurrent(first), false);
  assert.equal(coordinator.isCurrent(second), true);
});
```

- [x] **Step 2: Prove loader tests fail**

Run: `node --test test/trace-loader.test.mjs`  
Expected: FAIL with module-not-found for `public/trace-loader.js`.

- [x] **Step 3: Implement the loader contracts**

```js
export async function parseNdjsonResponse(response, { signal, onProgress, yieldEvery = 4000 } = {}) {}
export class TraceCache {
  constructor({ maxEntries = 2, maxSourceBytes = 128 * 1024 * 1024 } = {}) {}
  get(id) {}
  set(id, value, sourceBytes) {}
}
export class SelectionCoordinator {
  begin(id) {}      // aborts prior token and returns { id, generation, signal }
  isCurrent(token) {}
}
```

The parser uses `response.body.getReader()`, one streaming `TextDecoder`, carries
the incomplete final line between chunks, yields with `setTimeout(0)` every
`yieldEvery` parsed lines, reports bytes and row counts, and throws the native
`AbortError`. The cache refreshes recency on get, evicts oldest entries, and
does not retain an item larger than the byte budget.

- [x] **Step 4: Verify large-input responsiveness mechanically**

Run: `node --test test/trace-loader.test.mjs`  
Expected: PASS including a generated 100,000-row stream whose progress callback
fires before completion.

### Task 6: Build the semantic workbench shell and visual system

**Files:**

- Create: `public/index.html`
- Create: `public/styles.css`
- Create: `test/ui-contract.test.mjs`
- Remove: `index.html`

**Security flag:** none

**Does NOT cover:** populated chart rendering; empty/loading/error regions must
already be coherent before JavaScript fills them.

- [x] **Step 1: Write the static UI contract test**

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("workbench shell is semantic, accessible, and responsive", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  for (const id of ["trace-rail", "trace-status", "window-select", "metric-grid", "timeline",
    "inspector", "kernel-table", "wait-table"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /aria-label="Dispatch overlap timeline"/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /--exposed-host:/);
  assert.doesNotMatch(css, /linear-gradient|radial-gradient/);
});
```

- [x] **Step 2: Prove the shell test fails**

Run: `node --test test/ui-contract.test.mjs`  
Expected: FAIL because `public/index.html` does not exist.

- [x] **Step 3: Implement the complete empty/loading shell**

Create one `main` landmark, a compact header with wordmark, directory identity,
refresh and theme buttons; a `nav` trace rail; provenance and health strips; a
launch-window `select`; a semantic `dl` metric grid; a figure containing an accessible canvas and
timeline toolbar; an `aside` inspector; kernel and waits tables; and a single
status region with `aria-live="polite"`. Load `/app.js` as a module.

CSS must implement the spec palette through custom properties, visible
`:focus-visible`, tabular numeric metrics, 44px pointer targets, horizontal rail
overflow, responsive one-column layout, light theme via `[data-theme=light]`,
forced-colors-safe outlines, and reduced motion. Use no gradients or broad
`transition: all` rules.

Implement the desktop 304px inspector rail, 76px trace rail, 96px metric band,
360–440px plot, 980px inspector-stack breakpoint, and 760px narrow layout from
the renderer contract. The Canvas scroller must announce that horizontal
scrolling reveals more timeline detail and retain a 720px minimum drawing width
on narrow screens.

- [x] **Step 4: Verify the static presentation contract**

Run: `node --test test/ui-contract.test.mjs`  
Expected: PASS with all landmarks, accessibility hooks, themes, responsive
breakpoint, reduced motion, and restrained styling present.

### Task 7: Implement density-aware timeline geometry and Canvas interaction

**Files:**

- Create: `public/timeline.js`
- Create: `test/timeline.test.mjs`

**Security flag:** none

**Does NOT cover:** WebGL or offscreen-canvas acceleration; Canvas 2D density
binning is the measured scale strategy.

- [x] **Step 1: Write geometry tests independent of a browser canvas**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { buildDensityBins, clampViewport, timeToX, xToTime } from "../public/timeline.js";

test("density bins preserve counts and dominant kernel", () => {
  const bins = buildDensityBins([
    { atNs: 0, kernel: "qmv" }, { atNs: 1, kernel: "qmv" },
    { atNs: 9, kernel: "softmax" }
  ], { startNs: 0, endNs: 10, width: 2 });
  assert.equal(bins.reduce((sum, bin) => sum + bin.count, 0), 3);
  assert.equal(bins[0].dominantKernel, "qmv");
});

test("time and x transforms round trip", () => {
  const viewport = { startNs: 100, endNs: 200 };
  assert.equal(xToTime(timeToX(150, viewport, 1000), viewport, 1000), 150);
  assert.deepEqual(clampViewport({ startNs: -10, endNs: 20 }, { startNs: 0, endNs: 100 }),
    { startNs: 0, endNs: 30 });
});
```

- [x] **Step 2: Prove geometry tests fail**

Run: `node --test test/timeline.test.mjs`  
Expected: FAIL with module-not-found for `public/timeline.js`.

- [x] **Step 3: Implement geometry and `TimelineRenderer`**

```js
export function buildDensityBins(dispatches, { startNs, endNs, width }) {}
export function timeToX(timeNs, viewport, width) {}
export function xToTime(x, viewport, width) {}
export function clampViewport(viewport, bounds) {}
export class TimelineRenderer {
  constructor(canvas, { onInspect, onViewportChange } = {}) {}
  setDataset(dataset) {}
  fit() {}
  render() {}
  destroy() {}
}
```

Render separate host, GPU, wait, and dispatch lanes with a shared timing grid.
Exposed host uses solid coral, hidden host uses cyan hatching, GPU uses cyan,
decision drains use amber curtains, cap waits use amber triangles, and dependency
waits use dashed neutral markers. Draw density bins when average visible
dispatch spacing is below 3px and individual marks otherwise. Support pointer-
anchored wheel zoom, drag pan with pointer capture, double-click fit, resize via
`ResizeObserver`, device-pixel-ratio scaling, arrow-key pan, `+`/`-` zoom, and
`0` fit. `destroy()` removes every listener and observer.

Use ruler/host/GPU/waits/dispatch/footer lane heights of 28/68/68/46/72/24px.
Draw background, grid, boundaries, waits, host, GPU, dispatches, selection,
crosshair, then labels. A selected CB must highlight its encode fragments, GPU
interval, and dispatch range together. Use full-lane crosshair alignment and
marker shapes from the renderer contract; tooltips identify measured, derived,
ordered, and metadata values and never intercept pointer events.

- [x] **Step 4: Verify geometry before browser integration**

Run: `node --test test/timeline.test.mjs`  
Expected: PASS for empty data, count preservation, dominant-kernel ties,
clamping, zoom limits, and coordinate round trips.

### Task 8: Integrate registry, toggles, parsing, metrics, and inspector

**Files:**

- Create: `public/app.js`
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Modify: `README.md`
- Modify: `schema.md`
- Modify: `test/ui-contract.test.mjs`

**Security flag:** none

**Does NOT cover:** automatically comparing model throughput. Every trace is
shown in its own configuration and selected window.

- [x] **Step 1: Extend the UI contract for dynamic state hooks**

Add assertions that trace toggles use buttons, selection exposes
`aria-pressed`, table bodies have stable IDs, the URL selection parameter is
`trace` with `window` for launch selection, and no source uses `innerHTML` with
trace-derived strings. Add a test
that imports `public/app.js` with `globalThis.document` absent and verifies its
exported pure `chooseTraceId(registry, requestedId)` selection rules.

- [x] **Step 2: Prove integration tests fail**

Run: `node --test test/ui-contract.test.mjs`  
Expected: FAIL because `public/app.js` and dynamic contracts do not exist.

- [x] **Step 3: Implement the orchestration module**

```js
export function chooseTraceId(traces, requestedId) {}
export function traceLabel(trace) {}
export function metricRows(dataset) {}
export async function bootstrap({ fetchImpl = fetch } = {}) {}
```

On bootstrap: fetch the registry, render every file as a toggle, choose the
query-string ID or first trace, and load only that trace. On selection: begin a
`SelectionCoordinator` token, use cache or start one worker that fetches
`/api/traces/:id`, stream parses, normalizes, builds the dataset, and bounds the
Canvas payload, guard every publish with `isCurrent`, update
`?trace=&window=` through `history.replaceState`, and render provenance, health,
metrics, timeline, inspector, kernel census, and waits. Refresh must preserve
the selected ID when present. Use `textContent`, DOM constructors, and explicit
attributes for all trace-derived values.

Populate `window-select` from `dataset.launchWindows`; hide it for one launch,
preserve the requested window index when valid, and scope metrics, timeline,
inspector, census, and waits to the selected launch.

Theme selection uses `localStorage`, then `prefers-color-scheme`; refresh and
theme controls report state accessibly. Empty, malformed, unsupported,
incomplete, aborted, missing, and network-error paths each render the specified
status without falling back to a different trace.

Update README with install/start/folder-manifest commands and schema.md with the
public profiler names, legacy aliases, completeness semantics, and trace
manifest schema.

- [x] **Step 4: Run the full automated suite**

Run: `npm test`  
Expected: all package, registry, server, data, loader, timeline, and UI tests
PASS with no skipped tests.

### Task 9: Runtime and rendered-browser verification

**Files:**

- Modify only if verification exposes a defect in files already owned above.

**Security flag:** none

**Does NOT cover:** GPU capture; the showcase capture plan supplies those files.

- [x] **Step 1: Start the app against the current fixture folder**

Run: `npm start -- --trace-dir fixtures`  
Expected: listener reports `http://127.0.0.1:4173`, trace root label `fixtures`,
and no absolute path in HTTP JSON responses.

- [x] **Step 2: Exercise every endpoint**

Run:

```bash
curl -fsS http://127.0.0.1:4173/api/health
curl -fsS http://127.0.0.1:4173/api/traces
TRACE_ID=$(curl -fsS http://127.0.0.1:4173/api/traces | jq -r '.traces[0].id')
curl -fsS "http://127.0.0.1:4173/api/traces/$TRACE_ID" | head -n 1
```

Expected: healthy JSON, one or more registry entries, and one valid JSON row.

- [x] **Step 3: Inspect real desktop and narrow renders**

Use installed Chrome headless if available:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --hide-scrollbars --window-size=1440,1000 \
  --screenshot=/tmp/mdv-desktop.png http://127.0.0.1:4173/
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --hide-scrollbars --window-size=390,844 \
  --screenshot=/tmp/mdv-mobile.png http://127.0.0.1:4173/
```

Inspect both images for clipping, unreadable contrast, empty canvas, rail
overflow, and generic-card repetition. Exercise dark/light theme, keyboard
zoom/pan/fit, pointer zoom/pan, trace toggles, refresh, and the inspector in an
interactive browser.

Also inspect a grayscale copy of each screenshot and record the six render-
worker audit answers above. Reject the render if the first viewport is header-
heavy, if semantic categories collapse without color, if the Canvas is crushed
on narrow viewports, or if ordered dispatch placement looks measured.

- [x] **Step 4: Run the final non-GPU gate**

Run: `npm test && npm audit --omit=dev && git diff --check && git status --short`  
Expected: tests and audit green, no whitespace errors, only intended workbench,
docs, plan, and dependency files changed.
