import assert from "node:assert/strict";
import test from "node:test";

import {
  RangeNavigator,
  clampSelectedRange,
  moveSelectedRange,
  resizeSelectedRange,
  sliderStepNs,
} from "../public/range-navigator.js";

const bounds = Object.freeze({ startNs: 0, endNs: 1_000 });

test("selected range clamps without changing duration at launch edges", () => {
  assert.deepEqual(
    clampSelectedRange({ startNs: -50, endNs: 150 }, bounds, 10),
    { startNs: 0, endNs: 200 },
  );
  assert.deepEqual(
    clampSelectedRange({ startNs: 900, endNs: 1_200 }, bounds, 10),
    { startNs: 700, endNs: 1_000 },
  );
});

test("band movement and handle resize stay inside launch bounds", () => {
  assert.deepEqual(
    moveSelectedRange({ startNs: 200, endNs: 400 }, 750, bounds),
    { startNs: 800, endNs: 1_000 },
  );
  assert.deepEqual(
    resizeSelectedRange(
      { startNs: 200, endNs: 400 },
      "start",
      399,
      bounds,
      25,
    ),
    { startNs: 375, endNs: 400 },
  );
  assert.deepEqual(
    resizeSelectedRange(
      { startNs: 200, endNs: 400 },
      "end",
      100,
      bounds,
      25,
    ),
    { startNs: 200, endNs: 225 },
  );
});

test("slider steps are one or ten percent of the launch", () => {
  assert.equal(sliderStepNs(bounds, false), 10);
  assert.equal(sliderStepNs(bounds, true), 100);
});

test("range geometry never exceeds a shorter launch or accepts an unknown edge", () => {
  assert.deepEqual(
    clampSelectedRange(
      { startNs: 0.25, endNs: 0.5 },
      { startNs: 0, endNs: 1 },
      10,
    ),
    { startNs: 0, endNs: 1 },
  );
  assert.throws(
    () => resizeSelectedRange(
      { startNs: 0, endNs: 1 },
      "middle",
      0.5,
      { startNs: 0, endNs: 1 },
    ),
    /edge/i,
  );
});

test("range geometry rejects non-finite inputs before reaching DOM styles", () => {
  assert.throws(
    () => clampSelectedRange(
      { startNs: Number.NaN, endNs: 1 },
      { startNs: 0, endNs: 1 },
    ),
    /finite/i,
  );
  assert.throws(
    () => moveSelectedRange(
      { startNs: 0, endNs: 1 },
      Number.POSITIVE_INFINITY,
      { startNs: 0, endNs: 10 },
    ),
    /finite/i,
  );
  assert.throws(
    () => sliderStepNs({ startNs: 2, endNs: 2 }, false),
    /positive/i,
  );
});

