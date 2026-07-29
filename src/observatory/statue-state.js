import { buildKernelGlyphDescriptor } from "./kernel-glyph.js";

export const TRANSFORMER_STAGES = Object.freeze([
  "pre-attention-norm",
  "attention",
  "attention-residual",
  "pre-feed-forward-norm",
  "feed-forward",
  "feed-forward-residual",
]);

const MOE_TRANSFORMER_STAGES = Object.freeze([
  "pre-attention-norm",
  "attention",
  "attention-residual",
  "pre-feed-forward-norm",
  "router",
  "feed-forward",
  "feed-forward-residual",
]);

export function transformerStagesForArchitecture(architecture) {
  return architecture?.feedForward?.kind === "moe" ||
    architecture?.feedForwardKind === "moe"
    ? MOE_TRANSFORMER_STAGES
    : TRANSFORMER_STAGES;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function deepFreeze(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    Object.isFrozen(value)
  ) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function architecturePresentation(architecture) {
  if (architecture === null || typeof architecture !== "object") {
    return {
      available: false,
      source: "unavailable",
      layerCount: 0,
      hiddenSize: null,
      vocabSize: null,
      layerTypes: [],
      attention: null,
      linearAttention: null,
      feedForward: null,
      feedForwardKind: null,
      mtp: null,
    };
  }

  return {
    available: true,
    source: architecture.source,
    layerCount: architecture.numHiddenLayers,
    hiddenSize: architecture.hiddenSize,
    vocabSize: architecture.vocabSize,
    layerTypes: architecture.layerTypes.slice(),
    attention: { ...architecture.attention },
    linearAttention: { ...architecture.linearAttention },
    feedForward: { ...architecture.feedForward },
    feedForwardKind: architecture.feedForward.kind,
    mtp: { ...architecture.mtp },
  };
}

function activationPresentation(
  architecture,
  frame,
  simulationProgress,
) {
  if (!architecture.available) {
    return {
      evidence: "unavailable",
      simulationProgress: null,
      traceProgress: Number.isFinite(frame?.progress)
        ? clamp(frame.progress, 0, 1)
        : null,
      layerIndex: null,
      layerLabel: "—",
      layerType: null,
      stage: null,
      stageIndex: null,
      stageCount: 0,
    };
  }

  const progress = clamp(finite(simulationProgress), 0, 1);
  const layerPosition = progress * architecture.layerCount;
  const layerIndex = Math.min(
    architecture.layerCount - 1,
    Math.floor(layerPosition),
  );
  const layerFraction =
    progress === 1 ? 1 : layerPosition - layerIndex;
  const stages = transformerStagesForArchitecture(architecture);
  const stageIndex = Math.min(
    stages.length - 1,
    Math.floor(layerFraction * stages.length),
  );

  return {
    evidence: "simulated",
    simulationProgress: progress,
    traceProgress: Number.isFinite(frame?.progress)
      ? clamp(frame.progress, 0, 1)
      : null,
    layerIndex,
    layerLabel: `L${String(layerIndex + 1).padStart(2, "0")}`,
    layerType: architecture.layerTypes[layerIndex],
    stage: stages[stageIndex],
    stageIndex,
    stageCount: stages.length,
  };
}

function configuredExpertIllumination(feedForward, layerIndex) {
  if (feedForward?.kind !== "moe") return [];

  const total = feedForward.experts;
  const fanout = feedForward.expertsPerToken;
  const offset = Math.max(0, layerIndex ?? 0) % total;
  const stride = Math.max(1, Math.floor(total / fanout));
  return Array.from(
    { length: fanout },
    (_, index) => (offset + index * stride) % total,
  );
}

function expertPresentation(architecture, activation) {
  const feedForward = architecture.feedForward;
  if (!architecture.available || feedForward?.kind !== "moe") {
    return {
      total: 0,
      configuredFanout: 0,
      illuminatedIndices: [],
      sharedExpert: false,
      evidence: "unavailable",
    };
  }

  return {
    total: feedForward.experts,
    configuredFanout: feedForward.expertsPerToken,
    illuminatedIndices: configuredExpertIllumination(
      feedForward,
      activation.layerIndex,
    ),
    sharedExpert: feedForward.sharedIntermediateSize !== null,
    evidence: "configured",
  };
}

function gpuLaneCount(frame, model) {
  if (frame?.gridAvailable !== true) return 0;
  const grid = Array.isArray(frame.grid) ? frame.grid : [1, 1, 1];
  const work = grid.reduce(
    (product, dimension) =>
      product * Math.max(1, finite(dimension, 1)),
    1,
  );
  const overlap = Math.max(
    1,
    finite(model?.parallelism?.maxGpuCommandBuffers, 1),
  );
  return clamp(Math.ceil(Math.log2(work + 1) / 2 + overlap - 1), 1, 16);
}

function memoryHaloScale(model) {
  const gigabytes = model?.model?.estimatedWeightGigabytes;
  if (!Number.isFinite(gigabytes) || gigabytes <= 0) return 1;
  return clamp(0.9 + Math.log2(gigabytes + 1) / 10, 0.9, 1.5);
}

function hardwarePresentation(model, frame) {
  const memoryActive = finite(frame?.bindingIntensity) > 0;
  const gpuActive = frame?.gridAvailable === true;

  return {
    cpu: {
      dispatchPulse: frame?.commandBufferChanged === true,
      commandBuffer: frame?.commandBuffer ?? null,
      evidence: frame?.commandBuffer ? "measured" : "unavailable",
    },
    gpu: {
      active: gpuActive,
      laneCount: gpuLaneCount(frame, model),
      dispatchMode: frame?.dispatchMode ?? null,
      grid: Array.isArray(frame?.grid) ? frame.grid.slice() : [1, 1, 1],
      threadgroup: Array.isArray(frame?.threadgroup)
        ? frame.threadgroup.slice()
        : [1, 1, 1],
      evidence: gpuActive ? "measured" : "unavailable",
    },
    memory: {
      active: memoryActive,
      intensity: clamp(finite(frame?.bindingIntensity), 0, 1),
      direction: "bidirectional",
      haloScale: memoryHaloScale(model),
      evidence: "derived",
    },
  };
}

function speculationPresentation(model) {
  const configuredWidth = model?.speculation?.configuredWidth;
  const width =
    Number.isSafeInteger(configuredWidth) && configuredWidth > 0
      ? configuredWidth
      : 0;
  return {
    visible: width > 1,
    width,
    branches: Array.from({ length: width }, (_, index) => index),
    evidence: width > 0 ? "configured" : "unavailable",
    acceptanceMeasured: false,
  };
}

export function buildStatueFrame(model, frameIndex) {
  const frames = Array.isArray(model?.frames) ? model.frames : [];
  const boundedIndex =
    frames.length === 0
      ? 0
      : clamp(
          Number.isSafeInteger(frameIndex) ? frameIndex : 0,
          0,
          frames.length - 1,
        );
  const frame = frames[boundedIndex] ?? {};
  const architecture = architecturePresentation(model?.architecture);
  const simulationProgress =
    frames.length <= 1 ? 0 : boundedIndex / (frames.length - 1);
  const activation = activationPresentation(
    architecture,
    frame,
    simulationProgress,
  );
  const kernel = buildKernelGlyphDescriptor(frame);

  return deepFreeze({
    frameIndex: boundedIndex,
    architecture,
    activation,
    kernel,
    experts: expertPresentation(architecture, activation),
    hardware: hardwarePresentation(model, frame),
    speculation: speculationPresentation(model),
    inscriptions: {
      model:
        typeof model?.label === "string" && model.label.trim() !== ""
          ? model.label.trim()
          : "LOCAL TRACE",
      layer: architecture.available
        ? `${activation.layerLabel} · ${activation.stage}`
        : "ARCHITECTURE UNAVAILABLE",
      kernel: kernel.exactName,
      simulated: "SIM",
    },
    evidence: {
      architecture: architecture.available
        ? architecture.source
        : "unavailable",
      activation: activation.evidence,
      kernelIdentity: kernel.evidence.identity,
      memory: "derived binding activity",
      speculation:
        model?.speculation?.acceptanceMeasured === true
          ? "measured"
          : "configuration only",
    },
  });
}
