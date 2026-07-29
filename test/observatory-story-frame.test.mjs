import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStoryFrame,
  MAX_GPU_LANES,
  MAX_MEMORY_BLOCKS,
} from "../src/observatory/story-frame.js";

function theaterModel() {
  return {
    label: "Qwen3.6 35B",
    model: {
      parameterBillions: 35,
      estimatedWeightGigabytes: 17.5,
    },
    frames: [
      {
        index: 0,
        progress: 0.2,
        family: "normalization",
        kernel: "rms_norm",
        grid: [8, 1, 1],
        gridAvailable: true,
        windowPositionNs: 2_000,
        placementDetail: "interpolated-sequence",
        commandBuffer: {
          index: 3,
          position: 1,
          total: 2,
          durationNs: 2_500,
          durationSource: "encode",
        },
        mathIntensity: 0.2,
        bindingIntensity: 0.15,
      },
      {
        index: 1,
        progress: 0.8,
        family: "projection",
        kernel: "steel_gemm_fused_q4",
        grid: [64, 4, 1],
        gridAvailable: true,
        windowPositionNs: 8_000,
        placementDetail: "interpolated-sequence",
        commandBuffer: {
          index: 4,
          position: 2,
          total: 2,
          durationNs: 4_800,
          durationSource: "gpu",
        },
        mathIntensity: 1,
        bindingIntensity: 0.75,
      },
    ],
    speculation: { configuredWidth: 3, acceptanceMeasured: false },
    evidenceHealth: {
      level: "warning",
      summary: "Source completeness unverifiable",
      sourceCompleteness: "unverifiable",
    },
    dispatchCoverage: { displayed: 4_000, total: 330_494 },
  };
}

test("story frames expose one bounded and decipherable operation", () => {
  const story = buildStoryFrame(theaterModel(), 1);

  assert.equal(story.progress.percent, 80);
  assert.equal(story.progress.dispatchLabel, "2 / 2");
  assert.equal(story.progress.bufferLabel, "2 / 2");
  assert.equal(story.progress.positionLabel, "8 µs interpolated position");
  assert.equal(story.progress.measuredDurationLabel, "MEASURED GPU · 4.8 µs");
  assert.equal(story.active.family, "projection");
  assert.equal(story.active.kernel, "steel_gemm_fused_q4");
  assert.equal(story.active.shapeLabel, "64 × 4 × 1");
  assert.equal(story.memory.blocks.length <= MAX_MEMORY_BLOCKS, true);
  assert.equal(story.memory.blocks.length >= 12, true);
  assert.equal(story.memory.activeIndices.length > 0, true);
  assert.equal(story.gpu.lanes.length <= MAX_GPU_LANES, true);
  assert.equal(story.gpu.lanes.length >= 4, true);
  assert.equal(story.gpu.gridLabel, "GRID 64 × 4 × 1");
  assert.equal(story.flow.evidence, "derived");
  assert.equal(story.speculation.evidence, "configured");
  assert.equal(story.speculation.label, "CONFIGURED SPECULATION · K3");
  assert.equal(
    story.evidence.statusLabel,
    "SAMPLED 4,000/330,494 · SOURCE UNVERIFIABLE",
  );
  assert.equal(Object.isFrozen(story), true);
  assert.equal(Object.isFrozen(story.memory.blocks), true);
});

test("story-frame aggregation is deterministic and safe without a trace", () => {
  const model = theaterModel();
  assert.deepEqual(buildStoryFrame(model, 1), buildStoryFrame(model, 1));

  const empty = buildStoryFrame(null, 99);
  assert.equal(empty.index, 0);
  assert.equal(empty.progress.percent, 0);
  assert.equal(empty.progress.dispatchLabel, "—");
  assert.equal(empty.active.family, "awaiting");
  assert.equal(empty.active.kernel, "Awaiting dispatch");
  assert.equal(empty.active.shapeLabel, "SHAPE UNAVAILABLE");
  assert.equal(empty.memory.blocks.length, 12);
  assert.equal(empty.gpu.lanes.length, 0);
  assert.equal(empty.speculation.visible, false);
});

test("missing dispatch geometry stays unavailable instead of becoming measured", () => {
  const model = theaterModel();
  model.frames = [
    {
      ...model.frames[0],
      grid: [1, 1, 1],
      gridAvailable: false,
    },
  ];
  const story = buildStoryFrame(model, 0);
  assert.equal(story.active.shapeLabel, "SHAPE UNAVAILABLE");
  assert.equal(story.gpu.gridLabel, "GRID UNAVAILABLE");
  assert.equal(story.gpu.evidence, "unavailable");
  assert.equal(story.gpu.lanes.length, 0);
  assert.equal(story.gpu.activeIndices.length, 0);
});

test("zero binding activity does not invent an active memory access", () => {
  const model = theaterModel();
  model.frames = [
    {
      ...model.frames[0],
      bindingIntensity: 0,
    },
  ];

  const story = buildStoryFrame(model, 0);
  assert.equal(story.flow.active, false);
  assert.equal(story.memory.activeIndices.length, 0);
});