function eventTarget(extra = {}) {
  const listeners = new Map();
  return {
    attributes: new Map(),
    style: {},
    listeners,
    addEventListener(type, listener) {
      const handlers = listeners.get(type) ?? new Set();
      handlers.add(listener);
      listeners.set(type, handlers);
    },
    removeEventListener(type, listener) {
      const handlers = listeners.get(type);
      handlers?.delete(listener);
      if (handlers?.size === 0) listeners.delete(type);
    },
    dispatch(type, overrides = {}) {
      const event = {
        type,
        button: 0,
        pointerId: 1,
        clientX: 0,
        key: "",
        shiftKey: false,
        preventDefault() {},
        ...overrides,
      };
      for (const listener of [...(listeners.get(type) ?? [])]) {
        listener(event);
      }
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
    ...extra,
  };
}

function navigatorFixture({ width = 500, height = 58 } = {}) {
  const drawCalls = [];
  const context = new Proxy(
    {
      setLineDash(value) {
        drawCalls.push(["setLineDash", value]);
      },
    },
    {
      get(target, property) {
        if (property in target) return target[property];
        if (typeof property === "symbol") return undefined;
        return (...args) => drawCalls.push([property, ...args]);
      },
      set(target, property, value) {
        drawCalls.push([`set:${property}`, value]);
        target[property] = value;
        return true;
      },
    },
  );

  let nextAnimationFrame = 1;
  const animationFrames = new Map();
  const windowObject = eventTarget({
    devicePixelRatio: 2,
    requestAnimationFrame(callback) {
      const id = nextAnimationFrame++;
      animationFrames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      animationFrames.delete(id);
    },
    getComputedStyle() {
      return { getPropertyValue: () => "" };
    },
  });

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
  windowObject.ResizeObserver = FakeResizeObserver;

  const document = { defaultView: windowObject };
  const captures = [];
  const releases = [];
  const capturable = () => ({
    setPointerCapture(pointerId) {
      captures.push([this, pointerId]);
    },
    releasePointerCapture(pointerId) {
      releases.push([this, pointerId]);
    },
  });
  const canvas = eventTarget({
    ownerDocument: document,
    width: 0,
    height: 0,
    getBoundingClientRect() {
      return { left: 0, top: 0, width, height };
    },
    getContext(kind) {
      assert.equal(kind, "2d");
      return context;
    },
  });
  const band = eventTarget(capturable());
  const startHandle = eventTarget(capturable());
  const endHandle = eventTarget(capturable());
  const summary = eventTarget({ textContent: "" });

  return {
    canvas,
    band,
    startHandle,
    endHandle,
    summary,
    window: windowObject,
    windowObject,
    captures,
    releases,
    drawCalls,
    FakeResizeObserver,
    flushAnimationFrames() {
      const pending = [...animationFrames.values()];
      animationFrames.clear();
      for (const callback of pending) callback(0);
    },
  };
}

function oneBinOverview(startNs = 0, endNs = 1_000) {
  return {
    startNs,
    endNs,
    binCount: 1,
    bins: [{
      hostEncodeNs: endNs - startNs,
      gpuBusyNs: (endNs - startNs) / 2,
      dispatchCount: 2,
      waitCount: 0,
    }],
  };
}

function pointerEvent(pointerId, clientX) {
  return {
    pointerId,
    clientX,
    button: 0,
    preventDefault() {},
  };
}

test("handle keyboard commits an accessible range update", () => {
  const fixture = navigatorFixture();
  const commits = [];
  const navigator = new RangeNavigator(fixture, {
    onRangeCommit(range) {
      commits.push(range);
    },
  });
  navigator.setOverview(oneBinOverview());
  navigator.setRange({ startNs: 200, endNs: 400 });
  fixture.startHandle.dispatch("keydown", {
    key: "ArrowRight",
    shiftKey: false,
    preventDefault() {},
  });

  assert.deepEqual(commits.at(-1), { startNs: 210, endNs: 400 });
  assert.equal(fixture.startHandle.attributes.get("role"), "slider");
  assert.equal(fixture.startHandle.attributes.get("aria-valuenow"), "210");
  assert.equal(fixture.band.style.left, "21%");
  assert.equal(fixture.band.style.width, "19%");
  assert.equal(fixture.startHandle.style.left, "0%");
  assert.equal(fixture.endHandle.style.left, "100%");
  navigator.destroy();
});

test("band pointer drag emits transient updates and one committed range", () => {
  const fixture = navigatorFixture({ width: 1_000 });
  const inputs = [];
  const commits = [];
  const navigator = new RangeNavigator(fixture, {
    onRangeInput: (range) => inputs.push(range),
    onRangeCommit: (range) => commits.push(range),
  });
  navigator.setOverview(oneBinOverview());
  navigator.setRange({ startNs: 200, endNs: 400 });
  fixture.band.dispatch("pointerdown", pointerEvent(1, 300));
  fixture.window.dispatch("pointermove", pointerEvent(1, 500));
  fixture.window.dispatch("pointerup", pointerEvent(1, 500));

  assert.deepEqual(inputs.at(-1), { startNs: 400, endNs: 600 });
  assert.deepEqual(commits, [{ startNs: 400, endNs: 600 }]);
  navigator.destroy();
});

test("handle drags use pointer capture and enforce one overview pixel", () => {
  const fixture = navigatorFixture({ width: 500 });
  const inputs = [];
  const commits = [];
  const navigator = new RangeNavigator(fixture, {
    onRangeInput: (range) => inputs.push(range),
    onRangeCommit: (range) => commits.push(range),
  });
  navigator.setOverview(oneBinOverview());
  navigator.setRange({ startNs: 200, endNs: 400 });
  fixture.startHandle.dispatch("pointerdown", pointerEvent(7, 200));
  fixture.window.dispatch("pointermove", pointerEvent(7, 399.9));
  fixture.window.dispatch("pointerup", pointerEvent(7, 399.9));

  assert.deepEqual(inputs.at(-1), { startNs: 398, endNs: 400 });
  assert.deepEqual(commits, [{ startNs: 398, endNs: 400 }]);
  assert.deepEqual(
    fixture.captures.map(([, pointerId]) => pointerId),
    [7],
  );
  assert.deepEqual(
    fixture.releases.map(([, pointerId]) => pointerId),
    [7],
  );
  navigator.destroy();
});

test("pointer cancellation restores the pre-drag range without committing", () => {
  const fixture = navigatorFixture({ width: 1_000 });
  const inputs = [];
  const commits = [];
  const navigator = new RangeNavigator(fixture, {
    onRangeInput: (range) => inputs.push(range),
    onRangeCommit: (range) => commits.push(range),
  });
  navigator.setOverview(oneBinOverview());
  navigator.setRange({ startNs: 200, endNs: 400 });
  fixture.band.dispatch("pointerdown", pointerEvent(4, 300));
  fixture.window.dispatch("pointermove", pointerEvent(4, 500));
  fixture.window.dispatch("pointercancel", pointerEvent(4, 500));

  assert.deepEqual(inputs, [
    { startNs: 400, endNs: 600 },
    { startNs: 200, endNs: 400 },
  ]);
  assert.deepEqual(commits, []);
  assert.equal(fixture.startHandle.attributes.get("aria-valuenow"), "200");
  assert.deepEqual(
    fixture.releases.map(([, pointerId]) => pointerId),
    [4],
  );
  navigator.destroy();
});

test("an overview click recenters and immediately commits the selection", () => {
  const fixture = navigatorFixture({ width: 1_000 });
  const inputs = [];
  const commits = [];
  const navigator = new RangeNavigator(fixture, {
    onRangeInput: (range) => inputs.push(range),
    onRangeCommit: (range) => commits.push(range),
  });
  navigator.setOverview(oneBinOverview());
  navigator.setRange({ startNs: 200, endNs: 400 });
  fixture.canvas.dispatch("pointerdown", pointerEvent(1, 800));

  assert.deepEqual(inputs, [{ startNs: 700, endNs: 900 }]);
  assert.deepEqual(commits, [{ startNs: 700, endNs: 900 }]);
  navigator.destroy();
});

test("keyboard supports shifted steps and launch-edge Home and End", () => {
  const fixture = navigatorFixture({ width: 1_000 });
  const commits = [];
  const navigator = new RangeNavigator(fixture, {
    onRangeCommit: (range) => commits.push(range),
  });
  navigator.setOverview(oneBinOverview());
  navigator.setRange({ startNs: 200, endNs: 400 });

  fixture.endHandle.dispatch("keydown", {
    key: "ArrowRight",
    shiftKey: true,
    preventDefault() {},
  });
  assert.deepEqual(commits.at(-1), { startNs: 200, endNs: 500 });

  fixture.startHandle.dispatch("keydown", {
    key: "Home",
    preventDefault() {},
  });
  assert.deepEqual(commits.at(-1), { startNs: 0, endNs: 500 });

  fixture.endHandle.dispatch("keydown", {
    key: "End",
    preventDefault() {},
  });
  assert.deepEqual(commits.at(-1), { startNs: 0, endNs: 1_000 });

  fixture.startHandle.dispatch("keydown", {
    key: "End",
    preventDefault() {},
  });
  assert.deepEqual(commits.at(-1), { startNs: 999, endNs: 1_000 });
  assert.match(
    fixture.startHandle.attributes.get("aria-valuetext"),
    /from launch start/,
  );
  navigator.destroy();
});

test("disabled navigator blocks input and exposes its state accessibly", () => {
  const fixture = navigatorFixture({ width: 1_000 });
  const commits = [];
  const navigator = new RangeNavigator(fixture, {
    onRangeCommit: (range) => commits.push(range),
  });
  navigator.setOverview(oneBinOverview());
  navigator.setRange({ startNs: 200, endNs: 400 });
  navigator.setDisabled(true);
  fixture.startHandle.dispatch("keydown", {
    key: "ArrowRight",
    preventDefault() {},
  });
  fixture.band.dispatch("pointerdown", pointerEvent(1, 300));
  fixture.window.dispatch("pointermove", pointerEvent(1, 500));
  fixture.window.dispatch("pointerup", pointerEvent(1, 500));

  assert.deepEqual(commits, []);
  assert.equal(fixture.startHandle.attributes.get("aria-disabled"), "true");
  assert.equal(fixture.startHandle.attributes.get("tabindex"), "-1");
  navigator.destroy();
});

test("overview renders exact bins at device resolution with an accessible summary", () => {
  const fixture = navigatorFixture({ width: 512, height: 58 });
  const navigator = new RangeNavigator(fixture);
  const bins = Array.from({ length: 512 }, (_, index) => ({
    startNs: index,
    endNs: index + 1,
    hostEncodeNs: index === 0 ? 1 : 0,
    gpuBusyNs: index === 0 ? 0.5 : 0,
    dispatchCount: index === 0 ? 2 : 0,
    waitCount: index === 0 ? 4 : 0,
    waitClasses:
      index === 0 ? ["cap", "decision", "dependency", "other"] : [],
  }));
  navigator.setOverview({
    startNs: 0,
    endNs: 512,
    binCount: 512,
    bins,
  });
  fixture.flushAnimationFrames();

  assert.equal(fixture.canvas.width, 1_024);
  assert.equal(fixture.canvas.height, 116);
  assert.match(fixture.summary.textContent, /512 overview bins/);
  assert.equal(
    fixture.canvas.attributes.get("aria-label"),
    fixture.summary.textContent,
  );
  const fills = fixture.drawCalls.filter(([method]) => method === "fillRect");
  assert.ok(fills.some(([, , y]) => y === 7), "host is drawn in the upper lane");
  assert.ok(fills.some(([, , y]) => y === 27), "GPU is drawn below host");
  assert.ok(
    fills.some(([, , y, , drawHeight]) => y === 0 && drawHeight === 58),
    "wait tick spans the overview",
  );
  assert.ok(
    fixture.drawCalls.some(
      ([method, value]) =>
        method === "set:strokeStyle" && value === "#b49cff",
    ),
    "dependency waits retain their purple treatment",
  );
  assert.ok(
    fixture.drawCalls.some(
      ([method, value]) =>
        method === "setLineDash" &&
        Array.isArray(value) &&
        value.join(",") === "3,2",
    ),
    "dependency waits retain a dashed shape",
  );
  navigator.destroy();
});

test("destroy removes every listener, observer, and pending frame without callbacks", () => {
  const fixture = navigatorFixture();
  const inputs = [];
  const commits = [];
  const navigator = new RangeNavigator(fixture, {
    onRangeInput: (range) => inputs.push(range),
    onRangeCommit: (range) => commits.push(range),
  });
  navigator.setOverview(oneBinOverview());
  navigator.setRange({ startNs: 200, endNs: 400 });
  fixture.band.dispatch("pointerdown", pointerEvent(9, 300));
  navigator.destroy();
  fixture.flushAnimationFrames();

  for (const target of [
    fixture.canvas,
    fixture.band,
    fixture.startHandle,
    fixture.endHandle,
    fixture.window,
  ]) {
    assert.equal(target.listeners.size, 0);
  }
  assert.equal(fixture.FakeResizeObserver.instances[0].disconnected, true);
  assert.deepEqual(inputs, []);
  assert.deepEqual(commits, []);
});
