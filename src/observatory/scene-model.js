import { normalizeArchitecture } from "./architecture.js";

const PARAMETER_COUNT_PATTERN =
  /(?:^|[^0-9])(\d+(?:\.\d+)?)\s*b(?:[^a-z]|$)/i;
const QUANTIZATION_PATTERN = /(?:^|[^a-z0-9])o?q(\d+)(?:[^0-9]|$)/i;
const MTP_WIDTH_PATTERN = /\bMTP\s*K(\d+)\b/i;

const KERNEL_FAMILY_PATTERNS = Object.freeze([
  ["attention", /attention|flash_attn|sdpa|softmax|rope|rotary/i],
  ["projection", /gemm|matmul|mm_|linear|projection|proj_|qmm|qmv/i],
  ["normalization", /norm|layernorm|rms/i],
  ["routing", /router|routing|topk|expert|moe/i],
  ["activation", /silu|gelu|relu|sigmoid|activation|gate/i],
  ["residual", /(?:^|_)(?:v{1,3}n?|g\d+)_?add/i],
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

function nonNegativeFinite(value) {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function stableTraceIdentity(trace) {
  return (
    stringValue(trace?.id) ??
    stringValue(trace?.relativePath) ??
    stringValue(trace?.label) ??
    ""
  );
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
    .filter((trace) => trace?.observatory?.enabled === true)
    .slice()
    .sort((left, right) => {
      const leftOrder = Number.isSafeInteger(left?.observatory?.order)
        ? left.observatory.order
        : Number.POSITIVE_INFINITY;
      const rightOrder = Number.isSafeInteger(right?.observatory?.order)
        ? right.observatory.order
        : Number.POSITIVE_INFINITY;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
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
  const populated = windows.find(
    (window) =>
      Array.isArray(window?.dispatches) && window.dispatches.length > 0,
  );
  if (populated) return populated;

  const unassigned = Array.isArray(dataset?.unassignedDispatches)
    ? dataset.unassignedDispatches
    : [];
  if (unassigned.length > 0) {
    return {
      startNs: null,
      endNs: null,
      dispatches: unassigned,
      commandBuffers: [],
      omissions: windows[0]?.omissions,
      observatoryUnassignedFallback: true,
    };
  }

  return (
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

function normalizedGrid(value) {
  const dimensions = Array.isArray(value) ? value.slice(0, 3) : [];
  return Object.freeze(
    [0, 1, 2].map((index) => {
      const dimension = dimensions[index];
      return Number.isFinite(dimension) && dimension > 0
        ? Math.floor(dimension)
        : 1;
    }),
  );
}

function hasRecordedGrid(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.slice(0, 3).every(
      (dimension) => Number.isFinite(dimension) && dimension > 0,
    )
  );
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

function measuredCommandBufferDuration(commandBuffer) {
  for (const [durationSource, startKey, endKey] of [
    ["gpu", "gpuStartNs", "gpuEndNs"],
    ["encode", "encodeStartNs", "encodeEndNs"],
  ]) {
    const startNs = commandBuffer?.[startKey];
    const endNs = commandBuffer?.[endKey];
    if (
      Number.isFinite(startNs) &&
      Number.isFinite(endNs) &&
      endNs >= startNs
    ) {
      return Object.freeze({
        durationNs: endNs - startNs,
        durationSource,
      });
    }
  }
  return null;
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
  const commandBufferIndices = [];
  const seenCommandBuffers = new Set();
  for (const source of [launch?.commandBuffers ?? [], dispatches]) {
    for (const item of source) {
      const index = item?.commandBufferIndex;
      if (!Number.isFinite(index) || seenCommandBuffers.has(index)) continue;
      seenCommandBuffers.add(index);
      commandBufferIndices.push(index);
    }
  }
  const commandBufferPositions = new Map(
    commandBufferIndices.map((index, position) => [index, position + 1]),
  );
  const commandBufferTimings = new Map(
    (launch?.commandBuffers ?? [])
      .filter((commandBuffer) =>
        Number.isFinite(commandBuffer?.commandBufferIndex),
      )
      .map((commandBuffer) => [
        commandBuffer.commandBufferIndex,
        measuredCommandBufferDuration(commandBuffer),
      ]),
  );
  let visualProgress = 0;
  return Object.freeze(
    dispatches.map((dispatch, index) => {
      const commandBufferIndex = Number.isFinite(
        dispatch?.commandBufferIndex,
      )
        ? dispatch.commandBufferIndex
        : null;
      const measuredTiming =
        commandBufferIndex === null
          ? null
          : (commandBufferTimings.get(commandBufferIndex) ?? null);
      visualProgress = Math.max(
        visualProgress,
        progressFor(dispatch, index, dispatches.length, launch),
      );
      return Object.freeze({
        index,
        seq: Number.isFinite(dispatch?.seq) ? dispatch.seq : null,
        atNs: Number.isFinite(dispatch?.atNs) ? dispatch.atNs : null,
        windowPositionNs:
          Number.isFinite(dispatch?.atNs) && Number.isFinite(launch?.startNs)
            ? Math.max(0, dispatch.atNs - launch.startNs)
            : null,
        placementDetail:
          stringValue(dispatch?.placementDetail) ??
          stringValue(dispatch?.placement) ??
          "ordinal",
        commandBufferIndex,
        commandBuffer: Object.freeze({
          index: commandBufferIndex,
          position:
            commandBufferIndex === null
              ? null
              : (commandBufferPositions.get(commandBufferIndex) ?? null),
          total:
            commandBufferIndices.length > 0
              ? commandBufferIndices.length
              : null,
          durationNs: measuredTiming?.durationNs ?? null,
          durationSource: measuredTiming?.durationSource ?? null,
        }),
        kernel: stringValue(dispatch?.kernel) ?? "unnamed kernel",
        family: classifyKernelFamily(dispatch?.kernel),
        dispatchMode:
          dispatch?.dispatch === "threads" ||
          dispatch?.dispatch === "threadgroups"
            ? dispatch.dispatch
            : null,
        grid: normalizedGrid(dispatch?.grid),
        threadgroup: normalizedGrid(dispatch?.threadgroup),
        gridAvailable: hasRecordedGrid(dispatch?.grid),
        threadgroupAvailable: hasRecordedGrid(dispatch?.threadgroup),
        bufferBinds: nonNegativeFinite(dispatch?.bufferBinds),
        setBytesCalls: nonNegativeFinite(dispatch?.setBytesCalls),
        setBytesTotalBytes: nonNegativeFinite(
          dispatch?.setBytesTotalBytes,
        ),
        commandBufferChanged:
          index === 0 ||
          dispatches[index - 1]?.commandBufferIndex !==
            commandBufferIndex,
        progress: visualProgress,
        mathIntensity:
          Math.log1p(dispatchWork(dispatch)) / Math.log1p(maximumWork),
        bindingIntensity: dispatchBinding(dispatch) / maximumBinding,
        ribbonLabel: "binding activity",
        speculativeLane:
          speculationWidth === null ? null : index % speculationWidth,
      });
    }),
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

function dispatchCoverage(dataset, launch) {
  const displayed = Array.isArray(launch?.dispatches)
    ? launch.dispatches.length
    : 0;
  const sampledTotal = Number.isSafeInteger(
    launch?.renderSampling?.dispatches?.total,
  )
    ? launch.renderSampling.dispatches.total
    : displayed;
  const exactUnassigned = Number.isSafeInteger(
    launch?.omissions?.unplacedDispatches,
  )
    ? launch.omissions.unplacedDispatches
    : 0;
  const availableUnassigned = Array.isArray(dataset?.unassignedDispatches)
    ? dataset.unassignedDispatches.length
    : 0;
  return Object.freeze({
    displayed,
    total: Math.max(displayed, sampledTotal),
    unassigned: Math.max(exactUnassigned, availableUnassigned),
    unassignedFallback: launch?.observatoryUnassignedFallback === true,
  });
}

function evidenceHealth(trace, health, coverage) {
  const sourceStatus =
    stringValue(trace?.source_evidence_status) ??
    stringValue(trace?.evidence) ??
    "unspecified";
  const sourceCompleteness =
    trace?.source_complete === true || sourceStatus === "verified-complete"
      ? "complete"
      : trace?.source_complete === false
        ? "incomplete"
        : trace?.source_complete === null ||
            sourceStatus === "legacy-unverifiable"
          ? "unverifiable"
          : "not declared";
  const windowCompleteness =
    stringValue(health?.sourceCompleteness) ??
    (health?.validEvidence === true ? "complete" : "not declared");
  const droppedRows = Number.isFinite(health?.droppedRows)
    ? Math.max(0, health.droppedRows)
    : 0;
  const malformedRows = Number.isFinite(health?.malformedRows)
    ? Math.max(0, health.malformedRows)
    : 0;
  const issues = [];

  if (sourceCompleteness === "unverifiable") {
    issues.push("source completeness unverifiable");
  } else if (sourceCompleteness === "incomplete") {
    issues.push("source capture incomplete");
  } else if (
    sourceCompleteness === "not declared" ||
    trace?.valid_evidence === false
  ) {
    issues.push("source provenance is not verified");
  }
  if (windowCompleteness !== "complete") {
    issues.push(`${windowCompleteness} trace window`);
  }
  if (droppedRows > 0) {
    issues.push(
      `${droppedRows.toLocaleString("en-US")} dropped ${
        droppedRows === 1 ? "row" : "rows"
      }`,
    );
  }
  if (malformedRows > 0) {
    issues.push(
      `${malformedRows.toLocaleString("en-US")} malformed ${
        malformedRows === 1 ? "row" : "rows"
      }`,
    );
  }
  if (health?.validEvidence === false && issues.length === 0) {
    issues.push("trace window is not valid evidence");
  }
  if (coverage.unassigned > 0) {
    const count = coverage.unassigned.toLocaleString("en-US");
    const dispatchLabel =
      coverage.unassigned === 1 ? "dispatch" : "dispatches";
    issues.push(
      coverage.unassignedFallback
        ? `${count} unassigned ${dispatchLabel} shown with ordinal fallback`
        : `${count} unassigned ${dispatchLabel} omitted from this launch view`,
    );
  }
  if (coverage.total > coverage.displayed) {
    issues.push(
      `${coverage.displayed.toLocaleString("en-US")} of ${coverage.total.toLocaleString(
        "en-US",
      )} launch dispatches shown by deterministic sampling`,
    );
  }

  const verified =
    sourceStatus === "verified-complete" &&
    health?.validEvidence === true &&
    issues.length === 0;
  return Object.freeze({
    level: verified ? "verified" : "warning",
    sourceStatus,
    sourceCompleteness,
    windowLabel:
      trace?.artifact_status === "curated-window"
        ? "Curated window"
        : "Trace window",
    windowCompleteness,
    validEvidence: verified,
    droppedRows,
    malformedRows,
    summary: verified
      ? "Verified source · complete trace window"
      : issues.join(" · ") || "Evidence status is not declared",
  });
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
  const coverage = dispatchCoverage(dataset, launch);
  const architecture = normalizeArchitecture(trace?.architecture, {
    required: false,
  });

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
    architecture,
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
    dispatchCoverage: coverage,
    evidence: Object.freeze({
      timing: measuredPlacement
        ? "measured command-buffer timing"
        : "ordinal fallback",
      dispatch: launch?.observatoryUnassignedFallback
        ? "unassigned ordinal fallback"
        : "measured order",
      memory:
        parameterBillions === null
          ? "architecture metadata unavailable"
          : "manifest-derived estimate",
      binding: "derived binding activity",
      storage: "unavailable in schema v1",
    }),
    evidenceHealth: evidenceHealth(trace, dataset?.health, coverage),
    health: dataset?.health ?? null,
  });
}
