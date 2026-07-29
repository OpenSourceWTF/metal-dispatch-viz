# Silicon Observatory Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-optimized:subagent-driven-development (recommended) or superpowers-optimized:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full-screen, trace-driven Silicon Observatory mode that animates the Qwen showcase traces, accepts local MLX profiler files, and exports the canvas locally.

**Architecture:** `src/main.jsx` selects the existing workbench or Observatory from the `mode=observatory` URL parameter. Observatory reuses the existing registry, trace URL, Web Worker analysis, and compact dataset contracts; pure scene-model code turns those records into deterministic visual instructions. A React shell owns loading, gallery playback, import, evidence labels, and export while one raw Three.js renderer owns the WebGL scene and is disposed on unmount.

**Tech Stack:** React 19, Three.js 0.185.1, existing shadcn/Radix components, Tailwind CSS 4 compatibility layer, Vitest/jsdom, Node test runner.

**Assumptions:**

- Assumes schema-v1 dispatch census rows expose command-buffer timing, ordered dispatches, kernel names, grid/threadgroup dimensions, and binding counts — it will NOT claim exact tensor identity, buffer addresses, access direction, or SSD traffic.
- Assumes gallery candidates are discovered from registry metadata — it will NOT depend on fixed trace filenames or a fixed showcase count.
- Assumes model parameter scale can be parsed from metadata such as `27B` and `35B` — local traces without model metadata will use trace-topology geometry and show “architecture metadata unavailable.”
- Assumes `canvas.captureStream` and H.264 MP4 `MediaRecorder` support are available for X-ready movie export — unsupported browsers retain PNG snapshot export and explain why recording is unavailable.

---

## File Structure

- Modify `package.json` and `package-lock.json`: add exactly pinned `three@0.185.1`.
- Modify `src/main.jsx`: select Workbench or Observatory from URL state.
- Create `src/observatory/scene-model.js`: pure evidence classification, gallery discovery, model-mass parsing, kernel-family grouping, and animation-frame derivation.
- Create `src/observatory/trace-source.js`: registry/local-file loading boundary using existing worker analysis.
- Create `src/observatory/export.js`: canvas snapshot and MediaRecorder lifecycle.
- Create `src/observatory/ObservatoryScene.jsx`: Three.js renderer lifecycle and deterministic scene updates.
- Create `src/observatory/ObservatoryApp.jsx`: full-screen accessible shell, loader, gallery transport, local import, disclosures, and export controls.
- Create `src/observatory/observatory.css`: scoped spatial-instrument visual system and responsive/reduced-motion rules.
- Create `test/observatory-scene-model.test.mjs`: pure transformation contracts.
- Create `test/observatory-trace-source.test.mjs`: registry discovery and local-file cleanup contracts.
- Create `test/observatory-export.test.mjs`: browser-local export contracts.
- Create `test/observatory-app.test.jsx`: routing, states, transport, upload, evidence, and accessibility contracts.

### Task 1: Install the isolated rendering dependency

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

**Security flag:** none

- [x] **Step 1: Record the dependency baseline**

Run:

```bash
npm outdated
npm audit
npm test
npm run build
```

Expected: the existing dependency set is reported without modification; audit, tests, and build succeed.

- [x] **Step 2: Install one exact production dependency**

Run:

```bash
npm install --save-exact three@0.185.1
```

Expected: only `package.json` and `package-lock.json` change; `three` is recorded as `"0.185.1"`.

- [x] **Step 3: Verify dependency compatibility**

Run:

```bash
npm test
npm run build
npm audit
```

Expected: tests and build succeed; audit reports zero vulnerabilities.

