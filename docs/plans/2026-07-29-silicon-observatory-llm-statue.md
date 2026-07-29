# Silicon Observatory LLM Statue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers-optimized:subagent-driven-development (recommended) or
> superpowers-optimized:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three-column dispatch theater with a full-screen,
architecture-shaped LLM sculpture whose causal motion communicates layer
activation, unified-memory access, CPU dispatch, GPU work, kernel identity,
parallelism, and configured speculation without explanatory dashboard chrome.

**Architecture:** Normalize checkpoint architecture once when a trace is
installed, then combine it with immutable measured dispatch frames at a pure
presentation boundary. A Three.js scene controller preallocates the complete
model statue, hardware orbit, kernel-glyph family pool, ribbons, particles,
labels, and world-space instruments; frame updates change only transforms,
visibility, and material uniforms. React owns trace loading, gallery playback,
local-only imports, accessibility semantics, and export commands while the
ready-state visual interface lives inside the Three.js scene.

**Tech Stack:** React 19, Three.js 0.185.1, Vite 8, Tailwind CSS 4 and the
existing shadcn-compatible primitives, Node test runner, Vitest/jsdom, Safari
WebDriver browser receipts, H.264 canvas recording, and PNG canvas capture.

**Assumptions:**

- Assumes the current profiler schema records dispatch order, raw kernel name,
  dispatch mode, grid, threadgroup, command-buffer association, buffer binds,
  and set-bytes activity — it will NOT recover an exact transformer layer,
  activation tensor, memory direction, routed expert identity, or physical die
  location without a future semantic profiler record.
- Assumes hosted Qwen traces can carry normalized checkpoint architecture in
  manifest metadata — a hosted trace without that metadata receives an unknown
  sculpture and will NOT be assigned architecture from its filename.
- Assumes a local user can optionally select `config.json` after selecting a
  profiler trace — the browser will NOT upload it or fetch checkpoint metadata
  remotely.
- Assumes simulated layer traversal is synchronized to measured trace progress
  and rendered with a ghosted material plus `SIM` sigil — it will NOT be
  described as measured layer execution.
- Assumes configured MTP width and top-k fan-out are presentation branches —
  they will NOT be described as measured speculative acceptance or measured
  expert routing.
- Assumes MP4 remains the X-compatible animation target when the browser
  exposes an H.264 `MediaRecorder` path — unsupported browsers retain PNG and
  will NOT receive a WebM file mislabeled as MP4.
- Assumes the existing feature branch and worktree remain the implementation
  boundary — no work is performed on `main`.

---

## Design System

**Design System:** Spatial computational sculpture — motion-driven
retro-aerospace minimalism.

**Colors:** blue-charcoal atmosphere / pale architecture wireframe /
white-gold activation / cyan unified memory / cool-blue CPU / hot-violet GPU /
amber math / coral evidence caution.

**Typography:** existing Inter and SFMono stack, restricted in the idle scene to
model identity, active layer or stage, exact kernel name, and conditional `SIM`.

**Effects:** bounded perspective orbit, focus-plus-context layer expansion,
phosphor afterimage, deterministic ribbon travel, family-specific mechanical
kernel assembly, restrained bloom, depth fog, and world-space parallax.

**Avoid:** `GridHelper`, floor grids, three-column diagrams, flat HUDs, cards,
legends, tutorials, random particles, generic cyberpunk rain, excessive bloom,
fictional SSD activity, and text that explains what stable form and motion must
communicate.

## Requirement-to-Evidence Map

| Requirement | Authoritative implementation evidence |
| --- | --- |
| Actual Qwen architecture shapes | `architecture.js` normalization tests plus manifest assertions for 64-layer dense 27B and 40-layer/256-expert 35B-A3B |
| Every layer visible and active layer identifiable | Three scene-graph tests count exact layer ribs; browser receipts inspect both candidates |
| Layer-by-layer activation | `buildStatueFrame()` tests prove deterministic layer/stage traversal; captures show travelling residual ribbon and opened focus layer |
| Unified memory, CPU dispatch, GPU work | presentation tests prove binding and command-buffer gates; scene tests prove ribbons terminate at active layer |
| Exact kernel plus recognizable family shape | kernel-glyph descriptor tests retain raw name and produce stable, bounded family geometry |
| Parallelism and speculation | representative GPU lanes derive from measured grid/overlap; ghost branches derive from configured MTP width and remain non-measured |
| Minimal standalone animation | app and CSS contracts forbid persistent HUD/cards/legend/control bar; idle browser capture shows instruments retracted |
| UI exists in 3D | scene graph contains world-space instrument group and raycast targets; interaction capture proves parallax |
| Easy gallery and local import | app tests cover automatic gallery cycling, trace upload, optional config upload, and local-only URL cleanup |
| PNG and X-compatible movie | export tests retain PNG and H.264 MP4; browser receipt records the canvas without DOM chrome |
| Responsive and accessible | Vitest checks semantic mirror controls; receipts cover 375, 768, 1024, and 1440 widths plus reduced motion |

## File Structure

- Create `src/observatory/architecture.js` — normalize and deeply freeze hosted
  architecture metadata or raw checkpoint configs; reject invalid topology
  before scene installation.
- Create `src/observatory/kernel-glyph.js` — classify exact kernel dispatches
  into stable, bounded mechanical geometry descriptors.
- Create `src/observatory/statue-state.js` — pure architecture-plus-trace
  presentation state for active layer, transformer stage, hardware gates,
  inscriptions, evidence materials, and world instruments.
- Create `src/observatory/statue-geometry.js` — allocate the central layer
  sculpture, dense/MoE internals, expert field, hardware orbit, kernel pool,
  ribbons, particles, and spatial control meshes once.
- Create `src/observatory/world-labels.js` — restrained canvas-texture sprites
  for the three idle inscriptions and temporary inspection rings.
- Create `test/observatory-architecture.test.mjs` — nested/top-level checkpoint
  normalization, pattern expansion, validation, and immutability.
- Create `test/observatory-kernel-glyph.test.mjs` — exact identity, stable hash,
  bounded grid/threadgroup ratios, port count, and family grammar.
- Create `test/observatory-statue-state.test.mjs` — traversal, hardware gates,
  evidence class, dense/MoE silhouette state, and text budget.
- Create `test/observatory-statue-geometry.test.mjs` — exact layer/expert scene
  counts, no floor grid, installed glyph pool, instrument retraction, and
  geometry-allocation stability.
- Modify `traces/showcase/traces.json` — add checkpoint-derived architecture
  metadata to the two Qwen gallery candidates.
- Modify `src/observatory/scene-model.js` — install normalized architecture and
  retain dispatch mode, threadgroup, binding counts, and command-buffer-change
  facts at construction.
- Modify `src/observatory/trace-source.js` — parse an optional local
  `config.json` entirely in the browser and attach normalized architecture to a
  local trace source.
- Modify `src/observatory/ObservatoryScene.jsx` — replace the orthographic
  theater with the perspective statue controller, deterministic exhibition
  camera, raycast controls, scene loader, and critical WebGL fallback.
