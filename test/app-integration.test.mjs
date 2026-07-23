import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  analyzeTraceOffMainThread,
  bootstrap,
  buildDatasetOffMainThread,
  evidenceBadges,
  handleTraceRailKey,
  kernelRowsForScope,
  loadTraceRegistry,
  parseRangeSelection,
  progressState,
  RangeRequestAuthority,
  rangeSelectionUrl,
  RegistrySelectionGuard,
  renderTraceRail,
  samplingDisclosure,
  traceCacheKey,
  traceRailState,
  traceSourceUrl,
  waitRowsForScope,
} from "../public/app.js";
import { compactDatasetForClient } from "../public/client-dataset.js";
import { TimelineRenderer } from "../public/timeline.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, reject, resolve };
}

test("registry loading falls back to the generated hosted manifest", async () => {
  const requests = [];
  const hostedRegistry = {
    schemaVersion: 1,
    rootLabel: "Hosted showcase",
    traces: [{
      id: "abc123",
      relativePath: "nested/capture one.jsonl",
    }],
    warnings: [],
  };
  const loaded = await loadTraceRegistry(async (url) => {
    requests.push(url);
    if (url === "/api/traces") {
      return { ok: false, status: 404 };
    }
    return {
      ok: true,
      status: 200,
      async json() {
        return hostedRegistry;
      },
    };
  });

  assert.deepEqual(requests, ["/api/traces", "/hosted-traces.json"]);
  assert.equal(loaded.registry, hostedRegistry);
  assert.equal(loaded.hosted, true);
  assert.equal(
    traceSourceUrl(loaded.registry.traces[0], { hosted: loaded.hosted }),
    "/traces/showcase/nested/capture%20one.jsonl",
  );
});

test("server registry remains authoritative and ignores metadata source URLs", async () => {
  const registry = {
    traces: [{
      id: "abc123",
      relativePath: "capture.jsonl",
      sourceUrl: "https://example.invalid/untrusted.jsonl",
    }],
  };
  const loaded = await loadTraceRegistry(async (url) => {
    assert.equal(url, "/api/traces");
    return {
      ok: true,
      status: 200,
      async json() {
        return registry;
      },
    };
  });

  assert.equal(loaded.hosted, false);
  assert.equal(
    traceSourceUrl(loaded.registry.traces[0], { hosted: loaded.hosted }),
    "/api/traces/abc123",
  );
});

test("browser registry and trace requests resolve against root and project base URLs", async () => {
  for (const [baseUrl, expectedPrefix] of [
    ["https://mlx-profiler.opensource.wtf/", "https://mlx-profiler.opensource.wtf/"],
    [
      "https://opensourcewtf.github.io/metal-dispatch-viz/",
      "https://opensourcewtf.github.io/metal-dispatch-viz/",
    ],
  ]) {
    const requests = [];
    const loaded = await loadTraceRegistry(
      async (url) => {
        requests.push(url);
        if (url.endsWith("/api/traces")) {
          return { ok: false, status: 404 };
        }
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              traces: [{
                id: "trace-a",
                relativePath: "nested/capture one.jsonl",
              }],
            };
          },
        };
      },
      { baseUrl },
    );

    assert.deepEqual(requests, [
      `${expectedPrefix}api/traces`,
      `${expectedPrefix}hosted-traces.json`,
    ]);
    assert.equal(
      traceSourceUrl(loaded.registry.traces[0], {
        hosted: true,
        baseUrl,
      }),
      `${expectedPrefix}traces/showcase/nested/capture%20one.jsonl`,
    );
  }
});

const BOOTSTRAP_IDS = [
  "directory-identity",
  "refresh-button",
  "theme-toggle",
  "trace-rail",
  "trace-track",
  "provenance-strip",
  "health-strip",
  "trace-status",
  "window-control",
  "window-select",
  "metric-scope-label",
  "metric-grid",
  "timeline",
  "plot-frame",
  "timeline-placeholder",
  "timeline-sampling-note",
  "loading-state",
  "loading-filename",
  "loading-progress",
  "loading-readout",
  "empty-state",
  "error-state",
  "inspector-body",
  "clear-selection",
  "kernel-table-body",
  "kernel-table-state",
  "wait-table-body",
  "wait-table-state",
  "timeline-scale",
  "zoom-out",
  "fit-timeline",
  "zoom-in",
  "range-navigator",
  "range-overview",
  "range-overview-summary",
  "range-band",
  "range-start-handle",
  "range-end-handle",
  "range-mode-view",
  "range-mode-analyze",
  "range-start-readout",
  "range-end-readout",
  "range-duration-readout",
  "range-status",
  "range-omissions",
  "analysis-tables",
];

function bootstrapCanvasContext() {
  return new Proxy(
    {
      createPattern() {
        return "pattern";
      },
      measureText(text) {
        return { width: String(text).length * 6 };
      },
      setLineDash() {},
    },
    {
      get(target, property) {
        if (property in target) return target[property];
        if (typeof property === "symbol") return undefined;
        return () => {};
      },
      set(target, property, value) {
        target[property] = value;
        return true;
      },
    },
  );
}

class BootstrapElement {
  constructor(documentObject, id = "", tagName = "div") {
    this.ownerDocument = documentObject;
    this.id = id;
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map();
    this.children = [];
    this.listeners = new Map();
    this.className = "";
    this.disabled = false;
    this.hidden = false;
    this.style = {};
    this.textContent = "";
    this.value = "";
    this.max = 1;
    this.canvasContext =
      this.tagName === "CANVAS" ? bootstrapCanvasContext() : null;
    this.classList = {
      add: (...names) => {
        const values = new Set(this.className.split(/\s+/).filter(Boolean));
        names.forEach((name) => values.add(name));
        this.className = [...values].join(" ");
      },
      remove: (...names) => {
        const values = new Set(this.className.split(/\s+/).filter(Boolean));
        names.forEach((name) => values.delete(name));
        this.className = [...values].join(" ");
      },
      toggle: (name, force) => {
        const present = this.className.split(/\s+/).includes(name);
        const next = force === undefined ? !present : Boolean(force);
        if (next) this.classList.add(name);
        else this.classList.remove(name);
        return next;
      },
      contains: (name) => this.className.split(/\s+/).includes(name),
    };
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = [...children];
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === "disabled") this.disabled = true;
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === "disabled") this.disabled = false;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({
        currentTarget: this,
        target: this,
        preventDefault() {},
        ...event,
      });
    }
  }

  click() {
    if (!this.disabled) this.dispatch("click");
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }

  getContext(kind) {
    return kind === "2d" ? this.canvasContext : null;
  }

  setPointerCapture() {}

  releasePointerCapture() {}

  remove() {}

  querySelector(selector) {
    const tagName = selector.toLowerCase();
    let child = this.children.find(
      (item) => item?.tagName?.toLowerCase() === tagName,
    );
    if (!child) {
      child = new BootstrapElement(this.ownerDocument, "", tagName);
      this.children.push(child);
    }
    return child;
  }

  querySelectorAll(selector) {
    if (selector !== ".trace-toggle") return [];
    return this.children.filter((child) =>
      String(child?.className ?? "").split(/\s+/).includes("trace-toggle"),
    );
  }

  getBoundingClientRect() {
    return { left: 0, top: 0, width: 1120, height: 396 };
  }
}

function bootstrapDocument() {
  const documentObject = {
    activeElement: null,
    elements: new Map(),
    documentElement: null,
    body: null,
    getElementById(id) {
      return this.elements.get(id) ?? null;
    },
    createElement(tagName) {
      return new BootstrapElement(this, "", tagName);
    },
    createTextNode(text) {
      return { textContent: String(text) };
    },
  };
  documentObject.documentElement =
    new BootstrapElement(documentObject, "document", "html");
  documentObject.body = new BootstrapElement(documentObject, "body", "body");
  for (const id of BOOTSTRAP_IDS) {
    const tagName =
      id.includes("button") || id.startsWith("range-mode") ? "button" :
      id === "window-select" ? "select" :
      id.includes("table-body") ? "tbody" :
      id === "loading-progress" ? "progress" :
      id === "timeline" || id === "range-overview" ? "canvas" :
      "div";
    documentObject.elements.set(
      id,
      new BootstrapElement(documentObject, id, tagName),
    );
  }
  documentObject.getElementById("range-mode-analyze").disabled = true;
  return documentObject;
}

