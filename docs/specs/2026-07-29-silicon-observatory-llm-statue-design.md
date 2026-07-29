# Silicon Observatory: LLM Statue Design

**Date:** 2026-07-29  
**Status:** Approved direction; awaiting written-spec review  
**Branch:** `agent/silicon-observatory`

## Purpose

Silicon Observatory should be an artistic visualization of an LLM executing,
not a hardware dashboard with an LLM label attached.

The model becomes a beautiful central three-dimensional statue. Its actual
architecture determines the statue's form. Activations travel through the
statue layer by layer. Unified memory, CPU control, and GPU execution surround
the statue as supporting hardware, appearing through ribbons only when the
current event justifies them.

The existing static floor grid is removed. Metal dispatch geometry remains
available, but only as local tiling on the active operation. A dispatch grid is
not an LLM tensor or model shape and must never define the global scene.

## Premise Check

The problem is confirmed by the current implementation:

- The stage grid is static decoration with no LLM semantics.
- The measured Metal dispatch grid is visually easy to mistake for a tensor or
  model shape.
- The model is represented primarily through estimated mass and labels rather
  than topology.
- Kernel activity changes, but no visible activation traverses transformer
  layers.

The redesign is proportional because the missing model structure is the core
subject of the product. Adding more particles or brighter hardware to the
current composition would not solve the problem.

The cost of not making this change is that Silicon Observatory remains a
stylized dispatch dashboard rather than the intended musical visualizer for
LLMs.

## Design Principle

The scene has one visual hierarchy:

1. The central LLM statue
2. The active transformer layer and its internal stage
3. The exact active-kernel identity and its mechanical glyph
4. The activation flowing through that stage
5. Hardware ribbons connected to the active stage
6. Summoned world-space instruments, visible only during interaction

Nothing else may compete with the statue.

In its default state, the Observatory is a standalone animation rather than an
interface that explains an animation. It has no persistent HUD, card stack,
legend, tutorial copy, region labels, playback bar, or evidence drawer. Form,
position, material, and repeated motion establish the vocabulary:

- the layer stack is the model;
- the surrounding halo is unified memory;
- the narrow control pulse is CPU dispatch;
- the luminous execution volume is GPU work;
- the mechanical glyph is the active kernel;
- the travelling layer pulse is activation flow.

The piece must work without reading. Persistent text is limited to model
identity, active layer or stage, and exact kernel name. Even those are small
world-anchored inscriptions, never explanatory sentences.

## Architectural Truth

The architecture is derived from model configuration data, not inferred from
kernel names and not hardcoded in the renderer.

The two initial gallery candidates have materially different shapes:

### Qwen3.6 27B

- 64 transformer layers
- Hidden width 5,120
- 24 attention heads
- 4 key/value heads
- 16 linear-attention key heads and 48 linear-attention value heads
- Linear-attention key/value head dimension 128
- Dense MLP intermediate width 17,408
- Repeating layer pattern of three linear-attention layers followed by one
  full-attention layer
- One configured MTP layer

### Qwen3.6 35B-A3B

- 40 transformer layers
- Hidden width 2,048
- 16 attention heads
- 2 key/value heads
- 16 linear-attention key heads and 32 linear-attention value heads
- Linear-attention key/value head dimension 128
- 256 routed experts
- Top-8 configured expert fan-out
- Shared expert intermediate width 512
- Routed expert intermediate width 512
- The same three-linear-attention/one-full-attention repeating pattern
- One configured MTP layer

These values come from the candidates' verified checkpoint `text_config`
objects. They are data inputs. Geometry code consumes a normalized architecture
object and contains no Qwen-specific model switch.

## The Central Statue

### Overall silhouette

The statue occupies approximately 70 percent of the stage and remains centered
at every viewport size.

It is a vertical, slightly tilted wireframe structure:

- The input embedding is a luminous lens at the base.
- A central residual-stream spine rises through every transformer layer.
- Every transformer layer is a distinct translucent rib or wafer around the
  spine.
