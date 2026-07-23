const MIN_VIEWPORT_SPAN_NS = 1;
const DENSITY_SPACING_PX = 3;

export const TIMELINE_LANES = Object.freeze({
  ruler: Object.freeze({ y: 0, height: 28 }),
  host: Object.freeze({ y: 28, height: 68 }),
  gpu: Object.freeze({ y: 96, height: 68 }),
  waits: Object.freeze({ y: 164, height: 46 }),
  dispatch: Object.freeze({ y: 210, height: 72 }),
  footer: Object.freeze({ y: 282, height: 24 }),
  totalHeight: 306,
});

export const TIMELINE_DRAW_ORDER = Object.freeze([
  "background",
  "timing-grid",
  "launch-cycle-boundaries",
  "wait-curtains",
  "host",
  "gpu",
  "dispatch",
  "selection",
  "crosshair",
  "labels",
]);

const FALLBACK_COLORS = Object.freeze({
  canvas: "#071116",
  rule: "#213942",
  text: "#edf7f8",
  secondary: "#91aab2",
  gpu: "#48d7ff",
  hiddenHost: "#48d7ff",
  exposedHost: "#ff756d",
  decisionCap: "#ffc857",
  dependency: "#b49cff",
  selection: "#f5fbff",
});

const PROVENANCE = new Set(["measured", "derived", "ordered", "metadata"]);

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function validRange(range) {
  if (
    range !== null &&
    typeof range === "object" &&
    Number.isFinite(range.startNs) &&
    Number.isFinite(range.endNs) &&
    range.endNs > range.startNs
  ) {
    const span = range.endNs - range.startNs;
    return Number.isFinite(span) && span > 0;
  }
  return false;
}

function normalizedBounds(bounds) {
  if (!validRange(bounds)) {
    return { startNs: 0, endNs: 1 };
  }
  return { startNs: bounds.startNs, endNs: bounds.endNs };
}

function timeOf(dispatch) {
  return Number.isFinite(dispatch?.atNs) ? dispatch.atNs : null;
}

function mergeKeyboardMarks(dispatches, waits) {
  const marks = [];
  let dispatchIndex = 0;
  let waitIndex = 0;
  while (dispatchIndex < dispatches.length || waitIndex < waits.length) {
    const dispatch = dispatches[dispatchIndex];
    const wait = waits[waitIndex];
    if (
      wait === undefined ||
      (dispatch !== undefined && dispatch.atNs <= wait.atNs)
    ) {
      marks.push(dispatch);
      dispatchIndex += 1;
    } else {
      marks.push(wait);
      waitIndex += 1;
    }
  }
  return marks;
}

/**
 * Convert time to a CSS-pixel coordinate. Invalid geometry has a finite,
 * deterministic result so a malformed trace cannot poison the canvas state.
 */
export function timeToX(timeNs, viewport, width) {
  if (viewport && !validRange(viewport)) return 0;
  const range = validRange(viewport) ? viewport : { startNs: 0, endNs: 1 };
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 0;
  const safeTime = Number.isFinite(timeNs) ? timeNs : range.startNs;
  return ((safeTime - range.startNs) / (range.endNs - range.startNs)) * safeWidth;
}

/**
 * Convert a CSS-pixel coordinate to time. This is the exact inverse of
 * timeToX for valid inputs.
 */
export function xToTime(x, viewport, width) {
  if (viewport && !validRange(viewport)) return finite(viewport.startNs);
  const range = validRange(viewport) ? viewport : { startNs: 0, endNs: 1 };
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(x)) {
    return range.startNs;
  }
  return range.startNs + (x / width) * (range.endNs - range.startNs);
}

/**
 * Keep a viewport inside its trace bounds. The full trace is the maximum zoom
 * out and one nanosecond is the minimum span (or the complete bound when it is
 * smaller). Shifting at an edge preserves the requested span.
 */
export function clampViewport(viewport, bounds) {
  const safeBounds = normalizedBounds(bounds);
  const boundSpan = safeBounds.endNs - safeBounds.startNs;
  if (!validRange(viewport)) {
    if (
      viewport &&
      Number.isFinite(viewport.startNs) &&
      Number.isFinite(viewport.endNs) &&
      viewport.startNs === viewport.endNs
    ) {
      const span = Math.min(boundSpan, MIN_VIEWPORT_SPAN_NS);
      let startNs = viewport.startNs - span / 2;
      let endNs = startNs + span;
      if (startNs < safeBounds.startNs) {
        startNs = safeBounds.startNs;
        endNs = startNs + span;
      }
      if (endNs > safeBounds.endNs) {
        endNs = safeBounds.endNs;
        startNs = endNs - span;
      }
      return { startNs, endNs };
    }
    return safeBounds;
  }

  const requestedSpan = viewport.endNs - viewport.startNs;
  const span = Math.min(
    boundSpan,
    Math.max(Math.min(boundSpan, MIN_VIEWPORT_SPAN_NS), requestedSpan),
  );
  if (span >= boundSpan) {
    return safeBounds;
  }

  let startNs = viewport.startNs;
  let endNs = startNs + span;
  if (startNs < safeBounds.startNs) {
    startNs = safeBounds.startNs;
    endNs = startNs + span;
  }
  if (endNs > safeBounds.endNs) {
    endNs = safeBounds.endNs;
    startNs = endNs - span;
  }
  return { startNs, endNs };
}

/**
 * Aggregate placed dispatches into at most one bin per CSS pixel. The
 * algorithm is O(dispatches + populated bins), not O(dispatches * pixels).
 */
export function buildDensityBins(dispatches, { startNs, endNs, width } = {}) {
  if (
    !Array.isArray(dispatches) ||
    dispatches.length === 0 ||
    !Number.isFinite(startNs) ||
    !Number.isFinite(endNs) ||
    !Number.isFinite(width) ||
    width <= 0
  ) {
    return [];
  }

  const span = endNs - startNs;
  if (!Number.isFinite(span) || span <= 0) return [];

  const binCount = Math.max(1, Math.floor(width));
  const bins = new Map();
  for (const item of dispatches) {
    const atNs = timeOf(item);
    if (atNs === null || atNs < startNs || atNs > endNs) {
      continue;
    }
    const fraction = (atNs - startNs) / span;
    const index = Math.min(binCount - 1, Math.max(0, Math.floor(fraction * binCount)));
    let bin = bins.get(index);
    if (!bin) {
      bin = {
        index,
        startNs: startNs + (index / binCount) * span,
        endNs: startNs + ((index + 1) / binCount) * span,
        count: 0,
        kernelCounts: new Map(),
        commandBufferIndices: new Set(),
        hasUnownedDispatch: false,
        firstDispatch: item,
        lastDispatch: item,
      };
      bins.set(index, bin);
    }
    bin.count += 1;
    bin.lastDispatch = item;
    const kernel = typeof item.kernel === "string" && item.kernel.length > 0
      ? item.kernel
      : "(unknown)";
    bin.kernelCounts.set(kernel, (bin.kernelCounts.get(kernel) ?? 0) + 1);
    if (Number.isFinite(item.commandBufferIndex)) {
      bin.commandBufferIndices.add(item.commandBufferIndex);
    } else {
      bin.hasUnownedDispatch = true;
    }
  }

  return [...bins.values()]
    .sort((left, right) => left.index - right.index)
    .map((bin) => {
      let dominantKernel = null;
      let dominantCount = -1;
      for (const [kernel, count] of bin.kernelCounts) {
        if (
          count > dominantCount ||
          (count === dominantCount && (dominantKernel === null || kernel < dominantKernel))
        ) {
          dominantKernel = kernel;
          dominantCount = count;
        }
      }
      const commandBufferIndices = [...bin.commandBufferIndices].sort(
        (left, right) => left - right,
      );
      return Object.freeze({
        index: bin.index,
        startNs: bin.startNs,
        endNs: bin.endNs,
        count: bin.count,
        dominantKernel,
        kernelCounts: Object.freeze(
          Object.fromEntries([...bin.kernelCounts].sort(([left], [right]) =>
            left.localeCompare(right))),
        ),
        commandBufferIndex:
          commandBufferIndices.length === 1 && !bin.hasUnownedDispatch
            ? commandBufferIndices[0]
            : null,
        commandBufferIndices: Object.freeze(commandBufferIndices),
        firstDispatch: bin.firstDispatch,
        lastDispatch: bin.lastDispatch,
      });
    });
}

