const DEFAULT_MAX_SOURCE_BYTES = 128 * 1024 * 1024;
const DIAGNOSTIC_PREVIEW_LENGTH = 200;
const MAX_DECODED_LINE_SIZE = 4 * 1024 * 1024;
const YIELD_BYTE_BUDGET = 1024 * 1024;
const YIELD_CHUNK_BUDGET = 128;

function abortError(signal) {
  if (
    signal?.reason instanceof DOMException &&
    signal.reason.name === "AbortError"
  ) {
    return signal.reason;
  }
  return new DOMException("The operation was aborted.", "AbortError");
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw abortError(signal);
  }
}

function readWithSignal(reader, signal) {
  throwIfAborted(signal);
  if (!signal) {
    return reader.read();
  }

  return new Promise((resolve, reject) => {
    let settled = false;

    function finish(callback, value) {
      if (settled) {
        return;
      }
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback(value);
    }

    function onAbort() {
      finish(reject, abortError(signal));
    }

    signal.addEventListener("abort", onAbort, { once: true });
    reader.read().then(
      (result) => finish(resolve, result),
      (error) => finish(reject, error),
    );
  });
}

function yieldToBrowser(signal) {
  throwIfAborted(signal);

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      finish(resolve);
    }, 0);

    function finish(callback, value) {
      if (settled) {
        return;
      }
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      callback(value);
    }

    function onAbort() {
      clearTimeout(timer);
      finish(reject, abortError(signal));
    }

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function cancelAndRelease(reader, reason) {
  let cancellation;
  try {
    cancellation = reader.cancel(reason);
  } catch {
    cancellation = undefined;
  }

  Promise.resolve(cancellation).catch(() => {});

  function release() {
    try {
      reader.releaseLock();
      return true;
    } catch {
      return false;
    }
  }

  if (!release()) {
    queueMicrotask(release);
  }
}

function cancelBody(body, reason) {
  if (!body || typeof body.cancel !== "function") {
    return;
  }
  try {
    Promise.resolve(body.cancel(reason)).catch(() => {});
  } catch {
    // The original response error remains the useful failure.
  }
}