function bootstrapWindow(documentObject, href) {
  let nextTimerId = 1;
  let nextAnimationFrameId = 1;
  const timers = new Map();
  const animationFrames = new Map();
  const historyWrites = [];
  const listeners = new Map();
  const windowObject = {
    document: documentObject,
    location: { href },
    history: {
      replaceState(_state, _title, value) {
        windowObject.location.href =
          new URL(value, windowObject.location.href).href;
        historyWrites.push(windowObject.location.href);
      },
    },
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {},
    },
    matchMedia() {
      return { matches: false };
    },
    getComputedStyle() {
      return { getPropertyValue: () => "" };
    },
    devicePixelRatio: 1,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatchEvent(event) {
      for (const listener of [...(listeners.get(event?.type) ?? [])]) {
        listener.call(windowObject, event);
      }
    },
    requestAnimationFrame(callback) {
      const id = nextAnimationFrameId++;
      animationFrames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      animationFrames.delete(id);
    },
    setTimeout(callback, delay) {
      const id = nextTimerId++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
  documentObject.defaultView = windowObject;
  return {
    historyWrites,
    listenerCount(type) {
      return listeners.get(type)?.size ?? 0;
    },
    runAnimationFrames() {
      const pending = [...animationFrames.values()];
      animationFrames.clear();
      pending.forEach((callback) => callback(0));
    },
    runTimers() {
      const pending = [...timers.values()];
      timers.clear();
      pending.forEach(({ callback }) => callback());
    },
    timerDelays() {
      return [...timers.values()].map(({ delay }) => delay);
    },
    windowObject,
  };
}

function renderSampling(active, displayed = 1, total = 10) {
  return {
    active,
    dispatches: { displayed, total },
    commandBuffers: { displayed, total },
    waits: { displayed, total },
  };
}

function bootstrapLaunch({
  startNs = 0,
  endNs = 100,
  sampling = renderSampling(false),
  name = "kernel",
} = {}) {
  return {
    startNs,
    endNs,
    overview: {
      startNs,
      endNs,
      binCount: 1,
      bins: [{ dispatchCount: 1, waitCount: 0 }],
    },
    rangeAnalysis: { available: true, reason: null },
    summary: {
      startNs,
      endNs,
      wallSpanNs: endNs - startNs,
      opsTotal: 1,
      cbsTotal: 1,
    },
    kernelCensus: [{
      kernel: name,
      count: 1,
      setBytesCalls: 0,
      setBytesTotalBytes: 0,
      bufferBinds: 0,
    }],
    waitTaxonomy: {},
    dispatches: [],
    commandBuffers: [],
    waits: [],
    renderSampling: sampling,
  };
}

function bootstrapDataset(launches) {
  return {
    launchWindows: launches,
    health: {
      validEvidence: true,
      sourceCompleteness: "complete",
      malformedRows: 0,
    },
  };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function createBootstrapHarness({
  href = "http://localhost/?trace=trace-a&window=0",
  baseURI,
  traces = [
    {
      id: "trace-a",
      label: "Trace A",
      name: "a.jsonl",
      relativePath: "a.jsonl",
      size: 100,
      modifiedTime: "2026-07-23T00:00:00.000Z",
    },
    {
      id: "trace-b",
      label: "Trace B",
      name: "b.jsonl",
      relativePath: "b.jsonl",
      size: 100,
      modifiedTime: "2026-07-23T00:00:01.000Z",
    },
  ],
  datasets = new Map(),
  cached = new Map(),
  deferredLoads = false,
  useRealRenderer = false,
} = {}) {
  const documentObject = bootstrapDocument();
  if (baseURI !== undefined) {
    documentObject.baseURI = baseURI;
  }
  const windowHarness = bootstrapWindow(documentObject, href);
  const sessions = [];
  const renderers = [];
  const navigators = [];
  const pendingLoads = [];
  const requests = [];
  let loadsDeferred = deferredLoads;

  class HarnessRenderer {
    constructor(_canvas, callbacks) {
      this.callbacks = callbacks;
      this.datasets = [];
      this.viewport = { startNs: 0, endNs: 1 };
      this.colors = {};
      this.requestRenderCalls = 0;
      renderers.push(this);
    }

    setDataset(scope, options = {}) {
      this.datasets.push({ scope, options });
      this.viewport = { ...(options.viewport ?? this.viewport) };
      this.callbacks.onInspect?.(null);
      return this;
    }

    setViewport(viewport, { notify = true, ...metadata } = {}) {
      this.viewport = { ...viewport };
      if (notify) {
        this.callbacks.onViewportChange?.(
          { ...this.viewport },
          { committed: true, source: "external", ...metadata },
        );
      }
      return { ...this.viewport };
    }

    fit(target, notify = true) {
      this.viewport = { ...target };
      if (notify) {
        this.callbacks.onViewportChange?.(
          { ...this.viewport },
          { committed: true, source: "fit" },
        );
      }
      return { ...this.viewport };
    }

    emitViewport(viewport, metadata) {
      this.viewport = { ...viewport };
      this.callbacks.onViewportChange?.({ ...viewport }, metadata);
    }

    emitInspect(payload) {
      this.callbacks.onInspect?.(payload);
    }

    clearSelection() {
      this.callbacks.onInspect?.(null);
    }

    handleKeyDown() {}

    requestRender() {
      this.requestRenderCalls += 1;
    }

    destroy() {
      this.destroyed = true;
    }
  }

  class HarnessNavigator {
    constructor(_elements, callbacks) {
      this.callbacks = callbacks;
      this.requestRenderCalls = 0;
      navigators.push(this);
    }

    setOverview(overview) {
      this.overview = overview;
      return this;
    }

    setRange(range) {
      this.range = { ...range };
      return { ...this.range };
    }

    setDisabled(disabled) {
      this.disabled = disabled;
      return this;
    }

    emitInput(range) {
      this.callbacks.onRangeInput({ ...range });
    }

    emitCommit(range) {
      this.callbacks.onRangeCommit({ ...range });
    }

    requestRender() {
      this.requestRenderCalls += 1;
    }

    destroy() {
      this.destroyed = true;
    }
  }

  class HarnessSession {
    constructor(options) {
      this.options = options;
      this.ready = false;
      this.analysis = [];
      this.terminated = false;
      sessions.push(this);
    }

    load(url) {
      this.url = url;
      const trace = traces.find((item) =>
        url.endsWith(encodeURIComponent(item.id)));
      const loaded = {
        dataset: datasets.get(trace?.id),
        diagnostics: { sourceBytes: trace?.size ?? 0, parsedRows: 1 },
      };
      if (!loadsDeferred) {
        this.ready = true;
        return Promise.resolve(loaded);
      }
      const pending = deferred();
      pendingLoads.push({
        ...pending,
        resolve: () => {
          this.ready = true;
          pending.resolve(loaded);
        },
      });
      return pending.promise;
    }

    analyzeRange(request) {
      const pending = deferred();
      this.analysis.push({ request, ...pending });
      return pending.promise;
    }

    terminate() {
      this.terminated = true;
      this.ready = false;
    }
  }

  const cacheObject = {
    get(key) {
      return cached.get(key);
    },
    set(key, value) {
      cached.set(key, value);
    },
  };
  const RendererConstructor = useRealRenderer
    ? class InstrumentedTimelineRenderer extends TimelineRenderer {
        constructor(canvas, callbacks) {
          super(canvas, callbacks);
          renderers.push(this);
        }
      }
    : HarnessRenderer;
  const bootPromise = bootstrap({
    fetchImpl: async (url) => ({
      ok: true,
      async json() {
        requests.push(url);
        return { rootLabel: "test traces", traces };
      },
    }),
    analysisSessionFactory: (options) => new HarnessSession(options),
    analysisDebounceMs: 100,
    cacheObject,
    documentObject,
    windowObject: windowHarness.windowObject,
    RendererClass: RendererConstructor,
    RangeNavigatorClass: HarnessNavigator,
  });
  return {
    bootPromise,
    cacheObject,
    documentObject,
    navigators,
    pendingLoads,
    renderers,
    requests,
    setLoadsDeferred(value) {
      loadsDeferred = Boolean(value);
    },
    sessions,
    ...windowHarness,
  };
}

test("bootstrap passes absolute trace URLs at root and project bases", async () => {
  for (const baseURI of [
    "https://mlx-profiler.opensource.wtf/",
    "https://opensourcewtf.github.io/metal-dispatch-viz/",
  ]) {
    const harness = createBootstrapHarness({
      href: `${baseURI}?trace=trace-a&window=0`,
      baseURI,
      traces: [{
        id: "trace-a",
        label: "Trace A",
        name: "a.jsonl",
        relativePath: "a.jsonl",
        size: 100,
      }],
      datasets: new Map([["trace-a", bootstrapDataset([bootstrapLaunch()])]]),
    });

    const app = await harness.bootPromise;
    assert.deepEqual(harness.requests, [`${baseURI}api/traces`]);
    assert.equal(harness.sessions[0].url, `${baseURI}api/traces/trace-a`);
    app.destroy();
  }
});

test("bootstrap destroy is idempotent and pagehide delegates to the same cleanup", async () => {
  const harness = createBootstrapHarness({
    traces: [{
      id: "trace-a",
      label: "Trace A",
      name: "a.jsonl",
      relativePath: "a.jsonl",
      size: 100,
    }],
    datasets: new Map([["trace-a", bootstrapDataset([bootstrapLaunch()])]]),
  });
  const app = await harness.bootPromise;

  assert.equal(harness.listenerCount("pagehide"), 1);
  harness.windowObject.dispatchEvent({ type: "pagehide" });
  assert.equal(app.state.destroyed, true);
  assert.equal(app.renderer.destroyed, true);
  assert.equal(app.rangeNavigator.destroyed, true);
  assert.equal(harness.sessions[0].terminated, true);
  assert.equal(harness.listenerCount("pagehide"), 0);

  app.destroy();
  assert.equal(harness.listenerCount("pagehide"), 0);
});

function analyzedScope({
  startNs,
  endNs,
  sampling = renderSampling(false),
  omissions = { unplacedDispatches: 0, unanchoredWaits: 0 },
  kernel = "range-kernel",
} = {}) {
  return {
    ...bootstrapLaunch({
      startNs,
      endNs,
      sampling,
      name: kernel,
    }),
    range: { startNs, endNs },
    omissions,
  };
}

test("bootstrap renders cached View data while exact analysis hydrates", async () => {
  const trace = {
    id: "trace-a",
    label: "Trace A",
    name: "a.jsonl",
    relativePath: "a.jsonl",
    size: 100,
    modifiedTime: "2026-07-23T00:00:00.000Z",
  };
  const cachedLaunch = bootstrapLaunch({
    sampling: renderSampling(true, 2, 20),
    name: "cached",
  });
  const exactLaunch = bootstrapLaunch({ name: "exact" });
  const cachedLoaded = {
    dataset: bootstrapDataset([cachedLaunch]),
    diagnostics: { sourceBytes: 100, parsedRows: 1 },
  };
  const harness = createBootstrapHarness({
    traces: [trace],
    datasets: new Map([["trace-a", bootstrapDataset([exactLaunch])]]),
    cached: new Map([[traceCacheKey(trace), cachedLoaded]]),
    deferredLoads: true,
  });

  await flushMicrotasks();
  assert.equal(harness.renderers[0].datasets.at(-1).scope, cachedLaunch);
  assert.equal(
    harness.documentObject.getElementById("range-mode-analyze").disabled,
    true,
  );
  assert.match(
    harness.documentObject.getElementById("range-status").textContent,
    /preparing exact analysis/i,
  );
  const renderer = harness.renderers[0];
  const navigator = harness.navigators[0];
  renderer.emitInspect({
    kind: "cb",
    item: { commandBufferIndex: 1 },
    title: "Cached pin",
    values: [],
  });
  navigator.emitCommit({ startNs: 20, endNs: 80 });
  const datasetPublishes = renderer.datasets.length;

  harness.pendingLoads[0].resolve();
  const app = await harness.bootPromise;
  assert.equal(
    renderer.datasets.length,
    datasetPublishes,
    "ready hydration does not republish equivalent cached canvas data",
  );
  assert.deepEqual(app.state.selectedRange, { startNs: 20, endNs: 80 });
  assert.equal(
    harness.documentObject.getElementById("clear-selection").disabled,
    false,
    "cached inspector pin survives exact-session readiness",
  );
  assert.equal(
    harness.documentObject.getElementById("range-mode-analyze").disabled,
    false,
  );
  assert.equal(harness.sessions[0].terminated, false);
});

test("same-trace refresh renews only the exact session and selected rail click is a no-op", async () => {
  const trace = {
    id: "trace-a",
    label: "Trace A",
    name: "a.jsonl",
    relativePath: "a.jsonl",
    size: 100,
    modifiedTime: "2026-07-23T00:00:00.000Z",
  };
  const launch = bootstrapLaunch();
  const harness = createBootstrapHarness({
    traces: [trace],
    datasets: new Map([["trace-a", bootstrapDataset([launch])]]),
  });
  const app = await harness.bootPromise;
  const renderer = harness.renderers[0];
  const navigator = harness.navigators[0];
  navigator.emitCommit({ startNs: 15, endNs: 75 });
  harness.documentObject.getElementById("range-mode-analyze").click();
  harness.sessions[0].analysis[0].resolve({
    range: { startNs: 15, endNs: 75 },
    dataset: analyzedScope({ startNs: 15, endNs: 75 }),
  });
  await flushMicrotasks();
  renderer.emitInspect({
    kind: "cb",
    item: { commandBufferIndex: 1 },
    title: "Refresh pin",
    values: [],
  });
  const datasetPublishes = renderer.datasets.length;

  await app.refresh();
  assert.equal(harness.sessions.length, 2);
  assert.equal(harness.sessions[0].terminated, true);
  assert.equal(harness.sessions[1].terminated, false);
  assert.equal(renderer.datasets.length, datasetPublishes);
  assert.equal(app.state.rangeMode, "analyze");
  assert.deepEqual(app.state.selectedRange, { startNs: 15, endNs: 75 });
  assert.equal(
    harness.documentObject.getElementById("clear-selection").disabled,
    false,
  );

  const selectedButton =
    harness.documentObject.getElementById("trace-track").children[0];
  selectedButton.click();
  await flushMicrotasks();
  assert.equal(harness.sessions.length, 2, "selected trace click is a no-op");
});

test("same-trace renewal reissues an in-flight Analyze request when its replacement becomes ready", async () => {
  const launch = bootstrapLaunch();
  const harness = createBootstrapHarness({
    traces: [{
      id: "trace-a",
      label: "Trace A",
      name: "a.jsonl",
      relativePath: "a.jsonl",
      size: 100,
      modifiedTime: "2026-07-23T00:00:00.000Z",
    }],
    datasets: new Map([["trace-a", bootstrapDataset([launch])]]),
  });
  const app = await harness.bootPromise;
  const navigator = harness.navigators[0];
  navigator.emitCommit({ startNs: 15, endNs: 75 });
  harness.documentObject.getElementById("range-mode-analyze").click();
  assert.equal(harness.sessions[0].analysis.length, 1);

  harness.setLoadsDeferred(true);
  const refreshPromise = app.refresh();
  await flushMicrotasks();
  assert.equal(harness.sessions.length, 2);
  assert.equal(harness.sessions[0].terminated, true);
  assert.equal(
    harness.documentObject.getElementById("analysis-tables")
      .getAttribute("aria-busy"),
    "false",
    "renewal invalidation synchronizes the busy DOM",
  );
  assert.doesNotMatch(
    harness.documentObject.getElementById("kernel-table-state").textContent,
    /Analyzing selection/i,
    "renewal invalidation restores the visible table state",
  );

  harness.pendingLoads[0].resolve();
  await refreshPromise;
  assert.equal(
    harness.sessions[1].analysis.length,
    1,
    "Analyze intent is reissued independently of pending URL input",
  );
  assert.deepEqual(harness.sessions[1].analysis[0].request, {
    launchIndex: 0,
    startNs: 15,
    endNs: 75,
  });
});

test("range interaction before renewal readiness analyzes the newest range and clears busy state", async () => {
  const launch = bootstrapLaunch();
  const harness = createBootstrapHarness({
    traces: [{
      id: "trace-a",
      label: "Trace A",
      name: "a.jsonl",
      relativePath: "a.jsonl",
      size: 100,
      modifiedTime: "2026-07-23T00:00:00.000Z",
    }],
    datasets: new Map([["trace-a", bootstrapDataset([launch])]]),
  });
  const app = await harness.bootPromise;
  const navigator = harness.navigators[0];
  harness.documentObject.getElementById("range-mode-analyze").click();
  harness.sessions[0].analysis[0].resolve({
    range: { startNs: 0, endNs: 100 },
    dataset: analyzedScope({ startNs: 0, endNs: 100 }),
  });
  await flushMicrotasks();

  harness.setLoadsDeferred(true);
  const refreshPromise = app.refresh();
  await flushMicrotasks();
  navigator.emitCommit({ startNs: 25, endNs: 65 });
  assert.equal(harness.sessions[1].analysis.length, 0);
  assert.equal(app.state.rangePending, true);
  assert.equal(
    harness.documentObject.getElementById("metric-grid")
      .getAttribute("aria-busy"),
    "true",
  );

  harness.pendingLoads[0].resolve();
  await refreshPromise;
  assert.equal(harness.sessions[1].analysis.length, 1);
  assert.deepEqual(harness.sessions[1].analysis[0].request, {
    launchIndex: 0,
    startNs: 25,
    endNs: 65,
  });
  harness.sessions[1].analysis[0].resolve({
    range: { startNs: 25, endNs: 65 },
    dataset: analyzedScope({ startNs: 25, endNs: 65 }),
  });
  await flushMicrotasks();
  assert.equal(app.state.rangePending, false);
  assert.equal(
    harness.documentObject.getElementById("metric-grid")
      .getAttribute("aria-busy"),
    "false",
  );
  assert.deepEqual(app.state.confirmedRange, { startNs: 25, endNs: 65 });
});

test("failed same-trace renewal exits Analyze and restores launch evidence", async () => {
  const launch = bootstrapLaunch({ name: "launch" });
  const harness = createBootstrapHarness({
    traces: [{
      id: "trace-a",
      label: "Trace A",
      name: "a.jsonl",
      relativePath: "a.jsonl",
      size: 100,
      modifiedTime: "2026-07-23T00:00:00.000Z",
    }],
    datasets: new Map([["trace-a", bootstrapDataset([launch])]]),
  });
  const app = await harness.bootPromise;
  harness.documentObject.getElementById("range-mode-analyze").click();
  harness.sessions[0].analysis[0].resolve({
    range: { startNs: 10, endNs: 70 },
    dataset: analyzedScope({
      startNs: 10,
      endNs: 70,
      kernel: "stale-exact",
    }),
  });
  await flushMicrotasks();
  assert.equal(app.state.rangeMode, "analyze");
  assert.equal(app.state.activeScope.kernelCensus[0].kernel, "stale-exact");

  harness.setLoadsDeferred(true);
  const refreshPromise = app.refresh();
  await flushMicrotasks();
  harness.pendingLoads[0].reject(new Error("renewal unavailable"));
  await refreshPromise;

  assert.equal(app.state.rangeMode, "view");
  assert.equal(app.state.activeScope, launch);
  assert.equal(app.state.canvasScope, launch);
  assert.equal(
    harness.documentObject.getElementById("metric-scope-label").textContent,
    "Launch totals",
  );
  assert.match(
    harness.documentObject.getElementById("range-status").textContent,
    /Exact analysis unavailable.+renewal unavailable/i,
  );
});

test("reselecting an uncached active load is a no-op but failure remains retryable", async () => {
  const launch = bootstrapLaunch();
  const harness = createBootstrapHarness({
    traces: [{
      id: "trace-a",
      label: "Trace A",
      name: "a.jsonl",
      relativePath: "a.jsonl",
      size: 100,
      modifiedTime: "2026-07-23T00:00:00.000Z",
    }],
    datasets: new Map([["trace-a", bootstrapDataset([launch])]]),
    deferredLoads: true,
  });
  await flushMicrotasks();
  const selectedButton =
    harness.documentObject.getElementById("trace-track").children[0];
  selectedButton.click();
  await flushMicrotasks();
  assert.equal(harness.sessions.length, 1);
  assert.equal(harness.sessions[0].terminated, false);
  assert.equal(harness.pendingLoads.length, 1);

  harness.pendingLoads[0].reject(new Error("initial load failed"));
  const app = await harness.bootPromise;
  assert.equal(app.state.currentDataset, null);
  selectedButton.click();
  await flushMicrotasks();
  assert.equal(harness.sessions.length, 2, "failed selection can be retried");
  assert.equal(harness.pendingLoads.length, 2);
  harness.pendingLoads[1].resolve();
  await flushMicrotasks();
  assert.equal(app.state.currentDataset.launchWindows[0], launch);
});

test("bootstrap debounces Analyze input, rejects stale results, and synchronizes canvas disclosure", async () => {
  const sampledLaunch = bootstrapLaunch({
    sampling: renderSampling(true, 2, 20),
    name: "launch",
  });
  const harness = createBootstrapHarness({
    traces: [{
      id: "trace-a",
      label: "Trace A",
      name: "a.jsonl",
      relativePath: "a.jsonl",
      size: 100,
    }],
    datasets: new Map([["trace-a", bootstrapDataset([sampledLaunch])]]),
  });
  const app = await harness.bootPromise;
  const renderer = harness.renderers[0];
  const navigator = harness.navigators[0];
  const session = harness.sessions[0];
  const samplingNote =
    harness.documentObject.getElementById("timeline-sampling-note");
  const analyzeButton =
    harness.documentObject.getElementById("range-mode-analyze");

  assert.equal(samplingNote.hidden, false, "sampled launch is disclosed");
  analyzeButton.click();
  assert.equal(session.analysis.length, 1, "mode switch analyzes immediately");
  session.analysis[0].resolve({
    range: { startNs: 10, endNs: 40 },
    dataset: analyzedScope({
      startNs: 10,
      endNs: 40,
      sampling: renderSampling(false),
      omissions: { unplacedDispatches: 2, unanchoredWaits: 3 },
    }),
  });
  await flushMicrotasks();
  assert.equal(app.state.rangeMode, "analyze");
  assert.equal(samplingNote.hidden, true, "unsampled exact range hides launch disclosure");
  assert.equal(
    harness.documentObject.getElementById("range-omissions").hidden,
    false,
  );
  assert.match(
    harness.documentObject.getElementById("range-omissions").textContent,
    /2 dispatches.+3 waits/s,
  );

  const pin = {
    kind: "cb",
    item: { commandBufferIndex: 1 },
    title: "Pinned CB",
    values: [],
  };
  renderer.emitInspect(pin);
  assert.equal(
    harness.documentObject.getElementById("clear-selection").disabled,
    false,
  );

  const historyBeforeInput = harness.historyWrites.length;
  navigator.emitInput({ startNs: 20, endNs: 50 });
  assert.deepEqual(harness.timerDelays(), [100]);
  assert.equal(session.analysis.length, 1, "transient drag waits for debounce");
  assert.equal(renderer.datasets.at(-1).scope, sampledLaunch);
  assert.equal(samplingNote.hidden, false, "pending launch sample is disclosed");
  assert.equal(
    harness.documentObject.getElementById("clear-selection").disabled,
    false,
    "pending launch swap preserves the inspector pin",
  );
  assert.equal(harness.historyWrites.length, historyBeforeInput);

  harness.runTimers();
  assert.equal(session.analysis.length, 2);
  navigator.emitInput({ startNs: 30, endNs: 60 });
  session.analysis[1].resolve({
    range: { startNs: 20, endNs: 50 },
    dataset: analyzedScope({
      startNs: 20,
      endNs: 50,
      kernel: "stale",
    }),
  });
  await flushMicrotasks();
  assert.deepEqual(
    app.state.selectedRange,
    { startNs: 30, endNs: 60 },
    "new transient selection invalidates the in-flight older authority",
  );
  assert.equal(app.state.rangePending, true);
  assert.notEqual(app.state.activeScope?.kernelCensus?.[0]?.kernel, "stale");

  harness.runTimers();
  assert.equal(session.analysis.length, 3);
  session.analysis[2].resolve({
    range: { startNs: 30, endNs: 60 },
    dataset: analyzedScope({
      startNs: 30,
      endNs: 60,
      kernel: "current",
    }),
  });
  await flushMicrotasks();
  assert.equal(app.state.activeScope.kernelCensus[0].kernel, "current");
  assert.equal(
    harness.documentObject.getElementById("clear-selection").disabled,
    true,
    "confirmed exact canvas replacement clears the pin",
  );

  const requestsBeforeFinal = session.analysis.length;
  navigator.emitInput({ startNs: 35, endNs: 65 });
  navigator.emitCommit({ startNs: 40, endNs: 70 });
  assert.equal(
    session.analysis.length,
    requestsBeforeFinal + 1,
    "final pointer commit issues immediately",
  );
  harness.runTimers();
  assert.equal(
    session.analysis.length,
    requestsBeforeFinal + 1,
    "final commit cancels the transient timer",
  );
});

test("bootstrap commits timeline View ranges once, resets launch and Fit, and falls back on Analyze failure", async () => {
  const firstLaunch = bootstrapLaunch({ startNs: 0, endNs: 100 });
  const secondLaunch = bootstrapLaunch({
    startNs: 200,
    endNs: 300,
    sampling: renderSampling(false),
    name: "second",
  });
  const traceA = {
    id: "trace-a",
    label: "Trace A",
    name: "a.jsonl",
    relativePath: "a.jsonl",
    size: 100,
  };
  const traceB = {
    id: "trace-b",
    label: "Trace B",
    name: "b.jsonl",
    relativePath: "b.jsonl",
    size: 100,
  };
  const harness = createBootstrapHarness({
    traces: [traceA, traceB],
    datasets: new Map([
      ["trace-a", bootstrapDataset([firstLaunch, secondLaunch])],
      ["trace-b", bootstrapDataset([bootstrapLaunch({
        startNs: 500,
        endNs: 600,
        name: "trace-b",
      })])],
    ]),
  });
  const app = await harness.bootPromise;
  const renderer = harness.renderers[0];
  const navigator = harness.navigators[0];
  const rangeStatus =
    harness.documentObject.getElementById("range-status");

  const historyBeforePan = harness.historyWrites.length;
  renderer.emitViewport(
    { startNs: 10, endNs: 70 },
    { committed: false, source: "pointer-pan" },
  );
  renderer.emitViewport(
    { startNs: 20, endNs: 80 },
    { committed: false, source: "pointer-pan" },
  );
  assert.equal(harness.historyWrites.length, historyBeforePan);
  renderer.emitViewport(
    { startNs: 20, endNs: 80 },
    { committed: true, source: "pointer-pan" },
  );
  assert.equal(harness.historyWrites.length, historyBeforePan + 1);
  assert.match(rangeStatus.textContent, /Viewing 20 ns.+80 ns/s);

  navigator.emitCommit({ startNs: 30, endNs: 60 });
  harness.documentObject.getElementById("fit-timeline").click();
  assert.deepEqual(app.state.selectedRange, { startNs: 0, endNs: 100 });
  assert.match(rangeStatus.textContent, /Viewing 0 ns.+100 ns/s);

  const windowSelect =
    harness.documentObject.getElementById("window-select");
  windowSelect.value = "1";
  windowSelect.dispatch("change");
  assert.equal(app.state.currentWindowIndex, 1);
  assert.equal(app.state.rangeMode, "view");
  assert.deepEqual(app.state.selectedRange, { startNs: 200, endNs: 300 });

  harness.documentObject.getElementById("range-mode-analyze").click();
  const sampledExact = harness.sessions[0].analysis.at(-1);
  sampledExact.resolve({
    range: { startNs: 200, endNs: 300 },
    dataset: analyzedScope({
      startNs: 200,
      endNs: 300,
      sampling: renderSampling(true),
    }),
  });
  await flushMicrotasks();
  const samplingNote =
    harness.documentObject.getElementById("timeline-sampling-note");
  assert.equal(
    samplingNote.hidden,
    false,
    "sampled exact range discloses sampling over an unsampled launch",
  );

  navigator.emitInput({ startNs: 220, endNs: 260 });
  assert.equal(
    samplingNote.hidden,
    true,
    "pending analysis restores the unsampled launch disclosure",
  );
  navigator.emitCommit({ startNs: 220, endNs: 260 });
  const failing = harness.sessions[0].analysis.at(-1);
  failing.reject(new Error("range exploded"));
  await flushMicrotasks();
  assert.equal(app.state.rangeMode, "view");
  assert.equal(app.state.activeScope, secondLaunch);
  assert.match(rangeStatus.textContent, /Exact analysis failed.+range exploded/i);

  await app.selectTrace("trace-b");
  assert.equal(harness.sessions[0].terminated, true);
  assert.equal(app.state.currentTraceId, "trace-b");
  assert.equal(app.state.rangeMode, "view");
  assert.deepEqual(app.state.selectedRange, { startNs: 500, endNs: 600 });
});

test("real timeline Analyze pan survives exact-to-launch swap and commits once on release", async () => {
  const launch = bootstrapLaunch();
  const harness = createBootstrapHarness({
    traces: [{
      id: "trace-a",
      label: "Trace A",
      name: "a.jsonl",
      relativePath: "a.jsonl",
      size: 100,
      modifiedTime: "2026-07-23T00:00:00.000Z",
    }],
    datasets: new Map([["trace-a", bootstrapDataset([launch])]]),
    useRealRenderer: true,
  });
  const app = await harness.bootPromise;
  harness.runAnimationFrames();
  const renderer = harness.renderers[0];
  const navigator = harness.navigators[0];
  const session = harness.sessions[0];
  const canvas = harness.documentObject.getElementById("timeline");

  navigator.emitCommit({ startNs: 20, endNs: 80 });
  harness.documentObject.getElementById("range-mode-analyze").click();
  session.analysis[0].resolve({
    range: { startNs: 20, endNs: 80 },
    dataset: analyzedScope({ startNs: 20, endNs: 80 }),
  });
  await flushMicrotasks();
  harness.runAnimationFrames();
  const historyBeforePan = harness.historyWrites.length;

  canvas.dispatch("pointerdown", {
    button: 0,
    clientX: 560,
    clientY: 150,
    pointerId: 42,
  });
  canvas.dispatch("pointermove", {
    clientX: 540,
    clientY: 150,
    pointerId: 42,
  });
  const firstViewport = { ...renderer.viewport };
  assert.ok(renderer.drag, "first transient move retains the active pointer drag");
  assert.equal(app.state.canvasScope, launch);

  canvas.dispatch("pointermove", {
    clientX: 520,
    clientY: 150,
    pointerId: 42,
  });
  assert.notDeepEqual(
    renderer.viewport,
    firstViewport,
    "the second move continues the original pan",
  );
  canvas.dispatch("pointerup", {
    clientX: 520,
    clientY: 150,
    pointerId: 42,
  });
  assert.equal(renderer.drag, null);
  assert.equal(session.analysis.length, 2, "release issues one exact request");
  harness.runTimers();
  assert.equal(
    session.analysis.length,
    2,
    "release cancels the transient debounce request",
  );

  const committed = session.analysis[1].request;
  session.analysis[1].resolve({
    range: {
      startNs: committed.startNs,
      endNs: committed.endNs,
    },
    dataset: analyzedScope({
      startNs: committed.startNs,
      endNs: committed.endNs,
    }),
  });
  await flushMicrotasks();
  assert.equal(harness.historyWrites.length, historyBeforePan + 1);
});

test("real timeline drag survives an authoritative exact result arriving after pointer-down", async () => {
  const launch = bootstrapLaunch();
  const harness = createBootstrapHarness({
    traces: [{
      id: "trace-a",
      label: "Trace A",
      name: "a.jsonl",
      relativePath: "a.jsonl",
      size: 100,
      modifiedTime: "2026-07-23T00:00:00.000Z",
    }],
    datasets: new Map([["trace-a", bootstrapDataset([launch])]]),
    useRealRenderer: true,
  });
  const app = await harness.bootPromise;
  harness.runAnimationFrames();
  const renderer = harness.renderers[0];
  const navigator = harness.navigators[0];
  const session = harness.sessions[0];
  const canvas = harness.documentObject.getElementById("timeline");

  navigator.emitCommit({ startNs: 20, endNs: 80 });
  harness.documentObject.getElementById("range-mode-analyze").click();
  assert.equal(session.analysis.length, 1);
  canvas.dispatch("pointerdown", {
    button: 0,
    clientX: 560,
    clientY: 150,
    pointerId: 43,
  });
  assert.ok(renderer.drag);

  session.analysis[0].resolve({
    range: { startNs: 20, endNs: 80 },
    dataset: analyzedScope({ startNs: 20, endNs: 80 }),
  });
  await flushMicrotasks();
  harness.runAnimationFrames();
  assert.ok(
    renderer.drag,
    "same-launch authoritative publication preserves the paused drag",
  );
  assert.notEqual(app.state.canvasScope, launch);
  const historyBeforePan = harness.historyWrites.length;

  canvas.dispatch("pointermove", {
    clientX: 540,
    clientY: 150,
    pointerId: 43,
  });
  const firstViewport = { ...renderer.viewport };
  canvas.dispatch("pointermove", {
    clientX: 520,
    clientY: 150,
    pointerId: 43,
  });
  assert.notDeepEqual(renderer.viewport, firstViewport);
  canvas.dispatch("pointerup", {
    clientX: 520,
    clientY: 150,
    pointerId: 43,
  });
  assert.equal(renderer.drag, null);
  assert.equal(
    session.analysis.length,
    2,
    "release issues exactly one replacement request",
  );
  harness.runTimers();
  assert.equal(session.analysis.length, 2);

  const committed = session.analysis[1].request;
  session.analysis[1].resolve({
    range: {
      startNs: committed.startNs,
      endNs: committed.endNs,
    },
    dataset: analyzedScope({
      startNs: committed.startNs,
      endNs: committed.endNs,
    }),
  });
  await flushMicrotasks();
  assert.equal(harness.historyWrites.length, historyBeforePan + 1);
});

test("range URL stores launch-relative offsets and mode", () => {
  const url = rangeSelectionUrl(
    "http://localhost/?trace=t&window=1",
    {
      mode: "analyze",
      bounds: { startNs: 1_000, endNs: 2_000 },
      range: { startNs: 1_125, endNs: 1_750 },
    },
  );

  assert.equal(url.searchParams.get("trace"), "t");
  assert.equal(url.searchParams.get("window"), "1");
  assert.equal(url.searchParams.get("range"), "analyze");
  assert.equal(url.searchParams.get("from"), "125");
  assert.equal(url.searchParams.get("to"), "750");
  assert.deepEqual(
    parseRangeSelection(url, { startNs: 1_000, endNs: 2_000 }),
    {
      mode: "analyze",
      range: { startNs: 1_125, endNs: 1_750 },
    },
  );
});

test("invalid range URL restores View over the complete launch", () => {
  const bounds = { startNs: 10, endNs: 110 };
  for (const input of [
    "http://localhost/?range=analyze&from=90&to=20",
    "http://localhost/?range=analyze&from=wat&to=20",
    "http://localhost/?range=analyze&from=0&to=0",
    "http://localhost/?range=analyze&from=0.5&to=20",
    "http://localhost/?range=analyze&from=&to=20",
    "http://localhost/?range=analyze&from=%20%20&to=20",
    "http://localhost/?range=analyze&from=0&to=%09",
    "http://localhost/?from=0&to=20",
    "http://localhost/?range=invalid&from=0&to=20",
    "http://localhost/?range=view&from=0x10&to=20",
    "http://localhost/?range=view&from=0&to=2e1",
  ]) {
    assert.deepEqual(parseRangeSelection(input, bounds), {
      mode: "view",
      range: bounds,
    });
  }
});

test("range URL clamps a valid relative selection to launch bounds", () => {
  assert.deepEqual(
    parseRangeSelection(
      "http://localhost/?range=view&from=-10&to=120",
      { startNs: 10, endNs: 110 },
    ),
    {
      mode: "view",
      range: { startNs: 10, endNs: 110 },
    },
  );
});

test("range authority accepts only the newest request for the active launch", () => {
  const authority = new RangeRequestAuthority();
  const first = authority.begin(0);
  const second = authority.begin(0);
  assert.equal(authority.isCurrent(first, 0), false);
  assert.equal(authority.isCurrent(second, 0), true);
  assert.equal(authority.isCurrent(second, 1), false);
  authority.invalidate();
  assert.equal(authority.isCurrent(second, 0), false);
});

test("range authority rejects invalid launch identities before advancing", () => {
  const authority = new RangeRequestAuthority();
  for (const launchIndex of [-1, 0.5, Number.NaN, "0"]) {
    assert.throws(() => authority.begin(launchIndex), TypeError);
  }
  const first = authority.begin(0);
  assert.equal(first.generation, 1);
  assert.equal(authority.isCurrent(first, Number.NaN), false);
});

test("a delayed refresh preserves a newer user selection", async () => {
  const guard = new RegistrySelectionGuard("trace-a");
  const registryResponse = deferred();
  const token = guard.beginRefresh();
  const completion = registryResponse.promise.then((traces) =>
    guard.commitRefresh(token, traces),
  );

  guard.select("trace-b");
  registryResponse.resolve([
    { id: "trace-a" },
    { id: "trace-b" },
    { id: "trace-c" },
  ]);

  assert.deepEqual(await completion, {
    current: true,
    selectionChanged: true,
    selectedId: "trace-b",
  });
  assert.equal(guard.selectedId, "trace-b");
});

test("trace cache identity changes with registry size or modification time", () => {
  const original = {
    id: "stable-id",
    size: 10,
    modifiedTime: "2026-07-23T01:00:00.000Z",
  };
  assert.equal(traceCacheKey(original), traceCacheKey({ ...original }));
  assert.notEqual(traceCacheKey(original), traceCacheKey({ ...original, size: 11 }));
  assert.notEqual(
    traceCacheKey(original),
    traceCacheKey({
      ...original,
      modifiedTime: "2026-07-23T01:00:01.000Z",
    }),
  );
});

test("dataset construction uses an asynchronous worker boundary for large inputs", async () => {
  const instrumentation = [];
  let timerFired = false;
  let terminated = false;

  class DelayedWorker {
    constructor(url, options) {
      this.url = url;
      this.options = options;
      this.listeners = new Map();
    }

    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }

    removeEventListener(type, listener) {
      if (this.listeners.get(type) === listener) this.listeners.delete(type);
    }

    postMessage(message) {
      assert.equal(message.rows.length, 100_000);
      setTimeout(() => {
        this.listeners.get("message")?.({
          data: {
            ok: true,
            dataset: { summary: { opsTotal: message.rows.length } },
          },
        });
      }, 10);
    }

    terminate() {
      terminated = true;
    }
  }

  const rows = Array.from({ length: 100_000 }, (_, seq) => ({
    record: "op",
    seq,
  }));
  const building = buildDatasetOffMainThread(rows, {}, {
    WorkerClass: DelayedWorker,
    workerUrl: "dataset-worker.js",
    onStateChange(state) {
      instrumentation.push(state);
    },
  });
  setTimeout(() => {
    timerFired = true;
  }, 0);

  const dataset = await building;
  assert.equal(timerFired, true, "the event loop ran while dataset analysis was pending");
  assert.equal(dataset.summary.opsTotal, 100_000);
  assert.deepEqual(instrumentation, ["posted", "completed"]);
  assert.equal(terminated, true);
});

test("trace fetch, parse, and analysis stay behind one worker boundary", async () => {
  const instrumentation = [];
  const progress = [];
  let terminated = false;

  class TraceWorker {
    constructor(url, options) {
      this.url = url;
      this.options = options;
      this.listeners = new Map();
    }

    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }

    removeEventListener(type, listener) {
      if (this.listeners.get(type) === listener) this.listeners.delete(type);
    }

    postMessage(message) {
      assert.deepEqual(message, {
        type: "load",
        generation: 1,
        url: "/api/traces/trace-id",
      });
      setTimeout(() => {
        this.listeners.get("message")?.({
          data: {
            type: "progress",
            generation: 1,
            progress: {
              sourceBytes: 80,
              totalBytes: 100,
              parsedRows: 12,
              done: false,
            },
          },
        });
        this.listeners.get("message")?.({
          data: {
            type: "ready",
            generation: 1,
            dataset: {
              summary: { opsTotal: 12 },
              diagnostics: { sourceBytes: 100, parsedRows: 12 },
            },
            diagnostics: { sourceBytes: 100, parsedRows: 12 },
          },
        });
      }, 0);
    }

    terminate() {
      terminated = true;
    }
  }

  const loaded = await analyzeTraceOffMainThread(
    "/api/traces/trace-id",
    {
      WorkerClass: TraceWorker,
      workerUrl: "dataset-worker.js",
      onProgress(value) {
        progress.push(value);
      },
      onStateChange(value) {
        instrumentation.push(value);
      },
    },
  );

  assert.equal(loaded.dataset.summary.opsTotal, 12);
  assert.equal(loaded.diagnostics.sourceBytes, 100);
  assert.deepEqual(progress, [
    {
      sourceBytes: 80,
      totalBytes: 100,
      parsedRows: 12,
      done: false,
    },
  ]);
  assert.deepEqual(instrumentation, ["posted", "completed"]);
  assert.equal(terminated, true);
});