- Modify `src/observatory/ObservatoryApp.jsx` — remove visible dashboard chrome,
  route scene commands, add the nonvisual semantic control mirror, support
  optional config import, and preserve loading/error/export lifecycles.
- Replace `src/observatory/observatory.css` — make the canvas the full viewport,
  visually hide semantic controls during normal operation, style only critical
  browser fallbacks, and preserve focus/reduced-motion/accessibility behavior.
- Modify `src/observatory/export.js` — hide world instruments before capture,
  wait for a clean rendered frame, and restore interaction state after PNG or
  MP4 initiation.
- Modify `src/main.jsx` — make the lazy loader a sculptural aperture rather than
  explanatory prose.
- Create `scripts/capture_observatory_receipts.mjs` — dependency-free Safari
  WebDriver capture of deterministic viewport and interaction receipts.
- Modify `test/observatory-scene-model.test.mjs` — architecture and retained
  dispatch facts.
- Modify `test/observatory-trace-source.test.mjs` — optional local config
  parsing, validation, and no-network guarantees.
- Replace the theater assertions in `test/observatory-app.test.jsx` with
  autonomous exhibition, semantic controls, commands, config import, gallery,
  reduced motion, and export contracts.
- Modify `test/observatory-export.test.mjs` — clean-frame capture and instrument
  restoration.
- Modify `test/showcase.test.mjs` — exact Qwen architecture manifest contracts.
- Modify `test/hosted-build.test.mjs` — architecture survives hosted registry
  generation.
- Delete `src/observatory/story-frame.js` after `statue-state.js` replaces every
  import.
- Delete `src/observatory/theater-labels.js` after `world-labels.js` replaces
  every export-visible label.
- Delete `test/observatory-story-frame.test.mjs` and
  `test/observatory-theater-labels.test.mjs` after equivalent statue contracts
  are green.

## Task 1: Install Architecture and Exact Dispatch Contracts

**Files:**

- Create: `src/observatory/architecture.js`
- Create: `test/observatory-architecture.test.mjs`
- Modify: `traces/showcase/traces.json`
- Modify: `src/observatory/scene-model.js`
- Modify: `src/observatory/trace-source.js`
- Modify: `test/observatory-scene-model.test.mjs`
- Modify: `test/observatory-trace-source.test.mjs`
- Modify: `test/showcase.test.mjs`
- Modify: `test/hosted-build.test.mjs`

**Security flag:** security — local JSON is an untrusted browser input and must
be size-bounded, parsed without evaluation, normalized without prototype
inheritance, and never transmitted.

**Does NOT cover:** Semantic layer scopes, activation shapes, routed expert
IDs, automatic checkpoint download, or architecture inferred from model names.

- [ ] **Step 1: Write failing architecture-normalization tests**

Create fixtures for nested dense config, top-level MoE config, pattern metadata,
and invalid input:

```js
const dense = normalizeArchitecture({
  text_config: {
    model_type: "qwen3_5_text",
    num_hidden_layers: 64,
    hidden_size: 5120,
    vocab_size: 248320,
    layer_types: Array.from(
      { length: 64 },
      (_, index) => index % 4 === 3 ? "full_attention" : "linear_attention",
    ),
    num_attention_heads: 24,
    num_key_value_heads: 4,
    head_dim: 256,
    linear_num_key_heads: 16,
    linear_num_value_heads: 48,
    linear_key_head_dim: 128,
    linear_value_head_dim: 128,
    intermediate_size: 17408,
    mtp_num_hidden_layers: 1,
    mtp_use_dedicated_embeddings: false,
  },
});
assert.equal(dense.numHiddenLayers, 64);
assert.equal(dense.feedForward.kind, "dense");
assert.equal(dense.linearAttention.valueHeads, 48);
assert.equal(dense.layerTypes[3], "full_attention");
assert.equal(Object.isFrozen(dense.feedForward), true);

const moe = normalizeArchitecture({
  source: "checkpoint-config",
  model_type: "qwen3_5_moe_text",
  num_hidden_layers: 40,
  hidden_size: 2048,
  vocab_size: 248320,
  layer_type_pattern: [
    "linear_attention",
    "linear_attention",
    "linear_attention",
    "full_attention",
  ],
  num_attention_heads: 16,
  num_key_value_heads: 2,
  head_dim: 256,
  linear_num_key_heads: 16,
  linear_num_value_heads: 32,
  linear_key_head_dim: 128,
  linear_value_head_dim: 128,
  moe_intermediate_size: 512,
  shared_expert_intermediate_size: 512,
  num_experts: 256,
  num_experts_per_tok: 8,
  mtp_num_hidden_layers: 1,
  mtp_use_dedicated_embeddings: false,
});
assert.equal(moe.feedForward.kind, "moe");
assert.equal(moe.feedForward.experts, 256);
assert.equal(moe.feedForward.expertsPerToken, 8);
assert.equal(moe.layerTypes.length, 40);
assert.throws(
  () => normalizeArchitecture({ num_hidden_layers: 40 }),
  /hidden_size/i,
);
```

- [ ] **Step 2: Run the architecture test and verify the missing module is the
  failure**

Run:

```sh
node --test test/observatory-architecture.test.mjs
```

Expected: FAIL with module-not-found for
`src/observatory/architecture.js`.

- [ ] **Step 3: Implement construction-time architecture normalization**

Export this public boundary:

```js
export function normalizeArchitecture(config, {
  source = "checkpoint-config",
  required = true,
} = {}) {
  const input = config?.architecture ?? config?.text_config ?? config;
  if (!plainObject(input) || Object.keys(input).length === 0) {
    if (!required) return null;
    throw new TypeError("Architecture configuration is required.");
  }

  const numHiddenLayers = positiveInteger(
    input.numHiddenLayers ?? input.num_hidden_layers,
    "num_hidden_layers",
  );
  const hiddenSize = positiveInteger(
    input.hiddenSize ?? input.hidden_size,
    "hidden_size",
  );
  const layerTypes = normalizeLayerTypes(input, numHiddenLayers);
  const experts = optionalPositiveInteger(
    input.feedForward?.experts ?? input.num_experts,
    "num_experts",
  );
  const kind = experts === null ? "dense" : "moe";

  return deepFreeze({
    source: stringField(input.source) ?? source,
    modelType:
      stringField(input.modelType ?? input.model_type) ?? "unknown",
    numHiddenLayers,
    hiddenSize,
    vocabSize: optionalPositiveInteger(
      input.vocabSize ?? input.vocab_size,
      "vocab_size",
    ),
    layerTypes,
    attention: {
      queryHeads: positiveInteger(
        input.attention?.queryHeads ?? input.num_attention_heads,
        "num_attention_heads",
      ),
      keyValueHeads: positiveInteger(
        input.attention?.keyValueHeads ?? input.num_key_value_heads,
        "num_key_value_heads",
      ),
      headDimension: positiveInteger(
        input.attention?.headDimension ?? input.head_dim,
        "head_dim",
      ),
    },
    linearAttention: {
      keyHeads: positiveInteger(
        input.linearAttention?.keyHeads ?? input.linear_num_key_heads,
        "linear_num_key_heads",
      ),
      valueHeads: positiveInteger(
        input.linearAttention?.valueHeads ?? input.linear_num_value_heads,
        "linear_num_value_heads",
      ),
      keyHeadDimension: positiveInteger(
        input.linearAttention?.keyHeadDimension ??
          input.linear_key_head_dim,
        "linear_key_head_dim",
      ),
      valueHeadDimension: positiveInteger(
        input.linearAttention?.valueHeadDimension ??
          input.linear_value_head_dim,
        "linear_value_head_dim",
      ),
    },
    feedForward: normalizeFeedForward(input, kind, experts),
    mtp: {
      layers:
        optionalPositiveInteger(
          input.mtp?.layers ?? input.mtp_num_hidden_layers,
          "mtp_num_hidden_layers",
        ) ?? 0,
      dedicatedEmbeddings:
        input.mtp?.dedicatedEmbeddings === true ||
        input.mtp_use_dedicated_embeddings === true,
    },
  });
}
```

