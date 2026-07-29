# Silicon Observatory Readable Theater Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers-optimized:subagent-driven-development (recommended) or
> superpowers-optimized:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dark, amorphous Observatory scene with a bright,
trace-driven computational theater whose progress, current kernel, memory
presentation, and parallel execution are understandable within three seconds.

**Architecture:** Extend the construction-time scene model with the dispatch
geometry and command-buffer positions required by the presentation, then
convert it through a pure `buildStoryFrame()` boundary. React renders the
accessible progress, playback, legend, and evidence controls; Three.js renders
a fixed orthographic stage and export-visible labels from the same story frame.
The existing local-only trace and MP4 export boundaries remain unchanged.

**Tech Stack:** React 19, Three.js 0.185.1, shadcn/Radix primitives, Vitest,
Node test runner, Vite, Playwright/Chromium browser receipts.

**Assumptions:**

- Assumes profiler schema v1 continues to expose dispatch order, grids, binding
  counts, and optional command-buffer timing — it will not reconstruct exact
  tensor identities, addresses, or access direction.
- Assumes representative lane and memory-block counts are presentation
  aggregates — they will not claim literal Apple GPU core or allocation counts.
- Assumes the browser records the WebGL canvas — all essential export labels
  must therefore be rendered inside that canvas, with accessible DOM
  equivalents outside it.
- Assumes H.264 `MediaRecorder` support remains browser-dependent — it will not
  add a WebM fallback labeled as X-compatible.

---

## File Structure

- Create `src/observatory/story-frame.js` — pure trace-scene to presentation
  transformer; owns bounded aggregation, progress, labels, and evidence modes.
- Create `src/observatory/theater-labels.js` — pure formatting and canvas label
  texture helpers shared by the Three stage.
- Create `test/observatory-story-frame.test.mjs` — presentation invariants and
  bounded aggregation.
- Create `test/observatory-theater-labels.test.mjs` — export-visible label copy
  and deterministic formatting.
- Modify `src/observatory/scene-model.js` — retain normalized dispatch grid,
  elapsed position, and command-buffer ordinal at construction.
- Modify `src/observatory/scene-timing.js` — clamp automatic playback at the
  final frame and map scrubber positions safely.
- Modify `src/observatory/ObservatoryApp.jsx` — progress rail, scrubber, frame
  stepping, focusable region explanations, compact legend, evidence disclosure,
  and story-frame wiring.
- Modify `src/observatory/ObservatoryScene.jsx` — fixed orthographic
  computational-theater geometry and deterministic state updates.
- Modify `src/observatory/observatory.css` — high-luminance hierarchy,
  responsive stage, progress rail, drawer, and accessible controls.
- Modify `test/observatory-scene-model.test.mjs` — retained geometry and buffer
  position contracts.
- Modify `test/observatory-scene-timing.test.mjs` — monotonic playback and
  scrubbing contracts.
- Modify `test/observatory-app.test.jsx` — user-visible story, progress,
  stepping, disclosure, and reduced-motion behavior.
- Modify `README.md` — how to read the redesigned Observatory and the
  measured/derived/configured legend.

## Task 1: Build the Pure Story-Frame Boundary

**Files:**

- Create: `src/observatory/story-frame.js`
- Create: `test/observatory-story-frame.test.mjs`
- Modify: `src/observatory/scene-model.js`
- Modify: `src/observatory/scene-timing.js`
- Modify: `test/observatory-scene-model.test.mjs`
- Modify: `test/observatory-scene-timing.test.mjs`

**Security flag:** none

**Does NOT cover:** Exact GPU lane counts, tensor addresses, read/write
direction, or speculative acceptance. All visual counts remain bounded
representations with exact recorded geometry shown separately.

- [ ] **Step 1: Write failing scene-model and timing tests**

Add assertions that each frame retains normalized geometry and an ordinal
command-buffer position:

```js
assert.deepEqual(model.frames[0].grid, [64, 1, 1]);
assert.equal(model.frames[0].commandBuffer.position, 1);
assert.equal(model.frames[0].commandBuffer.total, 2);
assert.equal(model.frames[0].elapsedNs, 20);
```

Add monotonic playback and scrubber tests:

```js
assert.equal(nextObservatoryFrameIndex({
  current: 8,
  frameCount: 10,
  stride: 4,
}), 9);
assert.equal(frameIndexFromProgress({
  frameCount: 10,
  progress: 0.5,
}), 5);
assert.equal(frameIndexFromProgress({
  frameCount: 10,
  progress: 2,
}), 9);
```