test("one-shot trace analysis reports a synchronous post abort only once", async () => {
  const controller = new AbortController();
  const states = [];
  let terminateCalls = 0;
  let removedListeners = 0;

  class AbortDuringPostWorker {
    constructor() {
      this.listeners = new Map();
    }

    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }

    removeEventListener(type, listener) {
      if (this.listeners.get(type) === listener) {
        this.listeners.delete(type);
        removedListeners += 1;
      }
    }

    postMessage() {
      controller.abort();
    }

    terminate() {
      terminateCalls += 1;
    }
  }

  await assert.rejects(
    analyzeTraceOffMainThread("/api/traces/abort", {
      WorkerClass: AbortDuringPostWorker,
      signal: controller.signal,
      onStateChange(state) {
        states.push(state);
      },
    }),
    { name: "AbortError" },
  );
  assert.deepEqual(states, ["aborted"]);
  assert.equal(terminateCalls, 1);
  assert.equal(removedListeners, 2);
});

test("worker payloads retain exact aggregates while bounding timeline records", () => {
  const dispatches = Array.from({ length: 20_000 }, (_, index) => ({
    type: "op",
    seq: index,
    atNs: index,
    commandBufferIndex: index,
  }));
  const commandBuffers = Array.from({ length: 20_000 }, (_, index) => ({
    type: "cb",
    commandBufferIndex: index,
    startNs: index,
    endNs: index + 1,
  }));
  const waits = Array.from({ length: 20_000 }, (_, index) => ({
    type: "wait",
    seq: index,
    atNs: index,
  }));
  const scope = {
    startNs: 0,
    endNs: 20_000,
    dispatches,
    commandBuffers,
    waits,
    kernelCensus: [{ kernel: "k", count: 20_000 }],
    waitTaxonomy: { cap_wait: { count: 20_000, waitNs: 20_000 } },
    summary: {
      opsTotal: 20_000,
      commandBuffersTotal: 20_000,
      waitCount: 20_000,
    },
  };
  const compact = compactDatasetForClient(
    {
      ...scope,
      records: dispatches,
      operations: dispatches,
      ops: dispatches,
      launchWindows: [{ index: 0, ...scope }],
      health: { validEvidence: true },
      diagnostics: { parsedRows: 60_000 },
    },
    {
      maxDispatches: 400,
      maxCommandBuffers: 300,
      maxWaits: 200,
    },
  );

  assert.equal(compact.summary.opsTotal, 20_000);
  assert.equal(compact.launchWindows[0].summary.opsTotal, 20_000);
  assert.equal(compact.launchWindows[0].kernelCensus[0].count, 20_000);
  assert.equal(compact.launchWindows[0].waitTaxonomy.cap_wait.count, 20_000);
  assert.equal(compact.launchWindows[0].dispatches.length, 400);
  assert.equal(compact.launchWindows[0].commandBuffers.length, 300);
  assert.equal(compact.launchWindows[0].waits.length, 200);
  assert.deepEqual(compact.launchWindows[0].renderSampling.dispatches, {
    displayed: 400,
    total: 20_000,
  });
  assert.equal("records" in compact, false);
  assert.equal("operations" in compact, false);
  assert.equal("ops" in compact, false);
  assert.equal(compact.health.validEvidence, true);
  assert.equal(compact.diagnostics.parsedRows, 60_000);
});