- The final normalization and language-model head form a crown at the top.
- A configured MTP branch appears as a smaller ghost structure offset from the
  crown.

The camera uses perspective and a restrained, deterministic orbit. The statue
may breathe or rotate by a few degrees, but it never drifts randomly. Reduced
motion freezes the camera and preserves discrete activation changes.

### Layer grammar

Every layer remains countable. The scene does not replace 64 layers with an
arbitrary handful of boxes.

Inactive layers form the persistent wireframe body. The active layer:

- increases in radius;
- separates slightly from adjacent layers;
- gains a high-luminance surface;
- opens into its attention and feed-forward substructures;
- receives the activation ribbon and relevant hardware ribbons.

The expansion is focus-plus-context: the viewer sees the whole model while
understanding the active layer.

### Attention form

Attention type changes the layer silhouette:

- Linear attention uses a directional helical or triangular rib.
- Full attention uses a circular, radially connected ring.

When attention is active, the layer opens to show:

- full attention uses one visible strand per configured query head and a
  smaller set of hubs using the configured KV-head count;
- linear attention uses its independently configured key/value head counts and
  head dimensions;
- a merge back into the residual spine.

The strands are architecture geometry. They do not claim measured attention
weights.

### Dense MLP form

A dense MLP opens as a paired fan or double-lobed chamber. Its depth and radius
are derived from the hidden-to-intermediate-width ratio.

The activation splits across the gate/up form, contracts through the
activation, and returns through the down projection before merging into the
residual spine.

### MoE form

An MoE layer opens into an expert constellation surrounding the active layer:

- all configured experts are represented as instanced points or small cells;
- a router ring sits between the residual spine and the expert constellation;
- the configured top-k fan-out determines how many paths illuminate;
- the shared expert remains a separate persistent path.

Until routed expert identities are present in the trace, illuminated expert
positions are deterministic presentation choices. Their ghosted configured
material distinguishes them from measured selections, and the optional active
stage inscription may add only `TOP 8`. It must not imply that those expert IDs
were measured.

This gives the two sample models unmistakably different bodies: the 27B model
is a tall dense machine, while the 35B-A3B model is a shorter central spine
surrounded by a large expert halo.

## Activation Choreography

One activation pulse enters the embedding lens and travels upward through the
model.

Within each layer it follows the explicit sequence:

```text
residual input
  → pre-attention normalization
  → attention
  → residual merge
  → pre-feed-forward normalization
  → dense MLP or MoE router/experts
  → residual merge
  → next layer
```

The central activation uses a continuous ribbon rather than unrelated
particles. Particles may appear inside an active math chamber, but they are
secondary texture and never define the route.

The active-layer transition is deterministic. No particles, expert choices, or
ribbons use unseeded randomness.

## Hardware Orbit

The hardware surrounds the statue without becoming the composition.

### Unified memory

Apple unified memory is represented as one shared luminous halo or reservoir
around the statue. It is not split into fictional CPU memory and GPU memory.

When buffer binding activity exists, a cyan ribbon connects the halo to the
active layer. Because schema v1 does not contain exact buffer direction, the
ribbon breathes bidirectionally and has no arrowheads. Its derived provenance is
available in the summoned inspection ring, not as an idle label.

The halo's overall volume may reflect manifest-derived model mass. Individual
lit regions remain an abstract aggregation rather than claimed allocations or
addresses.

### CPU control

The CPU is a compact control node in orbit around the statue.

A thin control ribbon appears when the active trace frame enters or changes
command buffer. It travels from the CPU node to the active layer and terminates
in a short dispatch pulse.

The command-buffer index, ordinal, and measured GPU or encode duration are
available as compact inspection annotations. The ribbon does not imply that the
CPU performs the layer's math.

### GPU execution

The GPU is a compact execution constellation opposite the CPU node.

During a measured dispatch:

- an execution ribbon connects the active operation to the GPU;
- the ribbon divides into a bounded set of representative execution lanes;
- the active layer surface receives a temporary tiling pattern derived from
  the dispatch geometry;