`normalizeLayerTypes()` accepts either an exact `layer_types` array whose
length equals `num_hidden_layers`, or a non-empty `layer_type_pattern` that is
repeated and sliced to the exact layer count. It accepts only
`linear_attention` and `full_attention`. `normalizeFeedForward()` requires
`intermediate_size` for dense models and requires
`moe_intermediate_size`, `shared_expert_intermediate_size`, `num_experts`, and
`num_experts_per_tok` for MoE models. Every returned object and array is deeply
frozen.

- [ ] **Step 4: Run the architecture test and verify green**

Run:

```sh
node --test test/observatory-architecture.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Write failing showcase and hosted-registry assertions**

In `test/showcase.test.mjs`, assert the two Qwen entries contain these exact
checkpoint-derived facts:

```js
const q27 = manifest.traces["qwen36-27b-mtp-k3.jsonl"].architecture;
assert.equal(q27.num_hidden_layers, 64);
assert.equal(q27.hidden_size, 5120);
assert.equal(q27.linear_num_value_heads, 48);
assert.equal(q27.intermediate_size, 17408);
assert.equal(q27.mtp_num_hidden_layers, 1);

const q35 = manifest.traces["qwen36-35b-a3b-k1.jsonl"].architecture;
assert.equal(q35.num_hidden_layers, 40);
assert.equal(q35.hidden_size, 2048);
assert.equal(q35.linear_num_value_heads, 32);
assert.equal(q35.num_experts, 256);
assert.equal(q35.num_experts_per_tok, 8);
assert.equal(q35.moe_intermediate_size, 512);
assert.equal(q35.shared_expert_intermediate_size, 512);
```

Extend the hosted build fixture with an `architecture` object and assert it is
present, unchanged, in `hosted-traces.json`.

- [ ] **Step 6: Run the manifest tests and verify the absent metadata fails**

Run:

```sh
node --test test/showcase.test.mjs test/hosted-build.test.mjs
```

Expected: FAIL because both Qwen manifest entries lack `architecture`.

- [ ] **Step 7: Add checkpoint-derived architecture to the Qwen manifests**

Add these fields to each Qwen `architecture` object:

```json
{
  "source": "checkpoint-config",
  "model_type": "qwen3_5_text",
  "num_hidden_layers": 64,
  "hidden_size": 5120,
  "vocab_size": 248320,
  "layer_type_pattern": [
    "linear_attention",
    "linear_attention",
    "linear_attention",
    "full_attention"
  ],
  "num_attention_heads": 24,
  "num_key_value_heads": 4,
  "head_dim": 256,
  "linear_num_key_heads": 16,
  "linear_num_value_heads": 48,
  "linear_key_head_dim": 128,
  "linear_value_head_dim": 128,
  "intermediate_size": 17408,
  "mtp_num_hidden_layers": 1,
  "mtp_use_dedicated_embeddings": false
}
```

```json
{
  "source": "checkpoint-config",
  "model_type": "qwen3_5_moe_text",
  "num_hidden_layers": 40,
  "hidden_size": 2048,
  "vocab_size": 248320,
  "layer_type_pattern": [
    "linear_attention",
    "linear_attention",
    "linear_attention",
    "full_attention"
  ],
  "num_attention_heads": 16,
  "num_key_value_heads": 2,
  "head_dim": 256,
  "linear_num_key_heads": 16,
  "linear_num_value_heads": 32,
  "linear_key_head_dim": 128,
  "linear_value_head_dim": 128,
  "moe_intermediate_size": 512,
  "shared_expert_intermediate_size": 512,
  "num_experts": 256,
  "num_experts_per_tok": 8,
  "mtp_num_hidden_layers": 1,
  "mtp_use_dedicated_embeddings": false
}
```

No non-Qwen trace receives inferred architecture.

- [ ] **Step 8: Preserve exact dispatch facts in the scene model**

First add failing assertions in `test/observatory-scene-model.test.mjs`:

```js
assert.equal(model.architecture.numHiddenLayers, 64);
assert.equal(model.frames[0].dispatchMode, "threads");
assert.deepEqual(model.frames[0].threadgroup, [32, 1, 1]);
assert.equal(model.frames[0].bufferBinds, 4);
assert.equal(model.frames[0].setBytesCalls, 2);
assert.equal(model.frames[0].setBytesTotalBytes, 128);
assert.equal(model.frames[0].commandBufferChanged, true);
assert.equal(model.frames[1].commandBufferChanged, false);
```

Add the dense architecture fixture from Step 1 to the trace passed into
`buildSceneModel()` so the assertion proves metadata normalization rather than
 a model-name lookup.

Then update `buildSceneModel()` to call:

```js
const architecture = normalizeArchitecture(trace?.architecture, {
  required: false,
});
```

Install `architecture` on the returned scene model. In `buildFrames()`, retain:

```js
{
  dispatchMode:
    dispatch?.dispatch === "threads" ||
    dispatch?.dispatch === "threadgroups"
      ? dispatch.dispatch
      : null,
  grid: normalizedGrid(dispatch?.grid),
  threadgroup: normalizedGrid(dispatch?.threadgroup),
  gridAvailable: hasRecordedGrid(dispatch?.grid),
  threadgroupAvailable: hasRecordedGrid(dispatch?.threadgroup),
  bufferBinds: nonNegativeFinite(dispatch?.bufferBinds),
  setBytesCalls: nonNegativeFinite(dispatch?.setBytesCalls),
  setBytesTotalBytes: nonNegativeFinite(dispatch?.setBytesTotalBytes),
  commandBufferChanged:
    index === 0 ||
    dispatches[index - 1]?.commandBufferIndex !== commandBufferIndex,
}
```

This normalization occurs only while constructing the model.

- [ ] **Step 9: Add a bounded local config reader**

Write failing tests for a valid `config.json`, malformed JSON, a file larger
than 2 MiB, and a file whose architecture is incomplete. Then export:

```js
export async function readLocalArchitectureConfig(file, {
  maximumBytes = 2 * 1024 * 1024,
} = {}) {
  if (!file || typeof file.text !== "function") {
    throw new TypeError("Select a checkpoint config.json file.");
  }
  if (!/\.json$/i.test(file.name ?? "")) {
    throw new TypeError("Checkpoint configuration must be a .json file.");
  }
  if (Number.isFinite(file.size) && file.size > maximumBytes) {
    throw new RangeError("Checkpoint configuration must be 2 MiB or smaller.");
  }
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new TypeError("Checkpoint configuration is not valid JSON.");
  }
  return normalizeArchitecture(parsed);
}
```

The function performs no `fetch`, object-URL creation, or mutation.

- [ ] **Step 10: Run the complete Task 1 test set**

Run:

```sh
node --test \
  test/observatory-architecture.test.mjs \
  test/observatory-scene-model.test.mjs \
  test/observatory-trace-source.test.mjs \
  test/showcase.test.mjs \
  test/hosted-build.test.mjs