test("timeline sampling disclosure distinguishes rendered records from exact totals", () => {
  assert.equal(samplingDisclosure({ renderSampling: { active: false } }), null);
  assert.equal(
    samplingDisclosure({
      renderSampling: {
        active: true,
        dispatches: { displayed: 4_000, total: 330_494 },
        commandBuffers: { displayed: 3_000, total: 65_318 },
        waits: { displayed: 2_000, total: 49_375 },
      },
    }),
    "Canvas sample: 4000 of 330494 dispatches, 3000 of 65318 command buffers, and 2000 of 49375 waits. Headline metrics and tables use the exact full window.",
  );
});

test("loaded tables consume worker summaries without touching raw event collections", () => {
  const throwingEvents = new Proxy([], {
    get(_target, property) {
      throw new Error(`raw event collection was read through ${String(property)}`);
    },
  });
  const kernelCensus = Object.freeze([
    Object.freeze({
      kernel: "kernel_a",
      count: 3,
      setBytesCalls: 5,
      setBytesTotalBytes: 64,
      bufferBinds: 7,
    }),
  ]);
  const waitTaxonomy = Object.freeze({
    cap_wait: Object.freeze({
      bucket: "cap_wait",
      count: 2,
      waitNs: 11,
      waitClass: "cap",
      headlineIncluded: true,
    }),
    sched_worker_wait: Object.freeze({
      bucket: "sched_worker_wait",
      count: 4,
      waitNs: 17,
      waitClass: "other",
      headlineIncluded: false,
    }),
  });
  const scope = {
    dispatches: throwingEvents,
    operations: throwingEvents,
    waits: throwingEvents,
    kernelCensus,
    waitTaxonomy,
  };

  assert.equal(kernelRowsForScope(scope), kernelCensus);
  assert.deepEqual(waitRowsForScope(scope), [
    {
      bucket: "cap_wait",
      count: 2,
      waitNs: 11,
      waitClass: "cap",
      additive: true,
    },
    {
      bucket: "sched_worker_wait",
      count: 4,
      waitNs: 17,
      waitClass: "other",
      additive: false,
    },
  ]);
});