/**
 * Density mode is selected from the actual visible placement spacing rather
 * than total trace size.
 */
export function shouldUseDensity(dispatches, viewport, width) {
  if (!Array.isArray(dispatches) || dispatches.length < 2 || !validRange(viewport)) {
    return false;
  }
  let count = 0;
  let first = Infinity;
  let last = -Infinity;
  for (const item of dispatches) {
    const atNs = timeOf(item);
    if (atNs === null || atNs < viewport.startNs || atNs > viewport.endNs) continue;
    count += 1;
    first = Math.min(first, atNs);
    last = Math.max(last, atNs);
  }
  if (count < 2) return false;
  const pixelSpan = Math.abs(timeToX(last, viewport, width) - timeToX(first, viewport, width));
  return pixelSpan / (count - 1) < DENSITY_SPACING_PX;
}

function lowerBound(items, value, selector) {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (selector(items[middle]) < value) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

function upperBound(items, value, selector) {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (selector(items[middle]) <= value) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

function intervalIsValid(interval) {
  return (
    Array.isArray(interval) &&
    Number.isFinite(interval[0]) &&
    Number.isFinite(interval[1]) &&
    interval[1] >= interval[0]
  );
}

function commandBufferBounds(commandBuffer) {
  const values = [
    commandBuffer?.encodeStartNs,
    commandBuffer?.encodeEndNs,
    commandBuffer?.gpuStartNs,
    commandBuffer?.gpuEndNs,
  ].filter(Number.isFinite);
  if (values.length === 0) return null;
  return { startNs: Math.min(...values), endNs: Math.max(...values) };
}

function traceBounds(data, placedDispatches) {
  if (validRange(data?.summary)) {
    return { startNs: data.summary.startNs, endNs: data.summary.endNs };
  }
  let startNs = Infinity;
  let endNs = -Infinity;
  const include = (atNs) => {
    if (!Number.isFinite(atNs)) return;
    startNs = Math.min(startNs, atNs);
    endNs = Math.max(endNs, atNs);
  };
  for (const dispatch of placedDispatches) include(dispatch.atNs);
  for (const commandBuffer of data?.commandBuffers ?? []) {
    const range = commandBufferBounds(commandBuffer);
    if (range) {
      include(range.startNs);
      include(range.endNs);
    }
  }
  for (const wait of data?.waits ?? []) {
    include(wait?.atNs);
  }
  if (!Number.isFinite(startNs) || !Number.isFinite(endNs)) {
    return { startNs: 0, endNs: 1 };
  }
  if (validRange({ startNs, endNs })) return { startNs, endNs };
  return normalizedBounds({
    startNs: startNs - 0.5,
    endNs: endNs + 0.5,
  });
}

function formatTime(value) {
  if (!Number.isFinite(value)) return "unplaced";
  const absolute = Math.abs(value);
  if (absolute >= 1e9) return `${(value / 1e9).toFixed(3)} s`;
  if (absolute >= 1e6) return `${(value / 1e6).toFixed(3)} ms`;
  if (absolute >= 1e3) return `${(value / 1e3).toFixed(3)} us`;
  return `${value.toFixed(Number.isInteger(value) ? 0 : 3)} ns`;
}

function niceStep(span, targetTicks) {
  if (!Number.isFinite(span) || span <= 0) return 1;
  const rough = span / Math.max(2, targetTicks);
  const power = 10 ** Math.floor(Math.log10(rough));
  const ratio = rough / power;
  const factor = ratio <= 1 ? 1 : ratio <= 2 ? 2 : ratio <= 5 ? 5 : 10;
  return factor * power;
}

function readColors(canvas, view) {
  const style = view?.getComputedStyle?.(canvas);
  const get = (variable, fallback) => {
    const value = style?.getPropertyValue?.(variable)?.trim();
    return value || fallback;
  };
  return {
    canvas: get("--canvas", FALLBACK_COLORS.canvas),
    rule: get("--rule", FALLBACK_COLORS.rule),
    text: get("--text", FALLBACK_COLORS.text),
    secondary: get("--secondary", FALLBACK_COLORS.secondary),
    gpu: get("--gpu", FALLBACK_COLORS.gpu),
    hiddenHost: get("--hidden-host", FALLBACK_COLORS.hiddenHost),
    exposedHost: get("--exposed-host", FALLBACK_COLORS.exposedHost),
    decisionCap: get("--decision-cap", FALLBACK_COLORS.decisionCap),
    dependency: get("--dependency", FALLBACK_COLORS.dependency),
    selection: get("--selection", FALLBACK_COLORS.selection),
  };
}

function value(label, entryValue, provenance) {
  return {
    label,
    value: entryValue,
    provenance: PROVENANCE.has(provenance) ? provenance : "metadata",
  };
}

function buildInspectPayload(item) {
  if (!item) return null;
  const kind = item.kind ?? item.type;
  let values;
  let title;
  if (kind === "dispatch-bin") {
    title = `${item.count} dispatches`;
    values = [
      value("count", item.count, "derived"),
      value("dominant kernel", item.dominantKernel ?? "(unknown)", "derived"),
      value("bin start", formatTime(item.startNs), "derived"),
      value("bin end", formatTime(item.endNs), "derived"),
    ];
  } else if (kind === "op" || kind === "dispatch") {
    title = item.kernel || "dispatch";
    values = [
      value("kernel", item.kernel ?? "(unknown)", "metadata"),
      value("sequence", item.seq ?? "missing", "metadata"),
      value("command buffer", item.commandBufferIndex ?? "unowned", "metadata"),
      value(
        "time",
        Number.isFinite(item.atNs)
          ? `${formatTime(item.atNs)} (ordered placement)`
          : `unplaced (${item.placementDetail ?? "ordered placement unavailable"})`,
        "ordered",
      ),
    ];
  } else if (kind === "cb") {
    title = `command buffer ${item.commandBufferIndex ?? "unknown"}`;
    values = [
      value("command buffer", item.commandBufferIndex ?? "unknown", "metadata"),
      value("operation count", item.opCount ?? "unknown", "metadata"),
    ];
    for (const [label, field] of [
      ["encode start", "encodeStartNs"],
      ["encode end", "encodeEndNs"],
      ["GPU start", "gpuStartNs"],
      ["GPU end", "gpuEndNs"],
    ]) {
      if (Number.isFinite(item[field])) values.push(value(label, formatTime(item[field]), "measured"));
    }
    if (Number.isFinite(item.hiddenHostNs)) {
      values.push(value("hidden host", formatTime(item.hiddenHostNs), "derived"));
    }
    if (Number.isFinite(item.exposedHostNs)) {
      values.push(value("exposed host", formatTime(item.exposedHostNs), "derived"));
    }
  } else if (kind === "wait") {
    title = item.bucket || "wait";
    values = [
      value("category", item.waitClass ?? "other", "metadata"),
      value("duration", formatTime(item.waitNs), "measured"),
    ];
    if (Number.isFinite(item.atNs)) {
      values.push(
        value(
          "anchor",
          formatTime(item.atNs),
          item.atNsSource || item.placement === "legacy-command-buffer-fallback"
            ? "derived"
            : "measured",
        ),
      );
    }
  } else {
    title = "timeline item";
    values = [value("value", String(item), "metadata")];
  }
  const text = [title, ...values.map((entry) =>
    `${entry.label}: ${entry.value} [${entry.provenance}]`)].join("\n");
  return Object.freeze({
    kind,
    item,
    title,
    values: Object.freeze(values),
    text,
  });
}

export class TimelineRenderer {
  constructor(canvas, { onInspect, onViewportChange } = {}) {
    if (!canvas || typeof canvas.getContext !== "function") {
      throw new TypeError("TimelineRenderer requires a canvas");
    }
    const context = canvas.getContext("2d");
    if (!context) throw new Error("TimelineRenderer requires a 2D context");

    this.canvas = canvas;
    this.context = context;
    this.document = canvas.ownerDocument ?? globalThis.document;
    this.window = this.document?.defaultView ?? globalThis.window;
    this.onInspect = typeof onInspect === "function" ? onInspect : () => {};
    this.onViewportChange =
      typeof onViewportChange === "function" ? onViewportChange : () => {};
    this.colors = readColors(canvas, this.window);
    this.dataset = null;
    this.bounds = { startNs: 0, endNs: 1 };
    this.viewport = { ...this.bounds };
    this.placedDispatches = [];
    this.unplacedDispatches = [];
    this.visibleDispatches = [];
    this.sortedWaits = [];
    this.waitsByCommandBuffer = new Map();
    this.commandBuffers = [];
    this.commandBufferByIndex = new Map();
    this.dispatchesByCommandBuffer = new Map();
    this.selection = { dispatch: null, commandBuffer: null, wait: null, bin: null };
    this.hovered = null;
    this.keyboardActive = null;
    this.keyboardActiveIndex = -1;
    this.keyboardMarks = [];
    this.crosshairX = null;
    this.hitTargets = [];
    this.listeners = [];
    this.framePending = false;
    this.frameId = null;
    this.destroyed = false;
    this.drag = null;
    this.interactionIdentity = null;
    this.selectedWindow = null;
    this.datasetGeneration = 0;
    this.analysisCache = null;
    this.paletteSignature = Object.values(this.colors).join("\u0000");
    this.laneScaleY = 1;
    this.staticLayerCanvas = null;
    this.staticLayerContext = null;
    this.staticLayerCache = null;
    this.reducedMotion = Boolean(
      this.window?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches,
    );
    this.lastRenderStats = Object.freeze({
      indexedDispatches: 0,
      visibleDispatches: 0,
      unplacedDispatches: 0,
      dispatchesVisited: 0,
      dispatchesBinned: 0,
      densityMode: false,
      densityCacheHit: false,
      staticLayerCacheHit: false,
      commandBuffersVisited: 0,
      waitsVisited: 0,
      staticHitTargetsRebuilt: 0,
      zeroOpHairlines: 0,
      selectedCommandBufferIndex: null,
      drawOrder: [],
    });

    this.canvas.setAttribute?.("role", "img");
    this.canvas.setAttribute?.("aria-label", "Metal dispatch timeline");
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute?.("tabindex", "0");
    this.canvas.setAttribute?.("aria-disabled", "false");
    this.createTooltip();
    this.installListeners();
    const ResizeObserverClass = this.window?.ResizeObserver ?? globalThis.ResizeObserver;
    if (typeof ResizeObserverClass === "function") {
      this.resizeObserver = new ResizeObserverClass(() => this.requestRender());
      this.resizeObserver.observe(canvas);
    } else {
      this.resizeObserver = null;
      this.listen(this.window, "resize", () => this.requestRender());
    }
    this.updateAccessibleSummary();
    this.requestRender();
  }

  createTooltip() {
    const tooltip = this.document?.createElement?.("div");
    if (!tooltip) {
      this.tooltip = null;
      return;
    }
    tooltip.className = "timeline-tooltip";
    Object.assign(tooltip.style, {
      position: "fixed",
      zIndex: "1000",
      maxWidth: "320px",
      padding: "8px 10px",
      border: "1px solid var(--rule)",
      borderRadius: "4px",
      background: "var(--canvas)",
      color: "var(--text)",
      font: '11px/1.45 "SFMono-Regular", ui-monospace, monospace',
      whiteSpace: "pre-line",
      pointerEvents: "none",
      display: "none",
    });
    tooltip.setAttribute?.("role", "tooltip");
    this.document?.body?.append?.(tooltip);
    this.tooltip = tooltip;
  }

  listen(target, type, listener, options) {
    if (!target?.addEventListener) return;
    target.addEventListener(type, listener, options);
    this.listeners.push({ target, type, listener, options });
  }

  installListeners() {
    this.listen(this.canvas, "pointermove", (event) => this.handlePointerMove(event));
    this.listen(this.canvas, "pointerdown", (event) => this.handlePointerDown(event));
    this.listen(this.canvas, "pointerup", (event) => this.handlePointerUp(event));
    this.listen(this.canvas, "pointercancel", (event) => this.handlePointerCancel(event));
    this.listen(this.canvas, "pointerleave", () => this.handlePointerLeave());
    this.listen(this.canvas, "wheel", (event) => this.handleWheel(event), {
      passive: false,
    });
    this.listen(this.canvas, "dblclick", (event) => {
      event.preventDefault?.();
      this.fit(this.selectedWindow);
    });
    this.listen(this.canvas, "keydown", (event) => this.handleKeyDown(event));
    this.listen(this.canvas, "contextmenu", (event) => {
      if (this.drag) event.preventDefault?.();
    });
  }

  setDataset(data, options = {}) {
    const previousBounds = this.bounds;
    const previousInteractionIdentity = this.interactionIdentity;
    const nextInteractionIdentity =
      typeof options.interactionIdentity === "string" &&
      options.interactionIdentity !== ""
        ? options.interactionIdentity
        : null;
    const preservedDrag =
      options.preservePointerDrag === true && this.drag ? this.drag : null;
    this.hideTooltip();
    this.selection = { dispatch: null, commandBuffer: null, wait: null, bin: null };
    this.hovered = null;
    this.keyboardActive = null;
    this.keyboardActiveIndex = -1;
    this.crosshairX = null;
    this.drag = null;
    this.onInspect(null);
    this.datasetGeneration += 1;
    this.analysisCache = null;
    this.staticLayerCache = null;
    this.hitTargets = [];
    this.visibleDispatches = [];
    const safeData = data && typeof data === "object" ? data : {};
    this.dataset = safeData;
    const dispatches = Array.isArray(safeData.dispatches)
      ? safeData.dispatches
      : Array.isArray(safeData.ops)
        ? safeData.ops
        : [];
    const placed = [];
    const unplaced = [];
    let monotonic = true;
    let previous = -Infinity;
    for (let index = 0; index < dispatches.length; index += 1) {
      const item = dispatches[index];
      if (timeOf(item) === null) {
        unplaced.push(item);
        continue;
      }
      if (item.atNs < previous) monotonic = false;
      previous = item.atNs;
      placed.push({ item, sourceOrder: index });
    }
    if (!monotonic) {
      placed.sort((left, right) =>
        left.item.atNs - right.item.atNs || left.sourceOrder - right.sourceOrder);
    }
    this.placedDispatches = placed.map(({ item }) => item);
    this.unplacedDispatches = unplaced;

    this.commandBuffers = Array.isArray(safeData.commandBuffers)
      ? [...safeData.commandBuffers]
      : [];
    this.commandBufferByIndex = new Map(
      this.commandBuffers
        .filter((item) => Number.isFinite(item?.commandBufferIndex))
        .map((item) => [item.commandBufferIndex, item]),
    );
    this.dispatchesByCommandBuffer = new Map();
    for (const item of this.placedDispatches) {
      if (!Number.isFinite(item.commandBufferIndex)) continue;
      let owned = this.dispatchesByCommandBuffer.get(item.commandBufferIndex);
      if (!owned) {
        owned = [];
        this.dispatchesByCommandBuffer.set(item.commandBufferIndex, owned);
      }
      owned.push(item);
    }
    this.sortedWaits = (Array.isArray(safeData.waits) ? safeData.waits : [])
      .filter((item) => Number.isFinite(item?.atNs))
      .map((item, sourceOrder) => ({ item, sourceOrder }))
      .sort((left, right) =>
        left.item.atNs - right.item.atNs || left.sourceOrder - right.sourceOrder)
      .map(({ item }) => item);
    this.keyboardMarks = mergeKeyboardMarks(
      this.placedDispatches,
      this.sortedWaits,
    );
    this.waitsByCommandBuffer = new Map();
    for (const wait of this.sortedWaits) {
      if (
        Number.isFinite(wait.commandBufferIndex) &&
        !this.waitsByCommandBuffer.has(wait.commandBufferIndex)
      ) {
        this.waitsByCommandBuffer.set(wait.commandBufferIndex, wait);
      }
    }
    const naturalBounds = traceBounds(safeData, this.placedDispatches);
    this.bounds = validRange(options.bounds)
      ? normalizedBounds(options.bounds)
      : naturalBounds;
    if (
      preservedDrag &&
      nextInteractionIdentity !== null &&
      nextInteractionIdentity === previousInteractionIdentity &&
      this.bounds.startNs === previousBounds.startNs &&
      this.bounds.endNs === previousBounds.endNs
    ) {
      this.drag = preservedDrag;
    }
    this.interactionIdentity = nextInteractionIdentity;
    const selectedWindow =
      (validRange(options) ? options : options.window) ??
      safeData.selectedWindow ??
      (Number.isInteger(safeData.selectedWindowIndex)
        ? safeData.launchWindows?.[safeData.selectedWindowIndex]
        : null);
    this.selectedWindow = validRange(selectedWindow) ? selectedWindow : null;
    const requestedViewport = validRange(options.viewport)
      ? options.viewport
      : this.selectedWindow ?? this.bounds;
    this.setViewport(requestedViewport, { notify: false });
    this.updateAccessibleSummary();
    this.requestRender();
    return this;
  }

  fit(
    target = this.selectedWindow ?? this.bounds,
    notify = true,
    metadata = { committed: true, source: "fit" },
  ) {
    let range = target;
    if (Number.isInteger(target)) {
      range = this.dataset?.launchWindows?.[target];
    }
    if (!validRange(range)) range = this.bounds;
    if (validRange(range) && range !== this.bounds) this.selectedWindow = range;
    return this.setViewport(
      { startNs: range.startNs, endNs: range.endNs },
      { notify, ...metadata },
    );
  }

  setViewport(
    viewport,
    { notify = true, committed = true, source = "external" } = {},
  ) {
    const nextViewport = clampViewport(viewport, this.bounds);
    const changed =
      nextViewport.startNs !== this.viewport.startNs ||
      nextViewport.endNs !== this.viewport.endNs;
    this.viewport = nextViewport;
    if (changed) {
      this.analysisCache = null;
      this.staticLayerCache = null;
    }
    if (notify) this.notifyViewportChange({ committed, source });
    this.requestRender();
    return Object.freeze({ ...this.viewport });
  }

  notifyViewportChange({ committed = true, source = "external" } = {}) {
    this.onViewportChange(
      Object.freeze({ ...this.viewport }),
      Object.freeze({ committed: Boolean(committed), source }),
    );
  }

  requestRender() {
    if (this.destroyed || this.framePending) return;
    this.framePending = true;
    const callback = () => {
      this.framePending = false;
      this.frameId = null;
      if (!this.destroyed) this.render();
    };
    if (this.window?.requestAnimationFrame) {
      this.frameId = this.window.requestAnimationFrame(callback);
    } else {
      this.frameId = globalThis.setTimeout(callback, 0);
    }
  }

  resizeBackingStore() {
    const rect = this.canvas.getBoundingClientRect?.() ?? {
      width: this.canvas.clientWidth ?? 1,
      height: this.canvas.clientHeight ?? TIMELINE_LANES.totalHeight,
    };
    const width = Math.max(1, finite(rect.width, 1));
    const measuredHeight = finite(
      rect.height,
      this.canvas.clientHeight ?? TIMELINE_LANES.totalHeight,
    );
    const height = measuredHeight > 0
      ? measuredHeight
      : TIMELINE_LANES.totalHeight;
    const dpr = Math.max(1, finite(this.window?.devicePixelRatio, 1));
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));
    if (this.canvas.width !== pixelWidth) this.canvas.width = pixelWidth;
    if (this.canvas.height !== pixelHeight) this.canvas.height = pixelHeight;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.laneScaleY = height / TIMELINE_LANES.totalHeight;
    this.context.setTransform?.(dpr, 0, 0, dpr * this.laneScaleY, 0, 0);
  }

  visibleDispatchRange() {
    const first = lowerBound(this.placedDispatches, this.viewport.startNs, (item) => item.atNs);
    const after = upperBound(this.placedDispatches, this.viewport.endNs, (item) => item.atNs);
    return { first, after, count: Math.max(0, after - first) };
  }

  renderAnalysis() {
    const range = this.visibleDispatchRange();
    const cache = this.analysisCache;
    if (
      cache &&
      cache.datasetGeneration === this.datasetGeneration &&
      cache.startNs === this.viewport.startNs &&
      cache.endNs === this.viewport.endNs &&
      cache.width === this.width &&
      cache.first === range.first &&
      cache.after === range.after &&
      cache.paletteSignature === this.paletteSignature
    ) {
      return {
        ...cache,
        densityCacheHit: true,
        dispatchesVisited: 0,
        dispatchesBinned: 0,
      };
    }

    let densityMode = false;
    if (range.count >= 2) {
      const firstNs = this.placedDispatches[range.first].atNs;
      const lastNs = this.placedDispatches[range.after - 1].atNs;
      const pixelSpan =
        ((lastNs - firstNs) / (this.viewport.endNs - this.viewport.startNs)) *
        this.width;
      densityMode = pixelSpan / (range.count - 1) < DENSITY_SPACING_PX;
    }
    const visibleDispatches = this.placedDispatches.slice(range.first, range.after);
    const visibleBins = densityMode
      ? buildDensityBins(visibleDispatches, {
        startNs: this.viewport.startNs,
        endNs: this.viewport.endNs,
        width: this.width,
      })
      : [];
    this.analysisCache = {
      datasetGeneration: this.datasetGeneration,
      startNs: this.viewport.startNs,
      endNs: this.viewport.endNs,
      width: this.width,
      first: range.first,
      after: range.after,
      paletteSignature: this.paletteSignature,
      visibleDispatches,
      visibleBins,
      densityMode,
    };
    return {
      ...this.analysisCache,
      densityCacheHit: false,
      dispatchesVisited: range.count,
      dispatchesBinned: densityMode ? range.count : 0,
    };
  }

  ensureStaticLayer() {
    if (this.staticLayerCanvas && this.staticLayerContext) {
      return true;
    }
    const canvas = this.document?.createElement?.("canvas");
    const context = canvas?.getContext?.("2d");
    if (!canvas || !context || canvas === this.canvas) {
      this.staticLayerCanvas = null;
      this.staticLayerContext = null;
      return false;
    }
    this.staticLayerCanvas = canvas;
    this.staticLayerContext = context;
    return true;
  }

  staticLayerMatches(cache) {
    return Boolean(
      cache &&
      cache.datasetGeneration === this.datasetGeneration &&
      cache.startNs === this.viewport.startNs &&
      cache.endNs === this.viewport.endNs &&
      cache.width === this.width &&
      cache.height === this.height &&
      cache.dpr === this.dpr &&
      cache.paletteSignature === this.paletteSignature
    );
  }

  blitStaticLayer() {
    const context = this.context;
    context.save?.();
    context.setTransform?.(1, 0, 0, 1, 0, 0);
    context.drawImage?.(this.staticLayerCanvas, 0, 0);
    context.restore?.();
  }

  drawStaticLanes(analysis) {
    this.drawBackground();
    this.drawTimingGrid();
    this.drawBoundaries();
    this.drawWaitCurtains();
    const zeroOpHairlines = this.drawHost();
    this.drawGpu();
    this.drawDispatches(analysis.densityMode, analysis.visibleBins);
    return zeroOpHairlines;
  }

  prepareStaticLayer(analysis) {
    if (this.staticLayerMatches(this.staticLayerCache)) {
      this.hitTargets = this.staticLayerCache.hitTargets;
      this.blitStaticLayer();
      return {
        cacheHit: true,
        zeroOpHairlines: this.staticLayerCache.zeroOpHairlines,
        commandBuffersVisited: 0,
        waitsVisited: 0,
        hitTargetsRebuilt: 0,
      };
    }

    const visibleCommandBuffers = this.visibleCommandBuffers();
    const visibleWaits = this.visibleWaits();
    this.staticVisibleCommandBuffers = visibleCommandBuffers;
    this.staticVisibleWaits = visibleWaits;
    this.hitTargets = [];
    let zeroOpHairlines = 0;
    const hasStaticLayer = this.ensureStaticLayer();
    if (hasStaticLayer) {
      const pixelWidth = Math.max(1, Math.round(this.width * this.dpr));
      const pixelHeight = Math.max(1, Math.round(this.height * this.dpr));
      if (this.staticLayerCanvas.width !== pixelWidth) {
        this.staticLayerCanvas.width = pixelWidth;
      }
      if (this.staticLayerCanvas.height !== pixelHeight) {
        this.staticLayerCanvas.height = pixelHeight;
      }
      this.staticLayerContext.setTransform?.(
        this.dpr,
        0,
        0,
        this.dpr * this.laneScaleY,
        0,
        0,
      );
      const visibleContext = this.context;
      this.context = this.staticLayerContext;
      try {
        zeroOpHairlines = this.drawStaticLanes(analysis);
      } finally {
        this.context = visibleContext;
        this.staticVisibleCommandBuffers = null;
        this.staticVisibleWaits = null;
      }
      this.staticLayerCache = {
        datasetGeneration: this.datasetGeneration,
        startNs: this.viewport.startNs,
        endNs: this.viewport.endNs,
        width: this.width,
        height: this.height,
        dpr: this.dpr,
        paletteSignature: this.paletteSignature,
        hitTargets: this.hitTargets,
        zeroOpHairlines,
      };
      this.blitStaticLayer();
    } else {
      try {
        zeroOpHairlines = this.drawStaticLanes(analysis);
      } finally {
        this.staticVisibleCommandBuffers = null;
        this.staticVisibleWaits = null;
      }
      this.staticLayerCache = null;
    }
    return {
      cacheHit: false,
      zeroOpHairlines,
      commandBuffersVisited: visibleCommandBuffers.length,
      waitsVisited: visibleWaits.length,
      hitTargetsRebuilt: this.hitTargets.length,
    };
  }

  render() {
    if (this.destroyed) return;
    this.resizeBackingStore();
    this.colors = readColors(this.canvas, this.window);
    const nextPaletteSignature = Object.values(this.colors).join("\u0000");
    if (nextPaletteSignature !== this.paletteSignature) {
      this.paletteSignature = nextPaletteSignature;
      this.analysisCache = null;
      this.staticLayerCache = null;
    }
    const analysis = this.renderAnalysis();
    this.visibleDispatches = analysis.visibleDispatches;
    const densityMode = analysis.densityMode;
    const visibleBins = analysis.visibleBins;
    const drawOrder = [];
    const staticLayer = this.prepareStaticLayer(analysis);
    drawOrder.push("background");
    drawOrder.push("timing-grid");
    drawOrder.push("launch-cycle-boundaries");
    drawOrder.push("wait-curtains");
    drawOrder.push("host");
    drawOrder.push("gpu");
    drawOrder.push("dispatch");
    this.drawSelection();
    drawOrder.push("selection");
    this.drawCrosshair();
    drawOrder.push("crosshair");
    this.drawLabels(densityMode);
    drawOrder.push("labels");

    this.lastRenderStats = Object.freeze({
      indexedDispatches: this.placedDispatches.length,
      visibleDispatches: this.visibleDispatches.length,
      unplacedDispatches: this.unplacedDispatches.length,
      dispatchesVisited: analysis.dispatchesVisited,
      dispatchesBinned: analysis.dispatchesBinned,
      densityMode,
      densityCacheHit: analysis.densityCacheHit,
      densityBins: visibleBins.length,
      staticLayerCacheHit: staticLayer.cacheHit,
      commandBuffersVisited: staticLayer.commandBuffersVisited,
      waitsVisited: staticLayer.waitsVisited,
      staticHitTargetsRebuilt: staticLayer.hitTargetsRebuilt,
      zeroOpHairlines: staticLayer.zeroOpHairlines,
      selectedCommandBufferIndex:
        this.selection.commandBuffer?.commandBufferIndex ?? null,
      drawOrder: Object.freeze(drawOrder),
    });
  }

  drawBackground() {
    const context = this.context;
    context.fillStyle = this.colors.canvas;
    context.fillRect(0, 0, this.width, TIMELINE_LANES.totalHeight);
    context.strokeStyle = this.colors.rule;
    context.lineWidth = 1;
    for (const lane of Object.values(TIMELINE_LANES)) {
      if (!lane || typeof lane !== "object" || !Number.isFinite(lane.y)) continue;
      context.beginPath();
      context.moveTo(0, lane.y + 0.5);
      context.lineTo(this.width, lane.y + 0.5);
      context.stroke();
    }
  }

  drawTimingGrid() {
    const context = this.context;
    const span = this.viewport.endNs - this.viewport.startNs;
    const step = niceStep(span, this.width / 100);
    const first = Math.ceil(this.viewport.startNs / step) * step;
    context.strokeStyle = this.colors.rule;
    context.fillStyle = this.colors.secondary;
    context.font = '10px "SFMono-Regular", ui-monospace, monospace';
    context.textBaseline = "top";
    context.lineWidth = 1;
    for (let tick = first, guard = 0;
      tick <= this.viewport.endNs && guard < 200;
      tick += step, guard += 1) {
      const x = Math.round(timeToX(tick, this.viewport, this.width)) + 0.5;
      context.globalAlpha = 0.65;
      context.beginPath();
      context.moveTo(x, TIMELINE_LANES.ruler.height);
      context.lineTo(x, TIMELINE_LANES.footer.y);
      context.stroke();
      context.globalAlpha = 1;
      context.fillText(formatTime(tick - this.bounds.startNs), x + 4, 7);
    }
  }

  drawBoundaries() {
    const context = this.context;
    const windows = Array.isArray(this.dataset?.launchWindows)
      ? this.dataset.launchWindows
      : [];
    context.lineWidth = 1;
    for (const window of windows) {
      for (const atNs of [window.startNs, window.endNs]) {
        if (
          !Number.isFinite(atNs) ||
          atNs < this.viewport.startNs ||
          atNs > this.viewport.endNs
        ) continue;
        const x = Math.round(timeToX(atNs, this.viewport, this.width)) + 0.5;
        context.strokeStyle = this.colors.secondary;
        context.setLineDash?.([2, 4]);
        context.beginPath();
        context.moveTo(x, TIMELINE_LANES.ruler.height);
        context.lineTo(x, TIMELINE_LANES.footer.y);
        context.stroke();
      }
    }
    context.setLineDash?.([]);
    const commandBuffers =
      this.staticVisibleCommandBuffers ?? this.commandBuffers;
    for (const commandBuffer of commandBuffers) {
      for (const atNs of [commandBuffer.gpuStartNs, commandBuffer.gpuEndNs]) {
        if (
          !Number.isFinite(atNs) ||
          atNs < this.viewport.startNs ||
          atNs > this.viewport.endNs
        ) continue;
        const x = Math.round(timeToX(atNs, this.viewport, this.width)) + 0.5;
        context.strokeStyle = this.colors.rule;
        context.beginPath();
        context.moveTo(x, TIMELINE_LANES.gpu.y);
        context.lineTo(x, TIMELINE_LANES.gpu.y + TIMELINE_LANES.gpu.height);
        context.stroke();
      }
    }
  }

  visibleWaits() {
    const first = lowerBound(this.sortedWaits, this.viewport.startNs, (item) => item.atNs);
    const after = upperBound(this.sortedWaits, this.viewport.endNs, (item) => item.atNs);
    return this.sortedWaits.slice(first, after);
  }

  drawWaitCurtains() {
    const context = this.context;
    const lane = TIMELINE_LANES.waits;
    const waits = this.staticVisibleWaits ?? this.visibleWaits();
    for (const wait of waits) {
      const x = timeToX(wait.atNs, this.viewport, this.width);
      const waitClass = wait.waitClass ?? "other";
      if (waitClass === "decision") {
        context.fillStyle = this.colors.decisionCap;
        context.globalAlpha = 0.09;
        context.fillRect(Math.max(0, x - 5), TIMELINE_LANES.ruler.height, 10,
          TIMELINE_LANES.footer.y - TIMELINE_LANES.ruler.height);
        context.globalAlpha = 1;
        context.strokeStyle = this.colors.decisionCap;
        context.lineWidth = 1;
        for (const offset of [-2, 2]) {
          context.beginPath();
          context.moveTo(Math.round(x + offset) + 0.5, TIMELINE_LANES.ruler.height);
          context.lineTo(Math.round(x + offset) + 0.5, TIMELINE_LANES.footer.y);
          context.stroke();
        }
      } else if (waitClass === "dependency") {
        context.strokeStyle = this.colors.dependency;
        context.setLineDash?.([4, 3]);
        context.beginPath();
        context.moveTo(x, lane.y);
        context.lineTo(x, lane.y + lane.height);
        context.stroke();
        context.setLineDash?.([]);
        const centerY = lane.y + lane.height / 2;
        context.fillStyle = this.colors.dependency;
        context.beginPath();
        context.moveTo(x, centerY - 6);
        context.lineTo(x + 6, centerY);
        context.lineTo(x, centerY + 6);
        context.lineTo(x - 6, centerY);
        context.closePath();
        context.fill();
      } else if (waitClass === "cap") {
        context.fillStyle = this.colors.decisionCap;
        context.beginPath();
        context.moveTo(x, lane.y + 7);
        context.lineTo(x + 7, lane.y + 20);
        context.lineTo(x - 7, lane.y + 20);
        context.closePath();
        context.fill();
      } else {
        context.strokeStyle = this.colors.secondary;
        context.beginPath();
        context.moveTo(x, lane.y + 7);
        context.lineTo(x, lane.y + lane.height - 7);
        context.stroke();
      }
      this.hitTargets.push({
        kind: "wait",
        item: wait,
        x: x - 7,
        y: lane.y,
        width: 14,
        height: lane.height,
      });
    }
  }

  visibleCommandBuffers() {
    return this.commandBuffers.filter((item) => {
      const range = commandBufferBounds(item);
      if (range &&
          range.endNs >= this.viewport.startNs &&
          range.startNs <= this.viewport.endNs) {
        return true;
      }
      const wait = this.waitsByCommandBuffer.get(item.commandBufferIndex);
      return Number.isFinite(wait?.atNs) &&
        wait.atNs >= this.viewport.startNs &&
        wait.atNs <= this.viewport.endNs;
    });
  }

  drawInterval(interval, lane, color, minimumWidth = 1) {
    if (!intervalIsValid(interval)) return null;
    const left = timeToX(interval[0], this.viewport, this.width);
    const right = timeToX(interval[1], this.viewport, this.width);
    const x = Math.max(0, Math.min(left, right));
    const end = Math.min(this.width, Math.max(left, right));
    if (end < 0 || x > this.width) return null;
    const width = Math.max(minimumWidth, end - x);
    this.context.fillStyle = color;
    this.context.fillRect(x, lane.y + 17, width, lane.height - 34);
    return { x, y: lane.y + 12, width, height: lane.height - 24 };
  }

  drawHatchedInterval(interval, lane) {
    if (!intervalIsValid(interval)) return null;
    const left = timeToX(interval[0], this.viewport, this.width);
    const right = timeToX(interval[1], this.viewport, this.width);
    const x = Math.max(0, Math.min(left, right));
    const end = Math.min(this.width, Math.max(left, right));
    if (end < 0 || x > this.width) return null;
    const width = Math.max(1, end - x);
    const y = lane.y + 17;
    const height = lane.height - 34;
    const context = this.context;
    context.save();
    context.beginPath();
    context.rect(x, y, width, height);
    context.clip();
    context.strokeStyle = this.colors.hiddenHost;
    context.lineWidth = 1.5;
    for (let stripe = x - height; stripe < x + width + height; stripe += 7) {
      context.beginPath();
      context.moveTo(stripe, y + height);
      context.lineTo(stripe + height, y);
      context.stroke();
    }
    context.restore();
    return { x, y: lane.y + 12, width, height: lane.height - 24 };
  }

  drawHost() {
    const lane = TIMELINE_LANES.host;
    let zeroOpHairlines = 0;
    const commandBuffers =
      this.staticVisibleCommandBuffers ?? this.visibleCommandBuffers();
    for (const commandBuffer of commandBuffers) {
      const targets = [];
      for (const interval of commandBuffer.exposedIntervals ?? []) {
        const target = this.drawInterval(interval, lane, this.colors.exposedHost);
        if (target) targets.push(target);
      }
      for (const interval of commandBuffer.hiddenIntervals ?? []) {
        const target = this.drawHatchedInterval(interval, lane);
        if (target) targets.push(target);
      }
      if (targets.length === 0 &&
          Number.isFinite(commandBuffer.encodeStartNs) &&
          Number.isFinite(commandBuffer.encodeEndNs)) {
        const target = this.drawInterval(
          [commandBuffer.encodeStartNs, commandBuffer.encodeEndNs],
          lane,
          this.colors.exposedHost,
        );
        if (target) targets.push(target);
      }
      if (
        (commandBuffer.opCount ?? 0) === 0 &&
        targets.length === 0
      ) {
        const ownedWait = this.waitsByCommandBuffer.get(
          commandBuffer.commandBufferIndex,
        );
        const anchor = [
          commandBuffer.gpuStartNs,
          commandBuffer.gpuEndNs,
          ownedWait?.atNs,
        ].find(Number.isFinite);
        if (Number.isFinite(anchor)) {
          const x = timeToX(anchor, this.viewport, this.width);
          this.context.strokeStyle = this.colors.exposedHost;
          this.context.beginPath();
          this.context.moveTo(Math.round(x) + 0.5, lane.y + 17);
          this.context.lineTo(Math.round(x) + 0.5, lane.y + lane.height - 17);
          this.context.stroke();
          targets.push({
            x: x - 2,
            y: lane.y + 12,
            width: 4,
            height: lane.height - 24,
          });
          zeroOpHairlines += 1;
        }
      }
      for (const target of targets) {
        this.hitTargets.push({ kind: "cb", item: commandBuffer, ...target });
      }
    }
    return zeroOpHairlines;
  }

  drawGpu() {
    const lane = TIMELINE_LANES.gpu;
    const commandBuffers =
      this.staticVisibleCommandBuffers ?? this.visibleCommandBuffers();
    for (const commandBuffer of commandBuffers) {
      if (
        !Number.isFinite(commandBuffer.gpuStartNs) ||
        !Number.isFinite(commandBuffer.gpuEndNs)
      ) continue;
      const target = this.drawInterval(
        [commandBuffer.gpuStartNs, commandBuffer.gpuEndNs],
        lane,
        this.colors.gpu,
      );
      if (target) {
        this.hitTargets.push({ kind: "cb", item: commandBuffer, ...target });
      }
    }
  }

  drawDispatches(densityMode, bins) {
    const context = this.context;
    const lane = TIMELINE_LANES.dispatch;
    if (densityMode) {
      let maximum = 1;
      for (const bin of bins) maximum = Math.max(maximum, bin.count);
      for (const bin of bins) {
        const height = Math.max(3, (bin.count / maximum) * (lane.height - 22));
        const x = bin.index;
        const y = lane.y + lane.height - 11 - height;
        context.fillStyle = this.colors.gpu;
        context.fillRect(x, y, 1, height);
        this.hitTargets.push({
          kind: "dispatch-bin",
          item: { ...bin, kind: "dispatch-bin" },
          x: x - 1,
          y,
          width: 3,
          height,
        });
      }
      return;
    }
    context.strokeStyle = this.colors.gpu;
    context.lineWidth = 1;
    for (const item of this.visibleDispatches) {
      const x = timeToX(item.atNs, this.viewport, this.width);
      context.beginPath();
      context.moveTo(Math.round(x) + 0.5, lane.y + 15);
      context.lineTo(Math.round(x) + 0.5, lane.y + lane.height - 12);
      context.stroke();
      this.hitTargets.push({
        kind: "op",
        item,
        x: x - 4,
        y: lane.y + 8,
        width: 8,
        height: lane.height - 14,
      });
    }
  }

  outlineInterval(interval, lane, padding = 3) {
    if (!intervalIsValid(interval)) return;
    const left = timeToX(interval[0], this.viewport, this.width);
    const right = timeToX(interval[1], this.viewport, this.width);
    const x = Math.min(left, right) - padding;
    const width = Math.max(1, Math.abs(right - left)) + padding * 2;
    this.context.strokeRect(
      x,
      lane.y + 12 - padding,
      width,
      lane.height - 24 + padding * 2,
    );
  }

  drawSelection() {
    const context = this.context;
    const commandBuffer = this.selection.commandBuffer;
    context.strokeStyle = this.colors.selection;
    context.lineWidth = 2;
    if (commandBuffer) {
      const hostIntervals = [
        ...(commandBuffer.exposedIntervals ?? []),
        ...(commandBuffer.hiddenIntervals ?? []),
      ];
      if (hostIntervals.length === 0 &&
          Number.isFinite(commandBuffer.encodeStartNs) &&
          Number.isFinite(commandBuffer.encodeEndNs)) {
        hostIntervals.push([commandBuffer.encodeStartNs, commandBuffer.encodeEndNs]);
      }
      for (const interval of hostIntervals) {
        this.outlineInterval(interval, TIMELINE_LANES.host);
      }
      if (
        Number.isFinite(commandBuffer.gpuStartNs) &&
        Number.isFinite(commandBuffer.gpuEndNs)
      ) {
        this.outlineInterval(
          [commandBuffer.gpuStartNs, commandBuffer.gpuEndNs],
          TIMELINE_LANES.gpu,
        );
      }
      const dispatches =
        this.dispatchesByCommandBuffer.get(commandBuffer.commandBufferIndex) ?? [];
      if (dispatches.length > 0) {
        this.outlineInterval(
          [dispatches[0].atNs, dispatches[dispatches.length - 1].atNs],
          TIMELINE_LANES.dispatch,
          4,
        );
      }
    }
    if (this.selection.dispatch && Number.isFinite(this.selection.dispatch.atNs)) {
      const x = timeToX(this.selection.dispatch.atNs, this.viewport, this.width);
      context.strokeRect(
        x - 4,
        TIMELINE_LANES.dispatch.y + 8,
        8,
        TIMELINE_LANES.dispatch.height - 14,
      );
    }
    if (this.selection.wait && Number.isFinite(this.selection.wait.atNs)) {
      const x = timeToX(this.selection.wait.atNs, this.viewport, this.width);
      context.strokeRect(
        x - 8,
        TIMELINE_LANES.waits.y + 3,
        16,
        TIMELINE_LANES.waits.height - 6,
      );
    }
    if (
      this.selection.bin &&
      Number.isFinite(this.selection.bin.startNs) &&
      Number.isFinite(this.selection.bin.endNs)
    ) {
      const left = timeToX(
        this.selection.bin.startNs,
        this.viewport,
        this.width,
      );
      const right = timeToX(
        this.selection.bin.endNs,
        this.viewport,
        this.width,
      );
      const width = Math.max(5, Math.abs(right - left) + 4);
      context.strokeRect(
        Math.min(left, right) - 2,
        TIMELINE_LANES.dispatch.y + 6,
        width,
        TIMELINE_LANES.dispatch.height - 12,
      );
    }
  }

  drawCrosshair() {
    if (!Number.isFinite(this.crosshairX)) return;
    const x = Math.max(0, Math.min(this.width, this.crosshairX));
    this.context.strokeStyle = this.colors.selection;
    this.context.globalAlpha = 0.7;
    this.context.lineWidth = 1;
    this.context.beginPath();
    this.context.moveTo(Math.round(x) + 0.5, 0);
    this.context.lineTo(Math.round(x) + 0.5, TIMELINE_LANES.totalHeight);
    this.context.stroke();
    this.context.globalAlpha = 1;
  }

  drawLabels(densityMode) {
    const context = this.context;
    context.font = '10px "SFMono-Regular", ui-monospace, monospace';
    context.textBaseline = "middle";
    context.fillStyle = this.colors.secondary;
    if (!this.hasSelection()) {
      for (const [name, label] of [
        ["host", "HOST"],
        ["gpu", "GPU"],
        ["waits", "WAITS"],
        ["dispatch", densityMode ? "DISPATCH DENSITY" : "DISPATCH"],
      ]) {
        const lane = TIMELINE_LANES[name];
        context.fillText(label, 7, lane.y + 9);
      }
    }
    context.textAlign = "right";
    const scale = formatTime(this.viewport.endNs - this.viewport.startNs);
    context.fillText(
      "ordered placement · " +
        `${this.visibleDispatches.length.toLocaleString()}/` +
        `${this.placedDispatches.length.toLocaleString()} visible/placed · ` +
        `scale ${scale}`,
      this.width - 7,
      TIMELINE_LANES.footer.y + TIMELINE_LANES.footer.height / 2,
      Math.max(1, this.width - 14),
    );
    context.textAlign = "start";
  }

  pointForEvent(event) {
    const rect = this.canvas.getBoundingClientRect?.() ?? { left: 0, top: 0 };
    return {
      x: finite(event.clientX, rect.left) - finite(rect.left),
      y:
        (finite(event.clientY, rect.top) - finite(rect.top)) /
        Math.max(Number.EPSILON, finite(this.laneScaleY, 1)),
    };
  }

  hitTest(x, y) {
    for (let index = this.hitTargets.length - 1; index >= 0; index -= 1) {
      const target = this.hitTargets[index];
      if (
        x >= target.x &&
        x <= target.x + target.width &&
        y >= target.y &&
        y <= target.y + target.height
      ) return target.item;
    }
    return null;
  }

  handlePointerMove(event) {
    if (this.destroyed) return;
    this.keyboardActive = null;
    this.keyboardActiveIndex = -1;
    const point = this.pointForEvent(event);
    this.crosshairX = point.x;
    if (this.drag) {
      const dx = point.x - this.drag.x;
      if (Math.abs(dx) > 2) this.drag.moved = true;
      const span = this.drag.viewport.endNs - this.drag.viewport.startNs;
      const shift = -(dx / Math.max(1, this.width)) * span;
      this.setViewport(
        {
          startNs: this.drag.viewport.startNs + shift,
          endNs: this.drag.viewport.endNs + shift,
        },
        { committed: false, source: "pointer-pan" },
      );
      return;
    }
    this.hovered = this.hitTest(point.x, point.y);
    if (this.hovered && !this.hasSelection()) {
      this.showTooltip(buildInspectPayload(this.hovered), event);
    } else if (!this.selection.dispatch &&
               !this.selection.commandBuffer &&
               !this.selection.wait &&
               !this.selection.bin) {
      this.hideTooltip();
    }
    this.requestRender();
  }

  handlePointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    const point = this.pointForEvent(event);
    this.drag = {
      pointerId: event.pointerId,
      x: point.x,
      viewport: { ...this.viewport },
      moved: false,
    };
    this.canvas.setPointerCapture?.(event.pointerId);
    this.canvas.focus?.({ preventScroll: true });
  }

  handlePointerUp(event) {
    if (!this.drag || this.drag.pointerId !== event.pointerId) return;
    const wasMoved = this.drag.moved;
    const viewportChanged =
      this.viewport.startNs !== this.drag.viewport.startNs ||
      this.viewport.endNs !== this.drag.viewport.endNs;
    this.canvas.releasePointerCapture?.(event.pointerId);
    this.drag = null;
    if (wasMoved || viewportChanged) {
      this.notifyViewportChange({
        committed: true,
        source: "pointer-pan",
      });
    }
    if (!wasMoved) {
      const point = this.pointForEvent(event);
      const item = this.hitTest(point.x, point.y);
      if (item) {
        this.selectItem(item);
        this.showTooltip(buildInspectPayload(item), event);
      }
    }
    this.requestRender();
  }

  handlePointerCancel(event) {
    if (this.drag?.pointerId === event.pointerId) {
      const originalViewport = this.drag.viewport;
      this.canvas.releasePointerCapture?.(event.pointerId);
      this.drag = null;
      this.setViewport(originalViewport, {
        committed: false,
        source: "pointer-pan",
      });
    }
  }

  handlePointerLeave() {
    if (this.drag) return;
    this.crosshairX = null;
    this.hovered = null;
    if (!this.hasSelection()) this.hideTooltip();
    this.requestRender();
  }

  handleWheel(event) {
    event.preventDefault?.();
    const point = this.pointForEvent(event);
    const anchor = xToTime(point.x, this.viewport, this.width);
    const oldSpan = this.viewport.endNs - this.viewport.startNs;
    const factor = event.deltaY < 0 ? 0.8 : event.deltaY > 0 ? 1.25 : 1;
    const nextSpan = oldSpan * factor;
    const fraction = Math.max(0, Math.min(1, point.x / Math.max(1, this.width)));
    this.setViewport(
      {
        startNs: anchor - nextSpan * fraction,
        endNs: anchor + nextSpan * (1 - fraction),
      },
      { committed: true, source: "wheel" },
    );
  }

  handleKeyDown(event) {
    let handled = true;
    const span = this.viewport.endNs - this.viewport.startNs;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      const shift = direction * span * 0.1;
      this.setViewport(
        {
          startNs: this.viewport.startNs + shift,
          endNs: this.viewport.endNs + shift,
        },
        { committed: true, source: "keyboard" },
      );
    } else if (event.key === "+" || event.key === "=" || event.key === "-") {
      const factor = event.key === "-" ? 1.25 : 0.8;
      const center = (this.viewport.startNs + this.viewport.endNs) / 2;
      const nextSpan = span * factor;
      this.setViewport(
        { startNs: center - nextSpan / 2, endNs: center + nextSpan / 2 },
        { committed: true, source: "keyboard" },
      );
    } else if (event.key === "0") {
      this.fit(this.selectedWindow, true, {
        committed: true,
        source: "keyboard",
      });
    } else if (event.key === "]" || event.key === "}") {
      this.moveKeyboardActive(1);
    } else if (event.key === "[" || event.key === "{") {
      this.moveKeyboardActive(-1);
    } else if (event.key === "Enter") {
      const active = this.keyboardActive ?? this.hovered;
      if (active) this.selectItem(active);
    } else if (event.key === "Escape") {
      this.clearSelection();
    } else {
      handled = false;
    }
    if (handled) {
      event.preventDefault?.();
      this.requestRender();
    }
  }

  moveKeyboardActive(direction) {
    if (this.keyboardMarks.length === 0) return null;
    const step = direction < 0 ? -1 : 1;
    if (
      this.keyboardActiveIndex < 0 ||
      this.keyboardActiveIndex >= this.keyboardMarks.length
    ) {
      this.keyboardActiveIndex = step > 0 ? 0 : this.keyboardMarks.length - 1;
    } else {
      this.keyboardActiveIndex =
        (this.keyboardActiveIndex + step + this.keyboardMarks.length) %
        this.keyboardMarks.length;
    }
    const item = this.keyboardMarks[this.keyboardActiveIndex];
    this.keyboardActive = item;
    this.hovered = item;
    const atNs = timeOf(item);
    if (atNs !== null) {
      const span = this.viewport.endNs - this.viewport.startNs;
      if (atNs < this.viewport.startNs || atNs > this.viewport.endNs) {
        this.setViewport(
          {
            startNs: atNs - span / 2,
            endNs: atNs + span / 2,
          },
          { committed: true, source: "keyboard" },
        );
      }
      this.crosshairX = timeToX(atNs, this.viewport, this.width);
    }
    this.updateAccessibleSummary();
    return item;
  }

  hasSelection() {
    return Boolean(
      this.selection.dispatch ||
      this.selection.commandBuffer ||
      this.selection.wait ||
      this.selection.bin,
    );
  }

  selectDispatch(item) {
    const commandBuffer = Number.isFinite(item?.commandBufferIndex)
      ? this.commandBufferByIndex.get(item.commandBufferIndex) ?? null
      : null;
    this.selection = {
      dispatch: item ?? null,
      commandBuffer,
      wait: null,
      bin: null,
    };
    this.requestRender();
    return this.selection;
  }

  selectCommandBuffer(item) {
    this.selection = {
      dispatch: null,
      commandBuffer: item ?? null,
      wait: null,
      bin: null,
    };
    this.requestRender();
    return this.selection;
  }

  selectItem(item) {
    const kind = item?.kind ?? item?.type;
    if (kind === "op" || kind === "dispatch") {
      this.selectDispatch(item);
    } else if (kind === "cb") {
      this.selectCommandBuffer(item);
    } else if (kind === "wait") {
      const commandBuffer = Number.isFinite(item.commandBufferIndex)
        ? this.commandBufferByIndex.get(item.commandBufferIndex) ?? null
        : null;
      this.selection = { dispatch: null, commandBuffer, wait: item, bin: null };
    } else if (kind === "dispatch-bin") {
      const commandBuffer = Number.isFinite(item.commandBufferIndex)
        ? this.commandBufferByIndex.get(item.commandBufferIndex) ?? null
        : null;
      this.selection = {
        dispatch: null,
        commandBuffer,
        wait: null,
        bin: item,
      };
    }
    this.inspect(item);
    this.requestRender();
    return this.selection;
  }

  clearSelection() {
    this.selection = { dispatch: null, commandBuffer: null, wait: null, bin: null };
    this.hideTooltip();
    this.onInspect(null);
    this.requestRender();
  }

  inspect(item) {
    const payload = buildInspectPayload(item);
    if (payload) this.onInspect(payload);
    return payload;
  }

  showTooltip(payload, event) {
    if (!this.tooltip || !payload) return;
    this.tooltip.textContent = payload.text;
    this.tooltip.style.display = "block";
    const rect = this.canvas.getBoundingClientRect?.() ?? {
      left: 0,
      top: 0,
      width: this.width,
      height: this.height,
    };
    const viewportWidth = finite(this.window?.innerWidth, rect.left + rect.width);
    const viewportHeight = finite(this.window?.innerHeight, rect.top + rect.height);
    const tooltipWidth = finite(this.tooltip.offsetWidth, 260);
    const tooltipHeight = finite(this.tooltip.offsetHeight, 100);
    let left = finite(event?.clientX, rect.left) + 12;
    let top = finite(event?.clientY, rect.top) + 12;
    left = Math.max(4, Math.min(left, viewportWidth - tooltipWidth - 4));
    top = Math.max(4, Math.min(top, viewportHeight - tooltipHeight - 4));
    this.tooltip.style.left = `${left}px`;
    this.tooltip.style.top = `${top}px`;
  }

  hideTooltip() {
    if (this.tooltip) this.tooltip.style.display = "none";
  }

  updateAccessibleSummary() {
    const total = this.placedDispatches.length + this.unplacedDispatches.length;
    const active = this.keyboardActive
      ? ` Active mark ${this.keyboardActiveIndex + 1} of ${this.keyboardMarks.length}.`
      : "";
    const description =
      `Metal dispatch timeline with ${total.toLocaleString()} operations: ` +
      `${this.placedDispatches.length.toLocaleString()} ordered placements and ` +
      `${this.unplacedDispatches.length.toLocaleString()} unplaced. ` +
      "Use the arrow keys to pan, plus and minus to zoom, zero to fit, " +
      "left and right brackets to move between marks, Enter to pin the " +
      `active mark, and Escape to clear selection.${active}`;
    this.canvas.setAttribute?.("aria-description", description);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const { target, type, listener, options } of this.listeners) {
      target.removeEventListener?.(type, listener, options);
    }
    this.listeners = [];
    this.resizeObserver?.disconnect?.();
    this.resizeObserver = null;
    if (this.framePending && this.frameId !== null) {
      if (this.window?.cancelAnimationFrame) {
        this.window.cancelAnimationFrame(this.frameId);
      } else {
        globalThis.clearTimeout(this.frameId);
      }
    }
    this.framePending = false;
    this.frameId = null;
    this.tooltip?.remove?.();
    this.tooltip = null;
    this.hitTargets = [];
    this.hovered = null;
    this.drag = null;
    this.analysisCache = null;
    this.staticLayerCache = null;
    this.staticLayerContext = null;
    this.staticLayerCanvas = null;
    this.staticVisibleCommandBuffers = null;
    this.staticVisibleWaits = null;
    this.canvas.tabIndex = -1;
    this.canvas.setAttribute?.("tabindex", "-1");
    this.canvas.setAttribute?.("aria-disabled", "true");
  }
}
