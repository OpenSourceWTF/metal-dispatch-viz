function positiveSpan(range, label) {
  if (
    range === null ||
    typeof range !== "object" ||
    !Number.isFinite(range.startNs) ||
    !Number.isFinite(range.endNs)
  ) {
    throw new TypeError(`${label} bounds must be finite.`);
  }
  const span = range.endNs - range.startNs;
  if (!Number.isFinite(span) || span <= 0) {
    throw new RangeError(`${label} must have positive finite duration.`);
  }
  return span;
}

function normalizedMinimumSpan(boundSpan, minimumSpanNs) {
  const requested =
    Number.isFinite(minimumSpanNs) && minimumSpanNs > 0
      ? minimumSpanNs
      : 1;
  return Math.min(boundSpan, Math.max(1, requested));
}

function sameRange(left, right) {
  return left?.startNs === right?.startNs && left?.endNs === right?.endNs;
}

export function clampSelectedRange(range, bounds, minimumSpanNs = 1) {
  const boundSpan = positiveSpan(bounds, "Launch");
  const rangeSpan = positiveSpan(range, "Selected range");
  const minimumSpan = normalizedMinimumSpan(boundSpan, minimumSpanNs);
  const requestedSpan = Math.max(
    minimumSpan,
    Math.min(boundSpan, rangeSpan),
  );
  let startNs = range.startNs;
  let endNs = startNs + requestedSpan;
  if (startNs < bounds.startNs) {
    startNs = bounds.startNs;
    endNs = startNs + requestedSpan;
  }
  if (endNs > bounds.endNs) {
    endNs = bounds.endNs;
    startNs = endNs - requestedSpan;
  }
  return Object.freeze({ startNs, endNs });
}

/**
 * Move a selected range by a time delta while preserving its duration.
 */
export function moveSelectedRange(range, deltaNs, bounds) {
  positiveSpan(range, "Selected range");
  positiveSpan(bounds, "Launch");
  if (!Number.isFinite(deltaNs)) {
    throw new TypeError("Range movement must be finite.");
  }
  const startNs = range.startNs + deltaNs;
  const endNs = range.endNs + deltaNs;
  if (!Number.isFinite(startNs) || !Number.isFinite(endNs)) {
    throw new RangeError("Range movement exceeds the finite numeric range.");
  }
  return clampSelectedRange({
    startNs,
    endNs,
  }, bounds);
}

export function resizeSelectedRange(
  range,
  edge,
  atNs,
  bounds,
  minimumSpanNs = 1,
) {
  const boundSpan = positiveSpan(bounds, "Launch");
  positiveSpan(range, "Selected range");
  if (edge !== "start" && edge !== "end") {
    throw new RangeError('Range edge must be either "start" or "end".');
  }
  if (!Number.isFinite(atNs)) {
    throw new TypeError("Range edge position must be finite.");
  }
  const minimumSpan = normalizedMinimumSpan(boundSpan, minimumSpanNs);
  const normalizedRange = clampSelectedRange(range, bounds, minimumSpan);
  return edge === "start"
    ? Object.freeze({
        startNs: Math.max(
          bounds.startNs,
          Math.min(atNs, normalizedRange.endNs - minimumSpan),
        ),
        endNs: normalizedRange.endNs,
      })
    : Object.freeze({
        startNs: normalizedRange.startNs,
        endNs: Math.min(
          bounds.endNs,
          Math.max(atNs, normalizedRange.startNs + minimumSpan),
        ),
      });
}

export function sliderStepNs(bounds, large) {
  return positiveSpan(bounds, "Launch") * (large ? 0.1 : 0.01);
}

const FALLBACK_COLORS = Object.freeze({
  canvas: "#071116",
  rule: "#213942",
  host: "#ff756d",
  gpu: "#48d7ff",
  dispatch: "#edf7f8",
  wait: "#ffc857",
  dependency: "#b49cff",
  secondary: "#91aab2",
});

function resolvedPalette(windowObject, element) {
  const styles = windowObject?.getComputedStyle?.(element);
  const color = (property, fallback) => {
    const value = styles?.getPropertyValue?.(property)?.trim?.();
    return value || fallback;
  };
  return Object.freeze({
    canvas: color("--canvas", FALLBACK_COLORS.canvas),
    rule: color("--rule", FALLBACK_COLORS.rule),
    host: color("--exposed-host", FALLBACK_COLORS.host),
    gpu: color("--gpu", FALLBACK_COLORS.gpu),
    dispatch: color("--text", FALLBACK_COLORS.dispatch),
    wait: color("--decision-cap", FALLBACK_COLORS.wait),
    dependency: color("--dependency", FALLBACK_COLORS.dependency),
    secondary: color("--secondary", FALLBACK_COLORS.secondary),
  });
}

