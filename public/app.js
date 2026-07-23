import { formatBytes, formatDuration } from "./data.js";
import {
  SelectionCoordinator,
  TraceCache,
} from "./trace-loader.js";
import { TimelineRenderer } from "./timeline.js";

const NON_ADDITIVE_WAITS = new Set([
  "sched_backpressure",
  "sched_worker_wait",
]);

function finiteOrZero(value) {
  return Number.isFinite(value) ? value : 0;
}

function stringValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function chooseTraceId(traces, requestedId) {
  if (!Array.isArray(traces) || traces.length === 0) {
    return null;
  }
  if (
    typeof requestedId === "string" &&
    traces.some((trace) => trace?.id === requestedId)
  ) {
    return requestedId;
  }
  return typeof traces[0]?.id === "string" ? traces[0].id : null;
}

export function traceLabel(trace) {
  if (!trace || typeof trace !== "object") {
    return "Unnamed trace";
  }
  const explicit = stringValue(trace.label) ?? stringValue(trace.title);
  if (explicit) {
    return explicit;
  }
  const descriptive = [
    stringValue(trace.model),
    stringValue(trace.quantization),
    stringValue(trace.mode),
  ].filter(Boolean);
  if (descriptive.length > 0) {
    return descriptive.join(" · ");
  }
  return (
    stringValue(trace.name) ??
    stringValue(trace.relativePath) ??
    "Unnamed trace"
  );
}

export function chooseWindowIndex(windows, requestedIndex) {
  if (!Array.isArray(windows) || windows.length === 0) {
    return null;
  }
  const parsed =
    typeof requestedIndex === "number"
      ? requestedIndex
      : Number.parseInt(String(requestedIndex ?? ""), 10);
  return Number.isInteger(parsed) && parsed >= 0 && parsed < windows.length
    ? parsed
    : 0;
}

export function selectionUrl(input, traceId, windowIndex) {
  const url = new URL(input, "http://localhost/");
  if (typeof traceId === "string" && traceId) {
    url.searchParams.set("trace", traceId);
  } else {
    url.searchParams.delete("trace");
  }
  if (Number.isInteger(windowIndex) && windowIndex >= 0) {
    url.searchParams.set("window", String(windowIndex));
  } else {
    url.searchParams.delete("window");
  }
  return url;
}

export function metricRows(datasetOrWindow) {
  const summary = datasetOrWindow?.summary ?? {};
  return Object.freeze([
    {
      label: "Wall span",
      value: formatDuration(summary.wallSpanNs),
      evidence: "measured endpoints",
    },
    {
      label: "Exposed host",
      value: formatDuration(summary.exposedHostNs),
      evidence: "interval-derived",
    },
    {
      label: "Hidden host",
      value: formatDuration(summary.hiddenHostNs),
      evidence: "interval-derived",
    },
    {
      label: "GPU busy",
      value: formatDuration(summary.gpuBusyNs),
      evidence: "interval-derived union",
    },
    {
      label: "GPU work",
      value: formatDuration(summary.gpuWorkNs),
      evidence: "measured intervals",
    },
    {
      label: "Decision drain",
      value: formatDuration(summary.decisionWaitNs),
      evidence: "measured waits",
    },
    {
      label: "Cap wait",
      value: formatDuration(summary.capWaitNs),
      evidence: "measured waits",
    },
    {
      label: "Dependency wait",
      value: formatDuration(summary.dependencyWaitNs),
      evidence: "measured waits",
    },
    {
      label: "Command buffers",
      value: String(finiteOrZero(summary.cbsTotal)),
      evidence: "record count",
    },
    {
      label: "Dispatches",
      value: String(finiteOrZero(summary.opsTotal)),
      evidence: "record count",
    },
  ].map(Object.freeze));
}

export function aggregateKernelRows(dispatches) {
  const kernels = new Map();
  for (const dispatch of Array.isArray(dispatches) ? dispatches : []) {
    const kernel = stringValue(dispatch?.kernel) ?? "(unnamed)";
    const row = kernels.get(kernel) ?? {
      kernel,
      count: 0,
      setBytesCalls: 0,
      setBytesTotalBytes: 0,
      bufferBinds: 0,
    };
    row.count += 1;
    row.setBytesCalls += finiteOrZero(dispatch?.setBytesCalls);
    row.setBytesTotalBytes += finiteOrZero(dispatch?.setBytesTotalBytes);
    row.bufferBinds += finiteOrZero(dispatch?.bufferBinds);
    kernels.set(kernel, row);
  }
  return [...kernels.values()]
    .sort(
      (left, right) =>
        right.count - left.count || lexicalCompare(left.kernel, right.kernel),
    )
    .map(Object.freeze);
}

export function aggregateWaitRows(waits) {
  const buckets = new Map();
  for (const wait of Array.isArray(waits) ? waits : []) {
    const bucket = stringValue(wait?.bucket) ?? "(unclassified)";
    const row = buckets.get(bucket) ?? {
      bucket,
      count: 0,
      waitNs: 0,
      waitClass: wait?.waitClass ?? "other",
      additive: !NON_ADDITIVE_WAITS.has(bucket),
    };
    row.count += 1;
    row.waitNs += finiteOrZero(wait?.waitNs);
    buckets.set(bucket, row);
  }
  return [...buckets.values()]
    .sort((left, right) => lexicalCompare(left.bucket, right.bucket))
    .map(Object.freeze);
}

export function kernelRowsForScope(scope) {
  return Array.isArray(scope?.kernelCensus) ? scope.kernelCensus : [];
}

export function waitRowsForScope(scope) {
  const taxonomy = scope?.waitTaxonomy;
  if (!taxonomy || typeof taxonomy !== "object") return [];
  return Object.values(taxonomy)
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) =>
      Object.freeze({
        bucket: stringValue(entry.bucket) ?? "(unclassified)",
        count: finiteOrZero(entry.count),
        waitNs: finiteOrZero(entry.waitNs),
        waitClass: stringValue(entry.waitClass) ?? "other",
        additive: entry.headlineIncluded !== false,
      }),
    )
    .sort((left, right) => lexicalCompare(left.bucket, right.bucket));
}

