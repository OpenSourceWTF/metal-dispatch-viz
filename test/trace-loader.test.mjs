import assert from "node:assert/strict";
import test from "node:test";

import {
  parseNdjsonResponse,
  SelectionCoordinator,
  TraceCache,
} from "../public/trace-loader.js";

const encoder = new TextEncoder();

function responseFromChunks(chunks, { headers } = {}) {
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
  return new Response(stream, { headers });
}

test("streams split JSON and UTF-8, preserves the final line, and diagnoses malformed rows", async () => {
  const source = [
    '{"record":"op","kernel":"qmv"}',
    '{"record":"op","kernel":"café"}',
    "   ",
    "not-json",
    '{"record":"summary","complete":true}',
  ].join("\n");
  const bytes = encoder.encode(source);
  const unicodeStart = bytes.indexOf(0xc3);
  assert.notEqual(unicodeStart, -1);

  const response = responseFromChunks(
    [
      bytes.slice(0, 17),
      bytes.slice(17, unicodeStart + 1),
      bytes.slice(unicodeStart + 1, bytes.length - 5),
      bytes.slice(bytes.length - 5),
    ],
    { headers: { "content-length": String(bytes.byteLength) } },
  );
  const progress = [];

  const result = await parseNdjsonResponse(response, {
    onProgress(value) {
      progress.push(value);
    },
    yieldEvery: 2,
  });

  assert.deepEqual(result.rows, [
    { record: "op", kernel: "qmv" },
    { record: "op", kernel: "café" },
    { record: "summary", complete: true },
  ]);
  assert.deepEqual(
    {
      sourceBytes: result.diagnostics.sourceBytes,
      parsedRows: result.diagnostics.parsedRows,
      malformedRows: result.diagnostics.malformedRows,
      blankRows: result.diagnostics.blankRows,
      totalLines: result.diagnostics.totalLines,
    },
    {
      sourceBytes: bytes.byteLength,
      parsedRows: 3,
      malformedRows: 1,
      blankRows: 1,
      totalLines: 5,
    },
  );
  assert.equal(result.diagnostics.malformedLines.length, 1);
  assert.equal(result.diagnostics.malformedLines[0].lineNumber, 4);
  assert.match(result.diagnostics.malformedLines[0].message, /JSON/);
  assert.equal(result.diagnostics.malformedLines[0].preview, "not-json");

  assert.ok(progress.some((value) => value.done === false));
  assert.deepEqual(progress.at(-1), {
    sourceBytes: bytes.byteLength,
    totalBytes: bytes.byteLength,
    parsedRows: 3,
    malformedRows: 1,
    processedLines: 4,
    done: true,
  });
});

test("yields and reports progress before completing a generated 100,000-row stream", async () => {
  const rowCount = 100_000;
  const source = Array.from(
    { length: rowCount },
    (_, index) => `{"record":"op","seq":${index}}\n`,
  ).join("");
  const bytes = encoder.encode(source);
  const response = responseFromChunks([bytes], {
    headers: { "content-length": String(bytes.byteLength) },
  });
  const progress = [];
  let timerFired = false;
  setTimeout(() => {
    timerFired = true;
  }, 0);

  const result = await parseNdjsonResponse(response, {
    onProgress(value) {
      progress.push(value);
    },
    yieldEvery: 4_000,
  });

  assert.equal(result.rows.length, rowCount);
  assert.equal(result.diagnostics.parsedRows, rowCount);
  assert.equal(timerFired, true);
  assert.ok(
    progress.some(
      (value) =>
        value.done === false &&
        value.parsedRows > 0 &&
        value.parsedRows < rowCount,
    ),
  );
  assert.equal(progress.at(-1).done, true);
  assert.equal(progress.at(-1).sourceBytes, bytes.byteLength);
  assert.equal(progress.at(-1).totalBytes, bytes.byteLength);
});

test("yields to timers and aborts a many-chunk stream before its first newline", async () => {
  const totalChunks = 10_000;
  let emittedChunks = 0;
  const stream = new ReadableStream({
    pull(controller) {
      emittedChunks += 1;
      controller.enqueue(encoder.encode("x"));
      if (emittedChunks === totalChunks) {
        controller.close();
      }
    },
  });
  const controller = new AbortController();
  const parsing = parseNdjsonResponse(new Response(stream), {
    signal: controller.signal,
  });

  setTimeout(() => controller.abort(), 0);

  await assert.rejects(parsing, { name: "AbortError" });
  assert.ok(
    emittedChunks < totalChunks,
    `expected an early abort, but consumed ${emittedChunks} chunks`,
  );
});