function formatTimeNs(value) {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) < 1_000) return `${Math.round(value * 100) / 100} ns`;
  if (Math.abs(value) < 1_000_000) {
    return `${Math.round((value / 1_000) * 100) / 100} µs`;
  }
  if (Math.abs(value) < 1_000_000_000) {
    return `${Math.round((value / 1_000_000) * 100) / 100} ms`;
  }
  return `${Math.round((value / 1_000_000_000) * 100) / 100} s`;
}

function percent(value, bounds) {
  return ((value - bounds.startNs) / (bounds.endNs - bounds.startNs)) * 100;
}

function finiteRange(range) {
  return (
    range !== null &&
    typeof range === "object" &&
    Number.isFinite(range.startNs) &&
    Number.isFinite(range.endNs) &&
    range.endNs > range.startNs
  );
}

function overviewBounds(overview) {
  if (!finiteRange(overview)) {
    throw new TypeError("Overview bounds must have positive finite duration.");
  }
  return Object.freeze({
    startNs: overview.startNs,
    endNs: overview.endNs,
  });
}

function visibleElementWidth(element) {
  const width = element?.getBoundingClientRect?.().width;
  return Number.isFinite(width) && width > 0 ? width : null;
}

function timeAtClientX(clientX, canvas, bounds) {
  const rect = canvas.getBoundingClientRect();
  const width = Number.isFinite(rect.width) && rect.width > 0 ? rect.width : 1;
  const x = Math.min(width, Math.max(0, clientX - rect.left));
  return bounds.startNs +
    (x / width) * (bounds.endNs - bounds.startNs);
}

export class RangeNavigator {
  constructor(
    { canvas, band, startHandle, endHandle, summary, windowObject },
    { onRangeInput, onRangeCommit } = {},
  ) {
    if (!canvas || !band || !startHandle || !endHandle || !summary) {
      throw new TypeError("RangeNavigator requires its canvas and range controls.");
    }
    this.canvas = canvas;
    this.band = band;
    this.startHandle = startHandle;
    this.endHandle = endHandle;
    this.summary = summary;
    this.window =
      windowObject ??
      canvas.ownerDocument?.defaultView ??
      globalThis.window;
    if (!this.window) {
      throw new TypeError("RangeNavigator requires a window object.");
    }
    this.context = canvas.getContext("2d");
    this.onRangeInput =
      typeof onRangeInput === "function" ? onRangeInput : () => {};
    this.onRangeCommit =
      typeof onRangeCommit === "function" ? onRangeCommit : () => {};
    this.overview = null;
    this.bounds = null;
    this.range = null;
    this.rangeRevision = 0;
    this.drag = null;
    this.disabled = false;
    this.destroyed = false;
    this.animationFrame = null;
    this.listeners = [];
    this.resolutionMediaQuery = null;
    this.resolutionListener = null;
    this.resolutionListenerKind = null;
    this.resolutionDpr = null;

    this.listen(this.canvas, "pointerdown", (event) =>
      this.handleOverviewPointerDown(event));
    this.listen(this.band, "pointerdown", (event) =>
      this.beginDrag("band", this.band, event));
    this.listen(this.startHandle, "pointerdown", (event) =>
      this.beginDrag("start", this.startHandle, event));
    this.listen(this.endHandle, "pointerdown", (event) =>
      this.beginDrag("end", this.endHandle, event));
    this.listen(this.startHandle, "keydown", (event) =>
      this.handleKey("start", event));
    this.listen(this.endHandle, "keydown", (event) =>
      this.handleKey("end", event));
    this.listen(this.window, "pointermove", (event) =>
      this.handlePointerMove(event));
    this.listen(this.window, "pointerup", (event) =>
      this.finishDrag(event));
    this.listen(this.window, "pointercancel", (event) =>
      this.cancelDrag(event));
    this.listen(this.window, "resize", () => {
      this.handleResize();
      if (this.resolutionDpr !== this.currentDevicePixelRatio()) {
        this.armResolutionObservation();
      }
    });
    for (const target of [this.band, this.startHandle, this.endHandle]) {
      this.listen(target, "lostpointercapture", (event) =>
        this.cancelDrag(event, { captureLost: true }));
    }

    this.resizeObserver = this.window.ResizeObserver
      ? new this.window.ResizeObserver(() => this.handleResize())
      : null;
    this.resizeObserver?.observe(this.canvas);
    this.armResolutionObservation();
    this.setDisabled(false);
  }

