function abortError(message = "The operation was superseded.") {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function protocolError(message) {
  const error = new Error(message);
  error.name = "DatasetWorkerProtocolError";
  return error;
}

function structuredWorkerError(payload, fallback) {
  if (payload instanceof Error) {
    return payload;
  }
  const error = new Error(payload?.message ?? fallback);
  error.name = payload?.name ?? "DatasetWorkerError";
  if (Number.isInteger(payload?.status)) {
    error.status = payload.status;
  }
  if (typeof payload?.code === "string") {
    error.code = payload.code;
  }
  return error;
}

export class TraceAnalysisSession {
  constructor({
    WorkerClass = globalThis.Worker,
    workerUrl = new URL("./dataset-worker.js", import.meta.url),
    generation = 1,
    onProgress,
    onStateChange,
  } = {}) {
    if (typeof WorkerClass !== "function") {
      throw new TypeError("Trace analysis requires Web Worker support.");
    }

    this.generation = generation;
    this.onProgress = onProgress;
    this.onStateChange = onStateChange;
    this.requestId = 0;
    this.loadStarted = false;
    this.ready = false;
    this.terminated = false;
    this.loadPending = null;
    this.rangePending = null;
    this.worker = new WorkerClass(workerUrl, {
      type: "module",
      name: "metal-dispatch-analysis",
    });
    this.onMessage = (event) => this.handleMessage(event?.data);
    this.onError = (event) => {
      this.ready = false;
      this.failAll(
        structuredWorkerError(
          event?.error,
          event?.message ?? "Trace worker failed.",
        ),
      );
    };
    this.worker.addEventListener("message", this.onMessage);
    this.worker.addEventListener("error", this.onError);
  }

  load(url) {
    if (this.terminated) {
      return Promise.reject(
        abortError("Trace analysis session terminated."),
      );
    }
    if (this.loadStarted) {
      return Promise.reject(
        new Error("Trace session load already started."),
      );
    }
    if (typeof url !== "string" || url.length === 0) {
      return Promise.reject(
        new TypeError("traceUrl must be a non-empty string"),
      );
    }

    this.loadStarted = true;
    const promise = new Promise((resolve, reject) => {
      this.loadPending = { reject, resolve };
    });
    try {
      this.worker.postMessage({
        type: "load",
        generation: this.generation,
        url,
      });
      this.onStateChange?.("posted");
    } catch (error) {
      const pending = this.loadPending;
      this.loadPending = null;
      pending.reject(error);
    }
    return promise;
  }

  analyzeRange({ launchIndex, startNs, endNs } = {}) {
    if (this.terminated) {
      return Promise.reject(
        abortError("Trace analysis session terminated."),
      );
    }
    if (!this.ready) {
      return Promise.reject(
        new Error("Trace analysis session is not ready."),
      );
    }

    this.rangePending?.reject(abortError());
    const requestId = ++this.requestId;
    const promise = new Promise((resolve, reject) => {
      this.rangePending = {
        launchIndex,
        reject,
        requestId,
        resolve,
      };
    });
    try {
      this.worker.postMessage({
        type: "analyze-range",
        generation: this.generation,
        requestId,
        launchIndex,
        startNs,
        endNs,
      });
    } catch (error) {
      const pending = this.rangePending;
      this.rangePending = null;
      pending.reject(error);
    }
    return promise;
  }

  handleMessage(message) {
    if (
      this.terminated ||
      message?.generation !== this.generation
    ) {
      return;
    }
    if (message.type === "progress") {
      this.onProgress?.(message.progress);
      return;
    }
    if (message.type === "state") {
      this.onStateChange?.(message.state);
      return;
    }
    if (message.type === "ready" && this.loadPending) {
      if (!message.dataset || typeof message.dataset !== "object") {
        const pending = this.loadPending;
        this.loadPending = null;
        pending.reject(
          protocolError("Trace worker ready response omitted its dataset."),
        );
        return;
      }
      const pending = this.loadPending;
      this.loadPending = null;
      this.ready = true;
      pending.resolve({
        dataset: message.dataset,
        diagnostics:
          message.diagnostics ??
          message.dataset?.diagnostics ??
          {},
      });
      return;
    }
    if (message.type === "range-result") {
      if (
        this.rangePending?.requestId !== message.requestId ||
        this.rangePending.launchIndex !== message.launchIndex
      ) {
        return;
      }
      const pending = this.rangePending;
      this.rangePending = null;
      if (
        !message.dataset ||
        typeof message.dataset !== "object" ||
        !message.range ||
        typeof message.range !== "object"
      ) {
        pending.reject(
          protocolError(
            "Trace worker range response omitted its range dataset.",
          ),
        );
        return;
      }
      pending.resolve(message);
      return;
    }
    if (message.type === "complete" && message.ok === false) {
      const error = structuredWorkerError(
        message.error,
        "Trace analysis failed.",
      );
      if (
        this.loadPending &&
        !Number.isInteger(message.requestId)
      ) {
        const pending = this.loadPending;
        this.loadPending = null;
        pending.reject(error);
        return;
      }
      if (
        this.rangePending?.requestId === message.requestId &&
        (
          message.launchIndex === undefined ||
          this.rangePending.launchIndex === message.launchIndex
        )
      ) {
        const pending = this.rangePending;
        this.rangePending = null;
        pending.reject(error);
      }
    }
  }

  failAll(error) {
    this.loadPending?.reject(error);
    this.rangePending?.reject(error);
    this.loadPending = null;
    this.rangePending = null;
  }

  terminate() {
    if (this.terminated) {
      return;
    }
    this.terminated = true;
    this.ready = false;
    this.failAll(abortError("Trace analysis session terminated."));
    this.worker.removeEventListener("message", this.onMessage);
    this.worker.removeEventListener("error", this.onError);
    this.worker.terminate();
  }
}