export function samplingDisclosure(scope) {
  const sampling = scope?.renderSampling;
  if (sampling?.active !== true) return null;
  const dispatches = sampling.dispatches ?? {};
  const commandBuffers = sampling.commandBuffers ?? {};
  const waits = sampling.waits ?? {};
  return (
    `Canvas sample: ${finiteOrZero(dispatches.displayed)} of ` +
    `${finiteOrZero(dispatches.total)} dispatches, ` +
    `${finiteOrZero(commandBuffers.displayed)} of ` +
    `${finiteOrZero(commandBuffers.total)} command buffers, and ` +
    `${finiteOrZero(waits.displayed)} of ${finiteOrZero(waits.total)} waits. ` +
    "Headline metrics and tables use the exact full window."
  );
}

function sourceEvidenceLabel(trace) {
  if (trace?.valid_evidence !== false) return null;
  return trace?.source_evidence_status === "legacy-unverifiable"
    ? "Legacy / unverifiable"
    : "Not validated";
}

export function evidenceBadges(dataset, trace) {
  const health = dataset?.health ?? {};
  const completeness =
    health.sourceCompleteness ?? dataset?.sourceCompleteness ?? "missing-summary";
  const badges = [];
  const add = (label) => badges.push({ label, valid: false });
  const sourceLabel = sourceEvidenceLabel(trace);
  if (sourceLabel !== null) add(`Source: ${sourceLabel}`);

  if (completeness === "missing-summary") add("No summary");
  if (completeness === "legacy-unverifiable") add("Legacy / unverifiable");
  if (completeness === "unsupported-schema") add("Unsupported schema");
  if (completeness === "incomplete") add("Incomplete capture");
  if (completeness === "dropped-rows") {
    add(`Dropped rows: ${finiteOrZero(health.droppedRows)}`);
  }
  if (finiteOrZero(health.malformedRows) > 0) {
    add(`Malformed rows: ${health.malformedRows}`);
  }
  if (finiteOrZero(health.unknownRows) > 0) {
    add(`Unsupported rows: ${health.unknownRows}`);
  }
  if (Object.keys(health.countMismatches ?? {}).length > 0) {
    add("Summary count mismatch");
  }
  if ((health.duplicateCommandBufferIndices ?? []).length > 0) {
    add("Duplicate CB IDs quarantined");
  }
  if (badges.length === 0 && health.validEvidence === true) {
    badges.push({ label: "Complete evidence", valid: true });
  }
  if (badges.length === 0) {
    add("Evidence not validated");
  }
  return badges.map(Object.freeze);
}

export function publishIfCurrent(coordinator, token, publish) {
  if (!coordinator?.isCurrent?.(token)) {
    return false;
  }
  publish();
  return true;
}

export function traceCacheKey(trace) {
  if (!trace || typeof trace !== "object" || typeof trace.id !== "string") {
    return "";
  }
  return JSON.stringify([
    trace.id,
    Number.isFinite(trace.size) ? trace.size : null,
    stringValue(trace.modifiedTime),
  ]);
}

export class RegistrySelectionGuard {
  #generation = 0;
  #revision = 0;
  #selectedId;

  constructor(selectedId = null) {
    this.#selectedId = typeof selectedId === "string" ? selectedId : null;
  }

  get selectedId() {
    return this.#selectedId;
  }

  select(id) {
    this.#selectedId = typeof id === "string" ? id : null;
    this.#revision += 1;
    return this.#selectedId;
  }

  adopt(id) {
    this.#selectedId = typeof id === "string" ? id : null;
    return this.#selectedId;
  }

  beginRefresh(previousTraces = []) {
    return Object.freeze({
      generation: (this.#generation += 1),
      revision: this.#revision,
      selectedId: this.#selectedId,
      previousTraces: Array.isArray(previousTraces)
        ? Object.freeze([...previousTraces])
        : Object.freeze([]),
    });
  }

  isCurrentRefresh(token) {
    return token?.generation === this.#generation;
  }

  commitRefresh(token, nextTraces) {
    if (token?.generation !== this.#generation) {
      return { current: false, selectionChanged: false, selectedId: this.#selectedId };
    }
    const selectionChanged = token.revision !== this.#revision;
    const basisId = selectionChanged ? this.#selectedId : token.selectedId;
    this.#selectedId = chooseRefreshTraceId(
      token.previousTraces,
      nextTraces,
      basisId,
    );
    return {
      current: true,
      selectionChanged,
      selectedId: this.#selectedId,
    };
  }
}

function abortError() {
  if (typeof DOMException === "function") {
    return new DOMException("The operation was aborted", "AbortError");
  }
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

export function buildDatasetOffMainThread(
  rows,
  diagnostics,
  {
    WorkerClass = globalThis.Worker,
    workerUrl = new URL("./dataset-worker.js", import.meta.url),
    signal,
    onStateChange,
  } = {},
) {
  if (typeof WorkerClass !== "function") {
    const error = new Error(
      "Dataset analysis requires browser Web Worker support.",
    );
    error.name = "DatasetWorkerUnavailableError";
    return Promise.reject(error);
  }
  if (signal?.aborted) {
    return Promise.reject(abortError());
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let worker;
    const finish = (callback, value, stateName) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener?.("abort", onAbort);
      worker?.removeEventListener?.("message", onMessage);
      worker?.removeEventListener?.("error", onError);
      worker?.terminate?.();
      if (stateName) onStateChange?.(stateName);
      callback(value);
    };
    const onAbort = () => finish(reject, abortError(), "aborted");
    const onMessage = (event) => {
      if (event?.data?.ok === true) {
        finish(resolve, event.data.dataset, "completed");
        return;
      }
      const error = new Error(
        event?.data?.error?.message ?? "Dataset worker failed.",
      );
      error.name = event?.data?.error?.name ?? "DatasetWorkerError";
      finish(reject, error, "failed");
    };
    const onError = (event) => {
      const error =
        event?.error instanceof Error
          ? event.error
          : new Error(event?.message ?? "Dataset worker failed.");
      finish(reject, error, "failed");
    };

    try {
      worker = new WorkerClass(workerUrl, {
        type: "module",
        name: "metal-dispatch-dataset",
      });
      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);
      signal?.addEventListener?.("abort", onAbort, { once: true });
      worker.postMessage({
        rows: Array.isArray(rows) ? rows : [],
        diagnostics:
          diagnostics && typeof diagnostics === "object" ? diagnostics : {},
      });
      onStateChange?.("posted");
    } catch (error) {
      finish(reject, error, "failed");
    }
  });
}