  listen(target, type, listener, options) {
    target.addEventListener(type, listener, options);
    this.listeners.push({ target, type, listener, options });
  }

  minimumSpanNs() {
    if (!this.bounds) return 1;
    return this.layoutMinimumSpanNs() ??
      normalizedMinimumSpan(positiveSpan(this.bounds, "Launch"), 1);
  }

  layoutMinimumSpanNs() {
    if (!this.bounds) return null;
    const width = visibleElementWidth(this.canvas);
    if (width === null) return null;
    const boundSpan = positiveSpan(this.bounds, "Launch");
    const requested = boundSpan / width;
    return Number.isFinite(requested)
      ? normalizedMinimumSpan(boundSpan, requested)
      : boundSpan;
  }

  setOverview(overview) {
    const bounds = overviewBounds(overview);
    const launchChanged = this.overview !== overview;
    if (this.drag) {
      this.abandonDrag(this.drag, { restore: false, release: true });
    }
    this.overview = overview;
    this.bounds = bounds;
    const bins = Array.isArray(overview.bins) ? overview.bins : [];
    const dispatches = bins.reduce(
      (total, bin) => total + (Number.isFinite(bin.dispatchCount) ? bin.dispatchCount : 0),
      0,
    );
    const waits = bins.reduce(
      (total, bin) => total + (Number.isFinite(bin.waitCount) ? bin.waitCount : 0),
      0,
    );
    const description =
      `Navigation summary for ${formatTimeNs(bounds.endNs - bounds.startNs)}: ` +
      `${bins.length} overview bins, ${dispatches} dispatches, ${waits} waits.`;
    this.summary.textContent = description;
    this.canvas.setAttribute("aria-label", description);
    const nextRange = clampSelectedRange(
      launchChanged ? bounds : this.range ?? bounds,
      bounds,
      this.minimumSpanNs(),
    );
    if (!sameRange(this.range, nextRange)) this.rangeRevision += 1;
    this.range = nextRange;
    this.updateControls();
    this.requestRender();
    return this;
  }

  applyRange(range) {
    if (!this.bounds) {
      throw new Error("Set an overview before setting the selected range.");
    }
    if (!finiteRange(range)) {
      throw new TypeError("Selected range must have positive finite duration.");
    }
    const nextRange = clampSelectedRange(
      range,
      this.bounds,
      this.minimumSpanNs(),
    );
    const changed = !sameRange(this.range, nextRange);
    if (changed) {
      this.range = nextRange;
      this.rangeRevision += 1;
      this.updateControls();
    }
    return Object.freeze({
      changed,
      range: Object.freeze({ ...this.range }),
      revision: this.rangeRevision,
    });
  }

  setRange(range, { emit = false } = {}) {
    const update = this.applyRange(range);
    if (this.drag && update.changed) {
      this.abandonDrag(this.drag, { restore: false, release: true });
    }
    if (emit && update.changed) this.onRangeInput(update.range);
    return update.range;
  }

  handleResize() {
    if (this.destroyed) return;
    const drag = this.drag;
    const finalizeDrag = drag?.hadTransientChange === true;
    if (drag) {
      this.abandonDrag(drag, { restore: false, release: true });
    }
    const minimumSpanNs = this.layoutMinimumSpanNs();
    let update = null;
    if (minimumSpanNs !== null && this.range) {
      const nextRange = clampSelectedRange(
        this.range,
        this.bounds,
        minimumSpanNs,
      );
      update = this.applyRange(nextRange);
      if (!update.changed) {
        this.updateControls();
      } else {
        const disabled = this.disabled;
        this.onRangeInput(update.range);
        if (
          !this.destroyed &&
          this.rangeRevision === update.revision &&
          this.disabled === disabled
        ) {
          this.onRangeCommit(update.range);
        }
        this.requestRender();
        return;
      }
    }
    if (finalizeDrag && this.range) {
      this.onRangeCommit(Object.freeze({ ...this.range }));
    }
    this.requestRender();
  }