function contentLength(response) {
  const value = response.headers?.get("content-length");
  if (
    typeof value !== "string" ||
    !/^\d+$/.test(value)
  ) {
    return null;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function httpError(response) {
  const statusText = response.statusText ? ` ${response.statusText}` : "";
  const error = new Error(
    `Trace request failed with HTTP ${response.status}${statusText}`,
  );
  error.name = "HttpError";
  error.status = response.status;
  return error;
}

function lineTooLongError(lineNumber, decodedSize) {
  const error = new RangeError(
    `NDJSON line ${lineNumber} exceeds the ${MAX_DECODED_LINE_SIZE}-character decoded limit`,
  );
  error.name = "NdjsonLineTooLongError";
  error.code = "ERR_NDJSON_LINE_TOO_LONG";
  error.lineNumber = lineNumber;
  error.decodedSize = decodedSize;
  error.maxDecodedLineSize = MAX_DECODED_LINE_SIZE;
  return error;
}

/**
 * Stream and parse one bounded NDJSON response without monopolizing the main
 * browser task for large captures. Invalid final UTF-8 is decoded with the
 * standard replacement character and reported as a malformed final line.
 *
 * Lines over 4 Mi decoded characters reject with NdjsonLineTooLongError before
 * JSON.parse, including lineNumber, decodedSize, and maxDecodedLineSize.
 */
export async function parseNdjsonResponse(
  response,
  { signal, onProgress, yieldEvery = 4_000 } = {},
) {
  throwIfAborted(signal);
  if (!response || typeof response.ok !== "boolean") {
    throw new TypeError("Expected a Response object");
  }
  if (!response.ok) {
    const error = httpError(response);
    cancelBody(response.body, error);
    throw error;
  }
  if (!response.body || typeof response.body.getReader !== "function") {
    throw new TypeError("Expected a readable response body");
  }
  if (onProgress !== undefined && typeof onProgress !== "function") {
    throw new TypeError("onProgress must be a function");
  }
  if (!Number.isSafeInteger(yieldEvery) || yieldEvery <= 0) {
    throw new RangeError("yieldEvery must be a positive integer");
  }

  const totalBytes = contentLength(response);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const rows = [];
  const malformedLines = [];
  let sourceBytes = 0;
  let malformedRows = 0;
  let blankRows = 0;
  let totalLines = 0;
  let processedLines = 0;
  let lineFragments = [];
  let lineDecodedSize = 0;
  let bytesSinceYield = 0;
  let chunksSinceYield = 0;
  let completed = false;
  let failure;

  function report(done) {
    onProgress?.({
      sourceBytes,
      totalBytes,
      parsedRows: rows.length,
      malformedRows,
      processedLines,
      done,
    });
  }

  async function yieldAndResetBudgets() {
    bytesSinceYield = 0;
    chunksSinceYield = 0;
    report(false);
    await yieldToBrowser(signal);
  }

  async function parseLine(rawLine) {
    totalLines += 1;
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.trim() === "") {
      blankRows += 1;
    } else {
      processedLines += 1;
      try {
        rows.push(JSON.parse(line));
      } catch (error) {
        malformedRows += 1;
        malformedLines.push({
          lineNumber: totalLines,
          message: `Invalid JSON: ${
            error instanceof Error ? error.message : String(error)
          }`,
          preview:
            line.length <= DIAGNOSTIC_PREVIEW_LENGTH
              ? line
              : `${line.slice(0, DIAGNOSTIC_PREVIEW_LENGTH)}…`,
        });
      }
    }

    if (totalLines % yieldEvery === 0) {
      await yieldAndResetBudgets();
    }
  }

  function appendLineFragment(fragment) {
    if (fragment.length === 0) {
      return;
    }

    const nextSize = lineDecodedSize + fragment.length;
    if (nextSize > MAX_DECODED_LINE_SIZE) {
      throw lineTooLongError(totalLines + 1, nextSize);
    }
    lineFragments.push(fragment);
    lineDecodedSize = nextSize;
  }

  function takeLine() {
    const line =
      lineFragments.length === 0
        ? ""
        : lineFragments.length === 1
          ? lineFragments[0]
          : lineFragments.join("");
    lineFragments = [];
    lineDecodedSize = 0;
    return line;
  }

  async function parseDecodedText(text) {
    let start = 0;
    while (start < text.length) {
      throwIfAborted(signal);
      const newline = text.indexOf("\n", start);
      if (newline === -1) {
        appendLineFragment(text.slice(start));
        return;
      }

      appendLineFragment(text.slice(start, newline));
      await parseLine(takeLine());
      start = newline + 1;
    }
  }

  try {
    while (true) {
      const { done, value } = await readWithSignal(reader, signal);
      throwIfAborted(signal);
      if (done) {
        break;
      }
      if (!(value instanceof Uint8Array)) {
        throw new TypeError("Response stream yielded a non-byte chunk");
      }

      sourceBytes += value.byteLength;
      bytesSinceYield += value.byteLength;
      chunksSinceYield += 1;
      await parseDecodedText(decoder.decode(value, { stream: true }));
      if (
        bytesSinceYield >= YIELD_BYTE_BUDGET ||
        chunksSinceYield >= YIELD_CHUNK_BUDGET
      ) {
        await yieldAndResetBudgets();
      } else {
        report(false);
      }
    }

    await parseDecodedText(decoder.decode());
    if (lineFragments.length > 0) {
      await parseLine(takeLine());
    }
    throwIfAborted(signal);
    completed = true;
    report(true);
  } catch (error) {
    failure = signal?.aborted ? abortError(signal) : error;
    throw failure;
  } finally {
    if (completed) {
      try {
        reader.releaseLock();
      } catch {
        // A completed stream no longer needs its reader.
      }
    } else {
      cancelAndRelease(reader, failure);
    }
  }

  return {
    rows,
    diagnostics: {
      sourceBytes,
      parsedRows: rows.length,
      malformedRows,
      blankRows,
      totalLines,
      malformedLines,
    },
  };
}

export class TraceCache {
  #entries = new Map();
  #maxEntries;
  #maxSourceBytes;
  #sourceBytes = 0;

  constructor({
    maxEntries = 2,
    maxSourceBytes = DEFAULT_MAX_SOURCE_BYTES,
  } = {}) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) {
      throw new RangeError("maxEntries must be a positive integer");
    }
    if (!Number.isSafeInteger(maxSourceBytes) || maxSourceBytes <= 0) {
      throw new RangeError("maxSourceBytes must be a positive integer");
    }
    this.#maxEntries = maxEntries;
    this.#maxSourceBytes = maxSourceBytes;
  }

  get(id) {
    const entry = this.#entries.get(id);
    if (!entry) {
      return undefined;
    }

    this.#entries.delete(id);
    this.#entries.set(id, entry);
    return entry.value;
  }

  set(id, value, sourceBytes) {
    if (!Number.isSafeInteger(sourceBytes) || sourceBytes <= 0) {
      throw new RangeError("sourceBytes must be a positive integer");
    }

    const replaced = this.#entries.get(id);
    if (replaced) {
      this.#entries.delete(id);
      this.#sourceBytes -= replaced.sourceBytes;
    }

    if (sourceBytes > this.#maxSourceBytes) {
      return false;
    }

    this.#entries.set(id, { value, sourceBytes });
    this.#sourceBytes += sourceBytes;

    while (
      this.#entries.size > this.#maxEntries ||
      this.#sourceBytes > this.#maxSourceBytes
    ) {
      const oldestId = this.#entries.keys().next().value;
      const oldest = this.#entries.get(oldestId);
      this.#entries.delete(oldestId);
      this.#sourceBytes -= oldest.sourceBytes;
    }

    return true;
  }
}

export class SelectionCoordinator {
  #current = null;
  #generation = 0;

  begin(id) {
    this.clear();
    const controller = new AbortController();
    const token = {
      id,
      generation: (this.#generation += 1),
      signal: controller.signal,
    };
    this.#current = { token, controller };
    return token;
  }

  isCurrent(token) {
    return (
      this.#current?.token === token &&
      this.#current.controller.signal.aborted === false
    );
  }

  clear() {
    this.#current?.controller.abort();
    this.#current = null;
  }
}
