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

export function clampSelectedRange(range, bounds, minimumSpanNs = 1) {
  const boundSpan = positiveSpan(bounds, "Launch");
  const rangeSpan = positiveSpan(range, "Selected range");
  const minimumSpan = Math.min(
    boundSpan,
    Math.max(1, Number.isFinite(minimumSpanNs) ? minimumSpanNs : 1),
  );
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
  positiveSpan(range, "Selected range");
  positiveSpan(bounds, "Launch");
  if (edge !== "start" && edge !== "end") {
    throw new RangeError('Range edge must be either "start" or "end".');
  }
  if (!Number.isFinite(atNs)) {
    throw new TypeError("Range edge position must be finite.");
  }
  return edge === "start"
    ? Object.freeze({
        startNs: Math.max(
          bounds.startNs,
          Math.min(atNs, range.endNs - minimumSpanNs),
        ),
        endNs: range.endNs,
      })
    : Object.freeze({
        startNs: range.startNs,
        endNs: Math.min(
          bounds.endNs,
          Math.max(atNs, range.startNs + minimumSpanNs),
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

function cssColor(windowObject, element, property, fallback) {
  const value = windowObject
    ?.getComputedStyle?.(element)
    ?.getPropertyValue?.(property)
    ?.trim?.();
  return value || fallback;
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

function elementWidth(element) {
  const width = element?.getBoundingClientRect?.().width;
  return Number.isFinite(width) && width > 0 ? width : 1;
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
    this.drag = null;
    this.disabled = false;
    this.destroyed = false;
    this.animationFrame = null;
    this.listeners = [];

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
    for (const target of [this.band, this.startHandle, this.endHandle]) {
      this.listen(target, "lostpointercapture", (event) =>
        this.cancelDrag(event));
    }

    this.resizeObserver = this.window.ResizeObserver
      ? new this.window.ResizeObserver(() => this.requestRender())
      : null;
    this.resizeObserver?.observe(this.canvas);
    this.setDisabled(false);
  }

  listen(target, type, listener, options) {
    target.addEventListener(type, listener, options);
    this.listeners.push({ target, type, listener, options });
  }

  minimumSpanNs() {
    if (!this.bounds) return 1;
    return Math.max(
      1,
      (this.bounds.endNs - this.bounds.startNs) / elementWidth(this.canvas),
    );
  }

  setOverview(overview) {
    const bounds = overviewBounds(overview);
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
    this.range = clampSelectedRange(
      this.range ?? bounds,
      bounds,
      this.minimumSpanNs(),
    );
    this.updateControls();
    this.requestRender();
    return this;
  }

  setRange(range, { emit = false } = {}) {
    if (!this.bounds) {
      throw new Error("Set an overview before setting the selected range.");
    }
    if (!finiteRange(range)) {
      throw new TypeError("Selected range must have positive finite duration.");
    }
    this.range = clampSelectedRange(range, this.bounds, this.minimumSpanNs());
    this.updateControls();
    this.requestRender();
    const result = Object.freeze({ ...this.range });
    if (emit) this.onRangeInput(result);
    return result;
  }

  setDisabled(disabled) {
    this.disabled = Boolean(disabled);
    for (const handle of [this.startHandle, this.endHandle]) {
      handle.setAttribute("aria-disabled", String(this.disabled));
      handle.setAttribute("tabindex", this.disabled ? "-1" : "0");
    }
    this.band.setAttribute("aria-disabled", String(this.disabled));
    if (this.disabled && this.drag) {
      this.cancelActiveDrag();
    }
    return this;
  }

  updateControls() {
    if (!this.bounds || !this.range) return;
    const startPercent = percent(this.range.startNs, this.bounds);
    const endPercent = percent(this.range.endNs, this.bounds);
    this.band.style.left = `${startPercent}%`;
    this.band.style.width = `${endPercent - startPercent}%`;
    this.startHandle.style.left = "0%";
    this.endHandle.style.left = "100%";

    const attributes = [
      [this.startHandle, "Range start", this.range.startNs],
      [this.endHandle, "Range end", this.range.endNs],
    ];
    for (const [handle, label, value] of attributes) {
      handle.setAttribute("role", "slider");
      handle.setAttribute("aria-label", label);
      handle.setAttribute("aria-orientation", "horizontal");
      handle.setAttribute("aria-valuemin", this.bounds.startNs);
      handle.setAttribute("aria-valuemax", this.bounds.endNs);
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
    };
  }

  rangeForPointer(clientX) {
    if (this.drag.type === "band") {
      const width = elementWidth(this.canvas);
      const deltaNs =
        ((clientX - this.drag.clientX) / width) *
        (this.bounds.endNs - this.bounds.startNs);
      return moveSelectedRange(this.drag.range, deltaNs, this.bounds);
    }
    return resizeSelectedRange(
      this.drag.range,
      this.drag.type,
      timeAtClientX(clientX, this.canvas, this.bounds),
      this.bounds,
      this.minimumSpanNs(),
    );
  }

  handlePointerMove(event) {
    if (
      !this.drag ||
      event.pointerId !== this.drag.pointerId ||
      !Number.isFinite(event.clientX)
    ) {
      return;
    }
    event.preventDefault();
    this.setRange(this.rangeForPointer(event.clientX), { emit: true });
  }

  releasePointerCapture(drag) {
    if (drag.type === "band") drag.target.classList?.remove?.("is-dragging");
    try {
      drag.target.releasePointerCapture?.(drag.pointerId);
    } catch {
      // Browsers may release capture before pointerup reaches the window.
    }
  }

  finishDrag(event) {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    const drag = this.drag;
    if (Number.isFinite(event.clientX)) {
      this.setRange(this.rangeForPointer(event.clientX), { emit: true });
    }
    this.drag = null;
    this.releasePointerCapture(drag);
    this.onRangeCommit(Object.freeze({ ...this.range }));
  }

  cancelActiveDrag() {
    if (!this.drag) return;
    const drag = this.drag;
    this.drag = null;
    this.range = drag.range;
    this.updateControls();
    this.requestRender();
    this.releasePointerCapture(drag);
    this.onRangeInput(Object.freeze({ ...this.range }));
  }

  cancelDrag(event) {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    this.cancelActiveDrag();
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
    const centerNs = (this.range.startNs + this.range.endNs) / 2;
    this.setRange(
      moveSelectedRange(this.range, atNs - centerNs, this.bounds),
      { emit: true },
    );
    this.onRangeCommit(Object.freeze({ ...this.range }));
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
    this.setRange(
      resizeSelectedRange(
        this.range,
        edge,
        atNs,
        this.bounds,
        this.minimumSpanNs(),
      ),
    );
    this.onRangeCommit(Object.freeze({ ...this.range }));
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
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = cssColor(
      this.window,
      this.canvas,
      "--canvas",
      FALLBACK_COLORS.canvas,
    );
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
      context.fillStyle = cssColor(
        this.window,
        this.canvas,
        "--exposed-host",
        FALLBACK_COLORS.host,
      );
      context.fillRect(x, 7, drawWidth, 13 * hostRatio);
      context.fillStyle = cssColor(
        this.window,
        this.canvas,
        "--gpu",
        FALLBACK_COLORS.gpu,
      );
      context.fillRect(x, 27, drawWidth, 13 * gpuRatio);

      const dispatchRatio = Math.min(
        1,
        Math.max(
          0,
          (Number.isFinite(bin.dispatchCount) ? bin.dispatchCount : 0) /
            maxDispatches,
        ),
      );
      context.fillStyle = cssColor(
        this.window,
        this.canvas,
        "--text",
        FALLBACK_COLORS.dispatch,
      );
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
            context.strokeStyle = cssColor(
              this.window,
              this.canvas,
              "--dependency",
              FALLBACK_COLORS.dependency,
            );
            context.setLineDash?.([3, 2]);
            context.beginPath();
            context.moveTo(waitX, 0);
            context.lineTo(waitX, height);
            context.stroke();
            context.setLineDash?.([]);
          } else if (waitClass === "cap") {
            context.fillStyle = cssColor(
              this.window,
              this.canvas,
              "--decision-cap",
              FALLBACK_COLORS.wait,
            );
            context.beginPath();
            context.moveTo(waitX, 0);
            context.lineTo(waitX + 3, 6);
            context.lineTo(waitX - 3, 6);
            context.closePath();
            context.fill();
          } else if (waitClass === "decision") {
            context.fillStyle = cssColor(
              this.window,
              this.canvas,
              "--decision-cap",
              FALLBACK_COLORS.wait,
            );
            context.fillRect(waitX - 1.5, 0, 1, height);
            context.fillRect(waitX + 0.5, 0, 1, height);
          } else {
            context.strokeStyle = cssColor(
              this.window,
              this.canvas,
              "--secondary",
              FALLBACK_COLORS.secondary,
            );
            context.beginPath();
            context.moveTo(waitX, 0);
            context.lineTo(waitX, height);
            context.stroke();
          }
        }
      }
    }

    context.strokeStyle = cssColor(
      this.window,
      this.canvas,
      "--rule",
      FALLBACK_COLORS.rule,
    );
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
      this.releasePointerCapture(drag);
    }
    for (const { target, type, listener, options } of this.listeners) {
      target.removeEventListener(type, listener, options);
    }
    this.listeners.length = 0;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.animationFrame !== null) {
      this.window.cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }
}
