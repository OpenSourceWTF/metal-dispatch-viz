import assert from "node:assert/strict";
import test from "node:test";

import {
  TIMELINE_DRAW_ORDER,
  TIMELINE_LANES,
  TimelineRenderer,
  buildDensityBins,
  clampViewport,
  shouldUseDensity,
  timeToX,
  xToTime,
} from "../public/timeline.js";

function dispatch(atNs, kernel = "kernel", commandBufferIndex = 0, seq = atNs) {
  return {
    type: "op",
    atNs,
    kernel,
    commandBufferIndex,
    seq,
    placement: "ordered",
    placementDetail: "interpolated-sequence",
  };
}

function dataset({
  dispatches = [],
  commandBuffers = [],
  waits = [],
  launchWindows = [],
  startNs = 0,
  endNs = 100,
} = {}) {
  return {
    dispatches,
    commandBuffers,
    waits,
    launchWindows,
    summary: { startNs, endNs },
  };
}

function createEnvironment({
  width = 600,
  height = 306,
  initialAttributes = {},
} = {}) {
  const listeners = new Map();
  const removed = [];
  const contextCalls = [];
  const context = new Proxy(
    {
      measureText(text) {
        return { width: String(text).length * 6 };
      },
      createPattern() {
        return "pattern";
      },
      setLineDash(value) {
        contextCalls.push(["setLineDash", value]);
      },
    },
    {
      get(target, property) {
        if (property in target) return target[property];
        if (typeof property === "symbol") return undefined;
        return (...args) => contextCalls.push([property, ...args]);
      },
      set(target, property, value) {
        contextCalls.push([`set:${property}`, value]);
        target[property] = value;
        return true;
      },
    },
  );

  const bodyChildren = [];
  const createdCanvases = [];
  const makeElement = () => ({
    style: {},
    textContent: "",
    className: "",
    setAttribute() {},
    remove() {
      const index = bodyChildren.indexOf(this);
      if (index >= 0) bodyChildren.splice(index, 1);
    },
  });
  const document = {
    body: {
      append(element) {
        bodyChildren.push(element);
      },
    },
    createElement(tagName) {
      if (String(tagName).toLowerCase() === "canvas") {
        const backbuffer = {
          width: 0,
          height: 0,
          style: {},
          getContext(kind) {
            assert.equal(kind, "2d");
            return context;
          },
        };
        createdCanvases.push(backbuffer);
        return backbuffer;
      }
      return makeElement();
    },
  };
  let nextRaf = 1;
  const rafs = new Map();
  const window = {
    devicePixelRatio: 2,
    document,
    getComputedStyle() {
      return { getPropertyValue: () => "" };
    },
    matchMedia() {
      return { matches: false };
    },
    requestAnimationFrame(callback) {
      const id = nextRaf++;
      rafs.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      rafs.delete(id);
    },
  };
  document.defaultView = window;

  const canvasAttributes = new Map(Object.entries(initialAttributes));
  const canvas = {
    ownerDocument: document,
    style: {},
    width: 0,
    height: 0,
    tabIndex: Number(initialAttributes.tabindex ?? -1),
    attributes: canvasAttributes,
    getContext(kind) {
      assert.equal(kind, "2d");
      return context;
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, width, height };
    },
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    },
    getAttribute(name) {
      return this.attributes.get(name) ?? null;
    },
    removeAttribute(name) {
      this.attributes.delete(name);
    },
    addEventListener(type, listener, options) {
      listeners.set(type, { listener, options });
    },
    removeEventListener(type, listener, options) {
      removed.push({ type, listener, options });
      if (listeners.get(type)?.listener === listener) listeners.delete(type);
    },
    setPointerCapture() {},
    releasePointerCapture() {},
    focus() {},
  };

  class FakeResizeObserver {
    static instances = [];

    constructor(callback) {
      this.callback = callback;
      this.disconnected = false;
      FakeResizeObserver.instances.push(this);
    }

    observe(target) {
      this.target = target;
    }

    disconnect() {
      this.disconnected = true;
    }
  }
  window.ResizeObserver = FakeResizeObserver;

  function flushAnimationFrame() {
    const pending = [...rafs.entries()];
    rafs.clear();
    for (const [, callback] of pending) callback(0);
  }

  function emit(type, overrides = {}) {
    const entry = listeners.get(type);
    assert.ok(entry, `missing ${type} listener`);
    entry.listener({
      clientX: 20,
      clientY: 150,
      pointerId: 1,
      button: 0,
      deltaY: 0,
      preventDefault() {},
      ...overrides,
    });
  }

  return {
    bodyChildren,
    canvas,
    contextCalls,
    createdCanvases,
    emit,
    FakeResizeObserver,
    flushAnimationFrame,
    listeners,
    removed,
    window,
  };
}

test("density bins preserve visible valid dispatch counts and deterministic ties", () => {
  const bins = buildDensityBins(
    [
      dispatch(0, "zeta"),
      dispatch(1, "zeta"),
      dispatch(1, "alpha"),
      dispatch(2, "alpha"),
      dispatch(10, "outside"),
      dispatch(null, "unplaced"),
      dispatch(Number.NaN, "invalid"),
    ],
    { startNs: 0, endNs: 4, width: 2 },
  );

  assert.equal(bins.reduce((sum, bin) => sum + bin.count, 0), 4);
  assert.deepEqual(
    bins.map(({ index, count, dominantKernel }) => ({
      index,
      count,
      dominantKernel,
    })),
    [
      { index: 0, count: 3, dominantKernel: "zeta" },
      { index: 1, count: 1, dominantKernel: "alpha" },
    ],
  );

  const tied = buildDensityBins(
    [dispatch(1, "zeta"), dispatch(1, "alpha")],
    { startNs: 0, endNs: 2, width: 1 },
  );
  assert.equal(tied[0].dominantKernel, "alpha");
});