- [ ] **Step 2: Run the focused tests and confirm the new contracts fail**

Run:

```sh
node --test test/observatory-scene-model.test.mjs \
  test/observatory-scene-timing.test.mjs
```

Expected: FAIL because frames do not retain grid/buffer presentation fields and
the timing helpers do not exist.

- [ ] **Step 3: Retain construction-time geometry and command-buffer position**

Normalize grids once in `scene-model.js`:

```js
function normalizedGrid(value) {
  const dimensions = Array.isArray(value) ? value.slice(0, 3) : [];
  return Object.freeze(
    [0, 1, 2].map((index) => {
      const dimension = dimensions[index];
      return Number.isFinite(dimension) && dimension > 0
        ? Math.floor(dimension)
        : 1;
    }),
  );
}
```

Build a command-buffer ordinal map from the launch command buffers and dispatch
references, then install immutable frame fields:

```js
{
  grid: normalizedGrid(dispatch?.grid),
  elapsedNs:
    Number.isFinite(dispatch?.atNs) && Number.isFinite(launch?.startNs)
      ? Math.max(0, dispatch.atNs - launch.startNs)
      : null,
  commandBuffer: Object.freeze({
    index: commandBufferIndex,
    position: commandBufferOrdinal ?? null,
    total: commandBufferCount || null,
  }),
}
```

This occurs in `buildSceneModel()`/`buildFrames()`, not in the animation loop.

- [ ] **Step 4: Add bounded timing helpers**

Implement in `scene-timing.js`:

```js
export function nextObservatoryFrameIndex({
  current,
  frameCount,
  stride = 1,
} = {}) {
  if (!Number.isSafeInteger(frameCount) || frameCount <= 0) return 0;
  const safeCurrent = Number.isSafeInteger(current)
    ? Math.min(frameCount - 1, Math.max(0, current))
    : 0;
  const safeStride =
    Number.isSafeInteger(stride) && stride > 0 ? stride : 1;
  return Math.min(frameCount - 1, safeCurrent + safeStride);
}

export function frameIndexFromProgress({
  frameCount,
  progress,
} = {}) {
  if (!Number.isSafeInteger(frameCount) || frameCount <= 1) return 0;
  const bounded = Number.isFinite(progress)
    ? Math.min(1, Math.max(0, progress))
    : 0;
  return Math.min(frameCount - 1, Math.round(bounded * (frameCount - 1)));
}
```

- [ ] **Step 5: Write the failing story-frame tests**

Create `test/observatory-story-frame.test.mjs` with a two-frame fixture and
assert:

```js
const story = buildStoryFrame(model, 1);
assert.equal(story.progress.percent, 80);
assert.equal(story.progress.dispatchLabel, "2 / 2");
assert.equal(story.progress.bufferLabel, "2 / 2");
assert.equal(story.active.family, "projection");
assert.equal(story.active.kernel, "steel_gemm_fused_q4");
assert.equal(story.active.shapeLabel, "64 × 4 × 1");
assert.equal(story.memory.blocks.length <= 28, true);
assert.equal(story.gpu.lanes.length <= 16, true);
assert.equal(story.flow.evidence, "derived");
assert.equal(story.speculation.evidence, "configured");
assert.equal(Object.isFrozen(story), true);
```

Also assert deterministic equality for repeated inputs and safe empty-model
output.

- [ ] **Step 6: Implement `buildStoryFrame()`**

Create `story-frame.js` with these exported constants and function:

```js
export const MAX_MEMORY_BLOCKS = 28;
export const MAX_GPU_LANES = 16;

export function buildStoryFrame(model, requestedFrameIndex = 0) {
  // Clamp the frame index.
  // Format captured-window, command-buffer, dispatch, and elapsed labels.
  // Aggregate parameter mass/dispatch coverage into 12–28 memory blocks.
  // Aggregate grid work into 4–16 representative GPU lanes.
  // Select deterministic active block/lane indices from frame index.
  // Return a recursively immutable presentation object.
}
```

The returned contract is:

```js
{
  index,
  progress: {
    ratio,
    percent,
    capturedWindowLabel,
    dispatchLabel,
    bufferLabel,
    elapsedLabel,
  },
  active: { family, kernel, shapeLabel, mathIntensity },
  memory: { blocks, activeIndices, exactMassLabel, evidence: "derived" },
  gpu: { lanes, activeIndices, gridLabel, evidence: "measured geometry" },
  flow: { active, intensity, label: "DERIVED BINDING FLOW", evidence: "derived" },
  speculation: {
    width,
    visible,
    label,
    evidence: "configured",
    acceptanceMeasured: false,
  },
  evidence: { level, summary },
}
```