  setDisabled(disabled) {
    const nextDisabled = Boolean(disabled);
    this.disabled = nextDisabled;
    for (const handle of [this.startHandle, this.endHandle]) {
      handle.setAttribute("aria-disabled", String(nextDisabled));
      handle.setAttribute("tabindex", nextDisabled ? "-1" : "0");
    }
    this.band.setAttribute("aria-disabled", String(nextDisabled));
    if (nextDisabled && this.drag) {
      this.abandonDrag(this.drag, { restore: false, release: true });
    }
    return this;
  }

  updateControls() {
    if (!this.bounds || !this.range) return;
    const minimumSpanNs = this.minimumSpanNs();
    const startPercent = percent(this.range.startNs, this.bounds);
    const endPercent = percent(this.range.endNs, this.bounds);
    this.band.style.left = `${startPercent}%`;
    this.band.style.width = `${endPercent - startPercent}%`;
    this.startHandle.style.left = "0%";
    this.endHandle.style.left = "100%";

    const attributes = [
      [
        this.startHandle,
        "Range start",
        this.range.startNs,
        this.bounds.startNs,
        this.range.endNs - minimumSpanNs,
      ],
      [
        this.endHandle,
        "Range end",
        this.range.endNs,
        this.range.startNs + minimumSpanNs,
        this.bounds.endNs,
      ],
    ];
    for (const [handle, label, value, minimum, maximum] of attributes) {
      handle.setAttribute("role", "slider");
      handle.setAttribute("aria-label", label);
      handle.setAttribute("aria-orientation", "horizontal");
      handle.setAttribute("aria-valuemin", minimum);
      handle.setAttribute("aria-valuemax", maximum);
      handle.setAttribute("aria-valuenow", value);
      handle.setAttribute(
        "aria-valuetext",
        `${formatTimeNs(value - this.bounds.startNs)} from launch start`,
      );
    }
  }

  beginDrag(type, target, event) {
    if (
      this.disabled ||
      this.drag ||
      !this.bounds ||
      !this.range ||
      event.button !== 0 ||
      !Number.isFinite(event.clientX)
    ) {
      return;
    }
    event.preventDefault();
    if (type !== "band") event.stopPropagation?.();
    target.setPointerCapture?.(event.pointerId);
    if (type === "band") target.classList?.add?.("is-dragging");
    this.drag = {
      type,
      target,
      pointerId: event.pointerId,
      clientX: event.clientX,
      range: Object.freeze({ ...this.range }),
      hadTransientChange: false,
    };
  }

  rangeForPointer(drag, clientX) {
    const width = visibleElementWidth(this.canvas);
    if (width === null) return drag.range;
    const deltaNs =
      ((clientX - drag.clientX) / width) *
      (this.bounds.endNs - this.bounds.startNs);
    if (drag.type === "band") {
      return moveSelectedRange(drag.range, deltaNs, this.bounds);
    }
    const originalEdgeNs =
      drag.type === "start" ? drag.range.startNs : drag.range.endNs;
    return resizeSelectedRange(
      drag.range,
      drag.type,
      originalEdgeNs + deltaNs,
      this.bounds,
      this.minimumSpanNs(),
    );
  }

  emitDragInput(drag, update) {
    drag.hadTransientChange = true;
    this.onRangeInput(update.range);
    if (
      this.destroyed ||
      this.drag !== drag
    ) {
      return false;
    }
    if (this.disabled || this.rangeRevision !== update.revision) {
      this.abandonDrag(drag, { restore: false, release: true });
      return false;
    }
    return true;
  }

  handlePointerMove(event) {
    const drag = this.drag;
    if (
      !drag ||
      event.pointerId !== drag.pointerId ||
      !Number.isFinite(event.clientX)
    ) {
      return;
    }
    event.preventDefault();
    const update = this.applyRange(this.rangeForPointer(drag, event.clientX));
    if (update.changed) this.emitDragInput(drag, update);
  }

  finishPointerCapture(drag, { release }) {
    if (drag.type === "band") drag.target.classList?.remove?.("is-dragging");
    if (!release) return;
    try {
      drag.target.releasePointerCapture?.(drag.pointerId);
    } catch {
      // Browsers may release capture before pointerup reaches the window.
    }
  }

  abandonDrag(
    drag,
    { restore = false, release = true, notifyInput = false } = {},
  ) {
    if (this.drag !== drag) return;
    this.drag = null;
    const update = restore ? this.applyRange(drag.range) : null;
    this.finishPointerCapture(drag, { release });
    if (notifyInput && update?.changed) this.onRangeInput(update.range);
  }

