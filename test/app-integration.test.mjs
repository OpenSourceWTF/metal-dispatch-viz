import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  analyzeTraceOffMainThread,
  buildDatasetOffMainThread,
  evidenceBadges,
  handleTraceRailKey,
  kernelRowsForScope,
  progressState,
  RegistrySelectionGuard,
  renderTraceRail,
  samplingDisclosure,
  traceCacheKey,
  traceRailState,
  waitRowsForScope,
} from "../public/app.js";
import { compactDatasetForClient } from "../public/client-dataset.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, reject, resolve };
}

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
        url: "/api/traces/trace-id",
      });
      setTimeout(() => {
        this.listeners.get("message")?.({
          data: {
            type: "progress",
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
            type: "complete",
            ok: true,
            dataset: {
              summary: { opsTotal: 12 },
              diagnostics: { sourceBytes: 100, parsedRows: 12 },
            },
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
  assert.match(appSource, /await traceAnalyzer\(/);
  assert.doesNotMatch(appSource, /\bbuildDataset\(/);
  assert.match(appSource, /renderProgress\(progress,\s*trace\.size\)/);
  assert.match(appSource, /renderTraceRail\(\{/);
  assert.match(appSource, /handleTraceRailKey\(\{/);
  assert.match(appSource, /const rows = kernelRowsForScope\(scope\)/);
  assert.match(appSource, /const rows = waitRowsForScope\(scope\)/);
  assert.doesNotMatch(appSource, /aggregateKernelRows\(scope\?\.dispatches\)/);
  assert.doesNotMatch(appSource, /aggregateWaitRows\(scope\?\.waits\)/);
  assert.match(workerSource, /import\s+\{\s*buildDataset\s*\}/);
  assert.match(workerSource, /parseNdjsonResponse/);
  assert.match(workerSource, /compactDatasetForClient/);
  assert.match(workerSource, /addEventListener\(["']message["']/);
  assert.doesNotMatch(workerSource, /\binnerHTML\b/);
  assert.match(readme, /Node\.js 18 or newer/i);
  assert.match(
    readme,
    /`\[` and `\]` move to the previous and next timeline/i,
  );
});