- math particles remain inside the active operation.

The trace's dispatch mode controls the temporary inspection wording:

- `threads` is described as a measured thread grid plus threadgroup size;
- `threadgroups` is described as a measured threadgroup grid plus group size.

The Metal grid is local execution geometry. It is never labeled as an LLM
shape, tensor shape, head count, or layer count.

## Active Kernel Glyph

The active layer contains a dedicated kernel presentation chamber. When a
dispatch becomes active, the layer opens and a mechanical hologram of that
specific kernel assembles inside or immediately in front of the layer.

The raw kernel name remains visible. The viewer can always identify the exact
measured kernel rather than seeing only a normalized family:

```text
affine_qmv_wide_bfloat16_t_gs_64_b_4_nv_3_kl_8_batch_0
```

Family and dispatch geometry are expressed by the glyph itself. Selecting the
glyph unfolds the measured dispatch mode, grid, and threadgroup values around it.

### Kernel geometry contract

The glyph is an artistic abstraction derived deterministically from measured
and classified fields:

- kernel family selects the primary mechanical grammar;
- dispatch mode selects thread-grid or threadgroup-grid presentation;
- grid dimensions control the glyph's major proportions;
- threadgroup dimensions control its visible microcell subdivision;
- buffer-bind and set-bytes activity control the number and intensity of
  interface ports;
- a stable hash of the exact kernel name selects bounded ornamental variation
  so the same kernel always has the same silhouette across traces.

The stable hash affects only aesthetic details. It does not create evidence
about arithmetic, memory direction, tensor layout, or silicon placement.

The derived-geometry qualification appears only in the summoned provenance
inspection.

### Family silhouettes

Each normalized family has a recognizable mechanical silhouette:

- **Attention:** nested targeting rings surrounding a phased-array core.
- **Projection/matmul:** an elongated matrix slab with tiled accumulator bays.
- **Normalization:** a toroidal equalizer with a pulse converging toward a
  common radius.
- **Routing/MoE:** an octagonal switch manifold whose exits align with the
  configured or measured expert fan-out.
- **Activation:** a compact ignition chamber with a controlled transfer curve.
- **Embedding/output:** a radial vocabulary aperture or fan array.
- **Transfer/binding:** a conduit coupler with explicit interface ports.
- **Other:** a neutral wireframe kernel capsule that preserves exact identity
  without inventing a known family.

These are stable visual vocabulary, not literal schematics of the Metal
implementation.

### Kernel choreography

A kernel transition uses a short mechanical sequence:

1. Targeting brackets acquire the active layer stage.
2. The prior glyph collapses into the residual spine.
3. The new glyph assembles from wireframe sections.
4. A calibration sweep reveals its measured grid and threadgroup tiling.
5. CPU, GPU, and memory ribbons dock at distinct interface ports.
6. Math particles or activation light execute inside the glyph.
7. The result returns to the layer's activation ribbon.

The sequence is short enough to preserve dispatch rhythm. Long raw traces may
sample frames, but the selected kernel identity is always exact.

### Other hardware

SSD, Neural Engine, network, or other hardware is absent unless a future trace
contains an explicit event for it. The scene does not create inactive device
boxes merely to complete a system diagram.

## Measured, Configured, Derived, and Simulated

The scene preserves four visibly distinct evidence classes:

- **Measured:** dispatch order, command-buffer relationships and timing,
  dispatch mode, grid, threadgroup, and profiler evidence health.
- **Configured:** model architecture, layer types, head counts, expert count,
  top-k fan-out, hidden widths, and MTP width.
- **Derived:** binding-flow intensity, visual aggregation, model-mass volume,
  and representative GPU-lane count.
- **Simulated:** layer traversal and internal activation stage when semantic
  profiler scopes are absent.

These classes are encoded in material and stored in the scene data model.
Simulated traversal uses the ghosted motion material and compact `SIM` sigil;
measured hardware remains crisp and solid. The summoned provenance inspection
can expose the full qualification. There is no silent promotion from simulated
traversal to measured traversal.

