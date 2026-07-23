const EXPORT_SCHEMA = "metal-dispatch-visible-timeline/v1";

const SOURCE_FIELDS = Object.freeze([
  ["id", "trace_id"],
  ["label", "label"],
  ["title", "title"],
  ["name", "name"],
  ["model", "model"],
  ["checkpoint", "checkpoint"],
  ["quantization", "quantization"],
  ["mode", "mode"],
  ["capture", "capture"],
  ["capture_date", "capture_date"],
  ["artifact_status", "artifact_status"],
  ["relativePath", "relative_path"],
  ["source_sha256", "source_sha256"],
  ["source_complete", "source_complete"],
  ["valid_evidence", "valid_evidence"],
  ["source_evidence_status", "source_evidence_status"],
]);

const MEASUREMENTS = Object.freeze([
  ["wall_span", "wallSpanNs", "ns", "measured-endpoints"],
  ["exposed_host", "exposedHostNs", "ns", "derived-intervals"],
  ["hidden_host", "hiddenHostNs", "ns", "derived-intervals"],
  ["gpu_busy", "gpuBusyNs", "ns", "derived-interval-union"],
  ["gpu_work", "gpuWorkNs", "ns", "measured-intervals"],
  ["decision_drain", "decisionWaitNs", "ns", "measured-waits"],
  ["cap_wait", "capWaitNs", "ns", "measured-waits"],
  ["dependency_wait", "dependencyWaitNs", "ns", "measured-waits"],
  ["command_buffers", "cbsTotal", "count", "counted-records"],
  ["dispatches", "opsTotal", "count", "counted-records"],
]);

const SCHEMA_LIMITATIONS = Object.freeze([
  "Headline measurements describe the selected launch, not only the visible viewport.",
  "Command-buffer host and GPU intervals can overlap; durations are not additive unless explicitly described as a union.",
  "Wait categories can overlap or mirror scheduler state; wait durations are non-additive.",
  "Dispatch positions are ordered placements within command buffers, not measured execution timestamps.",
  "Legacy wait anchors derived from command-buffer bounds are not measured wait timestamps.",
  "Unplaced dispatches are disclosed but cannot be assigned to the visible viewport.",
  "Unanchored waits are disclosed but cannot be assigned to the visible viewport.",
  "Schema v1 does not identify tensor dependencies.",
  "Schema v1 does not infer a critical path.",
]);