export function analyzeTraceOffMainThread(
  traceUrl,
  {
    WorkerClass = globalThis.Worker,
    workerUrl = new URL("./dataset-worker.js", import.meta.url),
    signal,
    onProgress,
    onStateChange,
  } = {},
) {
  if (typeof WorkerClass !== "function") {
    const error = new Error(
      "Trace loading requires browser Web Worker support.",
    );
    error.name = "DatasetWorkerUnavailableError";
    return Promise.reject(error);
  }
  if (typeof traceUrl !== "string" || traceUrl.length === 0) {
    return Promise.reject(new TypeError("traceUrl must be a non-empty string"));
  }
  if (signal?.aborted) {
    return Promise.reject(abortError());
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let worker;
    const finish = (callback, value, stateName) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener?.("abort", onAbort);
      worker?.removeEventListener?.("message", onMessage);
      worker?.removeEventListener?.("error", onError);
      worker?.terminate?.();
      if (stateName) onStateChange?.(stateName);
      callback(value);
    };
    const onAbort = () => finish(reject, abortError(), "aborted");
    const onMessage = (event) => {
      if (event?.data?.type === "progress") {
        onProgress?.(event.data.progress);
        return;
      }
      if (event?.data?.type === "state") {
        onStateChange?.(event.data.state);
        return;
      }
      if (
        event?.data?.type === "complete" &&
        event.data.ok === true
      ) {
        finish(
          resolve,
          {
            dataset: event.data.dataset,
            diagnostics:
              event.data.diagnostics ??
              event.data.dataset?.diagnostics ??
              {},
          },
          "completed",
        );
        return;
      }
      if (event?.data?.ok === false) {
        const error = new Error(
          event?.data?.error?.message ?? "Trace analysis failed.",
        );
        error.name =
          event?.data?.error?.name ?? "DatasetWorkerError";
        if (Number.isInteger(event?.data?.error?.status)) {
          error.status = event.data.error.status;
        }
        if (typeof event?.data?.error?.code === "string") {
          error.code = event.data.error.code;
        }
        finish(reject, error, "failed");
      }
    };
    const onError = (event) => {
      const error =
        event?.error instanceof Error
          ? event.error
          : new Error(event?.message ?? "Trace worker failed.");
      finish(reject, error, "failed");
    };

    try {
      worker = new WorkerClass(workerUrl, {
        type: "module",
        name: "metal-dispatch-trace",
      });
      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);
      signal?.addEventListener?.("abort", onAbort, { once: true });
      worker.postMessage({ type: "load", url: traceUrl });
      onStateChange?.("posted");
    } catch (error) {
      finish(reject, error, "failed");
    }
  });
}

export function progressState(
  progress,
  { fallbackTotalBytes, previousMax } = {},
) {
  const sourceBytes = Math.max(0, finiteOrZero(progress?.sourceBytes));
  const responseTotal =
    Number.isFinite(progress?.totalBytes) && progress.totalBytes > 0
      ? progress.totalBytes
      : null;
  const fallback =
    Number.isFinite(fallbackTotalBytes) && fallbackTotalBytes > 0
      ? fallbackTotalBytes
      : null;
  const estimateBytes = responseTotal ?? fallback;
  const done = progress?.done === true;
  const overflow =
    estimateBytes !== null && sourceBytes > estimateBytes;
  let max;
  if (done) {
    max = Math.max(1, sourceBytes);
  } else if (overflow) {
    max = Math.max(
      Number.isFinite(previousMax) ? previousMax : 0,
      estimateBytes * 2,
      sourceBytes * 2,
    );
    if (sourceBytes / max > 0.9) {
      max = Math.max(max * 2, sourceBytes * 2);
    }
  } else if (estimateBytes !== null) {
    max = estimateBytes;
  } else {
    max = Math.max(
      1,
      Number.isFinite(previousMax) ? previousMax : 0,
      sourceBytes * 2,
    );
    if (sourceBytes / max > 0.9) max *= 2;
  }
  const parsedRows = Math.max(0, finiteOrZero(progress?.parsedRows));
  const malformedRows = Math.max(0, finiteOrZero(progress?.malformedRows));
  const estimateNote = overflow
    ? ` · registry estimate exceeded (${formatBytes(estimateBytes)}); final size unknown`
    : estimateBytes !== null
      ? ` of ${formatBytes(estimateBytes)}`
      : " · total size unknown";
  return Object.freeze({
    value: Math.min(sourceBytes, max),
    max,
    sourceBytes,
    estimateBytes,
    overflow,
    done,
    readout:
      `${formatBytes(sourceBytes)} read${estimateNote} · ` +
      `${parsedRows} rows parsed · ${malformedRows} malformed`,
  });
}

function appendTextElement(documentObject, parent, tagName, text, className) {
  const element = documentObject.createElement(tagName);
  if (className) {
    element.className = className;
  }
  element.textContent = String(text);
  parent.append(element);
  return element;
}

function setHidden(element, hidden) {
  element.hidden = Boolean(hidden);
}

export function chooseRefreshTraceId(previousTraces, nextTraces, selectedId) {
  if (!Array.isArray(nextTraces) || nextTraces.length === 0) {
    return null;
  }
  if (nextTraces.some((trace) => trace?.id === selectedId)) {
    return selectedId;
  }
  const previousIndex = Array.isArray(previousTraces)
    ? previousTraces.findIndex((trace) => trace?.id === selectedId)
    : -1;
  const nextIndex =
    previousIndex < 0 ? 0 : Math.min(previousIndex, nextTraces.length - 1);
  return nextTraces[nextIndex]?.id ?? null;
}

export function traceRailState(trace, dataset) {
  const model = stringValue(trace?.model) ?? "Unknown";
  const mode = stringValue(trace?.mode) ?? "Unknown";
  const sourceLabel = sourceEvidenceLabel(trace);
  if (sourceLabel !== null) {
    return {
      model,
      mode,
      evidence:
        sourceLabel === "Legacy / unverifiable"
          ? "Legacy source"
          : "Source degraded",
      evidenceValid: false,
    };
  }
  if (!dataset) {
    return {
      model,
      mode,
      evidence: "Pending",
      evidenceValid: null,
    };
  }
  if (dataset.health?.validEvidence === true) {
    return {
      model,
      mode,
      evidence: "Complete",
      evidenceValid: true,
    };
  }
  const completeness =
    dataset.health?.sourceCompleteness ??
    dataset.sourceCompleteness ??
    "missing-summary";
  const evidence =
    {
      "missing-summary": "No summary",
      "legacy-unverifiable": "Legacy",
      "unsupported-schema": "Unsupported",
      incomplete: "Incomplete",
      "dropped-rows": "Dropped rows",
    }[completeness] ?? "Degraded";
  return { model, mode, evidence, evidenceValid: false };
}