```

Expected: PASS with architecture frozen, manifest facts exact, hosted metadata
preserved, dispatch geometry retained, and invalid local configs rejected.

- [ ] **Step 11: Commit the architecture boundary**

```sh
git add \
  src/observatory/architecture.js \
  src/observatory/scene-model.js \
  src/observatory/trace-source.js \
  traces/showcase/traces.json \
  test/observatory-architecture.test.mjs \
  test/observatory-scene-model.test.mjs \
  test/observatory-trace-source.test.mjs \
  test/showcase.test.mjs \
  test/hosted-build.test.mjs
git commit -m "feat: install model architecture contracts"
```

## Task 2: Derive the Statue, Activation, Hardware, and Kernel Vocabulary

**Files:**

- Create: `src/observatory/kernel-glyph.js`
- Create: `src/observatory/statue-state.js`
- Create: `test/observatory-kernel-glyph.test.mjs`
- Create: `test/observatory-statue-state.test.mjs`
- Modify: `src/observatory/scene-model.js`

**Security flag:** none

**Does NOT cover:** Literal Metal arithmetic diagrams, physical GPU core count,
memory read/write direction, exact transformer-layer timing, measured attention
weights, measured routed experts, or measured speculation acceptance.

- [ ] **Step 1: Write failing kernel-glyph descriptor tests**

Exercise every family and a measured projection dispatch:

```js
const dispatch = {
  kernel:
    "affine_qmv_wide_bfloat16_t_gs_64_b_4_nv_3_kl_8_batch_0",
  family: "projection",
  dispatchMode: "threadgroups",
  grid: [1, 1280, 1],
  threadgroup: [32, 2, 1],
  gridAvailable: true,
  threadgroupAvailable: true,
  bufferBinds: 5,
  setBytesCalls: 3,
  setBytesTotalBytes: 12,
};
const glyph = buildKernelGlyphDescriptor(dispatch);
assert.equal(glyph.exactName, dispatch.kernel);
assert.equal(glyph.family, "projection");
assert.equal(glyph.grammar, "matrix-slab");
assert.equal(glyph.dispatchMode, "threadgroups");
assert.deepEqual(glyph.grid, [1, 1280, 1]);
assert.deepEqual(glyph.threadgroup, [32, 2, 1]);
assert.ok(glyph.proportions.every((value) => value >= 0.55 && value <= 2.4));
assert.ok(glyph.microcells.every((value) => value >= 1 && value <= 12));
assert.ok(glyph.portCount >= 1 && glyph.portCount <= 8);
assert.deepEqual(
  buildKernelGlyphDescriptor(dispatch),
  buildKernelGlyphDescriptor(dispatch),
);
assert.notEqual(
  buildKernelGlyphDescriptor(dispatch).ornamentSeed,
  buildKernelGlyphDescriptor({
    ...dispatch,
    kernel: "another_projection_kernel",
  }).ornamentSeed,
);
```

Assert the grammar map is:

```js
{
  attention: "phased-rings",
  projection: "matrix-slab",
  normalization: "equalizer-torus",
  routing: "switch-manifold",
  activation: "ignition-chamber",
  "embedding-output": "vocabulary-aperture",
  "transfer-binding": "conduit-coupler",
  other: "neutral-capsule",
}
```

- [ ] **Step 2: Run the glyph test and verify red**

Run:

```sh
node --test test/observatory-kernel-glyph.test.mjs
```

Expected: FAIL with module-not-found for
`src/observatory/kernel-glyph.js`.

- [ ] **Step 3: Implement the deterministic glyph descriptor**

Use FNV-1a over the exact kernel name for `ornamentSeed`. Map each measured
dimension through `0.55 + log2(value + 1) / 8`, clamped to `2.4`. Map
threadgroup dimensions to integers clamped from 1 through 12. Derive
`portCount` from non-zero buffer and set-bytes activity, clamped from 1 through
8. Return a deeply frozen descriptor containing:

```js
{
  exactName,
  family,
  grammar,
  dispatchMode,
  grid,
  threadgroup,
  gridAvailable,
  threadgroupAvailable,
  proportions,
  microcells,
  portCount,
  ornamentSeed,
  evidence: {
    identity: "measured",
    dispatch: gridAvailable ? "measured" : "unavailable",
    geometry: "derived",
  },
}
```

- [ ] **Step 4: Run the glyph test and verify green**

Run:

```sh
node --test test/observatory-kernel-glyph.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Write failing statue-state tests**

Build scene models from dense and MoE architecture fixtures and assert:

```js
const start = buildStatueFrame(denseModel, 0);
assert.equal(start.architecture.layerCount, 64);
assert.equal(start.architecture.feedForwardKind, "dense");
assert.equal(start.activation.evidence, "simulated");
assert.equal(start.activation.layerIndex, 0);
assert.equal(start.activation.layerLabel, "L01");
assert.equal(start.inscriptions.simulated, "SIM");
assert.equal(start.inscriptions.model, "Qwen3.6 27B");
assert.equal(start.inscriptions.kernel, denseModel.frames[0].kernel);
assert.equal(Object.keys(start.inscriptions).length, 4);

const end = buildStatueFrame(denseModel, denseModel.frames.length - 1);
assert.equal(end.activation.layerIndex, 63);

const moe = buildStatueFrame(moeModel, 3);
assert.equal(moe.architecture.layerCount, 40);
assert.equal(moe.architecture.feedForwardKind, "moe");
assert.equal(moe.experts.total, 256);
assert.equal(moe.experts.illuminatedIndices.length, 8);
assert.equal(moe.experts.evidence, "configured");
assert.equal(moe.hardware.memory.direction, "bidirectional");
```

Prove the transformer choreography uses this exact ordered stage sequence:

```js
[
  "pre-attention-norm",
  "attention",
  "attention-residual",
  "pre-feed-forward-norm",
  "feed-forward",
  "feed-forward-residual",
]
```