- [x] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add three 0.185.1"
```

### Task 2: Derive visual geometry from trace evidence

**Files:**
- Create: `src/observatory/scene-model.js`
- Create: `src/observatory/trace-source.js`
- Create: `test/observatory-scene-model.test.mjs`
- Create: `test/observatory-trace-source.test.mjs`

**Security flag:** security

**Does NOT cover:** This task accepts only registry entries and browser-selected `.jsonl`/`.ndjson` files; it does not fetch arbitrary user-entered URLs or infer absent tensor/storage events.

- [x] **Step 1: Write failing scene-model tests**

Create fixtures inline in `test/observatory-scene-model.test.mjs` and assert:

```js
const registry = {
  traces: [
    { id: "x", model: "GLM-5.2", relativePath: "glm.jsonl" },
    { id: "a", model: "Qwen3.6 35B-A3B", relativePath: "a3b.jsonl", mode: "MTP K1" },
    { id: "b", model: "Qwen3.6 27B", relativePath: "27b.jsonl", mode: "MTP K3" },
  ],
};

assert.deepEqual(
  discoverObservatoryGallery(registry).map(({ id }) => id),
  ["b", "a"],
);
assert.equal(parseParameterCountBillions("Qwen3.6 35B-A3B"), 35);
assert.equal(parseParameterCountBillions("unlabeled capture"), null);

const model = buildSceneModel({
  trace: registry.traces[2],
  dataset: qwenFixtureDataset,
});
assert.equal(model.evidence.memory, "manifest-derived estimate");
assert.equal(model.evidence.dispatch, "measured order");
assert.equal(model.speculation.configuredWidth, 3);
assert.equal(model.speculation.acceptanceMeasured, false);
assert.ok(model.kernelFamilies.every(({ share }) => share > 0));
assert.ok(model.frames.every((frame) => frame.progress >= 0 && frame.progress <= 1));
```

Also assert that missing metadata yields topology geometry with no invented parameter count, and that buffer-bind ribbons are labeled “binding activity,” not reads or writes.

- [x] **Step 2: Run tests to verify RED**

Run:

```bash
node --test test/observatory-scene-model.test.mjs test/observatory-trace-source.test.mjs
```

Expected: FAIL because the Observatory modules do not exist.

- [x] **Step 3: Implement the pure model and source boundary**

Export these exact interfaces:

```js
export function discoverObservatoryGallery(registry) {}
export function parseParameterCountBillions(modelLabel) {}
export function classifyKernelFamily(kernelName) {}
export function buildSceneModel({ trace, dataset }) {}