  finishDrag(event) {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (Number.isFinite(event.clientX)) {
      const update = this.applyRange(this.rangeForPointer(drag, event.clientX));
      if (update.changed && !this.emitDragInput(drag, update)) return;
    }
    if (this.destroyed || this.disabled || this.drag !== drag) return;
    const result = Object.freeze({ ...this.range });
    const shouldCommit = drag.hadTransientChange;
    this.drag = null;
    this.finishPointerCapture(drag, { release: true });
    if (shouldCommit) this.onRangeCommit(result);
  }

  cancelDrag(event, { captureLost = false } = {}) {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    this.abandonDrag(drag, {
      restore: true,
      release: !captureLost,
      notifyInput: true,
    });
  }

  handleOverviewPointerDown(event) {
    if (
      this.disabled ||
      !this.bounds ||
      !this.range ||
      event.button !== 0 ||
      !Number.isFinite(event.clientX)
    ) {
      return;
    }
    const atNs = timeAtClientX(event.clientX, this.canvas, this.bounds);
    if (atNs >= this.range.startNs && atNs <= this.range.endNs) return;
    event.preventDefault();
    const centerNs =
      this.range.startNs + (this.range.endNs - this.range.startNs) / 2;
    const update = this.applyRange(
      moveSelectedRange(this.range, atNs - centerNs, this.bounds),
    );
    if (!update.changed) return;
    const disabled = this.disabled;
    this.onRangeInput(update.range);
    if (
      !this.destroyed &&
      this.rangeRevision === update.revision &&
      this.disabled === disabled
    ) {
      this.onRangeCommit(update.range);
    }
  }

  handleKey(edge, event) {
    if (this.disabled || !this.bounds || !this.range) return;
    let atNs;
    if (event.key === "Home") {
      atNs = this.bounds.startNs;
    } else if (event.key === "End") {
      atNs = this.bounds.endNs;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      const current = edge === "start" ? this.range.startNs : this.range.endNs;
      atNs = current + direction * sliderStepNs(this.bounds, event.shiftKey);
    } else {
      return;
    }
    event.preventDefault();
    const update = this.applyRange(
      resizeSelectedRange(
        this.range,
        edge,
        atNs,
        this.bounds,
        this.minimumSpanNs(),
      ),
    );
    if (update.changed) this.onRangeCommit(update.range);
  }

  currentDevicePixelRatio() {
    return Number.isFinite(this.window.devicePixelRatio) &&
        this.window.devicePixelRatio > 0
      ? this.window.devicePixelRatio
      : 1;
  }

  clearResolutionObservation() {
    if (!this.resolutionMediaQuery || !this.resolutionListener) return;
    if (this.resolutionListenerKind === "event") {
      this.resolutionMediaQuery.removeEventListener?.(
        "change",
        this.resolutionListener,
      );
    } else {
      this.resolutionMediaQuery.removeListener?.(this.resolutionListener);
    }
    this.resolutionMediaQuery = null;
    this.resolutionListener = null;
    this.resolutionListenerKind = null;
  }