export function renderTraceRail({
  documentObject,
  track,
  traces,
  selectedId,
  evidenceByCacheKey,
  onSelect,
}) {
  const previousButtons = track.querySelectorAll?.(".trace-toggle") ?? [];
  const activeElement = documentObject.activeElement;
  const focusedId = [...previousButtons].includes(activeElement)
    ? activeElement.getAttribute?.("data-trace-id")
    : null;
  track.replaceChildren();
  const safeTraces = Array.isArray(traces) ? traces : [];
  if (safeTraces.length === 0) {
    appendTextElement(
      documentObject,
      track,
      "p",
      "No .jsonl or .ndjson traces in this directory.",
      "trace-rail-empty",
    );
    return [];
  }

  const buttons = [];
  for (const trace of safeTraces) {
    const cacheKey = traceCacheKey(trace);
    const dataset = evidenceByCacheKey?.get?.(cacheKey) ?? null;
    const railState = traceRailState(trace, dataset);
    const button = documentObject.createElement("button");
    button.type = "button";
    button.className = "trace-toggle";
    button.setAttribute("aria-pressed", String(trace.id === selectedId));
    button.setAttribute("data-trace-id", trace.id);
    button.setAttribute(
      "aria-label",
      `${traceLabel(trace)}. Model ${railState.model}. Mode ${railState.mode}. ` +
        `Evidence ${railState.evidence}.`,
    );
    appendTextElement(
      documentObject,
      button,
      "span",
      traceLabel(trace),
      "trace-name",
    );
    appendTextElement(
      documentObject,
      button,
      "span",
      `Model: ${railState.model}`,
      "trace-model",
    );
    appendTextElement(
      documentObject,
      button,
      "span",
      `Mode: ${railState.mode}`,
      "trace-mode",
    );
    const evidenceClass =
      railState.evidenceValid === true
        ? "trace-evidence-valid"
        : railState.evidenceValid === false
          ? "trace-evidence-invalid"
          : "trace-evidence-pending";
    appendTextElement(
      documentObject,
      button,
      "span",
      `Evidence: ${railState.evidence}`,
      `trace-badge ${evidenceClass}`,
    );
    button.addEventListener("click", () => onSelect?.(trace.id));
    track.append(button);
    buttons.push(button);
  }
  const focusTarget = buttons.find(
    (button) => button.getAttribute("data-trace-id") === focusedId,
  );
  focusTarget?.focus?.({ preventScroll: true });
  return buttons;
}

export function handleTraceRailKey({ documentObject, track, event }) {
  if (
    !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event?.key)
  ) {
    return false;
  }
  const buttons = [...(track.querySelectorAll?.(".trace-toggle") ?? [])];
  if (buttons.length === 0) return false;
  const activeIndex = buttons.indexOf(documentObject.activeElement);
  const direction =
    event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
  const nextIndex =
    activeIndex < 0
      ? 0
      : (activeIndex + direction + buttons.length) % buttons.length;
  event.preventDefault?.();
  buttons[nextIndex].focus?.({ preventScroll: true });
  buttons[nextIndex].click?.();
  return true;
}