test("density bins handle endpoint visibility and malformed geometry", () => {
  assert.deepEqual(
    buildDensityBins([dispatch(0), dispatch(10)], {
      startNs: 0,
      endNs: 10,
      width: 10,
    }).map((bin) => bin.index),
    [0, 9],
  );
  assert.deepEqual(buildDensityBins([], { startNs: 0, endNs: 1, width: 2 }), []);
  assert.deepEqual(
    buildDensityBins([dispatch(0)], { startNs: 1, endNs: 1, width: 2 }),
    [],
  );
  assert.deepEqual(
    buildDensityBins([dispatch(0)], { startNs: 0, endNs: 1, width: 0 }),
    [],
  );
  assert.deepEqual(
    buildDensityBins([dispatch(0)], {
      startNs: -Number.MAX_VALUE,
      endNs: Number.MAX_VALUE,
      width: 2,
    }),
    [],
  );
});

test("time transforms round-trip and never produce non-finite output", () => {
  const viewport = { startNs: 10, endNs: 110 };
  for (const time of [10, 25, 60, 110]) {
    assert.ok(Math.abs(xToTime(timeToX(time, viewport, 500), viewport, 500) - time) < 1e-9);
  }
  assert.equal(timeToX(10, { startNs: 3, endNs: 3 }, 0), 0);
  assert.equal(xToTime(Number.NaN, { startNs: 3, endNs: 3 }, 0), 3);
  assert.ok(Number.isFinite(timeToX(Number.POSITIVE_INFINITY, viewport, 500)));
  assert.ok(Number.isFinite(xToTime(Number.POSITIVE_INFINITY, viewport, 500)));
});

test("time transforms and clamping reject ranges with an overflowing span", () => {
  const overflowRange = {
    startNs: -Number.MAX_VALUE,
    endNs: Number.MAX_VALUE,
  };

  assert.equal(timeToX(Number.MAX_VALUE, overflowRange, 500), 0);
  assert.equal(xToTime(250, overflowRange, 500), -Number.MAX_VALUE);
  assert.deepEqual(clampViewport(overflowRange, overflowRange), {
    startNs: 0,
    endNs: 1,
  });
});

test("clamping preserves a valid span at bounds and applies zoom limits", () => {
  assert.deepEqual(
    clampViewport({ startNs: -20, endNs: 30 }, { startNs: 0, endNs: 100 }),
    { startNs: 0, endNs: 50 },
  );
  assert.deepEqual(
    clampViewport({ startNs: 90, endNs: 140 }, { startNs: 0, endNs: 100 }),
    { startNs: 50, endNs: 100 },
  );
  assert.deepEqual(
    clampViewport({ startNs: -100, endNs: 500 }, { startNs: 0, endNs: 100 }),
    { startNs: 0, endNs: 100 },
  );
  const tiny = clampViewport({ startNs: 50, endNs: 50 }, { startNs: 0, endNs: 100 });
  assert.equal(tiny.endNs - tiny.startNs, 1);
  assert.deepEqual(
    clampViewport({ startNs: Number.NaN, endNs: Infinity }, { startNs: 4, endNs: 9 }),
    { startNs: 4, endNs: 9 },
  );
});