export async function loadObservatoryRegistry({ fetchImpl, baseUrl }) {}
export function createGalleryTraceSource({ trace, hosted, baseUrl }) {}
export function createLocalTraceSource(file, { createObjectURL, revokeObjectURL }) {}
```

Implementation rules:

- Gallery discovery filters registry entries whose normalized `model`, `label`, or `checkpoint` includes `qwen`; entries with a parsed parameter count sort ascending, then by stable ID. No filename list and no trace-count assertion.
- Parameter count uses `/(?:^|[^0-9])(\d+(?:\.\d+)?)\s*b(?:[^a-z]|$)/i` and returns a finite positive number or `null`.
- Kernel families are deterministic name-derived groups: attention, projection/matmul, normalization, routing, activation, embedding/output, transfer/binding, and other.
- Scene model uses the first non-empty launch window, preserves compact dispatch order, derives frame progress from placed dispatch time, and falls back to ordinal progress only when timing is absent.
- Unified-memory volume uses parameter count and quantization metadata only as a visibly labeled estimate; no CPU-memory/GPU-memory split is created.
- MTP width is parsed from `/\bMTP\s*K(\d+)\b/i` and described as configured speculative width, never observed acceptance.
- `createLocalTraceSource` accepts `.jsonl` and `.ndjson` case-insensitively, returns a blob URL source, and exposes an idempotent `release()` that revokes only that URL.

- [x] **Step 4: Run tests to verify GREEN**

Run:

```bash
node --test test/observatory-scene-model.test.mjs test/observatory-trace-source.test.mjs
```

Expected: all Observatory model/source tests pass.

- [x] **Step 5: Commit**

```bash
git add src/observatory/scene-model.js src/observatory/trace-source.js test/observatory-scene-model.test.mjs test/observatory-trace-source.test.mjs
git commit -m "feat: derive observatory scenes from trace evidence"
```

### Task 3: Render the full-screen Observatory and gallery transport

**Files:**
- Modify: `src/main.jsx`
- Create: `src/observatory/ObservatoryScene.jsx`
- Create: `src/observatory/ObservatoryApp.jsx`
- Create: `src/observatory/observatory.css`
- Create: `test/observatory-app.test.jsx`

**Security flag:** none

**Does NOT cover:** The Three.js ribbons visualize measured binding intensity and command-buffer activity; they do not represent exact memory addresses or prove SSD reads.

- [x] **Step 1: Write failing UI contracts**

In `test/observatory-app.test.jsx`, render with injected registry/session/scene adapters and assert:

```jsx
expect(container.querySelector("main.observatory")).not.toBeNull();
expect(container.querySelector("h1").textContent).toMatch(/Silicon Observatory/i);
expect(container.querySelector('[aria-label="Observatory playback controls"]')).not.toBeNull();
expect(container.querySelector('input[type="file"][accept=".jsonl,.ndjson"]')).not.toBeNull();
expect(container.textContent).toMatch(/Unified memory/i);
expect(container.textContent).toMatch(/Binding activity is derived/i);
expect(container.textContent).toMatch(/SSD activity is not present/i);
expect(container.querySelector('[aria-live="polite"]')).not.toBeNull();
```

Test loading skeleton, recoverable error with retry, empty registry with local-upload action, gallery auto-advance, pause/resume, next/previous, local import, unmount cancellation, and `prefers-reduced-motion`. Test `src/main.jsx` route selection through an exported `resolveAppMode(search)`.

- [x] **Step 2: Run tests to verify RED**

Run:

```bash
npx vitest run test/observatory-app.test.jsx
```

Expected: FAIL because the route and components do not exist.

- [x] **Step 3: Implement the React shell and Three.js lifecycle**

`ObservatoryScene` must:

- create one `WebGLRenderer`, `PerspectiveCamera`, scene, lights, and deterministic object groups in a mount-only effect;
- render one continuous unified-memory plane, separate SSD reservoir, CPU command lattice, GPU kernel field, model-volume lattice, math particles, and binding ribbons;
- update object intensity/visibility from the current frame without rebuilding the renderer;
- use `ResizeObserver`, cap pixel ratio at 2, pause when the document is hidden, and dispose every geometry, material, renderer, animation frame, and observer on unmount;
- disable camera drift and continuous particle travel when reduced motion is active.

`ObservatoryApp` must:

- load the registry immediately and choose the first discovered Qwen candidate;
- load traces through the existing `TraceAnalysisSession` worker boundary with real progress;
- show loading, error/retry, empty/import, success, and incomplete-evidence states;
- auto-advance frames and rotate gallery candidates after 18 seconds unless paused or reduced motion is active;
- expose Previous, Play/Pause, Next, speed, Workbench, Open trace, and Import trace controls with 44px minimum targets;
- display evidence chips for measured timing, measured dispatch order, configured MTP width, estimated model mass, derived binding activity, and unavailable SSD events;
- keep one `<h1>`, semantic regions, keyboard controls, visible focus, and a skip link.

In `src/main.jsx`:

```jsx
export function resolveAppMode(search) {
  return new URLSearchParams(search).get("mode") === "observatory"
    ? "observatory"
    : "workbench";
}
```

Render `<ObservatoryApp />` only for Observatory mode and preserve `<ProfilerApp />` unchanged otherwise.

- [x] **Step 4: Add scoped visual design**

Use `observatory.css` tokens under `.observatory` only:

- OLED canvas (`#050608`) with neutral graphite structures, cyan measured activity, amber derived activity, and violet configured speculation;
- asymmetric full-viewport stage with a narrow evidence rail rather than a grid of equal cards;
- system sans for labels and system mono for measurements;
- 375/768/1024/1440 responsive layouts, safe-area padding, no horizontal scrolling;
- shimmer only during loading, transform/opacity-only transitions, and a complete `prefers-reduced-motion: reduce` override.

- [x] **Step 5: Run tests to verify GREEN**

Run:

```bash
npx vitest run test/observatory-app.test.jsx test/react-shell.test.jsx
npm run build
```