function record(value) {
  return value !== null && typeof value === "object" ? value : {};
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function optionalNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function copyJson(value, fallback = null) {
  if (value === undefined) return fallback;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function sourceMetadata(trace) {
  const source = {};
  for (const [inputName, outputName] of SOURCE_FIELDS) {
    const value = trace[inputName];
    if (
      typeof value === "string" ||
      typeof value === "boolean" ||
      Number.isFinite(value)
    ) {
      source[outputName] = value;
    }
  }
  return source;
}

function launchBounds(launch) {
  const summary = record(launch.summary);
  const start = finiteOrNull(launch.startNs) ?? finiteOrNull(summary.startNs);
  const end = finiteOrNull(launch.endNs) ?? finiteOrNull(summary.endNs);
  return { start, end };
}

function viewportBounds(snapshot) {
  const viewport = record(snapshot.viewport);
  const start = finiteOrNull(viewport.startNs) ?? 0;
  const end = finiteOrNull(viewport.endNs) ?? start;
  return {
    start,
    end,
    duration: Math.max(0, end - start),
  };
}

function interval(startNs, endNs) {
  return Number.isFinite(startNs) &&
    Number.isFinite(endNs) &&
    endNs >= startNs
    ? { start: startNs, end: endNs }
    : null;
}

function clipInterval(source, viewport) {
  if (
    source === null ||
    source.end < viewport.start ||
    source.start > viewport.end
  ) {
    return null;
  }
  return {
    start: Math.max(source.start, viewport.start),
    end: Math.min(source.end, viewport.end),
  };
}

function commandBufferExport(commandBuffer, viewport) {
  const host = interval(
    commandBuffer?.encodeStartNs,
    commandBuffer?.encodeEndNs,
  );
  const gpu = interval(
    commandBuffer?.gpuStartNs,
    commandBuffer?.gpuEndNs,
  );
  return {
    command_buffer_index: finiteOrNull(commandBuffer?.commandBufferIndex),
    operation_count: finiteOrNull(commandBuffer?.opCount),
    host_encode_ns: host,
    visible_host_encode_ns: clipInterval(host, viewport),
    gpu_execute_ns: gpu,
    visible_gpu_ns: clipInterval(gpu, viewport),
    endpoint_provenance: "measured",
  };
}

function kernelFamilies(dispatches) {
  const counts = new Map();
  for (const dispatch of dispatches) {
    const kernel =
      typeof dispatch?.kernel === "string" && dispatch.kernel.length > 0
        ? dispatch.kernel
        : "(unknown)";
    counts.set(kernel, (counts.get(kernel) ?? 0) + 1);
  }
  return [...counts]
    .sort(([leftKernel, leftCount], [rightKernel, rightCount]) =>
      rightCount - leftCount || leftKernel.localeCompare(rightKernel))
    .map(([kernel, count]) => ({ kernel, count }));
}

function waitExport(wait) {
  const commandBufferIndex = finiteOrNull(wait?.commandBufferIndex);
  const placement = typeof wait?.placement === "string" ? wait.placement : null;
  const source = typeof wait?.atNsSource === "string" ? wait.atNsSource : null;
  return {
    duration_ns: finiteOrNull(wait?.waitNs),
    bucket:
      typeof wait?.bucket === "string" && wait.bucket.length > 0
        ? wait.bucket
        : "(unclassified)",
    class:
      typeof wait?.waitClass === "string" && wait.waitClass.length > 0
        ? wait.waitClass
        : "other",
    ownership:
      commandBufferIndex === null
        ? null
        : { command_buffer_index: commandBufferIndex },
    anchor_ns: finiteOrNull(wait?.atNs),
    anchor_provenance:
      source ??
      (placement === "legacy-command-buffer-fallback"
        ? "legacy-command-buffer-fallback"
        : placement ?? "event-timestamp"),
  };
}

function measurements(launch) {
  const summary = record(launch.summary);
  return MEASUREMENTS.map(([name, field, unit, evidence]) => ({
    name,
    value: finiteOrNull(summary[field]),
    unit,
    scope: "selected-launch",
    evidence,
  }));
}

function collectionCoverage(renderSampling, key, displayedViewportRecords) {
  const sampling = record(renderSampling);
  const source = record(sampling[key]);
  const sourceDisplayed = optionalNonNegativeInteger(source.displayed);
  const sourceTotal = optionalNonNegativeInteger(source.total);
  const sampled =
    sampling.active === true &&
    !(
      sourceDisplayed !== null &&
      sourceTotal !== null &&
      sourceDisplayed === sourceTotal
    );
  return {
    records: sampled
      ? "displayed-sample-records"
      : "all-visible-records",
    displayed_viewport_records: displayedViewportRecords,
    exact_viewport_total: sampled ? null : displayedViewportRecords,
    source_displayed: sourceDisplayed,
    source_total: sourceTotal,
  };
}

function limitationsFor(
  launch,
  snapshot,
  evidenceHealth,
  coverage,
) {
  const limitations = [...SCHEMA_LIMITATIONS];
  const sampledCollections = Object.entries(coverage)
    .filter(([, entry]) => entry.records === "displayed-sample-records")
    .map(([name]) => name.replaceAll("_", " "));
  if (sampledCollections.length > 0) {
    limitations.push(
      `Visible ${sampledCollections.join(", ")} collection records and aggregates ` +
        "use displayed sample records; exact viewport totals for those collections are unknown. " +
        "Selected-launch aggregates remain exact.",
    );
  }
  if (evidenceHealth.validEvidence !== true) {
    limitations.push(
      "Source evidence is incomplete, unsupported, malformed, or not fully validated; conclusions require reduced confidence.",
    );
  }
  if (nonNegativeInteger(snapshot.unplacedDispatchCount) === 0) {
    limitations.splice(
      limitations.indexOf(
        "Unplaced dispatches are disclosed but cannot be assigned to the visible viewport.",
      ),
      1,
    );
  }
  if (nonNegativeInteger(snapshot.unanchoredWaitCount) === 0) {
    limitations.splice(
      limitations.indexOf(
        "Unanchored waits are disclosed but cannot be assigned to the visible viewport.",
      ),
      1,
    );
  }
  return limitations;
}

/**
 * Build the deterministic, versioned payload for the current visible timeline.
 * `generatedAt` is supplied by the caller so this function has no clock side
 * effects and remains deterministic for identical inputs.
 */
export function buildVisibleTimelineExport(input = {}) {
  const safeInput = record(input);
  const trace = record(safeInput.trace);
  const launch = record(safeInput.launch);
  const snapshot = record(safeInput.snapshot);
  const evidenceHealth = record(safeInput.evidenceHealth);
  const dispatches = Array.isArray(snapshot.dispatches)
    ? snapshot.dispatches
    : [];
  const viewport = viewportBounds(snapshot);
  const unplacedDispatchCount = nonNegativeInteger(
    snapshot.unplacedDispatchCount,
  );
  const unanchoredWaitCount = nonNegativeInteger(
    snapshot.unanchoredWaitCount,
  );
  const commandBuffers = Array.isArray(snapshot.commandBuffers)
    ? snapshot.commandBuffers
    : [];
  const waits = Array.isArray(snapshot.waits) ? snapshot.waits : [];
  const renderSampling = copyJson(launch.renderSampling, {
    active: false,
  });
  const coverage = {
    command_buffers: collectionCoverage(
      renderSampling,
      "commandBuffers",
      commandBuffers.length,
    ),
    dispatches: collectionCoverage(
      renderSampling,
      "dispatches",
      dispatches.length,
    ),
    waits: collectionCoverage(
      renderSampling,
      "waits",
      waits.length,
    ),
  };
  const dispatchesSampled =
    coverage.dispatches.records === "displayed-sample-records";
  const waitsSampled = coverage.waits.records === "displayed-sample-records";

  const payload = {
    export_schema: EXPORT_SCHEMA,
    generated_at:
      typeof safeInput.generatedAt === "string" ? safeInput.generatedAt : null,
    source: sourceMetadata(trace),
    selection: {
      launch_index: Number.isInteger(safeInput.launchIndex)
        ? safeInput.launchIndex
        : null,
      launch_bounds_ns: launchBounds(launch),
      viewport_ns: viewport,
    },
    evidence_health: {
      ...copyJson(evidenceHealth, {}),
      render_sampling: renderSampling,
      coverage,
      unplaced_dispatch_count: dispatchesSampled
        ? null
        : unplacedDispatchCount,
      displayed_unplaced_dispatch_count: unplacedDispatchCount,
      unanchored_wait_count: waitsSampled ? null : unanchoredWaitCount,
      displayed_unanchored_wait_count: unanchoredWaitCount,
    },
    measurements: measurements(launch),
    command_buffers: commandBuffers.map((commandBuffer) =>
      commandBufferExport(commandBuffer, viewport)),
    dispatch_summary: {
      placed_in_viewport: coverage.dispatches.exact_viewport_total,
      displayed_placed_in_viewport: dispatches.length,
      unplaced_count: dispatchesSampled ? null : unplacedDispatchCount,
      displayed_unplaced_count: unplacedDispatchCount,
      density_mode: snapshot.densityMode === true,
      density_mode_basis: {
        timeline_viewport:
          typeof snapshot.densityModeBasis === "string"
            ? snapshot.densityModeBasis
            : "renderer-full-logical-viewport",
        dispatch_records: coverage.dispatches.records,
      },
      position_provenance: "ordered",
      kernel_family_counts: coverage.dispatches.records,
      kernel_families: kernelFamilies(dispatches),
    },
    waits: waits.map(waitExport),
    limitations: limitationsFor(
      launch,
      snapshot,
      evidenceHealth,
      coverage,
    ),
  };
  return deepFreeze(payload);
}

export function formatAiPrompt(payload) {
  return [
    "Analyze this visible Metal dispatch timeline evidence.",
    "",
    "1. Identify likely host, GPU, synchronization, or dispatch-density bottlenecks.",
    "2. Cite payload fields for every conclusion.",
    "3. Distinguish observation from inference and assign confidence.",
    "4. Recommend prioritized experiments and the measurements that would confirm each result.",
    "5. Do not make tensor dependency or critical-path claims unsupported by schema v1.",
    "",
    "```json",
    JSON.stringify(payload, null, 2),
    "```",
  ].join("\n");
}

export function exportFilename(trace = {}, launchIndex = null, extension = "json") {
  const safeTrace = record(trace);
  const label = [
    safeTrace.label,
    safeTrace.title,
    safeTrace.name,
    safeTrace.id,
  ].find((value) => typeof value === "string" && value.trim().length > 0) ?? "trace";
  const slug = label
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "trace";
  const safeExtension = String(extension).toLowerCase().replace(/[^a-z0-9]/g, "");
  const normalizedExtension = safeExtension === "md" ? "md" : "json";
  const launch = Number.isInteger(launchIndex) && launchIndex >= 0
    ? `-launch-${launchIndex + 1}`
    : "";
  return `${slug}${launch}-visible-timeline.${normalizedExtension}`;
}