Prove a command-buffer transition alone enables `hardware.cpu.dispatchPulse`,
zero binding disables the memory ribbon, measured grid creates representative
GPU lanes, configured MTP width creates ghost branches, and no presentation
object contains `read`, `write`, `accepted`, or `selectedExperts`.

- [ ] **Step 6: Run the statue-state test and verify red**

Run:

```sh
node --test test/observatory-statue-state.test.mjs
```

Expected: FAIL with module-not-found for
`src/observatory/statue-state.js`.

- [ ] **Step 7: Implement the immutable statue presentation**

Export:

```js
export const TRANSFORMER_STAGES = Object.freeze([
  "pre-attention-norm",
  "attention",
  "attention-residual",
  "pre-feed-forward-norm",
  "feed-forward",
  "feed-forward-residual",
]);

export function buildStatueFrame(model, requestedFrameIndex = 0) {
  const frames = Array.isArray(model?.frames) ? model.frames : [];
  const frameIndex = boundedFrameIndex(requestedFrameIndex, frames.length);
  const frame = frames[frameIndex] ?? null;
  const architecture = model?.architecture ?? null;
  const progress = boundedProgress(frame, frameIndex, frames.length);
  const layerFloat = architecture
    ? progress * architecture.numHiddenLayers
    : 0;
  const layerIndex = architecture
    ? Math.min(
        architecture.numHiddenLayers - 1,
        Math.floor(layerFloat),
      )
    : null;
  const stageIndex = architecture
    ? Math.min(
        TRANSFORMER_STAGES.length - 1,
        Math.floor(
          (layerFloat - Math.floor(layerFloat)) *
            TRANSFORMER_STAGES.length,
        ),
      )
    : null;

  return deepFreeze({
    frameIndex,
    traceProgress: progress,
    architecture: architecturePresentation(architecture),
    activation: activationPresentation(
      architecture,
      layerIndex,
      stageIndex,
    ),
    kernel: buildKernelGlyphDescriptor(frame),
    experts: expertPresentation(architecture, frameIndex),
    hardware: hardwarePresentation(frame, model),
    speculation: speculationPresentation(model),
    inscriptions: inscriptionBudget(model, architecture, layerIndex, frame),
    evidence: evidenceMaterials(model, architecture),
  });
}
```

`architecturePresentation()` returns:

```js
{
  available: architecture !== null,
  source: architecture?.source ?? "unavailable",
  layerCount: architecture?.numHiddenLayers ?? 0,
  hiddenSize: architecture?.hiddenSize ?? null,
  vocabSize: architecture?.vocabSize ?? null,
  layerTypes: architecture?.layerTypes ?? [],
  attention: architecture?.attention ?? null,
  linearAttention: architecture?.linearAttention ?? null,
  feedForward: architecture?.feedForward ?? null,
  mtp: architecture?.mtp ?? null,
}
```

`expertPresentation()` uses deterministic modular indices and never receives
runtime expert IDs. `hardwarePresentation()` uses `commandBufferChanged`,
`bindingIntensity`, measured grid, measured overlap, and the existing
manifest-derived model-mass estimate. It exposes a bounded halo scale without
claiming allocations. `inscriptionBudget()` returns only `model`, `layer`,
`kernel`, and conditional `simulated`. Missing architecture returns
`layerIndex: null`, an unknown wireframe mode, and
`ARCHITECTURE UNAVAILABLE`.

- [ ] **Step 8: Run Task 2 tests**

Run:

```sh
node --test \
  test/observatory-kernel-glyph.test.mjs \
  test/observatory-statue-state.test.mjs \
  test/observatory-scene-model.test.mjs
```

Expected: PASS with deterministic traversal, honest evidence states, stable
glyph geometry, and no invented direction, expert route, or acceptance.

- [ ] **Step 9: Commit the presentation vocabulary**

```sh
git add \
  src/observatory/kernel-glyph.js \
  src/observatory/statue-state.js \
  src/observatory/scene-model.js \
  test/observatory-kernel-glyph.test.mjs \
  test/observatory-statue-state.test.mjs \
  test/observatory-scene-model.test.mjs
git commit -m "feat: derive the LLM statue presentation"
```

## Task 3: Build the Spatial Statue and Autonomous Exhibition

**Files:**

- Create: `src/observatory/statue-geometry.js`
- Create: `src/observatory/world-labels.js`
- Create: `test/observatory-statue-geometry.test.mjs`
- Modify: `src/observatory/ObservatoryScene.jsx`
- Modify: `src/observatory/ObservatoryApp.jsx`
- Replace: `src/observatory/observatory.css`
- Modify: `src/main.jsx`
- Modify: `test/observatory-app.test.jsx`
- Delete: `src/observatory/story-frame.js`
- Delete: `src/observatory/theater-labels.js`
- Delete: `test/observatory-story-frame.test.mjs`
- Delete: `test/observatory-theater-labels.test.mjs`

**Security flag:** none

**Does NOT cover:** A screen-fixed visible control fallback during normal
operation. Flat DOM remains only for native file inputs, nonvisual semantics,
loading status, and critical error recovery.

- [ ] **Step 1: Write failing scene-graph contracts**

Create `test/observatory-statue-geometry.test.mjs` using Three.js without a
WebGL renderer:

```js
const dense = createStatueAssembly(THREE, densePresentation);
assert.equal(dense.layers.length, 64);
assert.equal(dense.experts.length, 0);
assert.ok(dense.root.getObjectByName("embedding-lens"));
assert.ok(dense.root.getObjectByName("residual-spine"));
assert.ok(dense.root.getObjectByName("output-crown"));
assert.ok(dense.root.getObjectByName("unified-memory-halo"));
assert.ok(dense.root.getObjectByName("cpu-orbital"));
assert.ok(dense.root.getObjectByName("gpu-orbital"));
assert.ok(dense.root.getObjectByName("world-instruments"));
assert.equal(dense.root.getObjectByName("floor-grid"), undefined);
assert.equal(dense.root.getObjectByName("world-instruments").visible, false);

const moe = createStatueAssembly(THREE, moePresentation);
assert.equal(moe.layers.length, 40);
assert.equal(moe.experts.length, 256);
assert.notEqual(
  dense.bounds.silhouetteRadius,
  moe.bounds.silhouetteRadius,
);
```

Capture every geometry UUID, call `applyStatueFrame()` for two different
frames, and assert the UUID list and child count are unchanged. Assert the
installed kernel pool contains all eight family grammars and only the active
family is visible. Assert `setInstrumentsVisible()` changes only group
visibility/material opacity.

- [ ] **Step 2: Run the geometry test and verify red**

Run:

```sh
node --test test/observatory-statue-geometry.test.mjs
```

Expected: FAIL with module-not-found for
`src/observatory/statue-geometry.js`.

- [ ] **Step 3: Allocate the complete Three.js sculpture once**

Export this controller boundary:

```js
export function createStatueAssembly(THREE, initialFrame) {
  const root = new THREE.Group();
  root.name = "llm-statue";

  const architecture = initialFrame.architecture;
  const layers = createLayerStack(THREE, architecture);
  const experts = createExpertField(THREE, architecture);
  const hardware = createHardwareOrbit(THREE);
  const kernelPool = createKernelGlyphPool(THREE);
  const instruments = createWorldInstruments(THREE);
  const ribbons = createInstalledRibbons(THREE);
  const particles = createInstalledMathParticles(THREE, 96);

  root.add(
    layers.group,
    experts.group,
    hardware.group,
    kernelPool.group,
    instruments.group,
    ribbons.group,
    particles.points,
  );

  const assembly = {
    root,
    layers: layers.items,
    experts: experts.items,
    hardware,
    kernelPool,
    instruments,
    ribbons,
    particles,
    bounds: sculptureBounds(architecture),
  };
  applyStatueFrame(assembly, initialFrame);
  return assembly;
}
```

Geometry rules:

- Place exact layer count on a vertical spine spanning 8 world units.
- Use a triangular/helical line rib for `linear_attention` and a radially
  connected ring for `full_attention`.
- Derive dense rib radius from
  `sqrt(intermediateSize / hiddenSize)`, clamped from 1.0 through 1.8.
- Derive MoE spine radius from `hiddenSize`, and place all expert instances on
  a deterministic double helix outside the layer stack.
- Create one visible expert cell per configured expert; use instancing when
  rendered and retain test-visible instance descriptors.
- Place embedding lens below layer zero, output crown above the final layer,
  and ghost MTP branch beside the crown.
- Use a single elliptical halo for unified memory, not separate CPU/GPU memory.
- Place compact CPU and GPU orbitals at opposing azimuths.
- Install one family-specific kernel group per glyph grammar and switch
  visibility without allocating geometry.
- Construct the family pool as nested phased rings for attention, a tiled
  accumulator slab for projection, a toroidal equalizer for normalization, an
  octagonal switch manifold for routing, a compact ignition chamber for
  activation, a radial aperture for embedding/output, a ported coupler for
  transfer/binding, and a neutral wire capsule for other kernels.
- Derive unified-memory halo radius and thickness from the bounded model-mass
  presentation when available; retain one neutral halo when mass is unknown.
- Install CPU, GPU, memory, residual, attention, feed-forward, expert, and
  speculative ribbons as fixed curves whose position attributes are updated.
- Install 96 seeded math particles inside the active kernel chamber; do not
  create ambient particles.
- Name every major group exactly as asserted by the tests.

- [ ] **Step 4: Add restrained world labels and instruments**

`world-labels.js` exports `createWorldLabel()` and `updateWorldLabel()`. The
label texture has a transparent background, no rectangular card, pale type,
one thin provenance tick, and bounded billboard scale. Create only:

```js
{
  model: { anchor: "crown", maximumCharacters: 36 },
  layer: { anchor: "active-layer", maximumCharacters: 18 },
  kernel: { anchor: "kernel-chamber", maximumCharacters: 88 },
  inspection: { anchor: "selected-object", idleVisible: false },
}
```

World instruments use recognizable mesh glyphs and invisible 44-pixel-equivalent
raycast targets:

```js
[
  { id: "previous", command: { type: "gallery", delta: -1 } },
  { id: "play", command: { type: "toggle-play" } },
  { id: "next", command: { type: "gallery", delta: 1 } },
  { id: "step-back", command: { type: "step", delta: -1 } },
  { id: "step-forward", command: { type: "step", delta: 1 } },
  { id: "import-trace", command: { type: "import-trace" } },
  { id: "import-config", command: { type: "import-config" } },
  { id: "save-png", command: { type: "save-png" } },
  { id: "record", command: { type: "toggle-recording" } },
  { id: "provenance", command: { type: "toggle-inspection" } },
]
```

The group starts hidden, unfolds along a foreground arc when summoned, and
retracts after 3,200 ms without interaction.

- [ ] **Step 5: Run the geometry test and verify green**

Run:

```sh
node --test test/observatory-statue-geometry.test.mjs
```

Expected: PASS with exact architecture counts, distinct dense/MoE silhouettes,
no floor grid, preinstalled glyphs, and stable geometry identities.

- [ ] **Step 6: Write failing autonomous-app tests**

Replace the theater-oriented assertions with:

```jsx
expect(container.querySelector(".observatory-story-hud")).toBeNull();
expect(container.querySelector(".observatory-legend")).toBeNull();
expect(container.querySelector(".observatory-region-guide")).toBeNull();
expect(container.querySelector(".observatory-transport")).toBeNull();
expect(container.querySelector("details")).toBeNull();
expect(
  container.querySelector('[aria-label="Observatory controls"]'),
).not.toBeNull();
expect(
  container.querySelector('[aria-label="Observatory controls"]')
    .classList.contains("observatory-semantic-controls"),
).toBe(true);
expect(
  container.querySelector('input[aria-label="Import local MLX profiler trace"]'),
).not.toBeNull();
expect(
  container.querySelector('input[aria-label="Import checkpoint config"]'),
).not.toBeNull();
expect(container.querySelector("[data-testid=scene]").dataset.layerCount).toBe(
  "64",
);
expect(container.querySelector("[data-testid=scene]").dataset.simulated).toBe(
  "true",
);
```

Update the `SceneStub` to receive `presentation`, `phase`, `onCommand`, and
`interactionRevision`. Render test-only buttons that invoke scene commands.
Prove gallery, play/pause, step, trace input, config input, PNG, recording, and
provenance inspection remain operable. Prove a local config rebuilds the local
scene from unknown architecture to its configured layer count without a
network request. Prove `?motion=reduce` forces the same discrete reduced-motion
mode as the operating-system preference so deterministic browser receipts do
not change the user's stored settings. Prove status updates exist in an
`aria-live` region but are not visually part of the ready scene.

- [ ] **Step 7: Run the app test and verify the old DOM fails**

Run:

```sh
npx vitest run test/observatory-app.test.jsx
```

Expected: FAIL because the current app renders a header, story HUD, legend,
region guide, evidence drawer, and footer transport.

- [ ] **Step 8: Rewrite the React shell around scene commands**

Replace ready-state visible DOM with:

```jsx
<main
  id="observatory-stage"
  className="observatory"
  data-phase={phase}
  tabIndex="-1"
>
  <SceneComponent
    model={sceneModel}
    presentation={statueFrame}
    phase={phase}
    reducedMotion={reducedMotion}
    animated={phase === "ready" && playing && !reducedMotion}
    recording={recording}
    interactionRevision={interactionRevision}
    onCommand={handleSceneCommand}
    onCanvasReady={handleCanvasReady}
  />
  <nav
    className="observatory-semantic-controls"
    aria-label="Observatory controls"
  >
    {semanticCommands.map(({ id, label, command }) => (
      <button
        key={id}
        type="button"
        aria-label={label}
        onFocus={() => summonInstrument(id)}
        onClick={() => handleSceneCommand(command)}
      />
    ))}
  </nav>
  <input
    ref={fileInputRef}
    className="observatory-file-input"
    type="file"
    accept=".jsonl,.ndjson"
    aria-label="Import local MLX profiler trace"
    onChange={handleLocalTrace}
  />
  <input
    ref={configInputRef}
    className="observatory-file-input"
    type="file"
    accept=".json,application/json"
    aria-label="Import checkpoint config"
    onChange={handleLocalConfig}
  />
  <p className="observatory-live-status" aria-live="polite">{status}</p>
  {criticalState}
</main>
```