Expected: Observatory and existing shell tests pass; Vite builds the Three.js scene without changing the workbench route.

- [x] **Step 6: Commit**

```bash
git add src/main.jsx src/observatory/ObservatoryScene.jsx src/observatory/ObservatoryApp.jsx src/observatory/observatory.css test/observatory-app.test.jsx
git commit -m "feat: add Silicon Observatory gallery"
```

### Task 4: Add browser-local animation export and complete verification

**Files:**
- Create: `src/observatory/export.js`
- Modify: `src/observatory/ObservatoryApp.jsx`
- Modify: `src/observatory/ObservatoryScene.jsx`
- Create: `test/observatory-export.test.mjs`
- Modify: `test/observatory-app.test.jsx`
- Modify: `README.md`

**Security flag:** security

**Does NOT cover:** Export never uploads traces or rendered media, and it does not add client-side transcoding; native H.264 MP4 recording depends on browser support while PNG remains available.

- [x] **Step 1: Write failing export tests**

Assert:

```js
assert.equal(selectRecordingMimeType({ isTypeSupported: () => false }), null);
assert.equal(
  selectRecordingMimeType({
    isTypeSupported: (type) => type === "video/mp4;codecs=avc1.42E01E",
  }),
  "video/mp4;codecs=avc1.42E01E",
);
assert.match(observatoryExportFilename("Qwen3.6 27B", "mp4"), /^silicon-observatory-qwen3-6-27b-\d{8}t\d{6}z\.mp4$/);
```

Test one `start()`/`stop()` MediaRecorder lifecycle, object URL download/revocation, PNG snapshot download, unsupported recording copy, and disabled duplicate recording.

- [x] **Step 2: Run tests to verify RED**

Run:

```bash
node --test test/observatory-export.test.mjs
npx vitest run test/observatory-app.test.jsx
```

Expected: FAIL because export helpers and controls do not exist.

- [x] **Step 3: Implement local export**

Export:

```js
export function selectRecordingMimeType(MediaRecorderClass) {}
export function observatoryExportFilename(label, extension, now = new Date()) {}
export function downloadCanvasPng(canvas, options) {}
export function createCanvasRecorder(canvas, options) {}
```

`createCanvasRecorder` letterboxes the live canvas into a fixed 1280×720 surface, captures H.264 MP4 at 30 fps and 8 Mbps, collects non-empty chunks, downloads one MP4 on stop, revokes the object URL, prevents a second concurrent recording, and exposes `{ supported, recording, start, stop, destroy }`. `ObservatoryScene` forwards its canvas through `onCanvasReady`; `ObservatoryApp` provides “Record MP4 / Stop recording” and “Save PNG” controls with `aria-live` status.

- [x] **Step 4: Document the prototype contract**

Add a README section containing:

```text
Open `?mode=observatory` for Silicon Observatory. The gallery discovers Qwen
runs from registry metadata, and local .jsonl/.ndjson files stay in the
browser. Timing and dispatch order are measured; model mass, binding ribbons,
and particle choreography are derived visual encodings. Schema v1 does not
contain tensor identities, exact buffer access direction, or SSD I/O events.
H.264 MP4 and PNG exports are generated locally.
```

- [x] **Step 5: Run final verification**

Run:

```bash
npm test
npm run build
npm run verify:pages
npm audit
git diff --check
```

Expected: all tests pass; build and Pages verification succeed; audit reports zero vulnerabilities; diff check is clean.

Then run the local server and inspect at 375, 768, 1024, and 1440 CSS pixels:

```bash
npm start
```

Verify keyboard controls, reduced motion, Qwen 27B/35B gallery cycling, one local upload, one PNG snapshot, one H.264 MP4 recording, loader/error/empty states, and no horizontal scroll.

- [x] **Step 6: Commit**

```bash
git add README.md src/observatory/export.js src/observatory/ObservatoryApp.jsx src/observatory/ObservatoryScene.jsx test/observatory-export.test.mjs test/observatory-app.test.jsx
git commit -m "feat: export observatory animations locally"
```
