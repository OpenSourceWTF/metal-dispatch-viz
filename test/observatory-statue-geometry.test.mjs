import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import { normalizeArchitecture } from "../src/observatory/architecture.js";
import {
  buildStatueFrame,
  TRANSFORMER_STAGES,
  transformerStagesForArchitecture,
} from "../src/observatory/statue-state.js";
import {
  applyStatuePresentation,
  createStatueGeometry,
  disposeStatueGeometry,
} from "../src/observatory/statue-geometry.js";

function architecture({ layers = 64, experts = null } = {}) {
  return normalizeArchitecture({
    model_type: experts ? "qwen3_5_moe_text" : "qwen3_5_text",
    num_hidden_layers: layers,
    hidden_size: experts ? 2048 : 5120,
    vocab_size: 248320,
    layer_type_pattern: [
      "linear_attention",
      "linear_attention",
      "linear_attention",
      "full_attention",
    ],
    num_attention_heads: experts ? 16 : 24,
    num_key_value_heads: experts ? 2 : 4,
    head_dim: 256,
    linear_num_key_heads: 16,
    linear_num_value_heads: experts ? 32 : 48,
    linear_key_head_dim: 128,
    linear_value_head_dim: 128,
    ...(experts
      ? {
          moe_intermediate_size: 512,
          shared_expert_intermediate_size: 512,
          num_experts: experts,
          num_experts_per_tok: 8,
        }
      : { intermediate_size: 17408 }),
    mtp_num_hidden_layers: 1,
  });
}

function presentation(architectureShape, {
  progress = 0,
  kernel = "exact_kernel",
  family = "attention",
  frameCount = 1,
  frameIndex = 0,
} = {}) {
  return buildStatueFrame(
    {
      label: "Qwen checkpoint",
      architecture: architectureShape,
      frames: Array.from({ length: frameCount }, (_, index) => ({
          index,
          progress,
          kernel,
          family,
          dispatchMode: "threads",
          grid: [64, 8, 1],
          threadgroup: [32, 2, 1],
          gridAvailable: true,
          threadgroupAvailable: true,
          bufferBinds: 4,
          setBytesCalls: 2,
          setBytesTotalBytes: 16,
          bindingIntensity: 0.8,
          mathIntensity: 0.9,
          commandBufferChanged: true,
        })),
      model: {
        estimatedWeightGigabytes:
          architectureShape?.feedForward?.kind === "moe" ? 17.5 : 13.5,
      },
      speculation: {
        configuredWidth: 3,
        acceptanceMeasured: false,
      },
      parallelism: { maxGpuCommandBuffers: 2 },
    },
    frameIndex,
  );
}

test("installs the exact configured layer and expert counts once", () => {
  const dense = createStatueGeometry(
    THREE,
    presentation(architecture({ layers: 64 })),
  );
  assert.equal(dense.parts.layers.count, 64);
  assert.equal(dense.parts.experts.count, 0);

  const moe = createStatueGeometry(
    THREE,
    presentation(architecture({ layers: 40, experts: 256 })),
  );
  assert.equal(moe.parts.layers.count, 40);
  assert.equal(moe.parts.experts.userData.expertsPerLayer, 256);
  assert.equal(moe.parts.experts.count, 40 * 256);

  disposeStatueGeometry(dense);
  disposeStatueGeometry(moe);
});

test("the configured transformer column flows from its top input to bottom output", () => {
  const statue = createStatueGeometry(
    THREE,
    presentation(architecture({ layers: 64 })),
  );
  const input = statue.root.getObjectByName("TOKEN_EMBEDDING_APERTURE");
  const output = statue.root.getObjectByName("VOCABULARY_APERTURE");

  assert.ok(input.position.y > output.position.y);
  assert.ok(statue.root.getObjectByName("UNIFIED_MEMORY_CUBE"));
  assert.ok(
    statue.parts.ribbons.every(
      ({ mesh }) => mesh.userData.anchor === "ACTIVE_LAYER_APERTURE",
    ),
  );

  disposeStatueGeometry(statue);
});

