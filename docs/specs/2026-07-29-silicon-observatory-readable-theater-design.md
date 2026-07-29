# Silicon Observatory Readable Theater Design

**Status:** Approved
**Date:** 2026-07-29
**Branch:** `agent/silicon-observatory`

## Problem

The first Silicon Observatory prototype is atmospheric but not legible. It
presents low-contrast boxes, free-floating labels, ribbons, particles, and an
evidence rail with nearly equal visual weight. The viewer cannot immediately
identify the current operation, the direction of the presentation, the amount
of work completed, or which forms represent memory, computation, and
parallelism.

The trace-to-scene premise remains useful. MLX profiler traces can drive
captured-window progress, command-buffer timing, dispatch order, kernel family,
kernel geometry, and observed overlap. They do not provide exact tensor
identity, exact memory addresses or access direction, per-operation execution
timestamps, or speculative-token acceptance. The redesign must make the
supported story obvious without turning derived choreography into measured
fact.

## Design Objective

Replace the amorphous observatory with a luminous 2.5D computational theater.
Within three seconds, a first-time viewer should be able to answer:

1. How far through the captured trace window are we?
2. Which kernel family is active?
3. What model-memory region is being presented as active?
4. How much parallel GPU work is being expressed?
5. Which elements are measured, derived, or merely configured?

The result should feel like an animated museum model: architectural, vivid,
and cinematic, but governed by an obvious left-to-right reading order.

## Visual Direction

### Composition

The camera uses a fixed orthographic projection with short, bounded emphasis
transitions between stable operation states. It does not drift continuously.

The stage has four stable regions:

1. **Model in unified memory** — a bright, structured wall of aggregated model
   blocks on the left.
2. **Active kernel** — one large labeled kernel tile in the center.
3. **GPU lanes** — a bank of parallel execution tiles on the right.
4. **Writeback path** — a lower return path into unified memory.

CPU command activity occupies a narrow control rail above the main path. SSD
does not occupy the primary stage because schema v1 contains no SSD activity.
Its absence is explained in the evidence drawer rather than represented as an
apparently active device.

```text
CAPTURED WINDOW 42%   BUFFER 3/8   DISPATCH 117/264

┌─────────────────┐    ┌─────────────────┐    ┌──────────────────┐
│ UNIFIED MEMORY  │───▶│ ACTIVE KERNEL   │═══▶│ GPU LANES × 12   │
│ model/layer map │    │ matmul · shape  │    │ parallel tiles   │
└─────────────────┘    └─────────────────┘    └──────────────────┘
         ▲                                                │
         └────────────── DERIVED WRITEBACK ───────────────┘
```

### Hierarchy

Only the current operation receives maximum brightness and motion. Supporting
regions remain visible at medium luminance. Inactive geometry never disappears
into black.

Priority order:

1. Captured-window progress and active kernel
2. Active memory-to-compute path
3. Parallel GPU lanes
4. Model and trace identity
5. Evidence qualifications and export controls

### Palette

- Background: charcoal slate, not absolute black
- Unified memory: luminous cyan
- Active kernel and math: amber-gold
- GPU parallel lanes: warm white with amber activation
- Configured speculation: violet with a dashed or interrupted treatment
- Completed work: cool white
- Inactive geometry: visible blue-grey at roughly 25–35% luminance
- Warnings: restrained coral, never reused as ordinary decoration

Color is reinforced with position, shape, labels, line treatment, and motion.
It is never the sole carrier of meaning.

### Shape Language

- Memory is a rectilinear wall subdivided into a bounded number of aggregated
  blocks.
- The active kernel is a large plate whose aspect and subdivisions derive from
  available dispatch geometry.
- Parallelism is a clearly countable bank of execution lanes. Large counts are
  aggregated into a labeled representative count rather than rendered
  literally.
- Speculation is a separate violet branch labeled `CONFIGURED SPECULATION`.
  It never animates an accepted/rejected outcome without acceptance evidence.
- CPU control is a thin sequence of command pulses rather than a second field
  of anonymous cubes.

### Motion Grammar

Every animation must answer a specific question:

- Memory blocks illuminate when binding activity is being presented.
- A directional ribbon travels only along the current derived presentation
  path and is explicitly identified as derived.
- Particles appear only inside the active kernel while math intensity is
  nonzero.
- GPU lanes pulse together or in trace-derived groups to express parallelism.
- The progress playhead advances monotonically through the captured window.
- Camera emphasis changes only at stable operation boundaries and uses short,
  interruptible transitions.

There are no ambient particle clouds, arbitrary oscillations, continuously
orbiting geometry, or decorative ribbons without an active relationship.

## Progress and Explanation

A persistent progress rail is the primary HUD:

- Captured-window percentage
- Current command buffer and total command buffers when available
- Current dispatch and total displayed dispatches
- Measured GPU or encode duration for the active command buffer when matching
  endpoints are available
- Play/pause state and playback speed

The progress rail uses the captured window as its denominator. If the source is
sampled or incomplete, it says `CAPTURED WINDOW` rather than implying complete
model execution.

Dispatch placement inside that window may be interpolated from recorded
command-buffer boundaries. Interpolated position is labeled as such and is not
described as measured elapsed time. The separately labeled command-buffer
duration is measured only when the trace provides matching GPU or encode
endpoints.

A persistent three-item legend sits next to the progress rail:

- Cyan: unified-memory presentation
- Amber: active math
- Violet dashed: configured speculation

The active-operation label is attached to the center kernel plate and includes
the normalized kernel family plus the most useful available shape. Raw kernel
names remain available in a secondary detail view.