`handleSceneCommand()` routes commands to existing gallery/playback/export
functions and increments `interactionRevision`. When a local config succeeds,
it creates a new immutable source object whose trace contains the normalized
architecture, then reloads the scene model. It never calls `fetch`.

Replace the old story memo with:

```js
const statueFrame = useMemo(
  () => buildStatueFrame(sceneModel, frameIndex),
  [frameIndex, sceneModel],
);
```

Resolve reduced motion from the explicit component prop first, then
`motion=reduce` in `location.search`, then the operating-system media query.

- [ ] **Step 9: Rewrite the Three.js wrapper as a perspective exhibition**

`ObservatoryScene.jsx` must:

- create `PerspectiveCamera(34, aspect, 0.1, 100)` and fit the statue bounds at
  every viewport;
- use `createStatueAssembly()` on model installation;
- render a fogged blue-charcoal environment without any plane or grid;
- use ACES filmic tone mapping and sRGB output;
- drive a deterministic slow orbit, shallow dolly, active-layer focus, and
  kernel acquisition pose;
- call `applyStatueFrame()` on frame changes without rebuilding geometry;
- use `Raycaster` against instrument hit targets and dispatch their stored
  commands;
- summon instruments on pointer movement, touch, key activity, or semantic
  focus revision, then retract after 3,200 ms;
- animate residual activation, active-layer expansion, kernel assembly,
  binding ribbon, CPU pulse, GPU split lanes, math particles, and configured
  branches from presentation state;
- freeze continuous motion under reduced motion while applying discrete frame
  changes;
- keep renderer allocation capped by `observatoryPixelRatio()`;
- preserve the canvas role and set one concise accessible description with
  model, layer, kernel, measured hardware, and simulated-layer qualification;
- expose nonvisual `data-model-label`, `data-layer-index`, and
  `data-layer-stage` canvas attributes for deterministic receipts and
  accessibility integration tests;
- dispose renderer, geometries, materials, textures, observers, listeners, and
  animation frames on teardown.

- [ ] **Step 10: Replace Observatory CSS with the full-screen contract**

The stylesheet must make `.observatory` and `.observatory-scene` fill
`100dvh`, make the canvas display block at full size, and contain no ready-state
header/footer/card grid. `.observatory-semantic-controls`,
`.observatory-file-input`, and `.observatory-live-status` use the standard
visually-hidden clipping pattern while remaining focusable to assistive
technology. Loading uses a centered aperture mark with at most one short
status line. Empty/error states may use a readable browser-native recovery
surface because they are critical fallbacks. Include safe-area padding,
375/768/1024/1440 responsive rules, visible skip-link focus, 44px recovery
targets, and `prefers-reduced-motion`.

- [ ] **Step 11: Replace the lazy loader**

Change `src/main.jsx` to:

```jsx
<main className="observatory-boot" aria-busy="true">
  <span className="observatory-boot-aperture" aria-hidden="true" />
  <span className="sr-only">Opening Silicon Observatory</span>
</main>
```

The aperture is a restrained CSS assembly animation, not a text tutorial.

- [ ] **Step 12: Remove the superseded theater modules and tests**

Delete `story-frame.js`, `theater-labels.js`, and their tests only after
`rg "story-frame|theater-labels|buildStoryFrame|buildTheaterLabels" src test`
returns no remaining imports. Do not remove export code, trace loading, timing,
or evidence health.

- [ ] **Step 13: Run Task 3 tests**

Run:

```sh
node --test \
  test/observatory-architecture.test.mjs \
  test/observatory-kernel-glyph.test.mjs \
  test/observatory-scene-model.test.mjs \
  test/observatory-statue-state.test.mjs \
  test/observatory-statue-geometry.test.mjs \
  test/observatory-trace-source.test.mjs
npx vitest run test/observatory-app.test.jsx
```

Expected: PASS with no theater module import, exact scene counts, autonomous
gallery behavior, accessible commands, local config support, and no visible
ready-state dashboard DOM.

- [ ] **Step 14: Commit the spatial exhibition**

```sh
git add \
  src/main.jsx \
  src/observatory \
  test/observatory-app.test.jsx \
  test/observatory-statue-geometry.test.mjs
git add -u \
  src/observatory/story-frame.js \
  src/observatory/theater-labels.js \
  test/observatory-story-frame.test.mjs \
  test/observatory-theater-labels.test.mjs
git commit -m "feat: replace the theater with the LLM statue"
```

## Task 4: Protect Export, Responsiveness, and Visual Spectacle

**Files:**

- Modify: `src/observatory/export.js`
- Modify: `src/observatory/ObservatoryApp.jsx`
- Modify: `src/observatory/ObservatoryScene.jsx`
- Modify: `src/observatory/observatory.css`
- Modify: `test/observatory-export.test.mjs`
- Modify: `test/observatory-app.test.jsx`
- Modify: `test/build-output.test.mjs`
- Modify: `test/pages-artifact.test.mjs`
- Create: `scripts/capture_observatory_receipts.mjs`

**Security flag:** none

**Does NOT cover:** Server-side video encoding, GIF encoding, audio
synchronization, remote uploads, or a non-H.264 movie labeled as X-compatible.

- [ ] **Step 1: Write failing clean-capture and ready-state source contracts**

Add export tests proving capture requests a clean frame:

```js
const visibility = [];
const result = await downloadCanvasPng(canvas, {
  label: "Qwen3.6 27B",
  prepareFrame: async (visible) => visibility.push(visible),
});
assert.deepEqual(visibility, [false, true]);
assert.match(result.filename, /\.png$/);
```

Add source-contract assertions:

```js
assert.doesNotMatch(sceneSource, /GridHelper|OrthographicCamera/);
assert.match(sceneSource, /PerspectiveCamera/);
assert.doesNotMatch(appSource, /observatory-story-hud|observatory-legend/);
assert.doesNotMatch(css, /\.observatory-transport|\.observatory-region-guide/);
assert.match(css, /100dvh/);
assert.match(css, /prefers-reduced-motion/);
```

Add app assertions that starting PNG or recording retracts instruments before
capture and that recording completion/error remains announced through the
nonvisual live region.

- [ ] **Step 2: Run export and app tests and verify red**

Run:

```sh
node --test test/observatory-export.test.mjs
npx vitest run test/observatory-app.test.jsx
```

Expected: FAIL because export does not yet coordinate clean-frame visibility.