test("yields and aborts within one huge chunk of blank physical lines", async () => {
  const blankLineCount = 1_000_000;
  const controller = new AbortController();
  const progress = [];
  const parsing = parseNdjsonResponse(
    responseFromChunks([encoder.encode("\n".repeat(blankLineCount))]),
    {
      signal: controller.signal,
      onProgress(value) {
        progress.push(value);
      },
    },
  );

  setTimeout(() => controller.abort(), 0);

  await assert.rejects(parsing, { name: "AbortError" });
  assert.equal(progress.some((value) => value.done === true), false);
  assert.ok(
    progress.some(
      (value) =>
        value.done === false &&
        value.parsedRows === 0 &&
        value.processedLines === 0,
    ),
  );
});

test("rejects oversized decoded lines before attempting unbounded JSON parsing", async () => {
  const oversizedLine = "x".repeat(4 * 1024 * 1024 + 1);

  await assert.rejects(
    parseNdjsonResponse(
      responseFromChunks([encoder.encode(oversizedLine)]),
    ),
    (error) => {
      assert.equal(error.name, "NdjsonLineTooLongError");
      assert.equal(error.code, "ERR_NDJSON_LINE_TOO_LONG");
      assert.equal(error.lineNumber, 1);
      assert.equal(error.maxDecodedLineSize, 4 * 1024 * 1024);
      return true;
    },
  );
});

test("flushes an incomplete final UTF-8 sequence into a malformed-line diagnostic", async () => {
  const valid = encoder.encode('{"ok":true}\n');
  const bytes = new Uint8Array(valid.byteLength + 1);
  bytes.set(valid);
  bytes[bytes.length - 1] = 0xc3;

  const result = await parseNdjsonResponse(responseFromChunks([bytes]));

  assert.deepEqual(result.rows, [{ ok: true }]);
  assert.equal(result.diagnostics.malformedRows, 1);
  assert.equal(result.diagnostics.totalLines, 2);
  assert.equal(result.diagnostics.malformedLines[0].lineNumber, 2);
  assert.equal(result.diagnostics.malformedLines[0].preview, "\ufffd");
});

test("rejects unsuccessful responses, cancels their bodies, and handles body/read errors", async () => {
  let errorBodyCancelled = false;
  const unsuccessfulResponse = {
    ok: false,
    status: 503,
    statusText: "Service Unavailable",
    body: {
      cancel() {
        errorBodyCancelled = true;
      },
    },
  };

  await assert.rejects(
    parseNdjsonResponse(unsuccessfulResponse),
    (error) => {
      assert.equal(error.status, 503);
      assert.match(error.message, /503 Service Unavailable/);
      return true;
    },
  );
  assert.equal(errorBodyCancelled, true);

  await assert.rejects(
    parseNdjsonResponse(new Response(null)),
    /readable response body/i,
  );

  const brokenStream = new ReadableStream({
    pull(controller) {
      controller.error(new Error("stream exploded"));
    },
  });
  await assert.rejects(
    parseNdjsonResponse(new Response(brokenStream)),
    /stream exploded/,
  );
});

test("strictly accepts only safe decimal Content-Length values", async () => {
  const invalidValues = [
    "1e3",
    "0x10",
    "+3",
    "3.0",
    "-1",
    "9007199254740992",
  ];

  for (const value of invalidValues) {
    const progress = [];
    await parseNdjsonResponse(
      responseFromChunks([encoder.encode("{}\n")], {
        headers: { "content-length": value },
      }),
      {
        onProgress(item) {
          progress.push(item);
        },
      },
    );
    assert.equal(progress.at(-1).totalBytes, null, value);
  }

  const validProgress = [];
  await parseNdjsonResponse(
    responseFromChunks([encoder.encode("{}\n")], {
      headers: { "content-length": "0003" },
    }),
    {
      onProgress(item) {
        validProgress.push(item);
      },
    },
  );
  assert.equal(validProgress.at(-1).totalBytes, 3);
});