## Evidence and Truthfulness

The existing evidence information remains available but moves into a collapsed
`What is measured?` drawer. A compact status badge remains visible.

The presentation contract is:

- **Measured:** command-buffer timing and recorded dispatch order
- **Derived:** memory binding choreography, aggregated model geometry, and
  representative flow direction
- **Configured:** speculative width or MTP configuration
- **Unavailable:** SSD I/O, exact tensor identity, exact buffer direction, and
  speculative acceptance when absent from the trace

Warnings about omissions, deterministic sampling, or incomplete sources remain
visible near the progress rail without taking over the stage.

## Interaction

- Play/pause, previous/next trace, speed, PNG, and MP4 remain available.
- The progress rail supports scrubbing through display frames.
- Stepping while paused moves exactly one display frame.
- Hover or keyboard focus on a stable stage region reveals a concise
  explanation; the core labels remain visible without interaction.
- A `Show details` control reveals raw names and evidence qualifications.
- Reduced-motion mode uses manual stepping and discrete state changes.

## Responsive Behavior

At desktop widths, the stage, progress rail, and compact legend remain visible
simultaneously. Evidence opens as a right drawer.

At tablet and mobile widths:

- The model wall, active kernel, and GPU bank remain in one horizontal stage
  with simplified geometry.
- The active-operation label moves above the stage.
- The legend becomes a compact single row.
- Evidence opens as a bottom sheet.
- Export and trace-management actions remain reachable without horizontal
  scrolling.

The design must pass at 375, 768, 1024, and 1440 CSS pixels.

## Architecture and Data Flow

### Presentation model

A pure presentation transformer converts the existing trace-derived scene
model plus frame index into a stable `storyFrame`. It owns:

- Captured-window progress
- Buffer and dispatch positions
- Active family and display shape
- Representative memory blocks
- GPU lane count and active lane grouping
- Math, binding, and speculation emphasis
- Measured/derived/configured labels

The Three.js scene consumes `storyFrame` directly. It does not revalidate model
metadata or infer trace facts inside the render loop.

### Rendering

The scene is constructed once with stable memory, kernel, GPU, control, and
flow groups. Frame changes update prebound materials, transforms, labels, and
progress geometry. Geometry is bounded independently of model size and dispatch
count.

Readable stage annotations are part of the captured composition. PNG and MP4
exports must contain the progress rail, active-operation label, legend, and
measured/derived status—not just unlabeled WebGL geometry.

The application retains accessible DOM equivalents for screen readers and
keyboard interaction even when export-visible labels are drawn into the canvas
composition.

### Error and degraded states

- Missing geometry uses a labeled generic kernel plate.
- Missing counts display `—` rather than a fabricated denominator.
- Incomplete or sampled traces preserve the animation and visibly downgrade the
  captured-window status.
- Lack of H.264 support keeps MP4 export disabled with the existing actionable
  explanation.
- WebGL failure keeps a structured fallback summary of the active operation and
  progress.

## Scope

This redesign includes:

- New stage composition and visual hierarchy
- A trace-window progress rail and scrubbing
- A pure presentation-model boundary
- Legible active-operation and region labels
- Deterministic math, memory, parallelism, and speculation animation
- A collapsible evidence surface
- Export-visible explanatory overlays
- Responsive and reduced-motion behavior

## Non-Goals

- Exact reconstruction of physical Apple silicon
- Literal allocation maps or tensor addresses
- Claims about read/write direction not present in the trace
- Simulating speculative-token acceptance without acceptance data
- Rendering every model parameter, layer, expert, or GPU lane literally
- Adding new profiler instrumentation in this iteration
- Adding an unrestricted free camera

## Testing Strategy

Pure tests cover:

- Monotonic captured-window progress
- Buffer and dispatch denominators
- Bounded memory and GPU aggregation
- Stable family/shape labeling
- Explicit measured/derived/configured states
- Deterministic frame output

UI tests cover:

- Visible progress, legend, and active-operation labels
- Scrubbing and one-frame stepping
- Evidence drawer behavior
- Responsive control reachability
- Recording navigation locks
- Loading, empty, error, partial, and ready states

Renderer tests cover:

- Fixed camera contract
- Bounded scene object counts
- No continuous animation in paused or reduced-motion states
- Frame changes updating the intended groups
- Export composition containing progress and labels

Browser verification covers:

- Readability at 375, 768, 1024, and 1440 pixels
- A real Qwen 27B and Qwen 35B gallery cycle
- PNG and H.264 MP4 output with visible annotations
- No horizontal overflow
- Keyboard navigation and reduced motion

## Rollout

The redesign remains isolated behind `?mode=observatory`; the workbench route
does not change. The existing Observatory branch is updated in place and pushed
only after tests, production build, browser receipts, and focused review pass.

The first revision favors clarity over maximal scene density. Additional
artistic complexity can be introduced only after the five design-objective
questions are answerable in a three-second visual scan.

## Failure-Mode Review

1. **The animation invents memory facts.** Critical. Prevented by labeling
   direction and model-block activation as derived, preserving unavailable
   fields, and never showing unmeasured addresses or acceptance.
2. **Large models recreate the original clutter.** Critical. Prevented by hard
   bounds on representative memory blocks and GPU lanes, with exact counts
   shown textually.
3. **The exported movie becomes unlabeled abstract art again.** Critical.
   Prevented by making progress, active-operation identity, legend, and evidence
   status part of the captured composition.
4. **Mobile simplification hides the story.** Minor if the same four-stage
   reading order and core labels remain visible; raw details may move into the
   bottom sheet.