  armResolutionObservation() {
    this.clearResolutionObservation();
    if (this.destroyed || typeof this.window.matchMedia !== "function") {
      this.resolutionDpr = null;
      return;
    }
    const dpr = this.currentDevicePixelRatio();
    let mediaQuery;
    try {
      mediaQuery = this.window.matchMedia(`(resolution: ${dpr}dppx)`);
    } catch {
      this.resolutionDpr = null;
      return;
    }
    if (!mediaQuery) {
      this.resolutionDpr = null;
      return;
    }
    const listener = () => {
      if (this.destroyed) return;
      this.clearResolutionObservation();
      this.handleResize();
      this.armResolutionObservation();
    };
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", listener);
      this.resolutionListenerKind = "event";
    } else if (typeof mediaQuery.addListener === "function") {
      mediaQuery.addListener(listener);
      this.resolutionListenerKind = "legacy";
    } else {
      this.resolutionDpr = null;
      return;
    }
    this.resolutionMediaQuery = mediaQuery;
    this.resolutionListener = listener;
    this.resolutionDpr = dpr;
  }

  requestRender() {
    if (this.destroyed || this.animationFrame !== null) return;
    this.animationFrame = this.window.requestAnimationFrame(() => {
      this.animationFrame = null;
      this.render();
    });
  }

  render() {
    if (!this.overview || !this.bounds || !this.context) return;
    const rect = this.canvas.getBoundingClientRect();
    const width = Number.isFinite(rect.width) && rect.width > 0 ? rect.width : 1;
    const height = Number.isFinite(rect.height) && rect.height > 0 ? rect.height : 58;
    const dpr = Number.isFinite(this.window.devicePixelRatio)
      ? Math.max(1, this.window.devicePixelRatio)
      : 1;
    const backingWidth = Math.max(1, Math.round(width * dpr));
    const backingHeight = Math.max(1, Math.round(height * dpr));
    if (this.canvas.width !== backingWidth) this.canvas.width = backingWidth;
    if (this.canvas.height !== backingHeight) this.canvas.height = backingHeight;

    const context = this.context;
    const palette = resolvedPalette(this.window, this.canvas);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = palette.canvas;
    context.fillRect(0, 0, width, height);

    const bins = Array.isArray(this.overview.bins) ? this.overview.bins : [];
    const binWidth = bins.length > 0 ? width / bins.length : width;
    let maxDispatches = 1;
    for (const bin of bins) {
      maxDispatches = Math.max(
        maxDispatches,
        Number.isFinite(bin.dispatchCount) ? bin.dispatchCount : 0,
      );
    }
    for (let index = 0; index < bins.length; index += 1) {
      const bin = bins[index];
      const binSpan = Number.isFinite(bin.endNs - bin.startNs) &&
          bin.endNs > bin.startNs
        ? bin.endNs - bin.startNs
        : (this.bounds.endNs - this.bounds.startNs) / Math.max(1, bins.length);
      const x = index * binWidth;
      const drawWidth = Math.max(1, Math.ceil(binWidth));
      const hostRatio = Math.min(
        1,
        Math.max(0, (Number.isFinite(bin.hostEncodeNs) ? bin.hostEncodeNs : 0) / binSpan),
      );
      const gpuRatio = Math.min(
        1,
        Math.max(0, (Number.isFinite(bin.gpuBusyNs) ? bin.gpuBusyNs : 0) / binSpan),
      );
      context.fillStyle = palette.host;
      context.fillRect(x, 7, drawWidth, 13 * hostRatio);
      context.fillStyle = palette.gpu;
      context.fillRect(x, 27, drawWidth, 13 * gpuRatio);

      const dispatchRatio = Math.min(
        1,
        Math.max(
          0,
          (Number.isFinite(bin.dispatchCount) ? bin.dispatchCount : 0) /
            maxDispatches,
        ),
      );
      context.fillStyle = palette.dispatch;
      context.fillRect(x, 48 - 5 * dispatchRatio, drawWidth, 5 * dispatchRatio);
      if (Number.isFinite(bin.waitCount) && bin.waitCount > 0) {
        const classes =
          Array.isArray(bin.waitClasses) && bin.waitClasses.length > 0
            ? bin.waitClasses
            : ["other"];
        for (let classIndex = 0; classIndex < classes.length; classIndex += 1) {
          const waitClass = classes[classIndex];
          const waitX =
            x + (drawWidth * (classIndex + 1)) / (classes.length + 1);
          if (waitClass === "dependency") {
            context.strokeStyle = palette.dependency;
            context.setLineDash?.([3, 2]);
            context.beginPath();
            context.moveTo(waitX, 0);
            context.lineTo(waitX, height);
            context.stroke();
            context.setLineDash?.([]);
          } else if (waitClass === "cap") {
            context.fillStyle = palette.wait;
            context.beginPath();
            context.moveTo(waitX, 0);
            context.lineTo(waitX + 3, 6);
            context.lineTo(waitX - 3, 6);
            context.closePath();
            context.fill();
          } else if (waitClass === "decision") {
            context.fillStyle = palette.wait;
            context.fillRect(waitX - 1.5, 0, 1, height);
            context.fillRect(waitX + 0.5, 0, 1, height);
          } else {
            context.strokeStyle = palette.secondary;
            context.beginPath();
            context.moveTo(waitX, 0);
            context.lineTo(waitX, height);
            context.stroke();
          }
        }
      }
    }

    context.strokeStyle = palette.rule;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(0, 24.5);
    context.lineTo(width, 24.5);
    context.moveTo(0, 44.5);
    context.lineTo(width, 44.5);
    context.stroke();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.drag) {
      const drag = this.drag;
      this.drag = null;
      this.finishPointerCapture(drag, { release: true });
    }
    for (const { target, type, listener, options } of this.listeners) {
      target.removeEventListener(type, listener, options);
    }
    this.listeners.length = 0;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.clearResolutionObservation();
    this.resolutionDpr = null;
    if (this.animationFrame !== null) {
      this.window.cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }
}