function sourceMetadata(trace) {
  const fields = [
    ["File", trace?.relativePath ?? trace?.name],
    ["Name", trace?.name],
    ["Model", trace?.model],
    ["Checkpoint", trace?.checkpoint],
    ["Quantization", trace?.quantization],
    ["Mode", trace?.mode],
    [
      "Capture",
      trace?.capture ??
        trace?.capture_label ??
        trace?.capture_mode ??
        trace?.captureWindow,
    ],
    [
      "Evidence",
      trace?.curation ??
        trace?.trace_kind ??
        trace?.raw_vs_curated ??
        trace?.raw_or_curated ??
        trace?.evidence,
    ],
    [
      "Source hash",
      trace?.source_hash ??
        trace?.sourceHash ??
        trace?.source_sha256 ??
        trace?.sha256,
    ],
  ];
  const seen = new Set();
  return fields.filter(([label, value]) => {
    const normalized = stringValue(value);
    if (!normalized) return false;
    const key = `${label}\u0000${normalized}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function errorDescription(error) {
  if (error?.status === 404) {
    return "The selected trace disappeared while it was being opened.";
  }
  if (error?.name === "NdjsonLineTooLongError") {
    return "A trace row exceeded the safe parser limit.";
  }
  if (error instanceof TypeError) {
    return "The registry or trace response could not be read.";
  }
  return error instanceof Error ? error.message : "The trace could not be read.";
}

export async function bootstrap({
  fetchImpl = globalThis.fetch,
  traceAnalyzer = analyzeTraceOffMainThread,
} = {}) {
  const documentObject = globalThis.document;
  const windowObject = documentObject?.defaultView ?? globalThis.window;
  if (!documentObject || !windowObject) {
    throw new Error("bootstrap requires a browser document");
  }
  if (typeof fetchImpl !== "function") {
    throw new TypeError("bootstrap requires fetch");
  }
  if (typeof traceAnalyzer !== "function") {
    throw new TypeError("bootstrap requires a trace analyzer");
  }

  const byId = (id) => {
    const element = documentObject.getElementById(id);
    if (!element) throw new Error(`Missing required UI hook #${id}`);
    return element;
  };
  const elements = {
    directory: byId("directory-identity"),
    refresh: byId("refresh-button"),
    theme: byId("theme-toggle"),
    rail: byId("trace-rail"),
    track: byId("trace-track"),
    provenance: byId("provenance-strip"),
    health: byId("health-strip"),
    status: byId("trace-status"),
    windowControl: byId("window-control"),
    windowSelect: byId("window-select"),
    metrics: byId("metric-grid"),
    canvas: byId("timeline"),
    plotFrame: byId("plot-frame"),
    timelinePlaceholder: byId("timeline-placeholder"),
    samplingNote: byId("timeline-sampling-note"),
    loading: byId("loading-state"),
    loadingFilename: byId("loading-filename"),
    progress: byId("loading-progress"),
    progressReadout: byId("loading-readout"),
    empty: byId("empty-state"),
    error: byId("error-state"),
    inspectorBody: byId("inspector-body"),
    clearSelection: byId("clear-selection"),
    kernelBody: byId("kernel-table-body"),
    kernelState: byId("kernel-table-state"),
    waitBody: byId("wait-table-body"),
    waitState: byId("wait-table-state"),
    scale: byId("timeline-scale"),
    zoomOut: byId("zoom-out"),
    fit: byId("fit-timeline"),
    zoomIn: byId("zoom-in"),
  };

  const cache = new TraceCache();
  const coordinator = new SelectionCoordinator();
  const registrySelection = new RegistrySelectionGuard();
  const initialUrl = new URL(windowObject.location.href);
  const state = {
    traces: [],
    evidenceByCacheKey: new Map(),
    currentTraceId: null,
    currentTrace: null,
    currentDataset: null,
    currentWindowIndex: null,
    activeScope: null,
    currentToken: null,
    destroyed: false,
  };

  function announce(message) {
    elements.status.textContent = message;
  }

  function applyTheme(theme) {
    const normalized = theme === "light" ? "light" : "dark";
    documentObject.documentElement.setAttribute("data-theme", normalized);
    const isLight = normalized === "light";
    elements.theme.setAttribute("aria-pressed", String(isLight));
    elements.theme.setAttribute(
      "aria-label",
      `Switch to ${isLight ? "dark" : "light"} theme`,
    );
    elements.theme.textContent = isLight ? "Theme: Light" : "Theme: Dark";
  }

  let storedTheme = null;
  try {
    storedTheme = windowObject.localStorage?.getItem("metal-dispatch-theme");
  } catch {
    storedTheme = null;
  }
  applyTheme(
    storedTheme === "light" || storedTheme === "dark"
      ? storedTheme
      : windowObject.matchMedia?.("(prefers-color-scheme: light)")?.matches
        ? "light"
        : "dark",
  );

  function updateScale(viewport) {
    const width =
      elements.canvas.getBoundingClientRect?.().width ??
      elements.canvas.clientWidth ??
      1;
    const nanosecondsPerPixel =
      (finiteOrZero(viewport?.endNs) - finiteOrZero(viewport?.startNs)) /
      Math.max(1, width);
    elements.scale.textContent = `View · ${formatDuration(nanosecondsPerPixel)}/px`;
  }

  const renderer = new TimelineRenderer(elements.canvas, {
    onInspect(payload) {
      renderInspector(payload);
    },
    onViewportChange(viewport) {
      updateScale(viewport);
    },
  });

  function refreshRendererPalette() {
    const style = windowObject.getComputedStyle(elements.canvas);
    const read = (name, fallback) =>
      style.getPropertyValue(name).trim() || fallback;
    renderer.colors = {
      canvas: read("--canvas", "#071116"),
      rule: read("--rule", "#213942"),
      text: read("--text", "#edf7f8"),
      secondary: read("--secondary", "#91aab2"),
      gpu: read("--gpu", "#48d7ff"),
      hiddenHost: read("--hidden-host", "#48d7ff"),
      exposedHost: read("--exposed-host", "#ff756d"),
      decisionCap: read("--decision-cap", "#ffc857"),
      dependency: read("--dependency", "#b49cff"),
      selection: read("--selection", "#f5fbff"),
    };
    renderer.paletteSignature = Object.values(renderer.colors).join("\u0000");
  }

  function updateUrl(traceId, windowIndex) {
    const url = selectionUrl(
      windowObject.location.href,
      traceId,
      windowIndex,
    );
    windowObject.history.replaceState(
      null,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }

  function renderRegistry() {
    elements.rail.setAttribute("aria-busy", "false");
    renderTraceRail({
      documentObject,
      track: elements.track,
      traces: state.traces,
      selectedId: state.currentTraceId,
      evidenceByCacheKey: state.evidenceByCacheKey,
      onSelect(id) {
        void selectTrace(id, {
          requestedWindow: 0,
          recordSelection: true,
        });
      },
    });
  }

  function renderProgress(progress, fallbackTotalBytes) {
    const display = progressState(progress, {
      fallbackTotalBytes,
      previousMax: elements.progress.max,
    });
    elements.progress.max = display.max;
    elements.progress.value = display.value;
    elements.progress.textContent =
      `${Math.round((display.value / display.max) * 100)}%`;
    elements.progressReadout.textContent = display.readout;
  }

  function showLoading(trace) {
    setHidden(elements.loading, false);
    setHidden(elements.empty, true);
    setHidden(elements.error, true);
    elements.loadingFilename.textContent =
      trace?.relativePath ?? trace?.name ?? "selected trace";
    renderProgress(
      { sourceBytes: 0, totalBytes: null, parsedRows: 0 },
      trace?.size,
    );
    announce(`Loading ${traceLabel(trace)}…`);
  }

  function showError(title, message) {
    setHidden(elements.loading, true);
    setHidden(elements.empty, true);
    setHidden(elements.error, false);
    const heading = elements.error.querySelector("h3");
    const paragraph = elements.error.querySelector("p");
    if (heading) heading.textContent = title;
    if (paragraph) paragraph.textContent = message;
    announce(`${title}: ${message}`);
  }

  function showEmpty() {
    setHidden(elements.loading, true);
    setHidden(elements.error, true);
    setHidden(elements.empty, false);
    renderEmptyProvenance();
    announce("No trace files found in the configured directory.");
  }

  function appendProvenanceItem(label, value) {
    const item = documentObject.createElement("span");
    item.className = "provenance-item";
    const key = documentObject.createElement("b");
    key.textContent = label;
    item.append(key, documentObject.createTextNode(String(value)));
    elements.provenance.append(item);
  }

  function renderProvenance(trace, dataset, diagnostics) {
    elements.provenance.replaceChildren();
    appendTextElement(
      documentObject,
      elements.provenance,
      "span",
      "Provenance",
      "strip-label",
    );
    for (const [label, value] of sourceMetadata(trace)) {
      appendProvenanceItem(label, value);
    }
    appendProvenanceItem("File size", formatBytes(trace?.size));
    appendProvenanceItem(
      "Rows",
      `${finiteOrZero(diagnostics?.parsedRows)} valid · ` +
        `${finiteOrZero(dataset?.health?.malformedRows)} malformed`,
    );
    const badgeGroup = documentObject.createElement("span");
    badgeGroup.id = "evidence-badges";
    badgeGroup.className = "evidence-badges";
    evidenceBadges(dataset, trace).forEach((badge, index) => {
      const item = appendTextElement(
        documentObject,
        badgeGroup,
        "span",
        badge.label,
        badge.valid
          ? "evidence-badge evidence-badge-valid"
          : "evidence-badge evidence-badge-invalid",
      );
      if (index === 0) item.id = "evidence-badge";
    });
    elements.provenance.append(badgeGroup);
  }

  function renderPendingProvenance(trace) {
    elements.provenance.replaceChildren();
    appendTextElement(
      documentObject,
      elements.provenance,
      "span",
      "Provenance",
      "strip-label",
    );
    for (const [label, value] of sourceMetadata(trace)) {
      appendProvenanceItem(label, value);
    }
    appendProvenanceItem("File size", formatBytes(trace?.size));
    const badgeGroup = documentObject.createElement("span");
    badgeGroup.id = "evidence-badges";
    badgeGroup.className = "evidence-badges";
    const badge = appendTextElement(
      documentObject,
      badgeGroup,
      "span",
      "Loading evidence",
      "evidence-badge evidence-badge-pending",
    );
    badge.id = "evidence-badge";
    elements.provenance.append(badgeGroup);
  }

  function renderEmptyProvenance() {
    elements.provenance.replaceChildren();
    appendTextElement(
      documentObject,
      elements.provenance,
      "span",
      "Provenance",
      "strip-label",
    );
    appendProvenanceItem("File", "No file selected");
    const badgeGroup = documentObject.createElement("span");
    badgeGroup.id = "evidence-badges";
    badgeGroup.className = "evidence-badges";
    const badge = appendTextElement(
      documentObject,
      badgeGroup,
      "span",
      "Empty registry",
      "evidence-badge evidence-badge-pending",
    );
    badge.id = "evidence-badge";
    elements.provenance.append(badgeGroup);
  }

  function renderMetrics(scope, pending = false) {
    elements.metrics.replaceChildren();
    for (const metricRow of metricRows(scope)) {
      const metric = documentObject.createElement("div");
      metric.className = "metric";
      const term = appendTextElement(
        documentObject,
        metric,
        "dt",
        metricRow.label,
      );
      appendTextElement(
        documentObject,
        term,
        "span",
        metricRow.evidence,
        "metric-evidence",
      );
      appendTextElement(
        documentObject,
        metric,
        "dd",
        pending ? "—" : metricRow.value,
      );
      elements.metrics.append(metric);
    }
    elements.metrics.setAttribute("aria-busy", String(pending));
  }

  function appendTableCell(row, tagName, value) {
    const cell = documentObject.createElement(tagName);
    if (tagName === "th") cell.setAttribute("scope", "row");
    cell.textContent = String(value);
    row.append(cell);
  }

  function renderKernelTable(scope) {
    elements.kernelBody.replaceChildren();
    const rows = kernelRowsForScope(scope);
    elements.kernelState.textContent = `${rows.length} kernels`;
    if (rows.length === 0) {
      const row = documentObject.createElement("tr");
      row.className = "placeholder-row";
      appendTableCell(row, "th", "No dispatch kernels in this launch");
      for (let index = 0; index < 4; index += 1) {
        appendTableCell(row, "td", "—");
      }
      elements.kernelBody.append(row);
      return;
    }
    for (const item of rows) {
      const row = documentObject.createElement("tr");
      appendTableCell(row, "th", item.kernel);
      appendTableCell(row, "td", item.count);
      appendTableCell(row, "td", item.setBytesCalls);
      appendTableCell(row, "td", formatBytes(item.setBytesTotalBytes));
      appendTableCell(row, "td", item.bufferBinds);
      elements.kernelBody.append(row);
    }
  }

  function renderWaitTable(scope) {
    elements.waitBody.replaceChildren();
    const rows = waitRowsForScope(scope);
    elements.waitState.textContent = `${rows.length} buckets`;
    if (rows.length === 0) {
      const row = documentObject.createElement("tr");
      row.className = "placeholder-row";
      appendTableCell(row, "th", "No waits in this launch");
      for (let index = 0; index < 3; index += 1) {
        appendTableCell(row, "td", "—");
      }
      elements.waitBody.append(row);
      return;
    }
    for (const item of rows) {
      const row = documentObject.createElement("tr");
      appendTableCell(row, "th", item.bucket);
      appendTableCell(row, "td", item.count);
      appendTableCell(row, "td", formatDuration(item.waitNs));
      appendTableCell(
        row,
        "td",
        item.additive
          ? `${item.waitClass} · measured`
          : item.bucket === "sched_backpressure"
            ? "scheduler mirror · non-additive"
            : "worker idle · non-additive",
      );
      elements.waitBody.append(row);
    }
  }

  function renderTablePlaceholder(body, columnCount, message) {
    body.replaceChildren();
    const row = documentObject.createElement("tr");
    row.className = "placeholder-row";
    appendTableCell(row, "th", message);
    for (let index = 1; index < columnCount; index += 1) {
      appendTableCell(row, "td", "—");
    }
    body.append(row);
  }

  function inspectorValue(parent, label, value, provenance) {
    const row = documentObject.createElement("div");
    const term = appendTextElement(documentObject, row, "dt", label);
    term.setAttribute("data-provenance", provenance);
    const description = documentObject.createElement("dd");
    description.textContent = String(value);
    appendTextElement(
      documentObject,
      description,
      "span",
      provenance,
      `provenance-tag provenance-${provenance}`,
    );
    row.append(description);
    parent.append(row);
  }

  function linkedCommandBuffer(payload) {
    const item = payload?.item;
    const index =
      payload?.kind === "cb"
        ? item?.commandBufferIndex
        : item?.commandBufferIndex;
    return Number.isFinite(index)
      ? state.activeScope?.commandBuffers?.find(
          (commandBuffer) => commandBuffer.commandBufferIndex === index,
        ) ?? null
      : null;
  }

  function renderInspector(payload) {
    elements.inspectorBody.replaceChildren();
    elements.clearSelection.disabled = !payload;
    if (!payload) {
      appendTextElement(
        documentObject,
        elements.inspectorBody,
        "p",
        "Select a command buffer, dispatch, density bin, or wait to connect its evidence.",
        "inspector-empty",
      );
      return;
    }
    appendTextElement(
      documentObject,
      elements.inspectorBody,
      "h3",
      payload.title,
      "inspector-title",
    );
    const readout = documentObject.createElement("dl");
    readout.className = "inspector-readout";
    for (const entry of payload.values ?? []) {
      inspectorValue(
        readout,
        entry.label,
        entry.value,
        entry.provenance ?? "metadata",
      );
    }
    const commandBuffer = linkedCommandBuffer(payload);
    if (commandBuffer) {
      const dispatchCount = state.activeScope?.dispatches?.filter(
        (dispatch) =>
          dispatch.commandBufferIndex === commandBuffer.commandBufferIndex,
      ).length ?? 0;
      inspectorValue(
        readout,
        "linked dispatches",
        dispatchCount,
        "derived",
      );
      if (
        Number.isFinite(commandBuffer.encodeStartNs) &&
        Number.isFinite(commandBuffer.encodeEndNs)
      ) {
        inspectorValue(
          readout,
          "host encode",
          `${formatDuration(commandBuffer.encodeStartNs)} – ` +
            formatDuration(commandBuffer.encodeEndNs),
          "measured",
        );
      }
      if (
        Number.isFinite(commandBuffer.gpuStartNs) &&
        Number.isFinite(commandBuffer.gpuEndNs)
      ) {
        inspectorValue(
          readout,
          "GPU execute",
          `${formatDuration(commandBuffer.gpuStartNs)} – ` +
            formatDuration(commandBuffer.gpuEndNs),
          "measured",
        );
      }
    }
    if (
      payload.kind === "wait" &&
      NON_ADDITIVE_WAITS.has(payload.item?.bucket)
    ) {
      inspectorValue(
        readout,
        "headline arithmetic",
        "excluded; scheduler detail is non-additive",
        "metadata",
      );
    }
    elements.inspectorBody.append(readout);
  }

  function scopeForWindow(dataset, windowIndex) {
    if (
      Number.isInteger(windowIndex) &&
      dataset?.launchWindows?.[windowIndex]
    ) {
      return dataset.launchWindows[windowIndex];
    }
    return dataset;
  }

  function clearAnalysisState() {
    state.currentDataset = null;
    state.currentWindowIndex = null;
    state.activeScope = null;
    elements.windowControl.hidden = true;
    elements.windowSelect.disabled = true;
    elements.windowSelect.replaceChildren();
    renderMetrics(null, true);
    elements.kernelState.textContent = "Awaiting rows";
    elements.waitState.textContent = "Awaiting rows";
    renderTablePlaceholder(
      elements.kernelBody,
      5,
      "Waiting for dispatch rows",
    );
    renderTablePlaceholder(elements.waitBody, 4, "Waiting for wait rows");
    renderInspector(null);
    renderer.setDataset({});
    elements.plotFrame.classList.add("is-loading");
    elements.timelinePlaceholder.hidden = false;
    elements.samplingNote.hidden = true;
    elements.samplingNote.textContent = "";
  }

  function renderSelectedWindow(windowIndex, { updateHistory = true } = {}) {
    const dataset = state.currentDataset;
    if (!dataset) return;
    const selectedIndex = chooseWindowIndex(dataset.launchWindows, windowIndex);
    state.currentWindowIndex = selectedIndex;
    const scope = scopeForWindow(dataset, selectedIndex);
    state.activeScope = scope;

    elements.windowSelect.replaceChildren();
    const windows = dataset.launchWindows ?? [];
    windows.forEach((window, index) => {
      const option = documentObject.createElement("option");
      option.value = String(index);
      option.textContent =
        `Launch ${index + 1} · ${formatDuration(window.summary?.wallSpanNs)}`;
      option.selected = index === selectedIndex;
      elements.windowSelect.append(option);
    });
    elements.windowControl.hidden = windows.length <= 1;
    elements.windowSelect.disabled = windows.length <= 1;

    renderMetrics(scope);
    renderKernelTable(scope);
    renderWaitTable(scope);
    renderInspector(null);
    renderer.setDataset(scope, { window: scope });
    renderer.fit(scope);
    elements.plotFrame.classList.remove("is-loading");
    elements.timelinePlaceholder.hidden = true;
    const disclosure = samplingDisclosure(scope);
    elements.samplingNote.textContent = disclosure ?? "";
    elements.samplingNote.hidden = disclosure === null;
    setHidden(elements.loading, true);
    if (updateHistory) {
      updateUrl(state.currentTraceId, selectedIndex);
    }
    announce(
      `${traceLabel(state.currentTrace)} · ` +
        `${windows.length > 0 ? `launch ${selectedIndex + 1} of ${windows.length}` : "no launch window"} · ` +
        `${scope.summary?.opsTotal ?? 0} dispatches`,
    );
  }

  function renderLoaded(trace, loaded, requestedWindow) {
    state.currentTrace = trace;
    state.currentDataset = loaded.dataset;
    state.evidenceByCacheKey.set(traceCacheKey(trace), loaded.dataset);
    renderRegistry();
    renderProvenance(trace, loaded.dataset, loaded.diagnostics);
    renderSelectedWindow(requestedWindow);
    const malformed = finiteOrZero(loaded.dataset.health?.malformedRows);
    if (malformed > 0) {
      announce(
        `${traceLabel(trace)} loaded with ${malformed} malformed row` +
          `${malformed === 1 ? "" : "s"}; valid records remain visible.`,
      );
    }
  }

  async function selectTrace(
    id,
    { requestedWindow = 0, recordSelection = true } = {},
  ) {
    const trace = state.traces.find((item) => item?.id === id);
    if (!trace || state.destroyed) return;
    if (recordSelection) {
      registrySelection.select(id);
    } else {
      registrySelection.adopt(id);
    }
    const token = coordinator.begin(id);
    const cacheKey = traceCacheKey(trace);
    state.currentToken = token;
    state.currentTraceId = id;
    state.currentTrace = trace;
    publishIfCurrent(coordinator, token, () => {
      renderRegistry();
      clearAnalysisState();
      renderPendingProvenance(trace);
      showLoading(trace);
      updateUrl(id, chooseWindowIndex([{ placeholder: true }], requestedWindow));
    });

    try {
      let loaded = cache.get(cacheKey);
      if (!loaded) {
        loaded = await traceAnalyzer(
          `/api/traces/${encodeURIComponent(id)}`,
          {
          signal: token.signal,
          onProgress(progress) {
            publishIfCurrent(coordinator, token, () => {
              renderProgress(progress, trace.size);
            });
          },
          onStateChange(workerState) {
            if (workerState !== "analyzing") return;
            publishIfCurrent(coordinator, token, () => {
              announce("Building exact aggregates off the main thread…");
            });
          },
          },
        );
        if (loaded.diagnostics.sourceBytes > 0) {
          cache.set(cacheKey, loaded, loaded.diagnostics.sourceBytes);
        }
      }
      publishIfCurrent(coordinator, token, () => {
        renderLoaded(trace, loaded, requestedWindow);
      });
    } catch (error) {
      if (
        error?.name === "AbortError" &&
        coordinator.isCurrent(token) === false
      ) {
        return;
      }
      if (!coordinator.isCurrent(token)) return;
      if (error?.status === 404) {
        announce("Selected trace disappeared; rescanning the directory…");
        await refreshRegistry({ missingId: id });
        return;
      }
      publishIfCurrent(coordinator, token, () => {
        showError(
          error?.name === "AbortError" ? "Loading aborted" : "Trace unavailable",
          errorDescription(error),
        );
      });
    }
  }

  async function refreshRegistry({ requestedId = null, missingId = null } = {}) {
    if (requestedId !== null) {
      registrySelection.adopt(requestedId);
    }
    const refreshToken = registrySelection.beginRefresh(state.traces);
    try {
      const response = await fetchImpl("/api/traces");
      if (!response?.ok) {
        const error = new Error(
          `Registry request failed with HTTP ${response?.status ?? "unknown"}`,
        );
        error.status = response?.status;
        throw error;
      }
      const registry = await response.json();
      if (!registrySelection.isCurrentRefresh(refreshToken) || state.destroyed) {
        return;
      }
      const traces = Array.isArray(registry?.traces) ? registry.traces : [];
      const commit = registrySelection.commitRefresh(refreshToken, traces);
      if (!commit.current) return;
      const activeTraceKey = traceCacheKey(state.currentTrace);
      state.traces = traces;
      elements.directory.textContent =
        stringValue(registry?.rootLabel) ?? "configured trace directory";

      const nextId = commit.selectedId;
      state.currentTraceId = nextId;
      renderRegistry();
      if (!nextId) {
        coordinator.clear();
        clearAnalysisState();
        showEmpty();
        updateUrl(null, null);
        return;
      }
      if (missingId && nextId === missingId) {
        showError(
          "Trace missing",
          "The selected file vanished but remains in a racing registry scan. Refresh again after the directory settles.",
        );
        return;
      }
      const nextTrace = traces.find((trace) => trace?.id === nextId);
      if (
        commit.selectionChanged &&
        state.currentToken?.id === nextId &&
        coordinator.isCurrent(state.currentToken) &&
        traceCacheKey(nextTrace) === activeTraceKey
      ) {
        state.currentTrace = nextTrace;
        renderRegistry();
        return;
      }
      await selectTrace(nextId, {
        requestedWindow:
          nextId === refreshToken.selectedId
            ? state.currentWindowIndex ?? 0
            : 0,
        recordSelection: false,
      });
    } catch (error) {
      if (!registrySelection.isCurrentRefresh(refreshToken) || state.destroyed) {
        return;
      }
      showError("Registry unavailable", errorDescription(error));
    }
  }

  elements.refresh.addEventListener("click", () => {
    announce("Refreshing trace directory…");
    void refreshRegistry();
  });
  elements.theme.addEventListener("click", () => {
    const current =
      documentObject.documentElement.getAttribute("data-theme") === "light"
        ? "light"
        : "dark";
    const next = current === "light" ? "dark" : "light";
    applyTheme(next);
    try {
      windowObject.localStorage?.setItem("metal-dispatch-theme", next);
    } catch {
      // Theme still applies for this session when storage is unavailable.
    }
    refreshRendererPalette();
    renderer.requestRender();
    announce(`${next === "light" ? "Light" : "Dark"} theme enabled.`);
  });
  elements.windowSelect.addEventListener("change", () => {
    renderSelectedWindow(Number.parseInt(elements.windowSelect.value, 10));
  });
  elements.clearSelection.addEventListener("click", () => {
    renderer.clearSelection();
  });
  elements.fit.addEventListener("click", () => renderer.fit(state.activeScope));
  elements.zoomIn.addEventListener("click", () => {
    renderer.handleKeyDown({ key: "+", preventDefault() {} });
  });
  elements.zoomOut.addEventListener("click", () => {
    renderer.handleKeyDown({ key: "-", preventDefault() {} });
  });
  elements.rail.addEventListener("keydown", (event) => {
    handleTraceRailKey({
      documentObject,
      track: elements.track,
      event,
    });
  });

  for (const element of [
    elements.refresh,
    elements.theme,
    elements.zoomOut,
    elements.fit,
    elements.zoomIn,
  ]) {
    element.removeAttribute("disabled");
  }

  const pagehide = () => {
    state.destroyed = true;
    coordinator.clear();
    renderer.destroy();
  };
  windowObject.addEventListener("pagehide", pagehide, { once: true });

  await refreshRegistry({
    requestedId: initialUrl.searchParams.get("trace"),
  });
  if (state.currentDataset) {
    renderSelectedWindow(initialUrl.searchParams.get("window"));
  }

  return {
    cache,
    coordinator,
    renderer,
    refresh: refreshRegistry,
    selectTrace,
    state,
  };
}

if (typeof globalThis.document !== "undefined") {
  const start = () => {
    void bootstrap().catch((error) => {
      const status = globalThis.document?.getElementById("trace-status");
      if (status) {
        status.textContent = `Workbench failed to start: ${errorDescription(error)}`;
      }
    });
  };
  if (globalThis.document.readyState === "loading") {
    globalThis.document.addEventListener("DOMContentLoaded", start, {
      once: true,
    });
  } else {
    globalThis.queueMicrotask(start);
  }
}