test("frame updates reuse installed geometry and expose hardware activity", () => {
  const shape = architecture({ layers: 64 });
  const first = presentation(shape, { progress: 0 });
  const statue = createStatueGeometry(THREE, first);
  const identities = statue.geometryIdentities();

  const next = presentation(shape, {
    progress: 0.72,
    family: "projection",
    kernel: "another_exact_kernel",
  });
  applyStatuePresentation(statue, next);

  assert.deepEqual(statue.geometryIdentities(), identities);
  assert.equal(statue.root.userData.activeLayer, next.activation.layerIndex);
  assert.equal(statue.parts.memory.userData.active, true);
  assert.equal(statue.parts.gpu.userData.active, true);
  assert.equal(statue.parts.cpu.userData.dispatchPulse, true);
  assert.equal(statue.parts.kernel.userData.exactName, "another_exact_kernel");

  disposeStatueGeometry(statue);
});

test("every layer retains the complete transformer stage sequence while the column scrolls", () => {
  const shape = architecture({ layers: 64 });
  const first = presentation(shape, {
    frameCount: 64 * TRANSFORMER_STAGES.length + 1,
    frameIndex: 0,
  });
  const statue = createStatueGeometry(THREE, first);
  const identities = statue.geometryIdentities();

  assert.equal(statue.parts.stageBands.length, TRANSFORMER_STAGES.length);
  assert.ok(
    statue.parts.stageBands.every(
      ({ mesh }) => mesh.count === shape.numHiddenLayers,
    ),
  );
  assert.ok(
    statue.parts.stageBands.every(({ mesh }) => mesh.visible),
  );
  const initialTarget = statue.parts.scrollGroup.userData.targetY;

  const feedForward = presentation(shape, {
    frameCount: 64 * TRANSFORMER_STAGES.length + 1,
    frameIndex: 4,
  });
  applyStatuePresentation(statue, feedForward);

  assert.deepEqual(statue.geometryIdentities(), identities);
  assert.equal(statue.parts.activeLayer.position.y, 0);
  assert.notEqual(
    statue.parts.scrollGroup.userData.targetY,
    initialTarget,
  );

  disposeStatueGeometry(statue);
});

test("MoE routing appears only while feed-forward selects configured experts", () => {
  const shape = architecture({ layers: 40, experts: 256 });
  const stageCount = transformerStagesForArchitecture(shape).length;
  const frameCount = 40 * stageCount * 2 + 1;
  const attention = presentation(shape, {
    frameCount,
    frameIndex: 3,
  });
  const statue = createStatueGeometry(THREE, attention);
  const identities = statue.geometryIdentities();

  assert.equal(statue.parts.expertRoutes.length, 8);
  assert.equal(statue.parts.expertRouteFan.visible, false);
  assert.equal(statue.parts.sharedExpert.visible, false);

  const router = presentation(shape, {
    frameCount,
    frameIndex: 9,
  });
  applyStatuePresentation(statue, router);

  assert.deepEqual(statue.geometryIdentities(), identities);
  assert.equal(statue.parts.expertRouteFan.visible, true);
  assert.equal(statue.parts.expertRouteFan.userData.routedExpertCount, 8);
  assert.equal(
    statue.parts.expertRoutes.filter((route) => route.visible).length,
    8,
  );
  assert.equal(statue.parts.sharedExpert.visible, false);

  const feedForward = presentation(shape, {
    frameCount,
    frameIndex: 11,
  });
  applyStatuePresentation(statue, feedForward);
  assert.equal(statue.parts.expertRouteFan.visible, true);
  assert.equal(statue.parts.sharedExpert.visible, true);

  const residual = presentation(shape, {
    frameCount,
    frameIndex: 13,
  });
  applyStatuePresentation(statue, residual);
  assert.equal(statue.parts.expertRouteFan.visible, false);
  assert.equal(statue.parts.sharedExpert.visible, false);

  disposeStatueGeometry(statue);
});

test("unavailable architecture remains a neutral empty installation", () => {
  const statue = createStatueGeometry(
    THREE,
    presentation(null, { family: "other" }),
  );
  assert.equal(statue.parts.layers.count, 0);
  assert.equal(statue.parts.experts.count, 0);
  assert.equal(statue.root.userData.architectureAvailable, false);
  disposeStatueGeometry(statue);
});
