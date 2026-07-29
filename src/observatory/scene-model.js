const PARAMETER_COUNT_PATTERN =
  /(?:^|[^0-9])(\d+(?:\.\d+)?)\s*b(?:[^a-z]|$)/i;
const QUANTIZATION_PATTERN = /(?:^|[^a-z0-9])o?q(\d+)(?:[^0-9]|$)/i;
const MTP_WIDTH_PATTERN = /\bMTP\s*K(\d+)\b/i;

const KERNEL_FAMILY_PATTERNS = Object.freeze([
  ["attention", /attention|flash_attn|sdpa|softmax|rope|rotary/i],
  ["projection", /gemm|matmul|mm_|linear|projection|proj_|qmm/i],
  ["normalization", /norm|layernorm|rms/i],
  ["routing", /router|routing|topk|expert|moe/i],
  ["activation", /silu|gelu|relu|activation|gate/i],
  ["embedding-output", /embed|embedding|lm_head|vocab|logit|output/i],
  ["transfer-binding", /copy|blit|buffer|bind|transfer|upload|download/i],
]);

function stringValue(value) {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : null;
}

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function positiveFinite(value) {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function stableTraceIdentity(trace) {
  return (
    stringValue(trace?.id) ??
    stringValue(trace?.relativePath) ??
    stringValue(trace?.label) ??
    ""
  );
}

function traceSearchText(trace) {
  return [trace?.model, trace?.label, trace?.checkpoint]
    .map(stringValue)
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function parseParameterCountBillions(modelLabel) {
  const match = PARAMETER_COUNT_PATTERN.exec(stringValue(modelLabel) ?? "");
  if (!match) return null;
  return positiveFinite(Number(match[1]));
}

function traceParameterCount(trace) {
  for (const value of [trace?.model, trace?.label, trace?.checkpoint]) {
    const count = parseParameterCountBillions(value);
    if (count !== null) return count;
  }
  return null;
}

export function discoverObservatoryGallery(registry) {
  const traces = Array.isArray(registry?.traces) ? registry.traces : [];
  return traces
    .filter((trace) => traceSearchText(trace).includes("qwen"))
    .slice()
    .sort((left, right) => {
      const leftCount = traceParameterCount(left);
      const rightCount = traceParameterCount(right);
      if (leftCount !== null && rightCount !== null && leftCount !== rightCount) {
        return leftCount - rightCount;
      }
      if (leftCount !== null && rightCount === null) return -1;
      if (leftCount === null && rightCount !== null) return 1;
      return stableTraceIdentity(left).localeCompare(stableTraceIdentity(right));
    });
}

export function classifyKernelFamily(kernelName) {
  const name = stringValue(kernelName) ?? "";
  for (const [family, pattern] of KERNEL_FAMILY_PATTERNS) {
    if (pattern.test(name)) return family;
  }
  return "other";
}

function quantizationBits(trace) {
  const source = [
    trace?.quantization,
    trace?.checkpoint,
    trace?.label,
    trace?.model,
  ]
    .map(stringValue)
    .filter(Boolean)
    .join(" ");
  const match = QUANTIZATION_PATTERN.exec(source);
  if (!match) return null;
  const bits = Number(match[1]);
  return Number.isInteger(bits) && bits > 0 && bits <= 32 ? bits : null;
}

function configuredMtpWidth(trace) {
  const source = [trace?.mode, trace?.capture, trace?.label]
    .map(stringValue)
    .filter(Boolean)
    .join(" ");
  const match = MTP_WIDTH_PATTERN.exec(source);
  if (!match) return null;
  const width = Number(match[1]);
  return Number.isSafeInteger(width) && width > 0 ? width : null;
}

function selectedLaunch(dataset) {
  const windows = Array.isArray(dataset?.launchWindows)
    ? dataset.launchWindows
    : [];
  return (
    windows.find(
      (window) =>
        Array.isArray(window?.dispatches) && window.dispatches.length > 0,
    ) ??
    windows[0] ?? {
      startNs: dataset?.startNs ?? null,
      endNs: dataset?.endNs ?? null,
      dispatches: Array.isArray(dataset?.dispatches)
        ? dataset.dispatches
        : [],
      commandBuffers: Array.isArray(dataset?.commandBuffers)
        ? dataset.commandBuffers
        : [],
    }
  );
}

function dimensionProduct(value) {
  const dimensions = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.values(value)
      : [];
  const finiteDimensions = dimensions.filter(
    (dimension) => Number.isFinite(dimension) && dimension > 0,
  );
  if (finiteDimensions.length === 0) return 1;
  return finiteDimensions.reduce((product, dimension) => product * dimension, 1);
}

function dispatchWork(dispatch) {
  return dimensionProduct(dispatch?.grid);
}

function dispatchBinding(dispatch) {
  const bufferBinds = positiveFinite(dispatch?.bufferBinds) ?? 0;
  const setBytesCalls = positiveFinite(dispatch?.setBytesCalls) ?? 0;
  const setBytes = positiveFinite(dispatch?.setBytesTotalBytes) ?? 0;
  return bufferBinds + setBytesCalls + setBytes / 64;
}

function progressFor(dispatch, index, count, launch) {
  const startNs = launch?.startNs;
  const endNs = launch?.endNs;
  if (
    Number.isFinite(dispatch?.atNs) &&
    Number.isFinite(startNs) &&
    Number.isFinite(endNs) &&
    endNs > startNs
  ) {
    return clamp((dispatch.atNs - startNs) / (endNs - startNs));
  }
  return count <= 1 ? 0 : index / (count - 1);
}

function kernelFamilyCensus(dispatches) {
  const counts = new Map();
  for (const dispatch of dispatches) {
    const family = classifyKernelFamily(dispatch?.kernel);
    counts.set(family, (counts.get(family) ?? 0) + 1);
  }
  const ordered = [...counts]
    .sort(
      ([leftFamily, leftCount], [rightFamily, rightCount]) =>
        rightCount - leftCount || leftFamily.localeCompare(rightFamily),
    );
  let assignedShare = 0;
  return Object.freeze(
    ordered.map(([family, count], index) => {
      const share =
        index === ordered.length - 1
          ? 1 - assignedShare
          : count / dispatches.length;
      assignedShare += share;
      return Object.freeze({ family, count, share });
    }),
  );
}

function maximumGpuCommandBufferOverlap(commandBuffers) {
  const endpoints = [];
  for (const commandBuffer of commandBuffers) {
    const start = commandBuffer?.gpuStartNs;
    const end = commandBuffer?.gpuEndNs;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      continue;
    }
    endpoints.push({ atNs: start, delta: 1 }, { atNs: end, delta: -1 });
  }
  endpoints.sort(
    (left, right) => left.atNs - right.atNs || left.delta - right.delta,
  );
  let active = 0;
  let maximum = 0;
  for (const endpoint of endpoints) {
    active += endpoint.delta;
    maximum = Math.max(maximum, active);
  }
  return maximum;
}

function buildFrames(dispatches, launch, speculationWidth) {
  const maximumWork = Math.max(1, ...dispatches.map(dispatchWork));
  const maximumBinding = Math.max(1, ...dispatches.map(dispatchBinding));
  return Object.freeze(
    dispatches.map((dispatch, index) =>
      Object.freeze({
        index,
        seq: Number.isFinite(dispatch?.seq) ? dispatch.seq : null,
        atNs: Number.isFinite(dispatch?.atNs) ? dispatch.atNs : null,
        commandBufferIndex: Number.isFinite(dispatch?.commandBufferIndex)
          ? dispatch.commandBufferIndex
          : null,
        kernel: stringValue(dispatch?.kernel) ?? "unnamed kernel",
        family: classifyKernelFamily(dispatch?.kernel),
        progress: progressFor(dispatch, index, dispatches.length, launch),
        mathIntensity:
          Math.log1p(dispatchWork(dispatch)) / Math.log1p(maximumWork),
        bindingIntensity: dispatchBinding(dispatch) / maximumBinding,
        ribbonLabel: "binding activity",
        speculativeLane:
          speculationWidth === null ? null : index % speculationWidth,
      }),
    ),
  );
}

function hasMeasuredPlacement(dispatches, launch) {
  return (
    Number.isFinite(launch?.startNs) &&
    Number.isFinite(launch?.endNs) &&
    launch.endNs > launch.startNs &&
    dispatches.some((dispatch) => Number.isFinite(dispatch?.atNs))
  );
}

export function buildSceneModel({ trace = {}, dataset = {} } = {}) {
  const launch = selectedLaunch(dataset);
  const dispatches = Array.isArray(launch?.dispatches)
    ? launch.dispatches
    : [];
  const commandBuffers = Array.isArray(launch?.commandBuffers)
    ? launch.commandBuffers
    : [];
  const parameterBillions = traceParameterCount(trace);
  const bits = quantizationBits(trace);
  const estimatedWeightGigabytes =
    parameterBillions !== null && bits !== null
      ? Math.round((parameterBillions * bits / 8) * 100) / 100
      : null;
  const configuredWidth = configuredMtpWidth(trace);
  const measuredPlacement = hasMeasuredPlacement(dispatches, launch);
  const geometrySource =
    parameterBillions === null ? "trace topology" : "manifest metadata";

  return Object.freeze({
    id: stableTraceIdentity(trace),
    label:
      stringValue(trace?.label) ??
      stringValue(trace?.model) ??
      stringValue(trace?.name) ??
      "Local trace",
    sourceEvidence:
      stringValue(trace?.source_evidence_status) ??
      stringValue(trace?.evidence) ??
      "unspecified",
    model: Object.freeze({
      parameterBillions,
      quantizationBits: bits,
      estimatedWeightGigabytes,
      geometrySource,
      normalizedScale:
        parameterBillions === null
          ? clamp(0.35 + Math.log1p(dispatches.length) / 20, 0.35, 0.85)
          : clamp(Math.sqrt(parameterBillions / 35), 0.35, 1.15),
    }),
    speculation: Object.freeze({
      configuredWidth,
      acceptanceMeasured: false,
    }),
    parallelism: Object.freeze({
      maxGpuCommandBuffers: maximumGpuCommandBufferOverlap(commandBuffers),
      evidence: "measured command-buffer overlap",
    }),
    kernelFamilies: kernelFamilyCensus(dispatches),
    frames: buildFrames(dispatches, launch, configuredWidth),
    evidence: Object.freeze({
      timing: measuredPlacement
        ? "measured command-buffer timing"
        : "ordinal fallback",
      dispatch: "measured order",
      memory:
        parameterBillions === null
          ? "architecture metadata unavailable"
          : "manifest-derived estimate",
      binding: "derived binding activity",
      storage: "unavailable in schema v1",
    }),
    health: dataset?.health ?? null,
  });
}