- [ ] **Step 7: Run focused tests**

Run:

```sh
node --test test/observatory-scene-model.test.mjs \
  test/observatory-scene-timing.test.mjs \
  test/observatory-story-frame.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit Task 1**

```sh
git add src/observatory/scene-model.js \
  src/observatory/scene-timing.js \
  src/observatory/story-frame.js \
  test/observatory-scene-model.test.mjs \
  test/observatory-scene-timing.test.mjs \
  test/observatory-story-frame.test.mjs
git commit -m "feat: derive readable Observatory story frames"
```

## Task 2: Install the Progress-First Interaction Hierarchy

**Files:**

- Modify: `src/observatory/ObservatoryApp.jsx`
- Modify: `src/observatory/observatory.css`
- Modify: `test/observatory-app.test.jsx`

**Security flag:** none

**Does NOT cover:** Scrubbing raw profiler timestamps or selecting arbitrary
launch windows. The scrubber addresses only the frames already installed in the
current Observatory scene model.

- [ ] **Step 1: Write failing UI tests**

Extend `SceneStub` to expose story-frame fields and assert that the ready state
contains:

```js
expect(container.textContent).toMatch(/Captured window/i);
expect(container.textContent).toMatch(/Dispatch 1 \\/ 2/i);
expect(container.textContent).toMatch(/Buffer 1 \\/ 1/i);
expect(container.textContent).toMatch(/Unified memory/i);
expect(container.textContent).toMatch(/Active math/i);
expect(container.textContent).toMatch(/Configured speculation/i);
expect(
  container.querySelector('input[aria-label="Captured window position"]'),
).not.toBeNull();
expect(
  container.querySelector('details[aria-label="What is measured?"]'),
).not.toBeNull();
expect(
  container.querySelector('[aria-label="Explain stage regions"]'),
).not.toBeNull();
```

Add interaction tests:

```js
await clickButton("Pause animation");
await clickButton("Step forward one dispatch");
expect(scene().dataset.frame).toBe("1");

const scrubber = container.querySelector(
  'input[aria-label="Captured window position"]',
);
scrubber.value = "0";
scrubber.dispatchEvent(new Event("input", { bubbles: true }));
expect(scene().dataset.frame).toBe("0");
expect(scene().dataset.animated).toBe("false");
```

Assert that reduced-motion mode exposes enabled step controls and keeps
continuous animation off. Focus the `Unified memory` region control and assert
that its explanation names aggregated model blocks; focus `GPU lanes` and
assert that its explanation calls them representative rather than physical
cores.

- [ ] **Step 2: Run the app test and confirm failure**

Run:

```sh
npx vitest run test/observatory-app.test.jsx
```

Expected: FAIL because the progress rail, scrubber, step controls, legend, and
evidence disclosure do not exist.

- [ ] **Step 3: Wire a single story frame into React and Three**

Memoize the presentation:

```jsx
const storyFrame = useMemo(
  () => buildStoryFrame(sceneModel, frameIndex),
  [frameIndex, sceneModel],
);
```

Pass `storyFrame` to `SceneComponent`, replace modulo playback with
`nextObservatoryFrameIndex()`, and implement:

```jsx
const seekFrame = (nextIndex) => {
  setPlaying(false);
  setFrameIndex(Math.min(frameCount - 1, Math.max(0, nextIndex)));
};
```

- [ ] **Step 4: Replace the old readout and zone labels**

Render a `observatory-story-hud` containing:

```jsx
<section className="observatory-progress" aria-label="Captured trace progress">
  <div className="progress-copy">
    <span>Captured window</span>
    <strong>{storyFrame.progress.percent}%</strong>
    <span>Buffer {storyFrame.progress.bufferLabel}</span>
    <span>Dispatch {storyFrame.progress.dispatchLabel}</span>
    <span>{storyFrame.progress.elapsedLabel}</span>
  </div>
  <input
    aria-label="Captured window position"
    type="range"
    min="0"
    max={Math.max(0, frameCount - 1)}
    value={frameIndex}
    onInput={(event) => seekFrame(Number(event.currentTarget.value))}
  />
