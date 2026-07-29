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
  animateStatueGeometry,
  applyStatuePresentation,
  createStatueGeometry,
  disposeStatueGeometry,
} from "../src/observatory/statue-geometry.js";

function architecture({
  layers = 64,
  experts = null,
  vocabulary = 248320,
} = {}) {
  return normalizeArchitecture({
    model_type: experts ? "qwen3_5_moe_text" : "qwen3_5_text",
    num_hidden_layers: layers,
    hidden_size: experts ? 2048 : 5120,
    vocab_size: vocabulary,
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
  gridAvailable = true,
  bindingIntensity = 0.8,
  commandBufferChanged = true,
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
          gridAvailable,
          threadgroupAvailable: gridAvailable,
          bufferBinds: bindingIntensity > 0 ? 4 : 0,
          setBytesCalls: bindingIntensity > 0 ? 2 : 0,
          setBytesTotalBytes: bindingIntensity > 0 ? 16 : 0,
          bindingIntensity,
          mathIntensity: 0.9,
          commandBufferChanged,
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

test("the real top and bottom apertures expand one token and condense one vocabulary choice", () => {
  const shape = architecture({ layers: 64 });
  const frameCount = 101;
  const statue = createStatueGeometry(
    THREE,
    presentation(shape, { frameCount, frameIndex: 0 }),
  );
  const identities = statue.geometryIdentities();

  assert.ok(
    statue.parts.terminalFlow,
    "the configured model must install one reusable terminal choreography",
  );
  assert.equal(
    statue.parts.terminalFlow.userData.hiddenSize,
    shape.hiddenSize,
  );
  assert.equal(
    statue.parts.terminalFlow.userData.vocabularySize,
    shape.vocabSize,
  );
  assert.equal(statue.parts.inputToken.visible, true);
  assert.equal(statue.parts.outputLogits.visible, false);
  assert.ok(statue.parts.embeddingSignals.count > 0);
  assert.ok(
    statue.parts.outputLogitSignals.count >
      statue.parts.embeddingSignals.count,
    "a larger vocabulary must open into a denser sampled output field",
  );

  applyStatuePresentation(
    statue,
    presentation(shape, { frameCount, frameIndex: 50 }),
  );
  assert.equal(statue.parts.inputToken.visible, false);
  assert.equal(statue.parts.outputLogits.visible, false);

  applyStatuePresentation(
    statue,
    presentation(shape, {
      frameCount,
      frameIndex: frameCount - 1,
    }),
  );
  assert.deepEqual(statue.geometryIdentities(), identities);
  assert.equal(statue.parts.outputLogits.visible, true);
  assert.equal(statue.parts.selectedToken.visible, true);
  assert.equal(
    statue.parts.selectedToken.userData.evidence,
    "simulated",
  );

  const smallerVocabulary = createStatueGeometry(
    THREE,
    presentation(
      architecture({ layers: 64, vocabulary: 32_000 }),
      { frameCount, frameIndex: frameCount - 1 },
    ),
  );
  assert.ok(
    smallerVocabulary.parts.outputLogitSignals.count <
      statue.parts.outputLogitSignals.count,
    "output density must be derived from configuration rather than a model name",
  );

  disposeStatueGeometry(statue);
  disposeStatueGeometry(smallerVocabulary);
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
  assert.equal(
    statue.parts.memoryCouriers.count,
    2,
    "unified memory must show simultaneous reads and writes",
  );
  assert.equal(
    statue.parts.cpuCouriers.count,
    1,
    "a CPU dispatch must travel toward the active layer",
  );
  assert.equal(
    statue.parts.gpuCouriers.count,
    Math.min(
      4,
      Math.max(1, Math.ceil(next.hardware.gpu.laneCount / 4)),
    ),
    "parallel GPU work must be derived from the active lane count",
  );

  animateStatueGeometry(statue, 0);
  const start = new THREE.Matrix4();
  statue.parts.memoryCouriers.getMatrixAt(0, start);
  const startPosition = new THREE.Vector3().setFromMatrixPosition(start);
  animateStatueGeometry(statue, 0.5);
  const later = new THREE.Matrix4();
  statue.parts.memoryCouriers.getMatrixAt(0, later);
  const laterPosition = new THREE.Vector3().setFromMatrixPosition(later);
  assert.notDeepEqual(
    laterPosition.toArray(),
    startPosition.toArray(),
    "memory traffic must visibly travel along its installed ribbon",
  );

  applyStatuePresentation(
    statue,
    presentation(shape, {
      gridAvailable: false,
      bindingIntensity: 0,
      commandBufferChanged: false,
    }),
  );
  assert.equal(statue.parts.memoryCouriers.count, 0);
  assert.equal(statue.parts.cpuCouriers.count, 0);
  assert.equal(statue.parts.gpuCouriers.count, 0);

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

test("one focal cross-section opens while the complete transformer column remains quiet context", () => {
  const shape = architecture({ layers: 64 });
  const frameCount = 64 * TRANSFORMER_STAGES.length + 1;
  const statue = createStatueGeometry(
    THREE,
    presentation(shape, { frameCount, frameIndex: 0 }),
  );

  assert.ok(
    Array.isArray(statue.parts.focalStages),
    "the active layer must preallocate its stage cross-sections",
  );
  assert.equal(statue.parts.focalStages.length, TRANSFORMER_STAGES.length);
  assert.equal(
    statue.parts.focalStages.filter(({ group }) => group.visible).length,
    1,
  );
  assert.equal(
    statue.parts.focalStages.find(({ group }) => group.visible).stage,
    "pre-attention-norm",
  );

  const dormant = new THREE.Color();
  const focused = new THREE.Color();
  statue.parts.stageBands[0].mesh.getColorAt(20, dormant);
  statue.parts.stageBands[0].mesh.getColorAt(0, focused);
  assert.ok(
    focused.getHSL({}).l > dormant.getHSL({}).l * 2,
    "the active layer must be materially brighter than distant context",
  );

  const identities = statue.geometryIdentities();
  applyStatuePresentation(
    statue,
    presentation(shape, { frameCount, frameIndex: 4 }),
  );
  assert.deepEqual(statue.geometryIdentities(), identities);
  assert.equal(
    statue.parts.focalStages.find(({ group }) => group.visible).stage,
    "feed-forward",
  );
  assert.equal(
    statue.parts.activationPaths.filter(({ path }) => path.visible).length,
    1,
  );

  disposeStatueGeometry(statue);
});

test("one continuous residual spine divides completed from pending model depth", () => {
  const shape = architecture({ layers: 64 });
  const frameCount = 64 * TRANSFORMER_STAGES.length + 1;
  const statue = createStatueGeometry(
    THREE,
    presentation(shape, { frameCount, frameIndex: 0 }),
  );

  assert.ok(
    statue.parts.residualProgress,
    "the configured model must install a continuous progress spine",
  );
  const { completed, pending } = statue.parts.residualProgress;
  const initialBoundary = completed.userData.boundaryY;
  assert.equal(initialBoundary, pending.userData.boundaryY);
  assert.ok(completed.position.y > pending.position.y);

  const identities = statue.geometryIdentities();
  applyStatuePresentation(
    statue,
    presentation(shape, {
      frameCount,
      frameIndex: 32 * TRANSFORMER_STAGES.length,
    }),
  );

  assert.deepEqual(statue.geometryIdentities(), identities);
  assert.ok(completed.userData.boundaryY < initialBoundary);
  assert.equal(
    completed.userData.boundaryY,
    pending.userData.boundaryY,
  );

  disposeStatueGeometry(statue);
});

test("completed, active, and pending layers form a top-down progress gradient", () => {
  const shape = architecture({ layers: 64 });
  const frameCount = 64 * TRANSFORMER_STAGES.length + 1;
  const statue = createStatueGeometry(
    THREE,
    presentation(shape, {
      frameCount,
      frameIndex: 32 * TRANSFORMER_STAGES.length,
    }),
  );
  const processed = new THREE.Color();
  const active = new THREE.Color();
  const pending = new THREE.Color();
  statue.parts.layers.getColorAt(0, processed);
  statue.parts.layers.getColorAt(32, active);
  statue.parts.layers.getColorAt(60, pending);

  assert.equal(
    statue.parts.completedLayers.count,
    32,
    "one preallocated overlay must make completed layers lighting-independent",
  );
  assert.ok(active.getHSL({}).l > processed.getHSL({}).l);
  assert.ok(
    processed.getHSL({}).l > pending.getHSL({}).l * 2,
    "processed layers must leave a visible trail above the focal plane",
  );

  disposeStatueGeometry(statue);
});

test("the focal attention cross-section carries exact configured head geometry", () => {
  const shape = architecture({ layers: 64 });
  const frameCount = 64 * TRANSFORMER_STAGES.length * 2 + 1;
  const fullAttentionFrame =
    (3 * TRANSFORMER_STAGES.length + 1) * 2 + 1;
  const statue = createStatueGeometry(
    THREE,
    presentation(shape, {
      frameCount,
      frameIndex: fullAttentionFrame,
    }),
  );

  assert.equal(
    statue.parts.fullAttention.userData.queryHeadCount,
    shape.attention.queryHeads,
  );
  assert.equal(
    statue.parts.fullAttention.userData.keyValueHeadCount,
    shape.attention.keyValueHeads,
  );
  assert.equal(
    statue.parts.fullAttention.userData.layerType,
    "full_attention",
  );
  assert.equal(statue.parts.fullAttention.visible, true);
  assert.equal(statue.parts.linearAttention.visible, false);

  disposeStatueGeometry(statue);
});

test("one preallocated thought cycle gives every transformer stage a causal motion", () => {
  const denseShape = architecture({ layers: 64 });
  const denseStageCount =
    transformerStagesForArchitecture(denseShape).length;
  const denseFrameCount = 64 * denseStageCount * 2 + 1;
  const denseAttention = presentation(denseShape, {
    frameCount: denseFrameCount,
    frameIndex: (3 * denseStageCount + 1) * 2 + 1,
  });
  const dense = createStatueGeometry(THREE, denseAttention);
  const denseIdentities = dense.geometryIdentities();

  assert.ok(
    dense.parts.thoughtCycle,
    "the active aperture must install one reusable causal signal system",
  );
  assert.equal(dense.parts.thoughtCycle.userData.mode, "gather");
  assert.equal(
    dense.parts.thoughtSignals.count,
    denseShape.attention.queryHeads,
    "attention must gather the configured query-head strands",
  );

  animateStatueGeometry(dense, 0);
  const attentionStart = new THREE.Matrix4();
  dense.parts.thoughtSignals.getMatrixAt(0, attentionStart);
  const attentionStartPosition = new THREE.Vector3().setFromMatrixPosition(
    attentionStart,
  );
  animateStatueGeometry(dense, 0.8);
  const attentionGathered = new THREE.Matrix4();
  dense.parts.thoughtSignals.getMatrixAt(0, attentionGathered);
  const attentionGatheredPosition =
    new THREE.Vector3().setFromMatrixPosition(attentionGathered);
  assert.ok(
    Math.hypot(attentionGatheredPosition.x, attentionGatheredPosition.z) <
      Math.hypot(attentionStartPosition.x, attentionStartPosition.z),
    "attention signals must visibly gather from the head ring into context",
  );

  applyStatuePresentation(
    dense,
    presentation(denseShape, {
      frameCount: denseFrameCount,
      frameIndex: 3,
    }),
  );
  assert.equal(dense.parts.thoughtCycle.userData.mode, "recurrent-mix");
  assert.equal(
    dense.parts.thoughtSignals.count,
    denseShape.linearAttention.keyHeads +
      denseShape.linearAttention.valueHeads,
    "linear attention must retain both configured state-mixing fields",
  );

  const feedForward = presentation(denseShape, {
    frameCount: denseFrameCount,
    frameIndex: 9,
  });
  applyStatuePresentation(dense, feedForward);
  assert.deepEqual(dense.geometryIdentities(), denseIdentities);
  assert.equal(dense.parts.thoughtCycle.userData.mode, "transform");
  assert.equal(dense.parts.thoughtSignals.count, 2);

  const moeShape = architecture({ layers: 40, experts: 256 });
  const moeStageCount = transformerStagesForArchitecture(moeShape).length;
  const moeFrameCount = 40 * moeStageCount * 2 + 1;
  const router = presentation(moeShape, {
    frameCount: moeFrameCount,
    frameIndex: 9,
  });
  const moe = createStatueGeometry(THREE, router);
  assert.equal(moe.parts.thoughtCycle.userData.mode, "select");
  assert.equal(
    moe.parts.thoughtSignals.count,
    moeShape.feedForward.expertsPerToken,
    "routing must split into the configured top-k expert fan-out",
  );

  applyStatuePresentation(
    moe,
    presentation(moeShape, {
      frameCount: moeFrameCount,
      frameIndex: 13,
    }),
  );
  assert.equal(moe.parts.thoughtCycle.userData.mode, "release");
  assert.equal(moe.parts.thoughtSignals.count, 1);

  disposeStatueGeometry(dense);
  disposeStatueGeometry(moe);
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
