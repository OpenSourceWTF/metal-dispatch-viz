export const MAX_MEMORY_BLOCKS = 28;
export const MAX_GPU_LANES = 16;

const MIN_MEMORY_BLOCKS = 12;
const MIN_GPU_LANES = 4;

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finitePositive(value) {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function integerInRange(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function dimensions(value) {
  const source = Array.isArray(value) ? value : [];
  return [0, 1, 2].map((index) => {
    const dimension = source[index];
    return Number.isFinite(dimension) && dimension > 0
      ? Math.floor(dimension)
      : 1;
  });
}

function dimensionsLabel(value) {
  return dimensions(value).join(" × ");
}

function dimensionProduct(value) {
  return dimensions(value).reduce(
    (product, dimension) => product * dimension,
    1,
  );
}

function elapsedLabel(elapsedNs) {
  if (!Number.isFinite(elapsedNs) || elapsedNs < 0) return "timing unavailable";
  if (elapsedNs < 1_000) return `${Math.round(elapsedNs)} ns elapsed`;
  if (elapsedNs < 1_000_000) {
    const microseconds = elapsedNs / 1_000;
    return `${Number(microseconds.toFixed(microseconds < 10 ? 1 : 0))} µs elapsed`;
  }
  const milliseconds = elapsedNs / 1_000_000;
  return `${Number(milliseconds.toFixed(milliseconds < 10 ? 1 : 0))} ms elapsed`;
}

function numberedItems(count) {
  return Array.from({ length: count }, (_, index) =>
    Object.freeze({ index }),
  );
}

function activeIndices(total, activeCount, start) {
  if (total <= 0 || activeCount <= 0) return Object.freeze([]);
  const result = [];
  for (let offset = 0; offset < Math.min(total, activeCount); offset += 1) {
    result.push((start + offset) % total);
  }
  return Object.freeze(result);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function memoryBlockCount(model) {
  const parameters = finitePositive(model?.model?.parameterBillions);
  if (parameters === null) return MIN_MEMORY_BLOCKS;
  return integerInRange(
    MIN_MEMORY_BLOCKS + Math.log2(parameters + 1) * 2.5,
    MIN_MEMORY_BLOCKS,
    MAX_MEMORY_BLOCKS,
  );
}

function gpuLaneCount(frame) {
  const work = dimensionProduct(frame?.grid);
  return integerInRange(
    Math.ceil(Math.log2(work + 1)),
    MIN_GPU_LANES,
    MAX_GPU_LANES,
  );
}

export function buildStoryFrame(model, requestedFrameIndex = 0) {
  const frames = Array.isArray(model?.frames) ? model.frames : [];
  const index =
    frames.length === 0
      ? 0
      : integerInRange(requestedFrameIndex, 0, frames.length - 1);
  const frame = frames[index] ?? null;
  const ratio = clamp(Number.isFinite(frame?.progress) ? frame.progress : 0);
  const memoryCount = memoryBlockCount(model);
  const lanesCount = gpuLaneCount(frame);
  const bindingIntensity = clamp(
    Number.isFinite(frame?.bindingIntensity) ? frame.bindingIntensity : 0,
  );
  const mathIntensity = clamp(
    Number.isFinite(frame?.mathIntensity) ? frame.mathIntensity : 0,
  );
  const activeMemoryCount = Math.max(
    1,
    Math.round(1 + bindingIntensity * 5),
  );
  const activeLaneCount = Math.max(
    1,
    Math.round(lanesCount * (0.35 + mathIntensity * 0.65)),
  );
  const configuredWidth = finitePositive(
    model?.speculation?.configuredWidth,
  );
  const mass = finitePositive(model?.model?.estimatedWeightGigabytes);
  const shapeLabel = dimensionsLabel(frame?.grid);
  const hasFrames = frames.length > 0;

  return deepFreeze({
    index,
    progress: {
      ratio,
      percent: Math.round(ratio * 100),
      capturedWindowLabel: "CAPTURED WINDOW",
      dispatchLabel: hasFrames ? `${index + 1} / ${frames.length}` : "—",
      bufferLabel:
        frame?.commandBuffer?.position && frame?.commandBuffer?.total
          ? `${frame.commandBuffer.position} / ${frame.commandBuffer.total}`
          : "—",
      elapsedLabel: elapsedLabel(frame?.elapsedNs),
    },
    active: {
      family: frame?.family ?? "awaiting",
      kernel: frame?.kernel ?? "Awaiting dispatch",
      shapeLabel,
      mathIntensity,
    },
    memory: {
      blocks: numberedItems(memoryCount),
      activeIndices: activeIndices(
        memoryCount,
        activeMemoryCount,
        (frame?.index ?? 0) * 3,
      ),
      exactMassLabel: mass === null ? "MASS UNKNOWN" : `~${mass} GB`,
      evidence: "derived",
    },
    gpu: {
      lanes: numberedItems(lanesCount),
      activeIndices: activeIndices(
        lanesCount,
        activeLaneCount,
        frame?.index ?? 0,
      ),
      gridLabel: `GRID ${shapeLabel}`,
      evidence: "measured geometry",
    },
    flow: {
      active: hasFrames && bindingIntensity > 0,
      intensity: bindingIntensity,
      label: "DERIVED BINDING FLOW",
      evidence: "derived",
    },
    speculation: {
      width: configuredWidth,
      visible: configuredWidth !== null,
      label:
        configuredWidth === null
          ? "SPECULATION NOT DECLARED"
          : `CONFIGURED SPECULATION · K${configuredWidth}`,
      evidence: "configured",
      acceptanceMeasured:
        model?.speculation?.acceptanceMeasured === true,
    },
    evidence: {
      level: model?.evidenceHealth?.level ?? "pending",
      summary:
        model?.evidenceHealth?.summary ??
        "Evidence health is resolved with the trace.",
    },
  });
}