test("aborts promptly, unlocks the stream, and ignores never-settling cancellation", async () => {
  let cancelReason;
  const stream = new ReadableStream({
    pull() {
      return new Promise(() => {});
    },
    cancel(reason) {
      cancelReason = reason;
      return new Promise(() => {});
    },
  });
  const controller = new AbortController();
  const parsing = parseNdjsonResponse(new Response(stream), {
    signal: controller.signal,
  });

  setTimeout(() => controller.abort(), 0);

  await assert.rejects(parsing, (error) => {
    assert.equal(error.name, "AbortError");
    assert.equal(error instanceof DOMException, true);
    return true;
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(cancelReason?.name, "AbortError");
  assert.equal(stream.locked, false);
});

test("honors abort while yielding between parsing batches", async () => {
  const source = Array.from(
    { length: 1_000 },
    (_, index) => `{"seq":${index}}\n`,
  ).join("");
  const controller = new AbortController();
  const parsing = parseNdjsonResponse(
    responseFromChunks([encoder.encode(source)]),
    {
      signal: controller.signal,
      yieldEvery: 1,
    },
  );

  setTimeout(() => controller.abort(), 0);

  await assert.rejects(parsing, (error) => {
    assert.equal(error.name, "AbortError");
    assert.equal(error instanceof DOMException, true);
    return true;
  });
});

test("rapid selections abort prior work and only the latest generation is current", () => {
  const coordinator = new SelectionCoordinator();
  const first = coordinator.begin("a");
  const second = coordinator.begin("b");
  const third = coordinator.begin("a");

  assert.deepEqual(
    [first.id, first.generation, second.id, second.generation, third.generation],
    ["a", 1, "b", 2, 3],
  );
  assert.equal(first.signal.aborted, true);
  assert.equal(second.signal.aborted, true);
  assert.equal(third.signal.aborted, false);
  assert.equal(coordinator.isCurrent(first), false);
  assert.equal(coordinator.isCurrent(second), false);
  assert.equal(coordinator.isCurrent(third), true);
  assert.equal(
    coordinator.isCurrent({
      id: third.id,
      generation: third.generation,
      signal: third.signal,
    }),
    false,
  );

  coordinator.clear();
  assert.equal(third.signal.aborted, true);
  assert.equal(coordinator.isCurrent(third), false);
});

test("cache refreshes LRU recency and evicts by entry and aggregate byte limits", () => {
  const entryLimited = new TraceCache({ maxEntries: 2, maxSourceBytes: 100 });
  entryLimited.set("a", { value: "a" }, 10);
  entryLimited.set("b", { value: "b" }, 10);
  assert.deepEqual(entryLimited.get("a"), { value: "a" });
  entryLimited.set("c", { value: "c" }, 10);

  assert.equal(entryLimited.get("b"), undefined);
  assert.deepEqual(entryLimited.get("a"), { value: "a" });
  assert.deepEqual(entryLimited.get("c"), { value: "c" });

  const byteLimited = new TraceCache({ maxEntries: 10, maxSourceBytes: 5 });
  byteLimited.set("a", "a", 2);
  byteLimited.set("b", "b", 2);
  assert.equal(byteLimited.get("a"), "a");
  byteLimited.set("c", "c", 2);

  assert.equal(byteLimited.get("b"), undefined);
  assert.equal(byteLimited.get("a"), "a");
  assert.equal(byteLimited.get("c"), "c");
});

test("cache rejects oversize items and adjusts bytes and recency on replacement", () => {
  const cache = new TraceCache({ maxEntries: 2, maxSourceBytes: 5 });

  assert.equal(cache.set("oversize", "no", 6), false);
  assert.equal(cache.get("oversize"), undefined);

  assert.equal(cache.set("a", "large-a", 4), true);
  assert.equal(cache.set("a", "small-a", 1), true);
  assert.equal(cache.set("b", "b", 4), true);
  assert.equal(cache.get("a"), "small-a");
  assert.equal(cache.get("b"), "b");

  assert.equal(cache.set("a", "too-large-a", 6), false);
  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.get("b"), "b");
});

test("rejects invalid parser and cache accounting limits consistently", async () => {
  const invalidValues = [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5];

  for (const value of invalidValues) {
    await assert.rejects(
      parseNdjsonResponse(responseFromChunks([encoder.encode("{}\n")]), {
        yieldEvery: value,
      }),
      /yieldEvery must be a positive integer/,
    );
    assert.throws(
      () => new TraceCache({ maxEntries: value }),
      /maxEntries must be a positive integer/,
    );
    assert.throws(
      () => new TraceCache({ maxSourceBytes: value }),
      /maxSourceBytes must be a positive integer/,
    );

    const cache = new TraceCache();
    assert.throws(
      () => cache.set("invalid", "value", value),
      /sourceBytes must be a positive integer/,
    );
    assert.equal(cache.get("invalid"), undefined);
  }
});