test("progress retains registry size, then exposes overflow without hovering near 100 percent", () => {
  let progress = progressState(
    { sourceBytes: 40, totalBytes: null, parsedRows: 3, done: false },
    { fallbackTotalBytes: 100 },
  );
  assert.equal(progress.estimateBytes, 100);
  assert.equal(progress.max, 100);
  assert.equal(progress.value, 40);
  assert.equal(progress.overflow, false);

  progress = progressState(
    { sourceBytes: 120, totalBytes: null, parsedRows: 9, done: false },
    { fallbackTotalBytes: 100, previousMax: progress.max },
  );
  assert.equal(progress.estimateBytes, 100);
  assert.equal(progress.overflow, true);
  assert.ok(progress.value / progress.max <= 0.5);
  assert.match(progress.readout, /registry estimate exceeded/i);

  progress = progressState(
    { sourceBytes: 230, totalBytes: null, parsedRows: 15, done: false },
    { fallbackTotalBytes: 100, previousMax: progress.max },
  );
  assert.ok(progress.value / progress.max <= 0.9);

  progress = progressState(
    { sourceBytes: 250, totalBytes: null, parsedRows: 20, done: true },
    { fallbackTotalBytes: 100, previousMax: progress.max },
  );
  assert.equal(progress.max, 250);
  assert.equal(progress.value, 250);
});

