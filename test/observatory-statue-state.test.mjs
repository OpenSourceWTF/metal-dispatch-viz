import assert from "node:assert/strict";
import test from "node:test";

import { normalizeArchitecture } from "../src/observatory/architecture.js";
import {
  buildStatueFrame,
  TRANSFORMER_STAGES,
} from "../src/observatory/statue-state.js";

function denseArchitecture() {
  return normalizeArchitecture({
    model_type: "qwen3_5_text",
    num_hidden_layers: 64,
    hidden_size: 5120,
    vocab_size: 248320,
    layer_type_pattern: [
      "linear_attention",
      "linear_attention",
      "linear_attention",
      "full_attention",
    ],
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
  });
}

function moeArchitecture() {
  return normalizeArchitecture({
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
}

function frame({
  progress,
  index,
  commandBufferChanged = index === 0,
  bindingIntensity = 0.7,
  gridAvailable = true,
} = {}) {
  return {
    index,
    progress,
    kernel: `exact_kernel_${index}`,
    family: index % 2 === 0 ? "attention" : "projection",
    dispatchMode: gridAvailable ? "threads" : null,
    grid: gridAvailable ? [64, 8, 1] : [1, 1, 1],
    threadgroup: gridAvailable ? [32, 2, 1] : [1, 1, 1],
    gridAvailable,
    threadgroupAvailable: gridAvailable,
    bufferBinds: bindingIntensity > 0 ? 4 : 0,
    setBytesCalls: bindingIntensity > 0 ? 2 : 0,
    setBytesTotalBytes: bindingIntensity > 0 ? 16 : 0,
    bindingIntensity,
    mathIntensity: 0.8,
    commandBufferChanged,
    commandBuffer: {
      index: index < 3 ? 7 : 8,
      position: index < 3 ? 1 : 2,
      total: 2,
      durationNs: 80,
      durationSource: "gpu",
    },
  };
}

function model(architecture, {
  label,
  frames,
  speculationWidth = 3,
  mass = 13.5,
} = {}) {
  return {
    label,
    architecture,
    frames,
    model: {
      estimatedWeightGigabytes: mass,
    },
    speculation: {
      configuredWidth: speculationWidth,
      acceptanceMeasured: false,
    },
    parallelism: {
      maxGpuCommandBuffers: 2,
      evidence: "measured command-buffer overlap",
    },
    evidenceHealth: {
      level: "verified",
    },
  };
}

test("maps trace progress across every configured dense layer without hiding the architecture", () => {
  const frames = [
    frame({ progress: 0, index: 0 }),
    frame({ progress: 0.5, index: 1 }),
    frame({ progress: 1, index: 2 }),
  ];
  const denseModel = model(denseArchitecture(), {
    label: "Qwen3.6 27B",
    frames,
  });

  const start = buildStatueFrame(denseModel, 0);
  assert.equal(start.architecture.layerCount, 64);
  assert.equal(start.architecture.feedForwardKind, "dense");
  assert.equal(start.architecture.layerTypes.length, 64);
  assert.equal(start.activation.evidence, "simulated");
  assert.equal(start.activation.layerIndex, 0);
  assert.equal(start.activation.layerLabel, "L01");
  assert.equal(start.inscriptions.simulated, "SIM");
  assert.equal(start.inscriptions.model, "Qwen3.6 27B");
  assert.equal(start.inscriptions.kernel, frames[0].kernel);
  assert.equal(Object.keys(start.inscriptions).length, 4);

  const middle = buildStatueFrame(denseModel, 1);
  assert.equal(middle.activation.layerIndex, 32);

  const end = buildStatueFrame(denseModel, 2);
  assert.equal(end.activation.layerIndex, 63);
  assert.equal(Object.isFrozen(end), true);
  assert.equal(Object.isFrozen(end.architecture.layerTypes), true);
});

test("uses the complete transformer choreography in causal order", () => {
  assert.deepEqual(TRANSFORMER_STAGES, [
    "pre-attention-norm",
    "attention",
    "attention-residual",
    "pre-feed-forward-norm",
    "feed-forward",
    "feed-forward-residual",
  ]);

  const layerCount = 64;
  const frames = TRANSFORMER_STAGES.map((_, index) =>
    frame({
      progress: (index + 0.1) / (TRANSFORMER_STAGES.length * layerCount),
      index,
    }),
  );
  const denseModel = model(denseArchitecture(), {
    label: "Qwen3.6 27B",
    frames,
  });
  assert.deepEqual(
    frames.map((_, index) =>
      buildStatueFrame(denseModel, index).activation.stage,
    ),
    TRANSFORMER_STAGES,
  );
});

test("represents the MoE body and configured top-k without inventing routed experts", () => {
  const frames = Array.from({ length: 5 }, (_, index) =>
    frame({ progress: index / 4, index }),
  );
  const moeModel = model(moeArchitecture(), {
    label: "Qwen3.6 35B-A3B",
    frames,
    speculationWidth: 1,
    mass: 17.5,
  });
  const presentation = buildStatueFrame(moeModel, 3);

  assert.equal(presentation.architecture.layerCount, 40);
  assert.equal(presentation.architecture.feedForwardKind, "moe");
  assert.equal(presentation.experts.total, 256);
  assert.equal(presentation.experts.illuminatedIndices.length, 8);
  assert.equal(
    new Set(presentation.experts.illuminatedIndices).size,
    8,
  );
  assert.equal(presentation.experts.evidence, "configured");
  assert.equal(presentation.experts.sharedExpert, true);
  assert.equal(presentation.speculation.width, 1);
  assert.equal(presentation.speculation.evidence, "configured");

  const serialized = JSON.stringify(presentation);
  assert.doesNotMatch(serialized, /selectedExperts|accepted/i);
});

test("gates CPU, GPU, and unified-memory motion only from available facts", () => {
  const activeModel = model(denseArchitecture(), {
    label: "Measured hardware",
    frames: [
      frame({
        progress: 0.25,
        index: 0,
        commandBufferChanged: true,
        bindingIntensity: 0.7,
      }),
    ],
  });
  const active = buildStatueFrame(activeModel, 0);
  assert.equal(active.hardware.cpu.dispatchPulse, true);
  assert.equal(active.hardware.cpu.evidence, "measured");
  assert.equal(active.hardware.gpu.active, true);
  assert.ok(active.hardware.gpu.laneCount >= 1);
  assert.ok(active.hardware.gpu.laneCount <= 16);
  assert.deepEqual(active.hardware.gpu.grid, [64, 8, 1]);
  assert.equal(active.hardware.memory.active, true);
  assert.equal(active.hardware.memory.direction, "bidirectional");
  assert.equal(active.hardware.memory.evidence, "derived");
  assert.ok(active.hardware.memory.haloScale >= 0.9);
  assert.ok(active.hardware.memory.haloScale <= 1.5);

  const inactiveModel = model(denseArchitecture(), {
    label: "Unavailable hardware",
    frames: [
      frame({
        progress: 0.25,
        index: 1,
        commandBufferChanged: false,
        bindingIntensity: 0,
        gridAvailable: false,
      }),
    ],
  });
  const inactive = buildStatueFrame(inactiveModel, 0);
  assert.equal(inactive.hardware.cpu.dispatchPulse, false);
  assert.equal(inactive.hardware.gpu.active, false);
  assert.equal(inactive.hardware.gpu.laneCount, 0);
  assert.equal(inactive.hardware.memory.active, false);
  assert.equal(inactive.hardware.memory.direction, "bidirectional");

  const serialized = JSON.stringify(inactive);
  assert.doesNotMatch(serialized, /"(?:read|write)"/i);
});

test("configured speculation remains ghosted and acceptance stays unmeasured", () => {
  const presentation = buildStatueFrame(
    model(denseArchitecture(), {
      label: "Qwen3.6 27B",
      frames: [frame({ progress: 0.2, index: 0 })],
      speculationWidth: 3,
    }),
    0,
  );
  assert.equal(presentation.speculation.visible, true);
  assert.equal(presentation.speculation.width, 3);
  assert.deepEqual(presentation.speculation.branches, [0, 1, 2]);
  assert.equal(presentation.speculation.evidence, "configured");
  assert.equal(presentation.speculation.acceptanceMeasured, false);
});

test("missing architecture stays unknown even when the trace label names Qwen", () => {
  const presentation = buildStatueFrame(
    model(null, {
      label: "Qwen3.6 27B",
      frames: [frame({ progress: 0.5, index: 0 })],
      speculationWidth: null,
      mass: null,
    }),
    0,
  );
  assert.equal(presentation.architecture.available, false);
  assert.equal(presentation.architecture.layerCount, 0);
  assert.equal(presentation.activation.layerIndex, null);
  assert.equal(
    presentation.inscriptions.layer,
    "ARCHITECTURE UNAVAILABLE",
  );
});
