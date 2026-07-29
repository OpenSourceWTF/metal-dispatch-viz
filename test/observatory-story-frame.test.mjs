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
        elapsedNs: 2_000,
        commandBuffer: { index: 3, position: 1, total: 2 },
        mathIntensity: 0.2,
        bindingIntensity: 0.15,
      },
      {
        index: 1,
        progress: 0.8,
        family: "projection",
        kernel: "steel_gemm_fused_q4",
        grid: [64, 4, 1],
        elapsedNs: 8_000,
        commandBuffer: { index: 4, position: 2, total: 2 },
        mathIntensity: 1,
        bindingIntensity: 0.75,
      },
    ],
    dispatchCoverage: { displayed: 2, total: 2 },
    speculation: { configuredWidth: 3, acceptanceMeasured: false },
    evidenceHealth: {
      level: "warning",
      summary: "Source completeness unverifiable",
    },
  };
}

test("story frames expose one bounded and decipherable operation", () => {
  const story = buildStoryFrame(theaterModel(), 1);

  assert.equal(story.progress.percent, 80);
  assert.equal(story.progress.dispatchLabel, "2 / 2");
  assert.equal(story.progress.bufferLabel, "2 / 2");
  assert.equal(story.progress.elapsedLabel, "8 µs elapsed");
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
  assert.equal(empty.memory.blocks.length, 12);
  assert.equal(empty.gpu.lanes.length, 4);
  assert.equal(empty.speculation.visible, false);
});