class FakeElement {
  constructor(documentObject, tagName) {
    this.ownerDocument = documentObject;
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.className = "";
    this.textContent = "";
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = [...children];
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }

  click() {
    this.listeners.get("click")?.({ currentTarget: this });
  }

  querySelectorAll(selector) {
    if (selector !== ".trace-toggle") return [];
    return this.children.filter((child) =>
      String(child.className).split(/\s+/).includes("trace-toggle"),
    );
  }
}

class FakeDocument {
  constructor() {
    this.activeElement = null;
  }

  createElement(tagName) {
    return new FakeElement(this, tagName);
  }

  createTextNode(text) {
    return { textContent: String(text) };
  }
}

function childByClass(element, className) {
  return element.children.find((child) =>
    String(child.className).split(/\s+/).includes(className),
  );
}

test("trace rail exposes model, mode, evidence and retains focus across rerenders", () => {
  const documentObject = new FakeDocument();
  const track = documentObject.createElement("div");
  const traces = [
    { id: "a", label: "Alpha", relativePath: "a.jsonl" },
    { id: "b", label: "Beta", model: "Qwen", mode: "decode", relativePath: "b.jsonl" },
    { id: "c", label: "Gamma", relativePath: "c.jsonl" },
  ];
  const evidence = new Map([
    [
      traceCacheKey(traces[1]),
      { health: { validEvidence: false, sourceCompleteness: "incomplete" } },
    ],
  ]);
  let selectedId = "a";

  const rerender = () =>
    renderTraceRail({
      documentObject,
      track,
      traces,
      selectedId,
      evidenceByCacheKey: evidence,
      onSelect(id) {
        selectedId = id;
        rerender();
      },
    });
  rerender();

  const alpha = track.querySelectorAll(".trace-toggle")[0];
  assert.equal(childByClass(alpha, "trace-model").textContent, "Model: Unknown");
  assert.equal(childByClass(alpha, "trace-mode").textContent, "Mode: Unknown");
  assert.equal(
    childByClass(alpha, "trace-badge").textContent,
    "Not loaded",
  );
  alpha.focus();

  handleTraceRailKey({
    documentObject,
    track,
    event: { key: "ArrowRight", preventDefault() {} },
  });
  assert.equal(selectedId, "b");
  assert.equal(documentObject.activeElement.getAttribute("data-trace-id"), "b");
  assert.equal(
    childByClass(documentObject.activeElement, "trace-model").textContent,
    "Model: Qwen",
  );
  assert.equal(
    childByClass(documentObject.activeElement, "trace-mode").textContent,
    "Mode: decode",
  );
  assert.match(
    childByClass(documentObject.activeElement, "trace-badge").textContent,
    /incomplete/i,
  );

  handleTraceRailKey({
    documentObject,
    track,
    event: { key: "ArrowRight", preventDefault() {} },
  });
  assert.equal(selectedId, "c", "navigation repeats after the rerender");
  assert.equal(documentObject.activeElement.getAttribute("data-trace-id"), "c");
});