</section>
```

Add a large active-operation card and a permanent legend with text and distinct
line treatments. Add three visibly attached, keyboard-focusable region controls
for `Unified memory`, `Active kernel`, and `GPU lanes`; focus and pointer entry
update a concise `aria-live` explanation immediately beside the stage. Remove
the SSD/CPU/GPU free-floating zone-label overlay.

- [ ] **Step 5: Add frame stepping and progressive evidence disclosure**

Add buttons labeled `Step backward one dispatch` and
`Step forward one dispatch`. Replace the always-open rail with:

```jsx
<details className="observatory-evidence" aria-label="What is measured?">
  <summary>What is measured?</summary>
  <EvidenceDetails model={sceneModel} activeFrame={storyFrame.active} />
</details>
```

`EvidenceDetails` includes the raw current kernel name. Keep the evidence level
in a compact always-visible badge beside the progress rail.

- [ ] **Step 6: Rebuild CSS hierarchy**

Use a slate canvas (`#0b1118` range), visible inactive surfaces, a stage that
dominates the viewport, and 16px minimum mobile copy. Make the progress rail
and active operation the two strongest typographic elements. Keep 44px controls,
visible focus rings, no horizontal overflow, and reduced-motion guards.

- [ ] **Step 7: Run UI and timing tests**

Run:

```sh
npx vitest run test/observatory-app.test.jsx
node --test test/observatory-scene-timing.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit Task 2**

```sh
git add src/observatory/ObservatoryApp.jsx \
  src/observatory/observatory.css \
  test/observatory-app.test.jsx