test("lane geometry, draw order, and density threshold are stable contracts", () => {
  assert.deepEqual(TIMELINE_LANES, {
    ruler: { y: 0, height: 28 },
    host: { y: 28, height: 68 },
    gpu: { y: 96, height: 68 },
    waits: { y: 164, height: 46 },
    dispatch: { y: 210, height: 72 },
    footer: { y: 282, height: 24 },
    totalHeight: 306,
  });
  assert.deepEqual(TIMELINE_DRAW_ORDER, [
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
  assert.equal(shouldUseDensity([dispatch(0), dispatch(10)], { startNs: 0, endNs: 100 }, 100), false);
  assert.equal(
    shouldUseDensity(
      Array.from({ length: 40 }, (_, atNs) => dispatch(atNs)),
      { startNs: 0, endNs: 100 },
      100,
    ),
    true,
  );
});

test("renderer links dispatch and command-buffer selection and ignores unplaced ops", () => {
  const environment = createEnvironment({ width: 100, height: 306 });
  const inspected = [];
  const renderer = new TimelineRenderer(environment.canvas, {
    onInspect(payload) {
      inspected.push(payload);
    },
  });
  renderer.setDataset(
    dataset({
      dispatches: [
        dispatch(20, "placed", 7, 1),
        dispatch(null, "unplaced", 7, 2),
      ],
      commandBuffers: [
        {
          type: "cb",
          commandBufferIndex: 7,
          encodeStartNs: 10,
          encodeEndNs: 30,
          gpuStartNs: 35,
          gpuEndNs: 50,
          exposedIntervals: [[10, 30]],
          hiddenIntervals: [],
          firstOpSeq: 1,
          lastOpSeq: 2,
        },
      ],
    }),
  );
  renderer.render();

  assert.equal(renderer.lastRenderStats.visibleDispatches, 1);
  assert.equal(renderer.lastRenderStats.unplacedDispatches, 1);
  renderer.selectDispatch(renderer.visibleDispatches[0]);
  renderer.render();
  assert.equal(renderer.selection.commandBuffer.commandBufferIndex, 7);
  assert.equal(renderer.selection.dispatch.kernel, "placed");
  assert.equal(renderer.lastRenderStats.selectedCommandBufferIndex, 7);

  const payload = renderer.inspect(renderer.visibleDispatches[0]);
  assert.match(payload.text, /ordered placement/i);
  assert.ok(payload.values.every((entry) => /^(measured|derived|ordered|metadata)$/.test(entry.provenance)));
  assert.equal(inspected.at(-1), payload);
  const unplacedPayload = renderer.inspect(renderer.unplacedDispatches[0]);
  assert.match(unplacedPayload.text, /unplaced/i);
  assert.equal(
    unplacedPayload.values.find((entry) => entry.label === "time").provenance,
    "ordered",
  );
  assert.doesNotMatch(unplacedPayload.text, /\[measured\].*unplaced/i);
  renderer.destroy();
});

test("renderer keeps zero-op command buffers visible when an interval exists", () => {
  const environment = createEnvironment();
  const renderer = new TimelineRenderer(environment.canvas);
  renderer.setDataset(
    dataset({
      waits: [
        {
          type: "wait",
          commandBufferIndex: 10,
          atNs: 60,
          waitNs: 5,
          waitClass: "cap",
        },
      ],
      commandBuffers: [
        {
          type: "cb",
          commandBufferIndex: 9,
          opCount: 0,
          gpuStartNs: 40,
          gpuEndNs: 41,
          exposedIntervals: [],
          hiddenIntervals: [],
        },
        {
          type: "cb",
          commandBufferIndex: 10,
          opCount: 0,
          exposedIntervals: [],
          hiddenIntervals: [],
        },
      ],
    }),
  );
  renderer.render();
  assert.equal(renderer.lastRenderStats.zeroOpHairlines, 2);
  renderer.destroy();
});

test("renderer pre-indexes 320k dispatches and simple pan visits only visible dispatches", () => {
  const environment = createEnvironment({ width: 1000 });
  const renderer = new TimelineRenderer(environment.canvas);
  const dispatches = Array.from({ length: 320_000 }, (_, atNs) =>
    dispatch(atNs, `k${atNs % 7}`, Math.floor(atNs / 100), atNs),
  );
  renderer.setDataset(dataset({ dispatches, startNs: 0, endNs: 319_999 }));
  renderer.viewport = { startNs: 100_000, endNs: 100_100 };
  renderer.render();

  assert.equal(renderer.lastRenderStats.indexedDispatches, 320_000);
  assert.equal(renderer.lastRenderStats.visibleDispatches, 101);
  assert.ok(renderer.lastRenderStats.dispatchesVisited <= 103);

  renderer.viewport = { startNs: 200_000, endNs: 200_100 };
  renderer.render();
  assert.equal(renderer.lastRenderStats.visibleDispatches, 101);
  assert.ok(renderer.lastRenderStats.dispatchesVisited <= 103);
  renderer.destroy();
});

test("repeated fit-scale density renders reuse cached 320k analytical geometry", (t) => {
  const environment = createEnvironment({ width: 1000 });
  const renderer = new TimelineRenderer(environment.canvas);
  const dispatches = Array.from({ length: 320_000 }, (_, atNs) =>
    dispatch(atNs, `k${atNs % 11}`, 12, atNs),
  );
  renderer.setDataset(dataset({ dispatches, startNs: 0, endNs: 319_999 }));

  const firstStarted = performance.now();
  renderer.render();
  const firstElapsedMs = performance.now() - firstStarted;
  assert.equal(renderer.lastRenderStats.densityMode, true);
  assert.equal(renderer.lastRenderStats.densityCacheHit, false);
  assert.equal(renderer.lastRenderStats.dispatchesVisited, 320_000);
  assert.equal(renderer.lastRenderStats.dispatchesBinned, 320_000);

  renderer.crosshairX = 333;
  const secondStarted = performance.now();
  renderer.render();
  const secondElapsedMs = performance.now() - secondStarted;
  assert.equal(renderer.lastRenderStats.densityCacheHit, true);
  assert.equal(renderer.lastRenderStats.dispatchesVisited, 0);
  assert.equal(renderer.lastRenderStats.dispatchesBinned, 0);
  assert.ok(
    secondElapsedMs < Math.max(20, firstElapsedMs),
    `cached ${secondElapsedMs.toFixed(2)}ms vs first ${firstElapsedMs.toFixed(2)}ms`,
  );
  t.diagnostic(
    `320k fit: first=${firstElapsedMs.toFixed(2)}ms/visited=320000/binned=320000 ` +
      `repeat=${secondElapsedMs.toFixed(2)}ms/visited=0/binned=0`,
  );
  renderer.destroy();
});

test("identical and edge-clamped viewport sync preserves renderer caches", () => {
  const environment = createEnvironment({ width: 100 });
  const renderer = new TimelineRenderer(environment.canvas);
  const dispatches = Array.from({ length: 1_000 }, (_, atNs) =>
    dispatch(atNs, `k${atNs % 5}`, 0, atNs),
  );
  renderer.setDataset(
    dataset({
      dispatches,
      commandBuffers: [
        {
          type: "cb",
          commandBufferIndex: 0,
          opCount: dispatches.length,
          encodeStartNs: 0,
          encodeEndNs: 100,
          gpuStartNs: 10,
          gpuEndNs: 90,
          exposedIntervals: [[0, 10]],
          hiddenIntervals: [[10, 100]],
        },
      ],
      startNs: 0,
      endNs: 999,
    }),
  );
  renderer.setViewport({ startNs: 0, endNs: 100 }, { notify: false });
  renderer.render();
  assert.equal(renderer.lastRenderStats.densityMode, true);
  assert.equal(renderer.lastRenderStats.densityCacheHit, false);
  assert.equal(renderer.lastRenderStats.staticLayerCacheHit, false);

  const analysisCache = renderer.analysisCache;
  const staticLayerCache = renderer.staticLayerCache;
  renderer.setViewport({ startNs: 0, endNs: 100 }, { notify: false });
  assert.equal(renderer.analysisCache, analysisCache);
  assert.equal(renderer.staticLayerCache, staticLayerCache);
  renderer.render();
  assert.equal(renderer.lastRenderStats.densityCacheHit, true);
  assert.equal(renderer.lastRenderStats.staticLayerCacheHit, true);

  renderer.setViewport({ startNs: -50, endNs: 50 }, { notify: false });
  assert.deepEqual(renderer.viewport, { startNs: 0, endNs: 100 });
  assert.equal(renderer.analysisCache, analysisCache);
  assert.equal(renderer.staticLayerCache, staticLayerCache);
  renderer.render();
  assert.equal(renderer.lastRenderStats.densityCacheHit, true);
  assert.equal(renderer.lastRenderStats.staticLayerCacheHit, true);

  renderer.setViewport({ startNs: -50, endNs: 50 }, { notify: false });
  assert.equal(renderer.analysisCache, analysisCache);
  assert.equal(renderer.staticLayerCache, staticLayerCache);
  renderer.render();
  assert.equal(renderer.lastRenderStats.densityCacheHit, true);
  assert.equal(renderer.lastRenderStats.staticLayerCacheHit, true);
  renderer.destroy();
});

test("crosshair frames reuse static 10k-CB/13k-wait lanes and hit targets", (t) => {
  const environment = createEnvironment({ width: 1000 });
  const renderer = new TimelineRenderer(environment.canvas);
  const dispatches = Array.from({ length: 320_000 }, (_, atNs) =>
    dispatch(atNs, `k${atNs % 11}`, Math.floor(atNs / 32), atNs),
  );
  const commandBuffers = Array.from({ length: 10_000 }, (_, index) => {
    const startNs = index * 30;
    return {
      type: "cb",
      commandBufferIndex: index,
      opCount: 32,
      encodeStartNs: startNs,
      encodeEndNs: startNs + 8,
      gpuStartNs: startNs + 8,
      gpuEndNs: startNs + 12,
      exposedIntervals: [[startNs, startNs + 4]],
      hiddenIntervals: [[startNs + 4, startNs + 8]],
    };
  });
  const waits = Array.from({ length: 13_000 }, (_, index) => ({
    type: "wait",
    atNs: index * 20,
    waitNs: 2,
    waitClass: index % 3 === 0 ? "dependency" : index % 3 === 1 ? "cap" : "decision",
    commandBufferIndex: index % 10_000,
  }));
  renderer.setDataset(
    dataset({
      dispatches,
      commandBuffers,
      waits,
      startNs: 0,
      endNs: 319_999,
    }),
  );

  renderer.render();
  const firstHitTargets = renderer.hitTargets;
  assert.equal(renderer.lastRenderStats.staticLayerCacheHit, false);
  assert.equal(renderer.lastRenderStats.commandBuffersVisited, 10_000);
  assert.equal(renderer.lastRenderStats.waitsVisited, 13_000);
  assert.ok(renderer.lastRenderStats.staticHitTargetsRebuilt >= 40_000);
  assert.equal(environment.createdCanvases.length, 1);

  environment.contextCalls.length = 0;
  renderer.crosshairX = 500;
  const repeatStarted = performance.now();
  renderer.render();
  const repeatElapsedMs = performance.now() - repeatStarted;
  assert.equal(renderer.lastRenderStats.staticLayerCacheHit, true);
  assert.equal(renderer.lastRenderStats.commandBuffersVisited, 0);
  assert.equal(renderer.lastRenderStats.waitsVisited, 0);
  assert.equal(renderer.lastRenderStats.staticHitTargetsRebuilt, 0);
  assert.equal(renderer.hitTargets, firstHitTargets);
  assert.ok(
    environment.contextCalls.some(([method]) => method === "drawImage"),
    "cached static canvas is blitted to the visible canvas",
  );
  assert.ok(
    repeatElapsedMs < 20,
    `cached 10k-CB/13k-wait frame took ${repeatElapsedMs.toFixed(2)}ms`,
  );
  t.diagnostic(
    `10k CB + 13k waits repeat=${repeatElapsedMs.toFixed(2)}ms ` +
      `targets=${renderer.hitTargets.length} CB-visits=0 wait-visits=0`,
  );
  renderer.destroy();
});

test("renderer coalesces frames, scales for DPR, and completely tears down lifecycle state", () => {
  const environment = createEnvironment({ width: 450, height: 400 });
  const renderer = new TimelineRenderer(environment.canvas);
  renderer.setDataset(dataset());
  renderer.render();
  assert.equal(environment.canvas.width, 900);
  assert.equal(environment.canvas.height, 800);
  assert.equal(environment.canvas.style.height, undefined);
  assert.equal(renderer.height, 400);
  assert.equal(renderer.laneScaleY, 400 / TIMELINE_LANES.totalHeight);
  assert.ok(
    environment.contextCalls.some(
      ([method, xScale, , , yScale]) =>
        method === "setTransform" &&
        xScale === 2 &&
        Math.abs(yScale - (800 / TIMELINE_LANES.totalHeight)) < 1e-9,
    ),
    "logical lanes scale to the measured CSS canvas height",
  );
  assert.equal(environment.canvas.attributes.get("role"), "img");
  assert.match(environment.canvas.attributes.get("aria-description"), /timeline/i);
  assert.equal(environment.bodyChildren.length, 1);

  const anchorBefore = xToTime(225, renderer.viewport, 450);
  environment.emit("wheel", { clientX: 225, deltaY: -10 });
  const anchorAfter = xToTime(225, renderer.viewport, 450);
  assert.ok(Math.abs(anchorAfter - anchorBefore) < 1e-9);
  environment.emit("pointermove", { clientX: 230, clientY: 100 });
  assert.equal(renderer.framePending, true);
  environment.flushAnimationFrame();
  assert.equal(renderer.framePending, false);

  const listenerCount = environment.listeners.size;
  assert.ok(listenerCount >= 9);
  renderer.destroy();
  assert.equal(environment.listeners.size, 0);
  assert.equal(environment.removed.length, listenerCount);
  assert.equal(environment.FakeResizeObserver.instances[0].disconnected, true);
  assert.equal(environment.bodyChildren.length, 0);
  assert.equal(renderer.destroyed, true);
});

test("360–440px canvases keep logical lanes, hit targets, and pointer mapping aligned", () => {
  for (const height of [360, 440]) {
    const environment = createEnvironment({ width: 200, height });
    const renderer = new TimelineRenderer(environment.canvas);
    const item = dispatch(50, `kernel-${height}`);
    renderer.setDataset(dataset({ dispatches: [item] }));
    renderer.render();

    const scale = height / TIMELINE_LANES.totalHeight;
    assert.equal(environment.canvas.height, height * 2);
    assert.equal(renderer.height, height);
    assert.ok(
      Math.abs(
        renderer.pointForEvent({ clientX: 100, clientY: height }).y -
          TIMELINE_LANES.totalHeight,
      ) < 1e-9,
    );

    const target = renderer.hitTargets.find(
      ({ kind, item: targetItem }) => kind === "op" && targetItem === item,
    );
    assert.ok(target, `${height}px canvas has a dispatch hit target`);
    const clientX = target.x + target.width / 2;
    const clientY = (target.y + target.height / 2) * scale;
    environment.emit("pointermove", { clientX, clientY });
    assert.equal(renderer.hovered, item);
    environment.emit("pointerdown", { clientX, clientY });
    environment.emit("pointerup", { clientX, clientY });
    assert.equal(renderer.selection.dispatch, item);

    renderer.clearSelection();
    renderer.handleKeyDown({ key: "]", preventDefault() {} });
    environment.contextCalls.length = 0;
    renderer.render();
    assert.equal(renderer.keyboardActive, item);
    assert.ok(
      environment.contextCalls.some(
        ([method, , , , yScale]) =>
          method === "setTransform" &&
          Math.abs(yScale - (2 * scale)) < 1e-9,
      ),
      `${height}px canvas installs the scaled lane transform`,
    );
    assert.ok(
      environment.contextCalls.some(
        ([method, , y]) =>
          method === "lineTo" && y === TIMELINE_LANES.totalHeight,
      ),
      "keyboard crosshair spans the complete logical plot",
    );
    renderer.destroy();
  }
});

test("tooltip colors remain live semantic theme references", () => {
  const environment = createEnvironment();
  const renderer = new TimelineRenderer(environment.canvas);
  const tooltip = environment.bodyChildren[0];

  assert.equal(tooltip.style.border, "1px solid var(--rule)");
  assert.equal(tooltip.style.background, "var(--canvas)");
  assert.equal(tooltip.style.color, "var(--text)");
  assert.doesNotMatch(tooltip.style.border, /#[0-9a-f]{3,8}/i);
  assert.doesNotMatch(tooltip.style.background, /#[0-9a-f]{3,8}/i);
  assert.doesNotMatch(tooltip.style.color, /#[0-9a-f]{3,8}/i);

  renderer.destroy();
});

test("renderer activates and restores a shell-disabled canvas", () => {
  const environment = createEnvironment({
    initialAttributes: {
      "aria-disabled": "true",
      tabindex: "-1",
    },
  });
  const renderer = new TimelineRenderer(environment.canvas);
  assert.equal(environment.canvas.tabIndex, 0);
  assert.equal(environment.canvas.getAttribute("tabindex"), "0");
  assert.equal(environment.canvas.getAttribute("aria-disabled"), "false");

  renderer.destroy();
  assert.equal(environment.canvas.tabIndex, -1);
  assert.equal(environment.canvas.getAttribute("tabindex"), "-1");
  assert.equal(environment.canvas.getAttribute("aria-disabled"), "true");
});

test("fit accepts a selected launch window without escaping dataset bounds", () => {
  const environment = createEnvironment();
  const renderer = new TimelineRenderer(environment.canvas);
  const selectedWindow = { startNs: 20, endNs: 40 };
  renderer.setDataset(
    dataset({
      launchWindows: [selectedWindow],
      startNs: 0,
      endNs: 100,
    }),
    selectedWindow,
  );
  assert.deepEqual(renderer.viewport, selectedWindow);
  renderer.fit({ startNs: -20, endNs: 30 });
  assert.deepEqual(renderer.viewport, { startNs: 0, endNs: 50 });
  renderer.destroy();
});

test("visible evidence snapshot copies viewport evidence and discloses unplaceable records", () => {
  const environment = createEnvironment({ width: 40 });
  const renderer = new TimelineRenderer(environment.canvas);
  const crossing = {
    type: "cb",
    commandBufferIndex: 1,
    encodeStartNs: 10,
    encodeEndNs: 70,
    gpuStartNs: 70,
    gpuEndNs: 110,
    exposedIntervals: [[10, 40]],
    raw: { source: { row: 1 } },
  };
  const outside = {
    type: "cb",
    commandBufferIndex: 2,
    encodeStartNs: 0,
    encodeEndNs: 10,
    gpuStartNs: 10,
    gpuEndNs: 19,
  };
  const visibleDispatch = dispatch(50, "visible", 1, 1);
  const endDispatch = dispatch(80, "endpoint", 1, 2);
  const unplacedDispatch = dispatch(null, "unplaced", 1, 3);
  const visibleWait = {
    type: "wait",
    bucket: "cap_wait",
    waitClass: "cap",
    waitNs: 5,
    atNs: 60,
    atNsSource: "event-timestamp",
  };
  const unanchoredWait = {
    type: "wait",
    bucket: "sched_worker_wait",
    waitClass: "other",
    waitNs: 7,
    atNs: null,
  };
  renderer.setDataset(
    dataset({
      dispatches: [
        dispatch(20, "outside", 2, 0),
        visibleDispatch,
        endDispatch,
        unplacedDispatch,
      ],
      commandBuffers: [outside, crossing],
      waits: [
        { type: "wait", waitNs: 1, atNs: 19 },
        visibleWait,
        unanchoredWait,
      ],
      startNs: 0,
      endNs: 120,
    }),
  );
  renderer.viewport = { startNs: 40, endNs: 80 };

  const snapshot = renderer.visibleEvidenceSnapshot();

  assert.deepEqual(snapshot.viewport, { startNs: 40, endNs: 80 });
  assert.deepEqual(snapshot.commandBuffers, [crossing]);
  assert.deepEqual(snapshot.dispatches, [visibleDispatch, endDispatch]);
  assert.deepEqual(snapshot.waits, [visibleWait]);
  assert.equal(snapshot.unplacedDispatchCount, 1);
  assert.equal(snapshot.unanchoredWaitCount, 1);
  assert.equal(snapshot.densityMode, false);
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.viewport));
  assert.ok(Object.isFrozen(snapshot.commandBuffers));
  assert.ok(Object.isFrozen(snapshot.dispatches));
  assert.ok(Object.isFrozen(snapshot.waits));
  assert.notEqual(snapshot.viewport, renderer.viewport);
  assert.notEqual(snapshot.commandBuffers, renderer.commandBuffers);
  assert.notEqual(snapshot.dispatches, renderer.placedDispatches);
  assert.notEqual(snapshot.waits, renderer.sortedWaits);
  assert.notEqual(snapshot.commandBuffers[0], crossing);
  assert.notEqual(snapshot.dispatches[0], visibleDispatch);
  assert.notEqual(snapshot.waits[0], visibleWait);
  assert.ok(Object.isFrozen(snapshot.commandBuffers[0]));
  assert.ok(Object.isFrozen(snapshot.commandBuffers[0].exposedIntervals));
  assert.ok(Object.isFrozen(snapshot.commandBuffers[0].exposedIntervals[0]));
  assert.ok(Object.isFrozen(snapshot.commandBuffers[0].raw.source));
  assert.ok(Object.isFrozen(snapshot.dispatches[0]));
  assert.ok(Object.isFrozen(snapshot.waits[0]));

  assert.throws(() => {
    snapshot.commandBuffers[0].encodeStartNs = 999;
  }, TypeError);
  assert.throws(() => {
    snapshot.commandBuffers[0].exposedIntervals[0][0] = 999;
  }, TypeError);
  assert.throws(() => {
    snapshot.commandBuffers[0].raw.source.row = 999;
  }, TypeError);
  assert.throws(() => {
    snapshot.dispatches[0].kernel = "mutated";
  }, TypeError);
  assert.throws(() => {
    snapshot.waits[0].waitNs = 999;
  }, TypeError);
  assert.equal(crossing.encodeStartNs, 10);
  assert.deepEqual(crossing.exposedIntervals, [[10, 40]]);
  assert.equal(crossing.raw.source.row, 1);
  assert.equal(visibleDispatch.kernel, "visible");
  assert.equal(visibleWait.waitNs, 5);

  renderer.viewport.startNs = 45;
  renderer.commandBuffers.push(outside);
  assert.deepEqual(snapshot.viewport, { startNs: 40, endNs: 80 });
  assert.deepEqual(snapshot.commandBuffers, [crossing]);
  renderer.destroy();
});

test("visible evidence snapshot maps a horizontally scrolled pixel window to timeline bounds", () => {
  const environment = createEnvironment({ width: 720 });
  const renderer = new TimelineRenderer(environment.canvas);
  const left = {
    type: "cb",
    commandBufferIndex: 1,
    encodeStartNs: 0,
    encodeEndNs: 20,
  };
  const middle = {
    type: "cb",
    commandBufferIndex: 2,
    encodeStartNs: 20,
    encodeEndNs: 80,
  };
  const right = {
    type: "cb",
    commandBufferIndex: 3,
    encodeStartNs: 80,
    encodeEndNs: 100,
  };
  renderer.setDataset(
    dataset({
      commandBuffers: [left, middle, right],
      dispatches: [
        dispatch(10, "left", 1),
        dispatch(40, "middle", 2),
        dispatch(90, "right", 3),
      ],
      waits: [
        { type: "wait", atNs: 15, waitNs: 1 },
        { type: "wait", atNs: 60, waitNs: 2 },
        { type: "wait", atNs: 95, waitNs: 3 },
      ],
      startNs: 0,
      endNs: 100,
    }),
  );

  const snapshot = renderer.visibleEvidenceSnapshot({
    scrollLeft: 180,
    clientWidth: 360,
  });

  assert.deepEqual(snapshot.viewport, { startNs: 25, endNs: 75 });
  assert.deepEqual(
    snapshot.commandBuffers.map(({ commandBufferIndex }) => commandBufferIndex),
    [2],
  );
  assert.deepEqual(snapshot.dispatches.map(({ kernel }) => kernel), ["middle"]);
  assert.deepEqual(snapshot.waits.map(({ waitNs }) => waitNs), [2]);

  const clamped = renderer.visibleEvidenceSnapshot({
    startPx: -100,
    endPx: 900,
  });
  assert.deepEqual(clamped.viewport, { startNs: 0, endNs: 100 });
  renderer.destroy();
});

test("visible evidence snapshot includes command-buffer hairlines from partial endpoints", () => {
  const environment = createEnvironment({ width: 100 });
  const renderer = new TimelineRenderer(environment.canvas);
  renderer.setDataset(
    dataset({
      commandBuffers: [
        {
          type: "cb",
          commandBufferIndex: 7,
          opCount: 0,
          gpuStartNs: 50,
        },
      ],
      waits: [
        {
          type: "wait",
          commandBufferIndex: 7,
          atNs: 50,
          waitNs: 3,
        },
      ],
      startNs: 0,
      endNs: 100,
    }),
  );
  renderer.render();

  assert.ok(
    renderer.hitTargets.some(
      ({ kind, item }) =>
        kind === "cb" && item.commandBufferIndex === 7,
    ),
  );
  assert.ok(
    renderer
      .visibleEvidenceSnapshot()
      .commandBuffers.some(({ commandBufferIndex }) => commandBufferIndex === 7),
  );
  renderer.destroy();
});

test("clipped snapshot preserves the renderer full-viewport density mode", () => {
  const environment = createEnvironment({ width: 720 });
  const renderer = new TimelineRenderer(environment.canvas);
  const dispatches = [
    ...Array.from({ length: 149 }, (_, index) =>
      dispatch((index * 24) / 148, "left-dense", 1, index)),
    dispatch(30, "clipped-left", 2, 149),
    dispatch(70, "clipped-right", 2, 150),
    ...Array.from({ length: 149 }, (_, index) =>
      dispatch(76 + (index * 24) / 148, "right-dense", 3, index + 151)),
  ];
  renderer.setDataset(dataset({ dispatches, startNs: 0, endNs: 100 }));
  renderer.render();
  assert.equal(renderer.lastRenderStats.densityMode, true);

  const snapshot = renderer.visibleEvidenceSnapshot({
    startPx: 180,
    endPx: 540,
  });

  assert.deepEqual(snapshot.viewport, { startNs: 25, endNs: 75 });
  assert.deepEqual(
    snapshot.dispatches.map(({ kernel }) => kernel),
    ["clipped-left", "clipped-right"],
  );
  assert.equal(
    shouldUseDensity(snapshot.dispatches, snapshot.viewport, 720),
    false,
    "the clipped records alone would be rendered sparsely",
  );
  assert.equal(snapshot.densityMode, true);
  assert.equal(
    snapshot.densityModeBasis,
    "renderer-full-logical-viewport",
  );
  renderer.destroy();
});

test("crosshair spans every fixed lane and footer names ordered placement", () => {
  const environment = createEnvironment({ width: 200 });
  const renderer = new TimelineRenderer(environment.canvas);
  renderer.setDataset(dataset({ dispatches: [dispatch(50)] }));
  renderer.crosshairX = 50;
  environment.contextCalls.length = 0;
  renderer.render();

  assert.ok(
    environment.contextCalls.some(
      ([method, x, y]) => method === "moveTo" && x === 50.5 && y === 0,
    ),
    "crosshair begins above the ruler",
  );
  assert.ok(
    environment.contextCalls.some(
      ([method, x, y]) =>
        method === "lineTo" && x === 50.5 && y === TIMELINE_LANES.totalHeight,
    ),
    "crosshair ends below the footer",
  );
  assert.ok(
    environment.contextCalls.some(
      ([method, text]) =>
        method === "fillText" && /\bordered placement\b/.test(String(text)),
    ),
    "footer visibly identifies dispatch timestamps as ordered placement",
  );
  assert.ok(
    renderer.lastRenderStats.drawOrder.indexOf("crosshair") <
      renderer.lastRenderStats.drawOrder.indexOf("labels"),
  );
  renderer.destroy();
});

test("setDataset clears pinned selection, tooltip, and inspector state", () => {
  const environment = createEnvironment();
  const inspected = [];
  const renderer = new TimelineRenderer(environment.canvas, {
    onInspect(payload) {
      inspected.push(payload);
    },
  });
  const firstDispatch = dispatch(20, "first", 1);
  renderer.setDataset(dataset({ dispatches: [firstDispatch] }));
  renderer.render();
  assert.ok(renderer.hitTargets.length > 0);
  renderer.selectDispatch(firstDispatch);
  renderer.showTooltip(renderer.inspect(firstDispatch), {
    clientX: 20,
    clientY: 220,
  });
  assert.equal(environment.bodyChildren[0].style.display, "block");

  renderer.setDataset(dataset({ dispatches: [dispatch(30, "second", 2)] }));
  assert.equal(renderer.hitTargets.length, 0);
  environment.emit("pointermove", { clientX: 120, clientY: 240 });
  environment.emit("pointerdown", { clientX: 120, clientY: 240 });
  environment.emit("pointerup", { clientX: 120, clientY: 240 });
  assert.deepEqual(renderer.selection, {
    dispatch: null,
    commandBuffer: null,
    wait: null,
    bin: null,
  });
  assert.equal(renderer.hovered, null);
  assert.equal(environment.bodyChildren[0].style.display, "none");
  assert.equal(inspected.at(-1), null);
  renderer.destroy();
});

test("selected density bin gets an explicit outline and links a sole parent CB", () => {
  const environment = createEnvironment({ width: 20 });
  const renderer = new TimelineRenderer(environment.canvas);
  const commandBuffer = {
    type: "cb",
    commandBufferIndex: 7,
    encodeStartNs: 0,
    encodeEndNs: 100,
    exposedIntervals: [[0, 100]],
    hiddenIntervals: [],
  };
  renderer.setDataset(
    dataset({
      dispatches: Array.from({ length: 20 }, (_, index) =>
        dispatch(index, "dense", 7, index)),
      commandBuffers: [commandBuffer],
    }),
  );
  renderer.render();
  const bin = renderer.hitTargets.find((target) => target.kind === "dispatch-bin")?.item;
  assert.ok(bin);
  environment.contextCalls.length = 0;
  renderer.selectItem(bin);
  renderer.render();

  assert.equal(renderer.selection.bin, bin);
  assert.equal(renderer.selection.commandBuffer, commandBuffer);
  assert.ok(
    environment.contextCalls.some(
      ([method, , y, , height]) =>
        method === "strokeRect" &&
        y === TIMELINE_LANES.dispatch.y + 6 &&
        height === TIMELINE_LANES.dispatch.height - 12,
    ),
    "selected density pixel/interval is visibly outlined",
  );
  renderer.destroy();
});

test("bracket keys move an active timeline mark and Enter pins it", () => {
  const inspected = [];
  const environment = createEnvironment({ width: 200 });
  const renderer = new TimelineRenderer(environment.canvas, {
    onInspect(payload) {
      inspected.push(payload);
    },
  });
  const first = dispatch(10, "first", 0, 1);
  const second = dispatch(20, "second", 0, 2);
  const wait = {
    type: "wait",
    bucket: "cap_wait",
    waitClass: "cap",
    waitNs: 2,
    atNs: 15,
  };
  renderer.setDataset(
    dataset({
      dispatches: [first, second],
      waits: [wait],
      startNs: 0,
      endNs: 30,
    }),
  );

  const keys = [];
  const press = (key) =>
    renderer.handleKeyDown({
      key,
      preventDefault() {
        keys.push(key);
      },
    });
  press("]");
  assert.equal(renderer.keyboardActive, first);
  press("]");
  assert.equal(renderer.keyboardActive, wait);
  press("[");
  assert.equal(renderer.keyboardActive, first);
  press("Enter");
  assert.equal(renderer.selection.dispatch, first);
  assert.equal(inspected.at(-1).item, first);
  assert.deepEqual(keys, ["]", "]", "[", "Enter"]);
  renderer.destroy();
});

test("range dataset keeps complete launch navigation bounds", () => {
  const environment = createEnvironment();
  const changes = [];
  const renderer = new TimelineRenderer(environment.canvas, {
    onViewportChange(range) {
      changes.push(range);
    },
  });
  renderer.setDataset(
    {
      startNs: 40,
      endNs: 60,
      commandBuffers: [],
      dispatches: [],
      waits: [],
    },
    {
      bounds: { startNs: 0, endNs: 100 },
      viewport: { startNs: 40, endNs: 60 },
    },
  );

  assert.deepEqual(renderer.bounds, { startNs: 0, endNs: 100 });
  assert.deepEqual(renderer.viewport, { startNs: 40, endNs: 60 });
  assert.deepEqual(renderer.setViewport({ startNs: 90, endNs: 120 }), {
    startNs: 70,
    endNs: 100,
  });
  assert.deepEqual(changes.at(-1), { startNs: 70, endNs: 100 });
  renderer.destroy();
});

test("setDataset rejects overflow-width launch bounds and viewports", () => {
  const environment = createEnvironment();
  const renderer = new TimelineRenderer(environment.canvas);
  const overflowRange = {
    startNs: -Number.MAX_VALUE,
    endNs: Number.MAX_VALUE,
  };

  renderer.setDataset(dataset({ startNs: 10, endNs: 20 }), {
    bounds: overflowRange,
    viewport: overflowRange,
  });
  assert.deepEqual(renderer.bounds, { startNs: 10, endNs: 20 });
  assert.deepEqual(renderer.viewport, { startNs: 10, endNs: 20 });

  renderer.setDataset(dataset({
    commandBuffers: [{
      type: "cb",
      commandBufferIndex: 0,
      encodeStartNs: overflowRange.startNs,
      encodeEndNs: overflowRange.endNs,
    }],
    startNs: overflowRange.startNs,
    endNs: overflowRange.endNs,
  }));
  assert.deepEqual(renderer.bounds, { startNs: 0, endNs: 1 });
  assert.deepEqual(renderer.viewport, { startNs: 0, endNs: 1 });
  renderer.destroy();
});

test("external viewport update can avoid a synchronization callback", () => {
  const environment = createEnvironment();
  let notifications = 0;
  const renderer = new TimelineRenderer(environment.canvas, {
    onViewportChange() {
      notifications += 1;
    },
  });
  renderer.setDataset(
    { startNs: 0, endNs: 100 },
    { bounds: { startNs: 0, endNs: 100 } },
  );
  renderer.setViewport({ startNs: 10, endNs: 30 }, { notify: false });
  assert.equal(notifications, 0);
  assert.deepEqual(renderer.viewport, { startNs: 10, endNs: 30 });
  renderer.destroy();
});

test("pointer pans emit transient viewport changes and exactly one committed release", () => {
  const environment = createEnvironment({ width: 200 });
  const changes = [];
  const renderer = new TimelineRenderer(environment.canvas, {
    onViewportChange(range, metadata) {
      changes.push({ range, metadata });
    },
  });
  renderer.setDataset(dataset({ startNs: 0, endNs: 200 }), {
    bounds: { startNs: 0, endNs: 200 },
    viewport: { startNs: 50, endNs: 150 },
  });

  environment.emit("pointerdown", { clientX: 100, pointerId: 7 });
  environment.emit("pointermove", { clientX: 80, pointerId: 7 });
  environment.emit("pointermove", { clientX: 60, pointerId: 7 });
  assert.equal(changes.length, 2);
  assert.ok(changes.every(({ metadata }) => metadata.committed === false));
  assert.ok(changes.every(({ metadata }) => metadata.source === "pointer-pan"));

  environment.emit("pointerup", { clientX: 60, pointerId: 7 });
  assert.equal(changes.length, 3);
  assert.deepEqual(changes.at(-1), {
    range: renderer.viewport,
    metadata: { committed: true, source: "pointer-pan" },
  });

  renderer.handleKeyDown({ key: "ArrowLeft", preventDefault() {} });
  assert.deepEqual(changes.at(-1).metadata, {
    committed: true,
    source: "keyboard",
  });
  renderer.destroy();
});

test("sub-threshold pointer jitter still commits a viewport change on release", () => {
  const environment = createEnvironment({ width: 200 });
  const changes = [];
  const renderer = new TimelineRenderer(environment.canvas, {
    onViewportChange(range, metadata) {
      changes.push({ range, metadata });
    },
  });
  renderer.setDataset(dataset({ startNs: 0, endNs: 200 }), {
    bounds: { startNs: 0, endNs: 200 },
    viewport: { startNs: 50, endNs: 150 },
  });

  environment.emit("pointerdown", { clientX: 100, pointerId: 8 });
  environment.emit("pointermove", { clientX: 99, pointerId: 8 });
  assert.deepEqual(changes.at(-1).metadata, {
    committed: false,
    source: "pointer-pan",
  });
  const changedViewport = { ...renderer.viewport };

  environment.emit("pointerup", { clientX: 99, pointerId: 8 });
  assert.deepEqual(changes.at(-1), {
    range: changedViewport,
    metadata: { committed: true, source: "pointer-pan" },
  });
  assert.equal(changes.length, 2);
  renderer.destroy();
});

test("dataset replacement preserves a drag only within identical launch bounds", () => {
  const environment = createEnvironment({ width: 200 });
  const renderer = new TimelineRenderer(environment.canvas);
  renderer.setDataset(dataset({ startNs: 0, endNs: 100 }), {
    bounds: { startNs: 0, endNs: 100 },
    viewport: { startNs: 20, endNs: 80 },
    interactionIdentity: "trace-a:launch-0",
  });

  environment.emit("pointerdown", { clientX: 100, pointerId: 9 });
  environment.emit("pointermove", { clientX: 90, pointerId: 9 });
  const activeDrag = renderer.drag;
  renderer.setDataset(dataset({ startNs: 0, endNs: 100 }), {
    bounds: { startNs: 0, endNs: 100 },
    viewport: renderer.viewport,
    interactionIdentity: "trace-a:launch-0",
    preservePointerDrag: true,
  });
  assert.equal(renderer.drag, activeDrag);

  renderer.setDataset(dataset({ startNs: 0, endNs: 100 }), {
    bounds: { startNs: 0, endNs: 100 },
    viewport: renderer.viewport,
    interactionIdentity: "trace-b:launch-0",
    preservePointerDrag: true,
  });
  assert.equal(renderer.drag, null);

  environment.emit("pointerdown", { clientX: 100, pointerId: 10 });
  environment.emit("pointermove", { clientX: 90, pointerId: 10 });
  renderer.setDataset(dataset({ startNs: 200, endNs: 300 }), {
    bounds: { startNs: 200, endNs: 300 },
    viewport: { startNs: 220, endNs: 280 },
    interactionIdentity: "trace-b:launch-0",
    preservePointerDrag: true,
  });
  assert.equal(renderer.drag, null);
  renderer.destroy();
});