## Architecture Data Contract

### Normalized structure

The renderer consumes an immutable normalized architecture:

```js
{
  source: "checkpoint-config",
  modelType: "qwen3_5_moe",
  numHiddenLayers: 40,
  hiddenSize: 2048,
  vocabSize: 248320,
  layerTypes: ["linear_attention", "...", "full_attention"],
  attention: {
    queryHeads: 16,
    keyValueHeads: 2,
    headDimension: 256,
  },
  linearAttention: {
    keyHeads: 16,
    valueHeads: 32,
    keyHeadDimension: 128,
    valueHeadDimension: 128,
  },
  feedForward: {
    kind: "moe",
    intermediateSize: 512,
    sharedIntermediateSize: 512,
    experts: 256,
    expertsPerToken: 8,
  },
  mtp: {
    layers: 1,
    dedicatedEmbeddings: false,
  },
}
```

The normalizer reads `config.text_config` when present and otherwise reads the
top-level config. It validates once while building the scene model. Invalid or
incomplete architecture is not installed into the statue renderer.

### Hosted traces

The showcase manifest gains an `architecture` object generated from the
checkpoint configuration. The static build validates and copies this metadata
into `hosted-traces.json`.

Architecture values live in trace metadata, not in JavaScript conditionals.

### Local traces

The long-term single-file contract adds one sanitized architecture record to
the profiler output:

```json
{
  "record": "architecture",
  "schema_version": 1,
  "source": "checkpoint-config",
  "architecture": {}
}
```

Before that profiler extension lands, the local importer may accept a
`config.json` alongside the trace and normalize it entirely in the browser.
The visualizer does not automatically upload a config or fetch a remote
checkpoint.

### Missing architecture

When architecture metadata is unavailable, the stage shows a minimal unknown
wireframe with `ARCHITECTURE UNAVAILABLE`. It does not infer a layer count from
the model name or fabricate a Qwen topology.

## Semantic Profiler Follow-Up

Exact layer activation cannot be reconstructed from the current dispatch
census. Kernel names repeat across layers, and the trace has no layer index,
tensor identity, activation shape, token step, or routed expert IDs.

A separate profiler design will add optional semantic scopes, for example:

```json
{
  "record": "scope",
  "event": "begin",
  "token_step": 42,
  "layer": 17,
  "stage": "attention",
  "activation_shape": [1, 1, 2048]
}
```

Dispatches captured inside the scope inherit a stable scope identifier. The
scope is active only under discovery instrumentation and is installed outside
the production hot path.

This follow-up enables measured layer traversal, exact runtime activation
shapes, and measured routed expert identities. It is intentionally separate
from the first statue implementation.

## Scene Construction

All invariant work happens once when the trace and architecture are installed:

- normalize and validate architecture;
- create instanced layer ribs;
- create attention-head and expert pools at proven maximum counts;
- create the residual spine and activation paths;
- create CPU, GPU, and unified-memory nodes;
- create the bounded kernel-glyph pool and family-specific primitives;
- create ribbon meshes, world-space instruments, and export-visible labels;
- create deterministic presentation routes.

Frame updates modify installed transforms, material uniforms, visibility,
labels, and ribbon progress. They do not rebuild geometry, re-read environment
state, revalidate metadata, or install fallbacks inside the animation loop.

## Spatial Interface Contract

The Observatory uses the scene itself as its primary interface. Normal operation
must not depend on a screen-fixed HTML HUD.

The depth composition is one authored volume:

1. The LLM statue owns the center and remains the visual anchor.
2. The kernel chamber acquires a measured dispatch beside the active layer.
3. CPU and GPU execution forms orbit at distinct depths around the statue.
4. Unified memory forms the outer halo and receives visible binding ribbons.
5. Interaction instruments unfold into the foreground as an orbital control arc,
   then retract into the scene.