git commit -m "feat: make Observatory progress and meaning explicit"
```

## Task 3: Replace the Scene with the Computational Theater

**Files:**

- Create: `src/observatory/theater-labels.js`
- Create: `test/observatory-theater-labels.test.mjs`
- Modify: `src/observatory/ObservatoryScene.jsx`
- Modify: `src/observatory/observatory.css`
- Modify: `test/observatory-scene-timing.test.mjs`

**Security flag:** none

**Does NOT cover:** A free camera, literal chip floorplan, physical core counts,
or ambient animation unrelated to the active story frame.

- [ ] **Step 1: Write failing label and renderer-contract tests**

Create formatting tests:

```js
const labels = buildTheaterLabels(storyFrame);
assert.equal(labels.progress, "CAPTURED WINDOW 80%");
assert.equal(labels.memory, "UNIFIED MEMORY · ~17.5 GB");
assert.equal(labels.kernel, "PROJECTION · 64 × 4 × 1");
assert.equal(labels.gpu, "16 REPRESENTATIVE LANES · GRID 64 × 4 × 1");
assert.equal(labels.flow, "DERIVED BINDING FLOW");
assert.equal(labels.speculation, "CONFIGURED SPECULATION · K3");
assert.equal(
  labels.legend,
  "CYAN MEMORY · AMBER MATH · VIOLET CONFIGURED",
);
```

Extend the renderer source contract to assert `OrthographicCamera` is used and
continuous camera oscillation is absent:

```js
assert.match(source, /new THREE\\.OrthographicCamera\\(/);
assert.doesNotMatch(source, /camera\\.position\\.x\\s*=\\s*Math\\.sin/);
```

- [ ] **Step 2: Run focused tests and confirm failure**

Run:

```sh
node --test test/observatory-theater-labels.test.mjs \
  test/observatory-scene-timing.test.mjs
```

Expected: FAIL because the theater-label module and orthographic scene do not
exist.

- [ ] **Step 3: Implement export-visible label plates**

Create `theater-labels.js` with pure `buildTheaterLabels(storyFrame)` and
Three.js canvas-texture helpers:

```js
export function createTextPlate(THREE, {
  text,
  width,
  height,
  foreground,
  background,
}) {
  // Create a bounded 2D canvas, render high-contrast text, create a
  // CanvasTexture, and return a sprite plus an update(nextText) method.
}
```

Canvas dimensions, font, alignment, padding, and colors are fixed constants so
labels remain deterministic and readable in 1280×720 exports.

- [ ] **Step 4: Construct the fixed architectural stage once**

Replace the current floating scene with:

- An orthographic camera fitted on resize
- A 4×7 memory wall on the left
- One large center kernel plate with geometric subdivisions
- A bounded 4×4 GPU lane bank on the right
- A five-segment CPU command rail above
- One memory-to-kernel ribbon and one labeled derived return path
- A separate dashed violet speculation branch
- A top progress plate and attached region labels

Use ambient and directional lighting strong enough for inactive geometry to
remain visible. Remove scene fog, the SSD block, camera drift, model rotation,
and ambient particle cloud.

- [ ] **Step 5: Update only preinstalled scene objects per frame**

The render update:

- Illuminates deterministic memory block indices
- Updates the active-kernel plate color and subdivisions
- Pulses only active representative lanes
- Shows math particles only inside the kernel plate
- Advances one flow pulse along the active derived path
- Shows the speculation branch only when configured
- Updates existing text plates instead of reconstructing scene objects

No model validation, environment reads, fallback routing, counters, or geometry
allocation occurs in the animation loop.

- [ ] **Step 6: Add responsive camera fitting and static invalidation**

Resize changes orthographic bounds while preserving the full reading order.
Paused, hidden, and reduced-motion scenes render only when their frame, size, or
visibility state changes.

- [ ] **Step 7: Run focused tests and production build**

Run:

```sh
node --test test/observatory-story-frame.test.mjs \
  test/observatory-theater-labels.test.mjs \
  test/observatory-scene-timing.test.mjs
npx vitest run test/observatory-app.test.jsx
npm run build
```

Expected: all tests PASS and Vite completes the Observatory chunk.

- [ ] **Step 8: Commit Task 3**

```sh
git add src/observatory/ObservatoryScene.jsx \
  src/observatory/observatory.css \
  src/observatory/theater-labels.js \
  test/observatory-theater-labels.test.mjs \
  test/observatory-scene-timing.test.mjs
git commit -m "feat: render the Observatory computational theater"
```

## Task 4: Prove Readability, Export Fidelity, and Regression Safety

**Files:**

- Modify: `README.md`
- Modify: `test/observatory-app.test.jsx`

**Security flag:** none

**Does NOT cover:** New video codecs, server-side rendering, uploading traces or
media, or changing the existing workbench route.

- [ ] **Step 1: Add final UI contract assertions**

Assert that the DOM contains one primary progress region, one active-operation
heading, one persistent legend, and a collapsed evidence disclosure. Assert
that the old `SSD reservoir` and free-floating `observatory-zones` are absent.

Add a source/CSS contract test for:

```js
assert.match(css, /@media \\(min-width: 768px\\)/);
assert.match(css, /@media \\(min-width: 1024px\\)/);
assert.match(css, /@media \\(prefers-reduced-motion: reduce\\)/);
assert.doesNotMatch(appSource, /SSD reservoir/);
```

- [ ] **Step 2: Update the README reading guide**

Document the stable reading order:

```text
Unified memory → active kernel → representative GPU lanes → derived writeback
```

Explain captured-window progress, the cyan/amber/violet legend, representative
lane aggregation, configured speculation, the hidden SSD, and the fact that
PNG/MP4 exports include the stage annotations.

- [ ] **Step 3: Run the complete automated gate**

Run:

```sh
npm test
npm run build
npm run verify:pages
npm audit --audit-level=high
git diff --check origin/main...HEAD
```

Expected: all tests PASS, build succeeds, Pages artifact verifies, audit reports
zero high-severity vulnerabilities, and the diff check is clean.

- [ ] **Step 4: Run browser readability receipts**

Start the built server:

```sh
npm start
```

At 375, 768, 1024, and 1440 CSS pixels, capture the Observatory after the Qwen
27B trace is ready and verify:

- The captured-window percentage and current dispatch are visible without
  interaction
- Memory, active kernel, and GPU lanes are visually separable
- The active operation is the brightest subject
- Labels are attached to their corresponding geometry
- The evidence drawer is closed by default and keyboard-operable
- No horizontal overflow exists
- Reduced motion permits stepping without continuous RAF rendering

Repeat one desktop receipt for Qwen 35B and save screenshots under `/tmp`.

- [ ] **Step 5: Verify annotated exports**

Save a PNG and record an MP4 from the real browser. Confirm the exported frames
visibly contain:

- Captured-window progress
- Active kernel family and geometry
- Unified-memory and GPU labels
- Measured/derived/configured legend

Confirm the MP4 still parses as ISO MP4 with an `avc1` track at 1280×720.

- [ ] **Step 6: Request focused review**

Review against the approved spec, with special attention to:

- Whether a first-time viewer can state what is happening
- Evidence honesty
- Recorder lifecycle and gallery transitions
- Reduced motion and mobile control reachability

Fix all blocking findings and rerun affected gates.

- [ ] **Step 7: Commit and push**

```sh
git add README.md \
  test/observatory-app.test.jsx \
  docs/specs/2026-07-29-silicon-observatory-readable-theater-design.md \
  docs/plans/2026-07-29-silicon-observatory-readable-theater.md
git commit -m "feat: make Silicon Observatory readable"
git push origin agent/silicon-observatory
```

Expected: remote `agent/silicon-observatory` resolves to the verified local
HEAD. Do not open or merge a PR unless separately requested.