test("rail evidence state is honest before and after parsing", () => {
  assert.deepEqual(traceRailState({ model: "", mode: "" }, null), {
    model: "Unknown",
    mode: "Unknown",
    evidence: "Not loaded",
    evidenceValid: null,
  });
  assert.deepEqual(
    traceRailState(
      { model: "Hy3", mode: "MTP K3" },
      { health: { validEvidence: true, sourceCompleteness: "complete" } },
    ),
    {
      model: "Hy3",
      mode: "MTP K3",
      evidence: "Capture complete",
      evidenceValid: true,
    },
  );
});

test("legacy raw provenance remains degraded when the curated artifact is complete", () => {
  const trace = {
    model: "Qwen3.6 35B-A3B",
    mode: "MTP K1",
    valid_evidence: false,
    source_evidence_status: "legacy-unverifiable",
  };
  const dataset = {
    health: {
      validEvidence: true,
      sourceCompleteness: "complete",
    },
  };

  assert.deepEqual(traceRailState(trace, dataset), {
    model: "Qwen3.6 35B-A3B",
    mode: "MTP K1",
    evidence: "Legacy source",
    evidenceValid: false,
  });
  assert.deepEqual(evidenceBadges(dataset, trace), [
    {
      label: "Source: Legacy / unverifiable",
      valid: false,
    },
  ]);
});