Model selection, gallery progress, transport, speed, capture, evidence, and
inspection controls are Three.js objects with world transforms. They receive
pointer and touch input through raycasting, provide generous invisible hit
volumes, and expose equivalent keyboard actions. Labels billboard only within
authored limits so they remain readable while retaining parallax and depth.

The camera follows bounded, deterministic exhibition poses: slow orbit, shallow
dolly, active-layer inspection, and kernel acquisition. The viewer can make a
small temporary orbit adjustment but cannot lose the statue or invert the
composition.

Flat DOM is reserved for capabilities that genuinely belong to the browser:

- the native file chooser;
- nonvisual screen-reader semantics and keyboard focus mirrors;
- WebGL recovery and critical error messages.

Those elements do not appear in normal captured output.

### Autonomous Exhibition State

On load, the sculpture assembles in space and begins cycling through the sample
gallery. With no interaction, every instrument retracts. The captured frame
contains only the statue, activation choreography, hardware forms, kernel glyph,
and minimal inscriptions.

Pointer movement, focus, a key press, or touch summons the orbital control arc.
It unfolds from the statue rather than appearing as an overlay, remains available
while interaction continues, and retracts after inactivity. Seeking or inspecting
an event may temporarily reveal measured values around the selected object; they
disappear when inspection ends.

Provenance is communicated primarily by material:

- solid light and crisp edges indicate measured trace facts;
- quiet architectural wireframe indicates checkpoint configuration;
- ghosted or dashed motion indicates simulated layer traversal;
- a derived kernel form uses measured geometry but never implies a literal die
  layout.

A compact `SIM` sigil may accompany the active layer inscription when necessary.
There is no persistent prose explaining the distinction.

## Visual System

### Palette

- Background: deep blue-charcoal with a soft central atmospheric gradient
- Inactive architecture: pale blue-white wireframe at medium luminance
- Active residual flow: white-gold
- Unified memory: electric cyan
- CPU control: cool blue
- GPU execution: hot violet
- Active math: amber-white
- Configured speculation or expert fan-out: lavender
- Evidence caution: coral rose

The background remains dark enough for bloom but never so dark that inactive
layers disappear.

### Interface art direction

The interface uses the visual language of a high-end diegetic aerospace or
mecha command system:

- cinematic holographic depth without copying a specific franchise interface;
- 1990s/2000s military-anime hard-surface framing;
- cel-lit edges and technical cutaway views;
- targeting brackets, range marks, calibration sweeps, and segmented reticles;
- condensed stencil telemetry and small engineering callouts only during
  inspection;
- restrained CRT phosphor persistence and scan texture;
- limited hazard stripes or warning chevrons reserved for evidence caution;
- mechanical assembly and locking motion rather than floating generic cards.

The result should feel authored by an aerospace/mecha art department, not
generated by a dashboard component library. The interface is diegetic: controls
are physical instruments inside the same volume as the statue and are absent
from the idle composition.

The style explicitly avoids:

- a static Cartesian floor grid;
- generic cyberpunk neon rain;
- random particle clouds;
- equal-weight bordered panels around every fact;
- excessive bloom that destroys wireframe structure;
- decorative technical labels with no relationship to real data.

### Materials

The primary statue uses:

- thin luminous wireframes;
- translucent glass surfaces on the active layer;
- controlled bloom around active paths;
- depth fading that preserves the full silhouette;
- subtle volumetric haze localized behind the statue;
- selective cel-shaded hard-surface panels around the active kernel chamber;
- thin phosphor afterimages on calibration sweeps.

There is no global floor grid and no field of random cubes.

### Motion

Motion always communicates one of:

- activation advancing through the residual spine;
- a layer opening and closing;
- attention or expert fan-out;
- CPU command dispatch;
- GPU execution;
- unified-memory binding activity;
- configured speculative branches;
- kernel acquisition, assembly, calibration, execution, and release.

Ambient motion is limited to a slow deterministic statue breath and restrained
camera orbit.

## Interaction and Readability

The interaction model is physically sparse and visually absent until invoked:

- idle playback cycles the sample gallery without requiring input;
- pointer movement, focus, touch, or a key summons the orbital control arc;
- dragging the orbital progress ring scrubs statue, glyph, and ribbons together;
- stepping advances to the next measured dispatch;
- selecting a layer moves the camera to an authored inspection pose;
- selecting the kernel glyph reveals measured dispatch geometry in a temporary
  world-space data ring;
- selecting the provenance beacon exposes trace-versus-presentation controls;
- capture unfolds PNG and MP4 export choices inside the same arc;
- inactivity folds every instrument back into the sculpture;
- reduced motion replaces continuous travel with discrete illuminated states.

The default text budget is:

1. model identity;
2. compact active layer or stage, with `SIM` only when needed;
3. exact raw kernel name.

Dispatch mode, grid, threadgroup, buffer bindings, architecture statistics, and
evidence detail appear only while the related object is inspected. The raw
kernel name follows a world-space tape or arc and exposes its complete accessible
value on focus.

At mobile widths the statue remains central and the same spatial contract holds.
Hardware orbitals move closer to the statue, the expert field reduces rendered
points while preserving encoded count through grouping, and larger invisible hit
volumes support touch. A tap summons or selects; a drag scrubs or makes the
bounded camera adjustment. No bottom sheet or persistent information strip
replaces the 3D interface.

## Export

PNG and MP4 contain:

- the full statue silhouette;
- the active layer and internal stage;
- the activation ribbon;
- the exact active-kernel identity and glyph;
- any active CPU, GPU, or memory ribbon;
- model and layer identity;
- the provenance material state;
- the compact `SIM` sigil when simulated layer traversal is active.

The export is the standalone work. It contains no surrounding DOM controls and
does not require explanatory copy to be visually coherent.

## Implementation Boundaries

The immediate visualizer work contains three coupled units:

1. **Architecture contract** — normalization, manifest metadata, gallery
   candidates, and local-config fallback.
2. **Statue renderer** — central wireframe model, layer grammar, focus behavior,
   camera, kernel-glyph chamber, materials, and export labels.
3. **Flow engine** — activation state machine, CPU/GPU/memory ribbons, local
   kernel tiling, playback, and evidence mapping.

The semantic profiler scope extension is a separate repository change and a
separate design/PR.

## Testing Strategy

### Pure contracts

- Normalize both `text_config` and top-level config shapes.
- Reject missing or invalid layer counts, widths, head counts, and MoE fields
  before renderer construction.
- Prove that the 27B candidate installs 64 layers and the 35B-A3B candidate
  installs 40 layers with 256 experts and top-8 fan-out.
- Prove architecture values come from metadata rather than model-name switches.
- Prove simulated and measured layer modes cannot be confused.
- Prove dispatch modes produce correctly worded local tiling labels.
- Prove exact kernel names map to stable glyph variants without model-specific
  switches.
- Prove glyph proportions and microcell subdivisions are derived from bounded
  measured dispatch and threadgroup geometry.

### Renderer contracts

- The scene contains no `GridHelper` or equivalent static world grid.
- Normal operation contains no screen-fixed visual HUD or DOM card layout.
- Idle playback exposes no transport, evidence, architecture-statistics, or
  export panels.
- Persistent scene text never exceeds model identity, active layer or stage,
  exact kernel name, and the conditional `SIM` sigil.
- All visible controls have world transforms and retract after inactivity.
- Pointer, touch, and keyboard actions operate the same world-space controls.
- Layer and expert pools are constructed once and bounded by installed
  architecture.
- Frame updates do not allocate scene geometry.
- Kernel transitions select from a preinstalled glyph pool rather than
  constructing new geometry.
- Zero binding activity produces no memory ribbon.
- A command-buffer transition produces one CPU control pulse.
- Missing dispatch geometry produces no local tiling claim.
- Reduced motion avoids continuous RAF scheduling.

### Browser receipts

At 375, 768, 1024, and 1440 pixels:

- the statue is the brightest and largest subject;
- the idle frame reads as a standalone sculpture, not a dashboard;
- every configured layer remains visually countable;
- the active layer is identifiable in under three seconds;
- CPU, GPU, and memory ribbons terminate at the active layer;
- the exact kernel name remains legible while its glyph is active;
- labels do not overlap the statue;
- no horizontal overflow exists;
- the Qwen candidates have visibly different silhouettes.

Capture and inspect both candidates at an attention stage and a feed-forward
stage. Capture the 35B candidate with its expert constellation open. Capture one
idle frame with every instrument retracted and one interaction frame proving the
controls occupy 3D space and retain parallax before retracting.

### Export receipts

Inspect PNG output for both candidates. In an H.264-capable browser, verify that
the activation, active-layer expansion, and hardware ribbons survive the
1280×720 MP4 composition.

## Failure-Mode Check

### Sixty-four layers become an unreadable fence

**Severity:** Critical.

**Mitigation:** Preserve a continuous silhouette, use depth fading, and expand
only one focus layer. Browser acceptance requires that individual layers remain
countable without giving every layer a persistent text label.

### Simulated traversal is mistaken for measured layer execution

**Severity:** Critical.

**Mitigation:** The evidence mode is part of the canvas composition and data
model. Current traces use the ghosted traversal material and compact `SIM`
sigil. Only semantic scope records can install measured layer mode.

### Configured top-k is mistaken for measured routed experts

**Severity:** Critical.

**Mitigation:** Before semantic expert IDs exist, expert highlights are rendered
with the configured ghost material and use deterministic presentation indices.
Optional inspection data identifies configured top-k. The scene does not use
selected/accepted language.

### Hardware ribbons imply unavailable memory direction

**Severity:** Critical.

**Mitigation:** Binding ribbons are bidirectional and have no arrowheads. Derived
provenance is exposed only in the summoned inspection ring.

### The sculpture is beautiful but still visually static

**Severity:** Critical.

**Mitigation:** Activation movement, layer expansion, CPU control pulses, GPU
execution ribbons, and memory binding ribbons are separate deterministic motion
channels driven by the activation state and measured hardware events.

### The statue overwhelms lower-end browsers

**Severity:** Minor if bounded.

**Mitigation:** Use instancing, preallocated geometry, capped pixel ratio,
bounded bloom, and static reduced-motion rendering. The scene does not create
one draw call per expert.

### The minimal composition becomes cryptic

**Severity:** Critical.

**Mitigation:** Meaning comes from stable spatial grammar and causal motion, not
from labels: activation always traverses the layer spine, CPU always dispatches
into the kernel chamber, GPU work always illuminates the execution volume, and
memory binding always touches the outer halo. Browser review is performed first
with all instruments retracted and without reading explanatory material.

### Three-dimensional controls become illegible or unreachable

**Severity:** Critical.

**Mitigation:** Use authored camera poses, bounded billboard behavior, generous
invisible hit volumes, and keyboard-equivalent accessible semantics. Control
contrast and hit testing are verified at every target viewport before the flat
browser fallbacks are considered.

### Conventional dashboard chrome returns during implementation

**Severity:** Critical.

**Mitigation:** The renderer contract forbids persistent screen-fixed HUDs,
cards, legends, bottom sheets, and control bars in normal operation. Browser
receipts must show the idle sculpture and the temporarily summoned world-space
instrument state separately.

## Rollout

1. Install normalized architecture metadata for both gallery candidates.
2. Replace the current theater with the static central statue and verify the
   two silhouettes.
3. Add layer focus and the simulated activation state machine.
4. Add the active-kernel chamber and family-specific mechanical glyphs.
5. Add CPU, GPU, and unified-memory nodes and ribbons.
6. Add active-operation tiling and measured hardware synchronization.
7. Complete responsive, reduced-motion, PNG, and MP4 receipts.
8. Design the semantic profiler scope extension separately.

The first implementation checkpoint is the statue itself. It must already look
intentional and architectural before motion complexity is added.