- [ ] **Step 3: Add the clean-frame export handshake**

Extend PNG options with:

```js
async function withCleanFrame(prepareFrame, capture) {
  if (typeof prepareFrame !== "function") return capture();
  await prepareFrame(false);
  try {
    await new Promise((resolve) =>
      globalThis.requestAnimationFrame(() =>
        globalThis.requestAnimationFrame(resolve),
      ),
    );
    return await capture();
  } finally {
    await prepareFrame(true);
  }
}
```

Use the same instrument-retraction callback immediately before MP4 recording
starts. The scene exposes `prepareCapture(restore)` through `onCanvasReady` or a
separate `onCaptureControllerReady` callback; React passes it into the existing
export functions. Stopping or failing a recording restores the normal
interaction policy.

- [ ] **Step 4: Run focused export tests and verify green**

Run:

```sh
node --test test/observatory-export.test.mjs
npx vitest run test/observatory-app.test.jsx
```

Expected: PASS with instruments absent from exported frames and restored after
capture.

- [ ] **Step 5: Run the complete automated verification**

Run:

```sh
npm test
npm run build
npm run verify:pages
npm audit --omit=dev
```

Expected:

- every Node and Vitest test passes;
- Vite and hosted artifacts build successfully;
- Pages verification succeeds;
- production dependency audit reports zero vulnerabilities.

- [ ] **Step 6: Start the production-equivalent server**

Run:

```sh
npm start
```

Expected: the server prints a loopback Observatory URL. Open:

```text
http://127.0.0.1:4173/?mode=observatory
```

If the selected port differs, use the printed port.

- [ ] **Step 7: Add a dependency-free Safari receipt script**

Create `scripts/capture_observatory_receipts.mjs` with this command contract:

```sh
node scripts/capture_observatory_receipts.mjs \
  --url http://127.0.0.1:4173/?mode=observatory \
  --output /tmp/silicon-observatory-receipts
```

The script uses native `fetch`, `node:fs/promises`, and the WebDriver endpoints
at `http://127.0.0.1:4444`:

```js
async function webdriver(pathname, method = "GET", body) {
  const response = await fetch(`${driverUrl}${pathname}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok || payload?.value?.error) {
    throw new Error(
      payload?.value?.message ?? `WebDriver ${method} ${pathname} failed`,
    );
  }
  return payload.value;
}

const session = await webdriver("/session", "POST", {
  capabilities: { alwaysMatch: { browserName: "safari" } },
});
const sessionId = session.sessionId ?? session.capabilities?.sessionId;

async function execute(script, args = []) {
  return webdriver(`/session/${sessionId}/execute/sync`, "POST", {
    script,
    args,
  });
}

async function waitForReady() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await execute(
      "return document.querySelector('[data-phase=\"ready\"]') !== null;",
    )) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Observatory did not reach the ready phase.");
}

async function capture(name, width, height) {
  await webdriver(`/session/${sessionId}/window/rect`, "POST", {
    x: 40,
    y: 40,
    width,
    height,
  });
  await new Promise((resolve) => setTimeout(resolve, 800));
  const encoded = await webdriver(
    `/session/${sessionId}/screenshot`,
  );
  await writeFile(
    path.join(outputRoot, name),
    Buffer.from(encoded, "base64"),
  );
}
```

The script navigates with `POST /session/{id}/url`, waits for ready, captures
the four 27B viewports, clicks the semantic `Next gallery trace` control through
`execute()` and waits for the canvas model label to change before capturing
35B, clicks `Step forward one dispatch` until `data-layer-stage` reports
`feed-forward` for the expert receipt, dispatches `pointermove` on the canvas
for the instrument receipt, navigates to the same URL with `motion=reduce` for
the reduced-motion receipt, and always deletes the WebDriver session in
`finally`.

- [ ] **Step 8: Capture and inspect both gallery candidates**

Use Safari with Develop → Allow Remote Automation enabled, start:

```sh
safaridriver -p 4444
```

Run:

```sh
node scripts/capture_observatory_receipts.mjs \
  --url http://127.0.0.1:4173/?mode=observatory \
  --output /tmp/silicon-observatory-receipts
```

Expected: the script saves:

```text
qwen-27b-375x812.png
qwen-27b-768x1024.png
qwen-27b-1024x768.png
qwen-27b-1440x900.png
qwen-35b-1440x900.png
qwen-35b-experts-1440x900.png
world-instruments-1440x900.png
reduced-motion-1024x768.png
```

Inspect each image directly. Acceptance requires:

- the statue occupies roughly 70 percent of the composition;
- the 64-layer dense statue is tall and countable;
- the 40-layer MoE statue is shorter with a visibly encoded expert halo;
- the active layer opens and remains identifiable within three seconds;
- activation travels through the residual spine rather than across a flat
  diagram;
- unified memory is one outer halo;
- CPU and GPU remain subordinate orbitals;
- kernel families have materially different mechanical silhouettes;
- memory, CPU, GPU, and speculation motion terminate at the active layer;
- the idle image contains no HUD, cards, legend, tutorial, grid, or persistent
  control bar;
- world instruments show parallax when summoned and retract after inactivity;
- model, layer/stage, exact kernel, and conditional `SIM` are the only idle
  inscriptions;
- inactive layers remain visible against the background;
- no label overlap, clipping, or horizontal overflow appears at any viewport;
- reduced motion freezes continuous travel while retaining the active state.

- [ ] **Step 9: Exercise local import and export in the browser**

Import one bundled Qwen trace as a local `.jsonl` file. Verify the unknown
wireframe appears without name-based architecture inference. Import its
checkpoint `config.json`; verify the exact layer sculpture replaces the unknown
wireframe without any network request.

Save one PNG and record at least five seconds of MP4. Inspect both outputs:

- neither contains world instruments or DOM recovery surfaces;
- the PNG retains statue, active layer, hardware ribbons, exact kernel, and
  provenance material;
- the MP4 is H.264, 1280×720, and plays through the complete activation/kernel
  motion;
- the MP4 file extension is `.mp4`;
- unsupported recording leaves a usable PNG action and never emits mislabeled
  video.

- [ ] **Step 10: Perform the completion audit**

Compare current files, tests, screenshots, and exports against every row in the
Requirement-to-Evidence Map and every section of
`docs/specs/2026-07-29-silicon-observatory-llm-statue-design.md`. Treat any
missing screenshot, untested requirement, indirect evidence, flat visible
control, illegible sculpture, or unverified export as incomplete and fix it
before proceeding.

- [ ] **Step 11: Commit verified polish**

```sh
git add \
  src/observatory/export.js \
  src/observatory/ObservatoryApp.jsx \
  src/observatory/ObservatoryScene.jsx \
  src/observatory/observatory.css \
  test/observatory-export.test.mjs \
  test/observatory-app.test.jsx \
  test/build-output.test.mjs \
  test/pages-artifact.test.mjs \
  scripts/capture_observatory_receipts.mjs
git commit -m "test: verify the autonomous LLM spectacle"
```
