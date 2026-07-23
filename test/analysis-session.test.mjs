import assert from "node:assert/strict";
import test from "node:test";

import { TraceAnalysisSession } from "../public/analysis-session.js";

class FakeWorker {
  constructor() {
    this.listeners = new Map();
    this.messages = [];
    this.terminateCalls = 0;
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  removeEventListener(type, listener) {
    if (this.listeners.get(type) === listener) {
      this.listeners.delete(type);
    }
  }

  postMessage(message) {
    this.messages.push(message);
  }

  emit(data) {
    this.listeners.get("message")?.({ data });
  }

  emitError(error) {
    this.listeners.get("error")?.({
      error,
      message: error?.message,
    });
  }

  terminate() {
    this.terminateCalls += 1;
  }
}

function workerFactory(worker, constructed = []) {
  return class {
    constructor(url, options) {
      constructed.push({ options, url });
      return worker;
    }
  };
}

async function readySession({
  generation = 1,
  onProgress,
  onStateChange,
} = {}) {
  const worker = new FakeWorker();
  const constructed = [];
  const session = new TraceAnalysisSession({
    WorkerClass: workerFactory(worker, constructed),
    workerUrl: "dataset-worker.js",
    generation,
    onProgress,
    onStateChange,
  });
  const loading = session.load("/api/traces/a");
  worker.emit({
    type: "ready",
    generation,
    dataset: { launchWindows: [{ index: 0 }] },
    diagnostics: { parsedRows: 1 },
  });
  const loaded = await loading;
  return { constructed, loaded, session, worker };
}

test("session retains one module worker after ready and resolves an authoritative range", async () => {
  const progress = [];
  const states = [];
  const worker = new FakeWorker();
  const constructed = [];
  const session = new TraceAnalysisSession({
    WorkerClass: workerFactory(worker, constructed),
    workerUrl: "dataset-worker.js",
    generation: 4,
    onProgress(value) {
      progress.push(value);
    },
    onStateChange(value) {
      states.push(value);
    },
  });

  assert.deepEqual(constructed, [{
    url: "dataset-worker.js",
    options: {
      type: "module",
      name: "metal-dispatch-analysis",
    },
  }]);

  const loading = session.load("/api/traces/a");
  assert.deepEqual(worker.messages[0], {
    type: "load",
    generation: 4,
    url: "/api/traces/a",
  });
  worker.emit({
    type: "progress",
    generation: 99,
    progress: { parsedRows: 99 },
  });
  worker.emit({
    type: "progress",
    generation: 4,
    progress: { parsedRows: 1 },
  });
  worker.emit({
    type: "state",
    generation: 4,
    state: "analyzing",
  });
  worker.emit({
    type: "ready",
    generation: 99,
    dataset: { wrong: true },
  });
  worker.emit({
    type: "ready",
    generation: 4,
    dataset: { launchWindows: [{ index: 0 }] },
    diagnostics: { parsedRows: 1 },
  });

  assert.equal((await loading).dataset.launchWindows[0].index, 0);
  assert.equal(worker.terminateCalls, 0);
  assert.deepEqual(progress, [{ parsedRows: 1 }]);
  assert.deepEqual(states, ["posted", "analyzing"]);

  const analysis = session.analyzeRange({
    launchIndex: 0,
    startNs: 10,
    endNs: 20,
  });
  const request = worker.messages[1];
  assert.deepEqual(request, {
    type: "analyze-range",
    generation: 4,
    requestId: 1,
    launchIndex: 0,
    startNs: 10,
    endNs: 20,
  });
  worker.emit({
    type: "range-result",
    generation: 4,
    requestId: request.requestId,
    launchIndex: 0,
    range: { startNs: 10, endNs: 20 },
    dataset: { summary: { wallSpanNs: 10 } },
  });
  assert.deepEqual(await analysis, {
    type: "range-result",
    generation: 4,
    requestId: 1,
    launchIndex: 0,
    range: { startNs: 10, endNs: 20 },
    dataset: { summary: { wallSpanNs: 10 } },
  });
  assert.equal(worker.terminateCalls, 0);

  session.terminate();
  assert.equal(worker.terminateCalls, 1);
});

test("newer range request aborts the older promise and ignores stale identities", async () => {
  const { session, worker } = await readySession({ generation: 7 });

  const older = session.analyzeRange({
    launchIndex: 0,
    startNs: 0,
    endNs: 10,
  });
  const newer = session.analyzeRange({
    launchIndex: 1,
    startNs: 10,
    endNs: 20,
  });
  await assert.rejects(older, { name: "AbortError" });

  const [olderMessage, newerMessage] = worker.messages.slice(1);
  assert.equal(newerMessage.requestId, olderMessage.requestId + 1);
  let newerSettled = false;
  newer.finally(() => {
    newerSettled = true;
  });

  worker.emit({
    type: "range-result",
    generation: 7,
    requestId: olderMessage.requestId,
    launchIndex: 0,
    range: { startNs: 0, endNs: 10 },
    dataset: { summary: { wallSpanNs: 999 } },
  });
  worker.emit({
    type: "range-result",
    generation: 8,
    requestId: newerMessage.requestId,
    launchIndex: 1,
    range: { startNs: 10, endNs: 20 },
    dataset: { summary: { wallSpanNs: 888 } },
  });
  worker.emit({
    type: "range-result",
    generation: 7,
    requestId: newerMessage.requestId,
    launchIndex: 0,
    range: { startNs: 10, endNs: 20 },
    dataset: { summary: { wallSpanNs: 777 } },
  });
  await Promise.resolve();
  assert.equal(newerSettled, false);

  worker.emit({
    type: "range-result",
    generation: 7,
    requestId: newerMessage.requestId,
    launchIndex: 1,
    range: { startNs: 10, endNs: 20 },
    dataset: { summary: { wallSpanNs: 10 } },
  });
  assert.equal((await newer).dataset.summary.wallSpanNs, 10);
  session.terminate();
});

test("load is single-use and range analysis requires a ready live session", async () => {
  const worker = new FakeWorker();
  const session = new TraceAnalysisSession({
    WorkerClass: workerFactory(worker),
    generation: 3,
  });

  await assert.rejects(
    session.analyzeRange({ launchIndex: 0, startNs: 0, endNs: 1 }),
    /not ready/i,
  );

  const loading = session.load("/api/traces/a");
  await assert.rejects(
    session.load("/api/traces/b"),
    /load already started/i,
  );
  worker.emit({
    type: "ready",
    generation: 3,
    dataset: {},
    diagnostics: {},
  });
  await loading;
  await assert.rejects(
    session.load("/api/traces/c"),
    /load already started/i,
  );

  session.terminate();
  await assert.rejects(
    session.load("/api/traces/d"),
    { name: "AbortError" },
  );
  await assert.rejects(
    session.analyzeRange({ launchIndex: 0, startNs: 0, endNs: 1 }),
    { name: "AbortError" },
  );
});

test("structured worker failures reject only the matching pending request", async () => {
  const worker = new FakeWorker();
  const session = new TraceAnalysisSession({
    WorkerClass: workerFactory(worker),
    generation: 11,
  });
  const loading = session.load("/api/traces/a");
  worker.emit({
    type: "complete",
    generation: 11,
    ok: false,
    error: {
      name: "TraceHttpError",
      message: "Trace download failed.",
      status: 503,
      code: "TRACE_UNAVAILABLE",
    },
  });
  await assert.rejects(loading, (error) => {
    assert.equal(error.name, "TraceHttpError");
    assert.equal(error.message, "Trace download failed.");
    assert.equal(error.status, 503);
    assert.equal(error.code, "TRACE_UNAVAILABLE");
    return true;
  });
  session.terminate();

  const ready = await readySession({ generation: 12 });
  const older = ready.session.analyzeRange({
    launchIndex: 0,
    startNs: 0,
    endNs: 5,
  });
  const newer = ready.session.analyzeRange({
    launchIndex: 0,
    startNs: 5,
    endNs: 10,
  });
  await assert.rejects(older, { name: "AbortError" });
  const [olderMessage, newerMessage] = ready.worker.messages.slice(1);
  ready.worker.emit({
    type: "complete",
    generation: 12,
    requestId: olderMessage.requestId,
    launchIndex: 0,
    ok: false,
    error: { name: "RangeError", message: "stale failure" },
  });
  ready.worker.emit({
    type: "complete",
    generation: 13,
    requestId: newerMessage.requestId,
    launchIndex: 0,
    ok: false,
    error: { name: "RangeError", message: "wrong generation" },
  });
  await Promise.resolve();
  ready.worker.emit({
    type: "complete",
    generation: 12,
    requestId: newerMessage.requestId,
    launchIndex: 0,
    ok: false,
    error: {
      name: "RangeError",
      message: "Range analysis unavailable.",
      code: "RANGE_UNAVAILABLE",
    },
  });
  await assert.rejects(newer, {
    name: "RangeError",
    message: "Range analysis unavailable.",
    code: "RANGE_UNAVAILABLE",
  });
  ready.session.terminate();
});

test("worker and protocol errors reject pending work with useful identities", async () => {
  const worker = new FakeWorker();
  const session = new TraceAnalysisSession({
    WorkerClass: workerFactory(worker),
    generation: 2,
  });
  const loading = session.load("/api/traces/a");
  worker.emit({
    type: "ready",
    generation: 2,
    diagnostics: {},
  });
  await assert.rejects(loading, {
    name: "DatasetWorkerProtocolError",
  });
  session.terminate();

  const secondWorker = new FakeWorker();
  const second = new TraceAnalysisSession({
    WorkerClass: workerFactory(secondWorker),
    generation: 5,
  });
  const secondLoading = second.load("/api/traces/b");
  const crash = new Error("worker crashed");
  crash.name = "WorkerCrashError";
  secondWorker.emitError(crash);
  await assert.rejects(secondLoading, {
    name: "WorkerCrashError",
    message: "worker crashed",
  });
  second.terminate();
});

test("terminate removes listeners, aborts pending work, and terminates exactly once", async () => {
  const { session, worker } = await readySession({ generation: 9 });
  const range = session.analyzeRange({
    launchIndex: 0,
    startNs: 1,
    endNs: 2,
  });

  session.terminate();
  session.terminate();

  await assert.rejects(range, {
    name: "AbortError",
    message: "Trace analysis session terminated.",
  });
  assert.equal(worker.terminateCalls, 1);
  assert.equal(worker.listeners.has("message"), false);
  assert.equal(worker.listeners.has("error"), false);
});

test("dataset worker retains exact rows for range summaries and serializes protocol errors", async (t) => {
  const previousAddEventListener = globalThis.addEventListener;
  const previousPostMessage = globalThis.postMessage;
  const previousFetch = globalThis.fetch;
  let messageListener;
  let fetchTrace;
  let outbound = [];

  globalThis.addEventListener = (type, listener) => {
    if (type === "message") {
      messageListener = listener;
    }
  };
  globalThis.postMessage = (message) => {
    outbound.push(message);
  };
  globalThis.fetch = (...args) => fetchTrace(...args);
  t.after(() => {
    if (previousAddEventListener === undefined) {
      delete globalThis.addEventListener;
    } else {
      globalThis.addEventListener = previousAddEventListener;
    }
    if (previousPostMessage === undefined) {
      delete globalThis.postMessage;
    } else {
      globalThis.postMessage = previousPostMessage;
    }
    if (previousFetch === undefined) {
      delete globalThis.fetch;
    } else {
      globalThis.fetch = previousFetch;
    }
  });

  const rowCount = 5_000;
  const trace = [
    JSON.stringify({
      record: "cb",
      command_buffer_index: 0,
      op_count: rowCount,
      first_op_seq: 0,
      last_op_seq: rowCount - 1,
      encode_start_ns: 0,
      encode_end_ns: 10_000,
      gpu_start_ns: 10_000,
      gpu_end_ns: 20_000,
    }),
    ...Array.from({ length: rowCount }, (_, seq) =>
      JSON.stringify({
        record: "op",
        seq,
        command_buffer_index: 0,
        kernel_name: "exact_kernel",
        kind: "compute",
      }),
    ),
  ].join("\n");
  fetchTrace = async () =>
    new Response(`${trace}\n`, {
      status: 200,
      headers: {
        "Content-Length": String(trace.length + 1),
        "Content-Type": "application/x-ndjson",
      },
    });

  const workerUrl = new URL(
    "../public/dataset-worker.js",
    import.meta.url,
  );
  workerUrl.searchParams.set("test", String(Date.now()));
  await import(workerUrl.href);
  assert.equal(typeof messageListener, "function");

  await messageListener({
    data: {
      type: "load",
      generation: 31,
      url: "/api/traces/exact",
    },
  });
  const progress = outbound.filter((message) => message.type === "progress");
  const state = outbound.find((message) => message.type === "state");
  const ready = outbound.find((message) => message.type === "ready");
  assert.ok(progress.length > 0);
  assert.equal(
    progress.every((message) => message.generation === 31),
    true,
  );
  assert.deepEqual(state, {
    type: "state",
    generation: 31,
    state: "analyzing",
  });
  assert.equal(ready.generation, 31);
  assert.equal(ready.dataset.launchWindows[0].summary.opsTotal, rowCount);
  assert.equal(ready.dataset.launchWindows[0].dispatches.length, 4_000);

  outbound = [];
  await messageListener({
    data: {
      type: "analyze-range",
      generation: 31,
      requestId: 1,
      launchIndex: 0,
      startNs: 0,
      endNs: 20_000,
    },
  });
  assert.equal(outbound.length, 1);
  assert.deepEqual(
    {
      type: outbound[0].type,
      generation: outbound[0].generation,
      requestId: outbound[0].requestId,
      launchIndex: outbound[0].launchIndex,
      range: outbound[0].range,
    },
    {
      type: "range-result",
      generation: 31,
      requestId: 1,
      launchIndex: 0,
      range: { startNs: 0, endNs: 20_000 },
    },
  );
  assert.equal(outbound[0].dataset.summary.opsTotal, rowCount);
  assert.equal(outbound[0].dataset.dispatches.length, 4_000);

  outbound = [];
  await messageListener({
    data: {
      type: "analyze-range",
      generation: 30,
      requestId: 2,
      launchIndex: 4,
      startNs: 0,
      endNs: 1,
    },
  });
  assert.deepEqual(
    {
      type: outbound[0].type,
      generation: outbound[0].generation,
      requestId: outbound[0].requestId,
      launchIndex: outbound[0].launchIndex,
      ok: outbound[0].ok,
      errorName: outbound[0].error.name,
    },
    {
      type: "complete",
      generation: 30,
      requestId: 2,
      launchIndex: 4,
      ok: false,
      errorName: "Error",
    },
  );

  outbound = [];
  fetchTrace = async () => {
    const error = new Error("Trace network unavailable.");
    error.name = "TraceNetworkError";
    error.status = 502;
    error.code = "TRACE_NETWORK";
    throw error;
  };
  await messageListener({
    data: {
      type: "load",
      generation: 32,
      url: "/api/traces/offline",
    },
  });
  assert.deepEqual(outbound, [{
    type: "complete",
    generation: 32,
    ok: false,
    error: {
      name: "TraceNetworkError",
      message: "Trace network unavailable.",
      status: 502,
      code: "TRACE_NETWORK",
    },
  }]);

  outbound = [];
  await messageListener({ data: { rows: [], diagnostics: {} } });
  assert.equal(outbound.length, 1);
  assert.equal(outbound[0].ok, true);
  assert.equal(outbound[0].type, undefined);
});