test("worker and documentation contracts are external, module-safe, and Node 18 compatible", async () => {
  const [appSource, workerSource, readme] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/dataset-worker.js", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
  ]);
  assert.match(appSource, /new RegistrySelectionGuard\(\)/);
  assert.match(appSource, /commitRefresh\(refreshToken,\s*traces\)/);
  assert.match(appSource, /const cacheKey = traceCacheKey\(trace\)/);
  assert.match(appSource, /cache\.get\(cacheKey\)/);
  assert.match(appSource, /cache\.set\(cacheKey,/);
  assert.match(appSource, /analysisSessionFactory\(\{/);
  assert.match(appSource, /await session\.load\(/);
  assert.match(appSource, /state\.analysisSession\?\.terminate\(\)/);
  assert.doesNotMatch(appSource, /\bbuildDataset\(/);
  assert.match(appSource, /renderProgress\(progress,\s*trace\.size\)/);
  assert.match(appSource, /renderTraceRail\(\{/);
  assert.match(appSource, /handleTraceRailKey\(\{/);
  assert.match(appSource, /const rows = kernelRowsForScope\(scope\)/);
  assert.match(appSource, /const rows = waitRowsForScope\(scope\)/);
  assert.doesNotMatch(appSource, /aggregateKernelRows\(scope\?\.dispatches\)/);
  assert.doesNotMatch(appSource, /aggregateWaitRows\(scope\?\.waits\)/);
  assert.match(
    workerSource,
    /import\s+\{\s*buildDataset,\s*buildRangeScope\s*\}/,
  );
  assert.match(workerSource, /parseNdjsonResponse/);
  assert.match(workerSource, /compactDatasetForClient/);
  assert.match(workerSource, /compactScopeForClient/);
  assert.match(workerSource, /let exactDataset = null/);
  assert.match(workerSource, /let activeGeneration = null/);
  assert.match(workerSource, /type:\s*["']ready["']/);
  assert.match(workerSource, /message\.type === ["']analyze-range["']/);
  assert.match(workerSource, /buildRangeScope\(launch,/);
  assert.match(workerSource, /compactScopeForClient\(range\)/);
  assert.match(workerSource, /addEventListener\(["']message["']/);
  assert.doesNotMatch(workerSource, /\binnerHTML\b/);
  assert.match(readme, /Node\.js 18 or newer/i);
  assert.match(
    readme,
    /`\[` and `\]` move to the previous and next timeline/i,
  );
});
