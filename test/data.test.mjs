import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildDataset,
  buildOverviewBins,
  buildRangeScope,
  classifyWait,
  formatBytes,
  formatDuration,
  intersectIntervals,
  mergeIntervals,
  normalizeRow,
  partitionLaunchWindows,
  subtractIntervals,
} from "../public/data.js";

test("normalizes the complete public op schema without inventing timestamps", () => {
  const raw = {
    record: "op",
    seq: 11,
    command_buffer_index: 7,
    kind: "compute",
    dispatch: "threads",
    kernel_name: "qmv",
    setBytes_calls: 2,
    setBytes_total_bytes: 48,
    buffer_binds: 3,
    grid: [32, 1, 1],
    threadgroup: [8, 1, 1],
  };

  const normalized = normalizeRow(raw);

  assert.deepEqual(normalized, {
    type: "op",
    seq: 11,
    commandBufferIndex: 7,
    kind: "compute",
    dispatch: "threads",
    kernel: "qmv",
    setBytesCalls: 2,
    setBytesTotalBytes: 48,
    bufferBinds: 3,
    grid: [32, 1, 1],
    threadgroup: [8, 1, 1],
    raw,
  });
  assert.equal("atNs" in normalized, false);
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(Object.isFrozen(raw), false);
});

test("accepts documented legacy aliases and field-based record inference", () => {
  const legacyOp = {
    kind: "dispatch",
    seq: 4,
    cb_index: 2,
    kernel: "legacy_kernel",
    set_bytes_calls: 1,
    set_bytes_total: 16,
  };
  const legacyWait = { cause: "dependency_cv_wait", duration_ns: 9, at_ns: 14 };
  const legacyCb = {
    type: "command_buffer",
    cb_index: 2,
    op_count: 1,
    first_op_seq: 4,
    last_op_seq: 4,
    encode_start_ns: 10,
    encode_end_ns: 20,
    gpu_start_ns: 21,
    gpu_end_ns: 30,
  };

  assert.deepEqual(normalizeRow(legacyOp), {
    type: "op",
    seq: 4,
    commandBufferIndex: 2,
    kind: "dispatch",
    kernel: "legacy_kernel",
    setBytesCalls: 1,
    setBytesTotalBytes: 16,
    raw: legacyOp,
  });
  assert.deepEqual(normalizeRow(legacyWait), {
    type: "wait",
    bucket: "dependency_cv_wait",
    waitNs: 9,
    atNs: 14,
    waitClass: "dependency",
    detailClass: "dependency",
    headlineCategory: "dependency",
    raw: legacyWait,
  });
  assert.deepEqual(normalizeRow(legacyCb), {
    type: "cb",
    commandBufferIndex: 2,
    opCount: 1,
    firstOpSeq: 4,
    lastOpSeq: 4,
    encodeStartNs: 10,
    encodeEndNs: 20,
    gpuStartNs: 21,
    gpuEndNs: 30,
    raw: legacyCb,
  });
});

test("accepts legacy wait duration, anchor, and command-buffer ownership aliases", () => {
  const cases = [
    { duration: { ns: 3 }, anchor: { ts_ns: 10 } },
    { duration: { dur_ns: 5 }, anchor: { start_ns: 20 } },
    { duration: { duration_ns: 7 }, anchor: { time_ns: 30 } },
    { duration: { wait_ns: 11 }, anchor: { timestamp_ns: 40 } },
    { duration: { wait_ns: 13 }, anchor: { at_ns: 50 } },
  ];

  for (const [index, { duration, anchor }] of cases.entries()) {
    const normalized = normalizeRow({
      kind: "wait",
      cause: "cap_wait",
      cb_index: index,
      ...duration,
      ...anchor,
    });
    assert.equal(normalized.waitNs, [3, 5, 7, 11, 13][index]);
    assert.equal(normalized.atNs, [10, 20, 30, 40, 50][index]);
    assert.equal(normalized.commandBufferIndex, index);
  }
});

test("normalizes summaries and handles malformed or unknown rows honestly", () => {
  const raw = {
    record: "summary",
    schema_version: 1,
    final: true,
    ops_total: 5,
    cbs_total: 2,
    dropped_rows: 0,
    complete: true,
    buckets: { cap_wait: { count: 1, total_ns: 7 } },
  };

  assert.deepEqual(normalizeRow(raw), {
    type: "summary",
    schemaVersion: 1,
    final: true,
    opsTotal: 5,
    cbsTotal: 2,
    droppedRows: 0,
    complete: true,
    buckets: { cap_wait: { count: 1, total_ns: 7 } },
    raw,
  });
  assert.equal(normalizeRow(null), null);
  assert.equal(normalizeRow([]), null);
  assert.deepEqual(normalizeRow({ record: "future", payload: 3 }), {
    type: "unknown",
    raw: { record: "future", payload: 3 },
  });

  const malformedOp = normalizeRow({
    record: "op",
    seq: "4",
    command_buffer_index: Number.NaN,
    setBytes_calls: -1,
  });
  assert.deepEqual(malformedOp, {
    type: "op",
    raw: {
      record: "op",
      seq: "4",
      command_buffer_index: Number.NaN,
      setBytes_calls: -1,
    },
  });
});

test("merges overlapping and adjacent intervals and rejects invalid spans", () => {
  assert.deepEqual(
    mergeIntervals([
      [9, 12],
      [0, 2],
      [2, 5],
      [4, 10],
      [20, 20],
      [8, 3],
      [Number.NaN, 30],
      "bad",
    ]),
    [[0, 12]],
  );
});

test("intersects and subtracts against union coverage without double-counting", () => {
  const gpu = [
    [2, 4],
    [3, 7],
    [4, 6],
    [8, 9],
  ];

  assert.deepEqual(intersectIntervals([[0, 10]], gpu), [
    [2, 7],
    [8, 9],
  ]);
  assert.deepEqual(subtractIntervals([[0, 10]], gpu), [
    [0, 2],
    [7, 8],
    [9, 10],
  ]);
  assert.deepEqual(subtractIntervals([[0, 10]], [[-5, 20]]), []);
  assert.deepEqual(intersectIntervals([[0, 10]], [[-5, 20]]), [[0, 10]]);
});

test("classifies waits while keeping scheduler mirror and idle detail non-additive", () => {
  assert.equal(classifyWait("cap_wait"), "cap");
  assert.equal(classifyWait("memory_wait"), "dependency");
  assert.equal(classifyWait("dependency_cv_wait"), "dependency");
  assert.equal(classifyWait("cb_wait_until_completed"), "decision");
  assert.equal(classifyWait("sched_backpressure"), "other");
  assert.equal(classifyWait("sched_worker_wait"), "other");
  assert.equal(classifyWait("new_wait_kind"), "other");

  const data = buildDataset([
    {
      record: "cb",
      command_buffer_index: 0,
      op_count: 0,
      encode_start_ns: 0,
      encode_end_ns: 10,
      gpu_start_ns: 2,
      gpu_end_ns: 7,
    },
    { record: "wait", bucket: "cap_wait", wait_ns: 3, at_ns: 11 },
    { record: "wait", bucket: "memory_wait", wait_ns: 5, at_ns: 12 },
    { record: "wait", bucket: "dependency_cv_wait", wait_ns: 7, at_ns: 13 },
    { record: "wait", bucket: "cb_wait_until_completed", wait_ns: 11, at_ns: 14 },
    { record: "wait", bucket: "sched_backpressure", wait_ns: 13, at_ns: 15 },
    { record: "wait", bucket: "sched_worker_wait", wait_ns: 17, at_ns: 16 },
    { record: "wait", bucket: "new_wait_kind", wait_ns: 19, at_ns: 17 },
    {
      record: "summary",
      schema_version: 1,
      complete: true,
      dropped_rows: 0,
    },
  ]);

  assert.deepEqual(
    {
      cap: data.summary.capWaitNs,
      dependency: data.summary.dependencyWaitNs,
      decision: data.summary.decisionWaitNs,
      other: data.summary.otherWaitNs,
      headline: data.summary.headlineWaitNs,
    },
    { cap: 3, dependency: 12, decision: 11, other: 19, headline: 45 },
  );
  assert.equal(data.waitTaxonomy.sched_backpressure.waitNs, 13);
  assert.equal(data.waitTaxonomy.sched_backpressure.headlineIncluded, false);
  assert.equal(data.waitTaxonomy.sched_backpressure.detailClass, "scheduler-mirror");
  assert.equal(data.waitTaxonomy.sched_worker_wait.waitNs, 17);
  assert.equal(data.waitTaxonomy.sched_worker_wait.headlineIncluded, false);
  assert.equal(data.waitTaxonomy.sched_worker_wait.detailClass, "idle");
});

test("classifies every CB encode interval against the union of GPU work", () => {
  const data = buildDataset([
    {
      record: "cb",
      command_buffer_index: 0,
      op_count: 0,
      encode_start_ns: 0,
      encode_end_ns: 10,
      gpu_start_ns: 2,
      gpu_end_ns: 8,
    },
    {
      record: "cb",
      command_buffer_index: 1,
      op_count: 0,
      encode_start_ns: 2,
      encode_end_ns: 8,
      gpu_start_ns: 4,
      gpu_end_ns: 6,
    },
    {
      record: "cb",
      command_buffer_index: 2,
      op_count: 0,
      encode_start_ns: 20,
      encode_end_ns: 25,
      gpu_start_ns: 30,
      gpu_end_ns: 35,
    },
    {
      record: "summary",
      schema_version: 1,
      complete: true,
      dropped_rows: 0,
    },
  ]);

  assert.deepEqual(data.gpuIntervals, [
    [2, 8],
    [30, 35],
  ]);
  assert.deepEqual(data.commandBuffers[0].hiddenIntervals, [[2, 8]]);
  assert.deepEqual(data.commandBuffers[0].exposedIntervals, [
    [0, 2],
    [8, 10],
  ]);
  assert.deepEqual(data.commandBuffers[1].hiddenIntervals, [[2, 8]]);
  assert.deepEqual(data.commandBuffers[1].exposedIntervals, []);
  assert.deepEqual(data.commandBuffers[2].hiddenIntervals, []);
  assert.deepEqual(data.commandBuffers[2].exposedIntervals, [[20, 25]]);
  assert.deepEqual(
    {
      exposed: data.summary.exposedHostNs,
      hidden: data.summary.hiddenHostNs,
      gpuBusy: data.summary.gpuBusyNs,
      gpuWork: data.summary.gpuWorkNs,
      gpuSpan: data.summary.gpuSpanNs,
    },
    { exposed: 9, hidden: 12, gpuBusy: 11, gpuWork: 13, gpuSpan: 33 },
  );
});

test("classifies 10k CBs against a canonical GPU union without repeated sorting", () => {
  const rows = [];
  for (let index = 0; index < 10_000; index += 1) {
    rows.push({
      record: "cb",
      command_buffer_index: index,
      encode_start_ns: index * 100,
      encode_end_ns: index * 100 + 20,
      gpu_start_ns: index * 100 + 40,
      gpu_end_ns: index * 100 + 50,
    });
  }
  rows.push({
    record: "summary",
    schema_version: 1,
    complete: true,
    dropped_rows: 0,
    ops_total: 0,
    cbs_total: 10_000,
  });

  const startedAt = performance.now();
  const data = buildDataset(rows);
  const elapsedMs = performance.now() - startedAt;

  assert.equal(data.commandBuffers.length, 10_000);
  assert.equal(data.gpuIntervals.length, 10_000);
  assert.equal(data.summary.exposedHostNs, 200_000);
  assert.ok(elapsedMs < 1_500, `10k-CB analysis took ${elapsedMs.toFixed(1)} ms`);
});

test("partitions sorted CB activity only when a positive gap exceeds the adaptive threshold", () => {
  const cbs = [
    { commandBufferIndex: 3, encodeStartNs: 500_000_000, encodeEndNs: 510_000_000 },
    { commandBufferIndex: 1, encodeStartNs: 20_000_000, encodeEndNs: 30_000_000 },
    { commandBufferIndex: 0, encodeStartNs: 0, encodeEndNs: 10_000_000 },
    { commandBufferIndex: 2, encodeStartNs: 40_000_000, encodeEndNs: 50_000_000 },
  ];
  const windows = partitionLaunchWindows(cbs);

  assert.deepEqual(
    windows.map((window) => window.commandBufferIndices),
    [
      [0, 1, 2],
      [3],
    ],
  );
  assert.equal(windows[0].gapThresholdNs, 200_000_000);
  assert.equal(windows[1].gapBeforeNs, 450_000_000);

  const equalToThreshold = partitionLaunchWindows([
    { commandBufferIndex: 0, encodeStartNs: 0, encodeEndNs: 10_000_000 },
    { commandBufferIndex: 1, encodeStartNs: 20_000_000, encodeEndNs: 30_000_000 },
    { commandBufferIndex: 2, encodeStartNs: 230_000_000, encodeEndNs: 240_000_000 },
  ]);
  assert.equal(equalToThreshold.length, 1);
  assert.deepEqual(partitionLaunchWindows([]), []);
});

test("uses the standard median for an even number of positive launch gaps", () => {
  const windows = partitionLaunchWindows([
    { commandBufferIndex: 0, encodeStartNs: 0, encodeEndNs: 10_000_000 },
    {
      commandBufferIndex: 1,
      encodeStartNs: 20_000_000,
      encodeEndNs: 30_000_000,
    },
    {
      commandBufferIndex: 2,
      encodeStartNs: 60_000_000,
      encodeEndNs: 70_000_000,
    },
  ]);

  // Positive gaps are 10 ms and 30 ms. Their standard median is 20 ms.
  assert.equal(windows.length, 1);
  assert.equal(windows[0].gapThresholdNs, 400_000_000);
});

test("launch gaps use encode starts and prior encode/GPU ends only", () => {
  const noGpuStartGap = partitionLaunchWindows([
    { commandBufferIndex: 0, encodeStartNs: 0, encodeEndNs: 10_000_000 },
    {
      commandBufferIndex: 1,
      gpuStartNs: 500_000_000,
      gpuEndNs: 510_000_000,
    },
    {
      commandBufferIndex: 2,
      encodeStartNs: 20_000_000,
      encodeEndNs: 30_000_000,
    },
  ]);
  assert.equal(noGpuStartGap.length, 1);
  assert.equal(noGpuStartGap[0].gapThresholdNs, 200_000_000);

  const noStartAsPriorEnd = partitionLaunchWindows([
    { commandBufferIndex: 0, encodeStartNs: 0 },
    {
      commandBufferIndex: 1,
      encodeStartNs: 200_000_000,
      encodeEndNs: 210_000_000,
    },
    {
      commandBufferIndex: 2,
      encodeStartNs: 220_000_000,
      encodeEndNs: 230_000_000,
    },
  ]);
  assert.equal(noStartAsPriorEnd.length, 1);
  assert.equal(noStartAsPriorEnd[0].gapThresholdNs, 200_000_000);

  const gpuEndCountsAsPriorEnd = partitionLaunchWindows([
    {
      commandBufferIndex: 0,
      encodeStartNs: 0,
      encodeEndNs: 10,
      gpuStartNs: 20,
      gpuEndNs: 100,
    },
    {
      commandBufferIndex: 1,
      encodeStartNs: 150,
      encodeEndNs: 200,
    },
  ]);
  assert.equal(gpuEndCountsAsPriorEnd[0].gapThresholdNs, 100_000_000);
});

test("launch-window output does not alias mutable command-buffer inputs", () => {
  const commandBuffers = [
    {
      commandBufferIndex: 0,
      encodeStartNs: 0,
      encodeEndNs: 10,
      metadata: { label: "original" },
    },
  ];
  const windows = partitionLaunchWindows(commandBuffers);

  commandBuffers[0].encodeEndNs = 999;
  commandBuffers[0].metadata.label = "changed";

  assert.equal(windows[0].commandBuffers[0].encodeEndNs, 10);
  assert.equal(windows[0].commandBuffers[0].metadata.label, "original");
  assert.equal(Object.isFrozen(windows[0].commandBuffers[0]), true);
  assert.equal(Object.isFrozen(windows[0].commandBuffers[0].metadata), true);
});

test("overlapping activity and decision waits do not create extra launch windows", () => {
  const rows = [
    {
      record: "cb",
      command_buffer_index: 0,
      encode_start_ns: 0,
      encode_end_ns: 20,
      gpu_start_ns: 10,
      gpu_end_ns: 30,
    },
    { record: "wait", bucket: "cb_wait_until_completed", wait_ns: 100, at_ns: 1_000_000_000 },
    {
      record: "cb",
      command_buffer_index: 1,
      encode_start_ns: 15,
      encode_end_ns: 25,
      gpu_start_ns: 20,
      gpu_end_ns: 40,
    },
    {
      record: "summary",
      schema_version: 1,
      complete: true,
      dropped_rows: 0,
    },
  ];

  const data = buildDataset(rows);
  assert.equal(data.launchWindows.length, 1);
  assert.equal(data.launchWindows[0].waits.length, 1);
});

test("anchors timestamp-less legacy waits to their owned CB launch window", () => {
  const data = buildDataset([
    {
      record: "cb",
      command_buffer_index: 0,
      encode_start_ns: 10,
      encode_end_ns: 20,
      gpu_start_ns: 30,
      gpu_end_ns: 40,
    },
    { kind: "wait", cause: "cap_wait", cb_index: 0, ns: 5 },
    {
      record: "summary",
      schema_version: 1,
      complete: true,
      dropped_rows: 0,
    },
  ]);

  assert.equal(data.waits[0].atNs, 20);
  assert.equal(data.waits[0].placement, "legacy-command-buffer-fallback");
  assert.equal(data.waits[0].atNsSource, "command-buffer-encode-end");
  assert.equal(data.launchWindows[0].waits[0], data.waits[0]);
  assert.equal(data.launchWindows[0].summary.capWaitNs, 5);
  assert.equal(data.summary.capWaitNs, 5);
  assert.deepEqual(data.unassignedWaits, []);
});

test("uses the documented legacy CB anchor precedence and leaves unanchorable waits unassigned", () => {
  const data = buildDataset([
    {
      record: "cb",
      command_buffer_index: 0,
      encode_start_ns: 10,
      encode_end_ns: 20,
      gpu_start_ns: 30,
    },
    {
      record: "cb",
      command_buffer_index: 1,
      encode_start_ns: 40,
      gpu_start_ns: 50,
    },
    {
      record: "cb",
      command_buffer_index: 2,
      gpu_start_ns: 60,
    },
    { record: "cb", command_buffer_index: 3 },
    { kind: "wait", cause: "cap_wait", cb_index: 0, ns: 2 },
    { kind: "wait", cause: "cap_wait", cb_index: 1, ns: 3 },
    { kind: "wait", cause: "cap_wait", cb_index: 2, ns: 5 },
    { kind: "wait", cause: "cap_wait", cb_index: 3, ns: 7 },
    { kind: "wait", cause: "cap_wait", cb_index: 404, ns: 11 },
    { kind: "wait", cause: "cap_wait", ns: 13 },
    {
      record: "summary",
      schema_version: 1,
      complete: true,
      dropped_rows: 0,
    },
  ]);

  assert.deepEqual(
    data.waits.slice(0, 3).map((wait) => [wait.atNs, wait.atNsSource]),
    [
      [20, "command-buffer-encode-end"],
      [40, "command-buffer-encode-start"],
      [60, "command-buffer-gpu-start"],
    ],
  );
  assert.equal(data.launchWindows[0].summary.capWaitNs, 10);
  assert.equal(data.summary.capWaitNs, 41);
  assert.deepEqual(
    data.unassignedWaits.map((wait) => wait.commandBufferIndex),
    [3, 404, undefined],
  );
});

test("places dispatches by sequence order and explicitly handles degenerate spans", () => {
  const rows = [
    {
      record: "cb",
      command_buffer_index: 7,
      op_count: 3,
      first_op_seq: 10,
      last_op_seq: 20,
      encode_start_ns: 100,
      encode_end_ns: 200,
    },
    { record: "op", command_buffer_index: 7, seq: 20, kernel_name: "c" },
    { record: "op", command_buffer_index: 7, seq: 10, kernel_name: "a" },
    { record: "op", command_buffer_index: 7, seq: 15, kernel_name: "b" },
    { record: "op", command_buffer_index: 7, seq: 9, kernel_name: "before" },
    { record: "op", command_buffer_index: 7, seq: 21, kernel_name: "after" },
    {
      record: "cb",
      command_buffer_index: 8,
      op_count: 1,
      first_op_seq: 1,
      last_op_seq: 1,
      encode_start_ns: 300,
      encode_end_ns: 300,
    },
    { record: "op", command_buffer_index: 8, seq: 1 },
    {
      record: "cb",
      command_buffer_index: 9,
      op_count: 1,
      first_op_seq: 2,
      last_op_seq: 2,
      encode_start_ns: 400,
      encode_end_ns: 500,
    },
    { record: "op", command_buffer_index: 9, seq: 2 },
    {
      record: "cb",
      command_buffer_index: 10,
      op_count: 1,
      encode_start_ns: 600,
      encode_end_ns: 700,
    },
    { record: "op", command_buffer_index: 10 },
    { record: "op", command_buffer_index: 404, seq: 99 },
    {
      record: "cb",
      encode_start_ns: 800,
      encode_end_ns: 900,
    },
    { record: "op", seq: 100 },
    {
      record: "summary",
      schema_version: 1,
      complete: true,
      dropped_rows: 0,
    },
  ];
  const data = buildDataset(rows);
  const byKernel = Object.fromEntries(
    data.dispatches.filter((op) => op.kernel).map((op) => [op.kernel, op]),
  );

  assert.deepEqual(
    ["a", "b", "c"].map((kernel) => ({
      atNs: byKernel[kernel].atNs,
      placement: byKernel[kernel].placement,
      placementDetail: byKernel[kernel].placementDetail,
    })),
    [
      { atNs: 100, placement: "ordered", placementDetail: "interpolated-sequence" },
      { atNs: 150, placement: "ordered", placementDetail: "interpolated-sequence" },
      { atNs: 200, placement: "ordered", placementDetail: "interpolated-sequence" },
    ],
  );

  const degenerateEncode = data.dispatches.find((op) => op.commandBufferIndex === 8);
  assert.equal(degenerateEncode.atNs, null);
  assert.equal(degenerateEncode.placement, "ordered");
  assert.equal(degenerateEncode.placementDetail, "degenerate-encode-interval");

  const singleSequence = data.dispatches.find((op) => op.commandBufferIndex === 9);
  assert.equal(singleSequence.atNs, 450);
  assert.equal(singleSequence.placementDetail, "degenerate-sequence-span");

  const missingSequence = data.dispatches.find((op) => op.commandBufferIndex === 10);
  assert.equal(missingSequence.atNs, null);
  assert.equal(missingSequence.placementDetail, "missing-sequence");

  for (const kernel of ["before", "after"]) {
    const outsideSequenceSpan = data.dispatches.find((op) => op.kernel === kernel);
    assert.equal(outsideSequenceSpan.atNs, null);
    assert.equal(outsideSequenceSpan.placement, "ordered");
    assert.equal(outsideSequenceSpan.placementDetail, "sequence-outside-span");
  }
  assert.equal(
    data.kernelCensus.find((entry) => entry.kernel === "before").count,
    1,
  );
  assert.equal(
    data.kernelCensus.find((entry) => entry.kernel === "after").count,
    1,
  );

  const missingParent = data.dispatches.find((op) => op.commandBufferIndex === 404);
  assert.equal(missingParent.atNs, null);
  assert.equal(missingParent.placementDetail, "missing-parent-command-buffer");

  const missingOwnership = data.dispatches.find((op) => op.seq === 100);
  assert.equal(missingOwnership.atNs, null);
  assert.equal(missingOwnership.placementDetail, "missing-parent-command-buffer");
  assert.ok(data.launchWindows[0].dispatches.some((op) => op.kernel === "a"));
});

test("derives sequence bounds from sibling ops when a CB omits them", () => {
  const data = buildDataset([
    {
      record: "cb",
      command_buffer_index: 0,
      op_count: 3,
      encode_start_ns: 0,
      encode_end_ns: 20,
    },
    { record: "op", command_buffer_index: 0, seq: 100 },
    { record: "op", command_buffer_index: 0, seq: 101 },
    { record: "op", command_buffer_index: 0, seq: 102 },
    {
      record: "summary",
      schema_version: 1,
      complete: true,
      dropped_rows: 0,
    },
  ]);

  assert.deepEqual(
    data.dispatches.map((op) => op.atNs),
    [0, 10, 20],
  );
  assert.ok(data.dispatches.every((op) => op.placementDetail === "interpolated-sequence"));
});

test("derives sequence bounds iteratively for a 140k-op command buffer", () => {
  const operationCount = 140_001;
  const rows = [
    {
      record: "cb",
      command_buffer_index: 0,
      op_count: operationCount,
      encode_start_ns: 0,
      encode_end_ns: 140_000,
    },
  ];
  for (let seq = 0; seq < operationCount; seq += 1) {
    rows.push({ record: "op", command_buffer_index: 0, seq });
  }
  rows.push({
    record: "summary",
    schema_version: 1,
    complete: true,
    dropped_rows: 0,
    ops_total: operationCount,
    cbs_total: 1,
  });

  const data = buildDataset(rows);

  assert.equal(data.dispatches.length, operationCount);
  assert.equal(data.dispatches[0].atNs, 0);
  assert.equal(data.dispatches.at(-1).atNs, 140_000);
});

test("invalidates evidence when finite summary counts disagree with accepted rows", () => {
  const data = buildDataset([
    {
      record: "cb",
      command_buffer_index: 0,
      encode_start_ns: 0,
      encode_end_ns: 10,
    },
    { record: "op", command_buffer_index: 0, seq: 0 },
    {
      record: "summary",
      schema_version: 1,
      complete: true,
      dropped_rows: 0,
      ops_total: 2,
      cbs_total: 1,
    },
  ]);

  assert.equal(data.sourceCompleteness, "complete");
  assert.equal(data.health.validEvidence, false);
  assert.deepEqual(data.health.countMismatches, {
    opsTotal: { reported: 2, analyzed: 1 },
  });
  assert.deepEqual(data.diagnostics.countMismatches, data.health.countMismatches);
});

test("quarantines every CB row sharing a duplicate finite index deterministically", () => {
  const data = buildDataset([
    {
      record: "cb",
      command_buffer_index: 5,
      op_count: 1,
      encode_start_ns: 0,
      encode_end_ns: 10,
    },
    {
      record: "cb",
      command_buffer_index: 5,
      gpu_start_ns: 2,
      gpu_end_ns: 8,
    },
    {
      record: "cb",
      command_buffer_index: 6,
      op_count: 0,
      encode_start_ns: 20,
      encode_end_ns: 30,
      gpu_start_ns: 22,
      gpu_end_ns: 28,
    },
    { record: "op", command_buffer_index: 5, seq: 0 },
    {
      record: "summary",
      schema_version: 1,
      complete: true,
      dropped_rows: 0,
      ops_total: 1,
      cbs_total: 1,
    },
  ]);

  assert.deepEqual(
    data.commandBuffers.map((commandBuffer) => commandBuffer.commandBufferIndex),
    [6],
  );
  assert.equal(data.quarantinedCommandBuffers.length, 2);
  assert.deepEqual(
    data.quarantinedCommandBuffers.map((commandBuffer) => commandBuffer.commandBufferIndex),
    [5, 5],
  );
  assert.deepEqual(data.gpuIntervals, [[22, 28]]);
  assert.equal(data.summary.cbsTotal, 1);
  assert.deepEqual(data.health.duplicateCommandBufferIndices, [5]);
  assert.equal(data.health.duplicateCommandBufferRows, 2);
  assert.equal(data.health.validEvidence, false);
  assert.deepEqual(data.diagnostics.countMismatches, {});
  assert.equal(data.dispatches[0].placementDetail, "missing-parent-command-buffer");
  assert.equal(data.unassignedDispatches.length, 1);
});

test("wait taxonomy safely retains prototype-shaped bucket names", () => {
  const data = buildDataset([
    { record: "wait", bucket: "__proto__", wait_ns: 1, at_ns: 1 },
    { record: "wait", bucket: "constructor", wait_ns: 2, at_ns: 2 },
    { record: "wait", bucket: "toString", wait_ns: 3, at_ns: 3 },
    {
      record: "summary",
      schema_version: 1,
      complete: true,
      dropped_rows: 0,
      ops_total: 0,
      cbs_total: 0,
    },
  ]);

  assert.equal(Object.getPrototypeOf(data.waitTaxonomy), null);
  assert.equal(Object.hasOwn(data.waitTaxonomy, "__proto__"), true);
  assert.equal(data.waitTaxonomy.__proto__.waitNs, 1);
  assert.equal(data.waitTaxonomy.constructor.waitNs, 2);
  assert.equal(data.waitTaxonomy.toString.waitNs, 3);
  assert.equal(data.summary.otherWaitNs, 6);
});

test("normalization deeply copies and freezes all exposed JSON and interval values", () => {
  const rows = [
    {
      record: "op",
      command_buffer_index: 0,
      seq: 0,
      grid: [8, 1, 1],
      threadgroup: [4, 1, 1],
      custom: { nested: ["kept"] },
    },
    {
      record: "cb",
      command_buffer_index: 0,
      encode_start_ns: 0,
      encode_end_ns: 10,
      gpu_start_ns: 2,
      gpu_end_ns: 8,
    },
    {
      record: "summary",
      schema_version: 1,
      complete: true,
      dropped_rows: 0,
      ops_total: 1,
      cbs_total: 1,
      buckets: { cap_wait: { count: 1, samples: [5] } },
    },
  ];
  const data = buildDataset(rows);

  rows[0].grid[0] = 999;
  rows[0].threadgroup.push(999);
  rows[0].custom.nested[0] = "changed";
  rows[2].buckets.cap_wait.samples[0] = 999;

  assert.deepEqual(data.operations[0].grid, [8, 1, 1]);
  assert.deepEqual(data.operations[0].threadgroup, [4, 1, 1]);
  assert.deepEqual(data.operations[0].raw.custom, { nested: ["kept"] });
  assert.deepEqual(data.sourceSummary.buckets.cap_wait.samples, [5]);
  assert.equal(Object.isFrozen(data.operations[0].grid), true);
  assert.equal(Object.isFrozen(data.operations[0].raw.custom.nested), true);
  assert.equal(Object.isFrozen(data.sourceSummary.buckets.cap_wait), true);
  assert.equal(Object.isFrozen(data.gpuIntervals[0]), true);
  assert.throws(() => {
    data.operations[0].grid[0] = 7;
  }, TypeError);
  assert.throws(() => {
    data.gpuIntervals[0][0] = -1;
  }, TypeError);

  const intervals = mergeIntervals([[0, 2]]);
  assert.equal(Object.isFrozen(intervals), true);
  assert.equal(Object.isFrozen(intervals[0]), true);
});

test("normalizes and freezes JSON nested 5000 levels without overflowing the stack", () => {
  const leaf = { value: "deep" };
  let nested = leaf;
  for (let depth = 0; depth < 5_000; depth += 1) {
    nested = { child: nested };
  }
  const rows = [
    {
      record: "op",
      seq: 0,
      custom: nested,
    },
    {
      record: "summary",
      schema_version: 1,
      complete: true,
      dropped_rows: 0,
      ops_total: 1,
      cbs_total: 0,
    },
  ];

  const data = buildDataset(rows);
  leaf.value = "source changed";

  let output = data.operations[0].raw.custom;
  let traversed = 0;
  while (output.child) {
    assert.equal(Object.isFrozen(output), true);
    output = output.child;
    traversed += 1;
  }
  assert.equal(traversed, 5_000);
  assert.equal(output.value, "deep");
  assert.equal(Object.isFrozen(output), true);
});

test("marks legacy, incomplete, dropped, and missing summaries as invalid evidence", () => {
  const legacy = buildDataset([{ record: "summary", ops_total: 2, cbs_total: 1 }]);
  assert.equal(legacy.sourceCompleteness, "legacy-unverifiable");
  assert.equal(legacy.health.validEvidence, false);

  const incomplete = buildDataset([
    { record: "summary", schema_version: 1, complete: false, dropped_rows: 0 },
  ]);
  assert.equal(incomplete.sourceCompleteness, "incomplete");
  assert.equal(incomplete.health.validEvidence, false);

  const dropped = buildDataset([
    { record: "summary", schema_version: 1, complete: true, dropped_rows: 4 },
  ]);
  assert.equal(dropped.sourceCompleteness, "dropped-rows");
  assert.equal(dropped.health.validEvidence, false);

  const missing = buildDataset([null, { record: "future" }], { malformedRows: 2 });
  assert.equal(missing.sourceCompleteness, "missing-summary");
  assert.equal(missing.health.validEvidence, false);
  assert.equal(missing.health.malformedRows, 3);
  assert.equal(missing.health.unknownRows, 1);
  assert.equal(missing.summary.opsTotal, 0);
  assert.equal(missing.summary.cbsTotal, 0);
  assert.deepEqual(missing.launchWindows, []);
});

test("reports complete source evidence only with explicit v1 completion fields", () => {
  const data = buildDataset([
    {
      record: "summary",
      schema_version: 1,
      final: true,
      ops_total: 0,
      cbs_total: 0,
      complete: true,
      dropped_rows: 0,
    },
  ]);

  assert.equal(data.sourceCompleteness, "complete");
  assert.equal(data.health.validEvidence, true);
  assert.equal(data.summary.sourceCompleteness, "complete");
});

test("aggregates large wait streams without spreading all timestamps onto the stack", () => {
  const waits = Array.from({ length: 130_000 }, (_, atNs) => ({
    record: "wait",
    bucket: "alloc_lock",
    wait_ns: 1,
    at_ns: atNs,
  }));
  const data = buildDataset([
    ...waits,
    {
      record: "summary",
      schema_version: 1,
      complete: true,
      dropped_rows: 0,
    },
  ]);

  assert.equal(data.summary.startNs, 0);
  assert.equal(data.summary.endNs, 129_999);
  assert.equal(data.summary.otherWaitNs, 130_000);
  assert.equal(data.waitTaxonomy.alloc_lock.count, 130_000);
});

test("rejects combined headline wait overflow from otherwise finite categories", () => {
  assert.throws(
    () => buildDataset([
      {
        record: "wait",
        bucket: "cap_wait",
        wait_ns: Number.MAX_VALUE,
        at_ns: 0,
      },
      {
        record: "wait",
        bucket: "memory_wait",
        wait_ns: Number.MAX_VALUE,
        at_ns: 1,
      },
      {
        record: "summary",
        schema_version: 1,
        complete: true,
        dropped_rows: 0,
        ops_total: 0,
        cbs_total: 0,
      },
    ]),
    {
      name: "RangeError",
      message: /Headline wait duration exceeds the finite numeric range/,
    },
  );
});

test("rejects non-additive wait-taxonomy overflow from finite scheduler waits", () => {
  assert.throws(
    () => buildDataset([
      {
        record: "wait",
        bucket: "sched_backpressure",
        wait_ns: Number.MAX_VALUE,
        at_ns: 0,
      },
      {
        record: "wait",
        bucket: "sched_backpressure",
        wait_ns: Number.MAX_VALUE,
        at_ns: 1,
      },
    ]),
    {
      name: "RangeError",
      message: /Wait taxonomy duration exceeds the finite numeric range/,
    },
  );
});

test("rejects kernel-census accumulator overflow from raw dispatch rows", () => {
  const fields = [
    ["setBytes_calls", "setBytes calls"],
    ["setBytes_total_bytes", "setBytes bytes"],
    ["buffer_binds", "buffer binds"],
  ];

  for (const [field, label] of fields) {
    assert.throws(
      () => buildDataset([
        {
          record: "cb",
          command_buffer_index: 0,
          first_op_seq: 0,
          last_op_seq: 1,
          encode_start_ns: 0,
          encode_end_ns: 1,
        },
        {
          record: "op",
          command_buffer_index: 0,
          seq: 0,
          kernel_name: "overflow",
          [field]: Number.MAX_VALUE,
        },
        {
          record: "op",
          command_buffer_index: 0,
          seq: 1,
          kernel_name: "overflow",
          [field]: Number.MAX_VALUE,
        },
      ]),
      {
        name: "RangeError",
        message: new RegExp(`Kernel ${label} exceeds the finite numeric range`),
      },
      field,
    );
  }
});

test("rejects construction-time host, GPU work, and wall-span overflow", () => {
  const cases = [
    {
      label: "host",
      rows: [
        {
          record: "cb",
          command_buffer_index: 0,
          encode_start_ns: 0,
          encode_end_ns: Number.MAX_VALUE,
        },
        {
          record: "cb",
          command_buffer_index: 1,
          encode_start_ns: 0,
          encode_end_ns: Number.MAX_VALUE,
        },
      ],
      message: /Exposed host duration exceeds the finite numeric range/,
    },
    {
      label: "GPU work",
      rows: [
        {
          record: "cb",
          command_buffer_index: 0,
          gpu_start_ns: 0,
          gpu_end_ns: Number.MAX_VALUE,
        },
        {
          record: "cb",
          command_buffer_index: 1,
          gpu_start_ns: 0,
          gpu_end_ns: Number.MAX_VALUE,
        },
      ],
      message: /GPU work duration exceeds the finite numeric range/,
    },
    {
      label: "wall span",
      rows: [
        {
          record: "wait",
          bucket: "cap_wait",
          wait_ns: 0,
          at_ns: -Number.MAX_VALUE,
        },
        {
          record: "wait",
          bucket: "cap_wait",
          wait_ns: 0,
          at_ns: Number.MAX_VALUE,
        },
      ],
      message: /Wall span exceeds the finite numeric range/,
    },
  ];

  for (const { label, rows, message } of cases) {
    assert.throws(
      () => buildDataset(rows),
      { name: "RangeError", message },
      label,
    );
  }
});

test("range aggregation rejects overflow using retained launch records", () => {
  const dispatchDataset = buildDataset([
    {
      record: "cb",
      command_buffer_index: 0,
      first_op_seq: 0,
      last_op_seq: 0,
      encode_start_ns: 0,
      encode_end_ns: 10,
    },
    {
      record: "op",
      command_buffer_index: 0,
      seq: 0,
      kernel_name: "overflow",
      setBytes_total_bytes: Number.MAX_VALUE,
    },
  ]);
  const dispatchLaunch = dispatchDataset.launchWindows[0];
  assert.throws(
    () => buildRangeScope({
      ...dispatchLaunch,
      dispatches: Object.freeze([
        dispatchLaunch.dispatches[0],
        dispatchLaunch.dispatches[0],
      ]),
    }, { startNs: 0, endNs: 10 }),
    {
      name: "RangeError",
      message: /Kernel setBytes bytes exceeds the finite numeric range/,
    },
  );

  const waitDataset = buildDataset([
    {
      record: "cb",
      command_buffer_index: 0,
      encode_start_ns: 0,
      encode_end_ns: 10,
    },
    {
      record: "wait",
      bucket: "sched_backpressure",
      wait_ns: Number.MAX_VALUE,
      at_ns: 5,
    },
  ]);
  const waitLaunch = waitDataset.launchWindows[0];
  assert.throws(
    () => buildRangeScope({
      ...waitLaunch,
      waits: Object.freeze([waitLaunch.waits[0], waitLaunch.waits[0]]),
    }, { startNs: 0, endNs: 10 }),
    {
      name: "RangeError",
      message: /Wait taxonomy duration exceeds the finite numeric range/,
    },
  );
});

test("formats compact durations and byte sizes for browser consumers", () => {
  assert.equal(formatDuration(950), "950 ns");
  assert.equal(formatDuration(1_500), "1.5 µs");
  assert.equal(formatDuration(2_000_000), "2 ms");
  assert.equal(formatDuration(undefined), "—");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1536), "1.5 KiB");
  assert.equal(formatBytes(Number.NaN), "—");
});

test("range scope clips host and GPU intervals and includes points at both edges", () => {
  const launch = {
    index: 0,
    startNs: 0,
    endNs: 250,
    commandBuffers: [
      {
        commandBufferIndex: 0,
        encodeStartNs: 0,
        encodeEndNs: 100,
        gpuStartNs: 50,
        gpuEndNs: 150,
        exposedIntervals: [[0, 50]],
        hiddenIntervals: [[50, 100]],
      },
      {
        commandBufferIndex: 1,
        encodeStartNs: 100,
        encodeEndNs: 200,
        gpuStartNs: 150,
        gpuEndNs: 250,
        exposedIntervals: [],
        hiddenIntervals: [[100, 200]],
      },
    ],
    dispatches: [
      { kernel: "edge-a", atNs: 75, setBytesCalls: 1 },
      { kernel: "middle", atNs: 125, bufferBinds: 2 },
      { kernel: "edge-b", atNs: 175, setBytesTotalBytes: 16 },
      { kernel: "outside", atNs: 200 },
      { kernel: "unplaced", atNs: null },
    ],
    waits: [
      {
        bucket: "cap_wait",
        waitClass: "cap",
        detailClass: "cap",
        headlineCategory: "cap",
        waitNs: 7,
        atNs: 75,
      },
      {
        bucket: "cb_wait_until_completed",
        waitClass: "decision",
        detailClass: "decision",
        headlineCategory: "decision",
        waitNs: 11,
        atNs: 175,
      },
      {
        bucket: "dependency_cv_wait",
        waitClass: "dependency",
        headlineCategory: "dependency",
        waitNs: 13,
        atNs: null,
      },
    ],
  };

  const range = buildRangeScope(launch, { startNs: 75, endNs: 175 });

  assert.deepEqual(range.range, { startNs: 75, endNs: 175 });
  assert.equal(range.summary.wallSpanNs, 100);
  assert.equal(range.summary.exposedHostNs, 0);
  assert.equal(range.summary.hiddenHostNs, 100);
  assert.equal(range.summary.gpuBusyNs, 100);
  assert.equal(range.summary.gpuWorkNs, 100);
  assert.equal(range.summary.cbsTotal, 2);
  assert.equal(range.summary.opsTotal, 3);
  assert.equal(range.summary.capWaitNs, 7);
  assert.equal(range.summary.decisionWaitNs, 11);
  assert.deepEqual(
    range.kernelCensus.map(({ kernel, count }) => [kernel, count]),
    [["edge-a", 1], ["edge-b", 1], ["middle", 1]],
  );
  assert.deepEqual(range.gpuIntervals, [[75, 175]]);
  assert.deepEqual(range.commandBuffers[0].hiddenIntervals, [[75, 100]]);
  assert.deepEqual(range.commandBuffers[1].hiddenIntervals, [[100, 175]]);
  assert.deepEqual(range.commandBuffers.map((commandBuffer) => [
    commandBuffer.encodeStartNs,
    commandBuffer.encodeEndNs,
    commandBuffer.gpuStartNs,
    commandBuffer.gpuEndNs,
    commandBuffer.rangeGpuInterval,
  ]), [
    [0, 100, 50, 150, [75, 150]],
    [100, 200, 150, 250, [150, 175]],
  ]);
  assert.deepEqual(Object.keys(range.waitTaxonomy).sort(), [
    "cap_wait",
    "cb_wait_until_completed",
  ]);
  assert.deepEqual(range.omissions, {
    unplacedDispatches: 1,
    unanchoredWaits: 1,
  });
  assert.equal(Object.isFrozen(range), true);
  assert.equal(Object.isFrozen(range.commandBuffers[0].hiddenIntervals[0]), true);
});

test("full-launch range preserves exact launch aggregates and endpoint events", () => {
  const dataset = buildDataset([
    {
      record: "cb",
      command_buffer_index: 0,
      first_op_seq: 0,
      last_op_seq: 1,
      encode_start_ns: 0,
      encode_end_ns: 100,
      gpu_start_ns: 50,
      gpu_end_ns: 150,
    },
    {
      record: "op",
      command_buffer_index: 0,
      seq: 0,
      kernel_name: "first",
    },
    {
      record: "op",
      command_buffer_index: 0,
      seq: 1,
      kernel_name: "last",
    },
    {
      record: "wait",
      bucket: "cap_wait",
      wait_ns: 3,
      at_ns: 150,
    },
  ]);
  const launch = dataset.launchWindows[0];
  const range = buildRangeScope(launch, {
    startNs: launch.startNs,
    endNs: launch.endNs,
  });

  for (const key of [
    "wallSpanNs",
    "exposedHostNs",
    "hiddenHostNs",
    "gpuBusyNs",
    "gpuWorkNs",
    "gpuSpanNs",
    "capWaitNs",
    "dependencyWaitNs",
    "decisionWaitNs",
    "otherWaitNs",
    "headlineWaitNs",
    "opsTotal",
    "cbsTotal",
  ]) {
    assert.equal(range.summary[key], launch.summary[key], key);
  }
  assert.equal(range.waits.at(-1).atNs, launch.endNs);
  assert.equal(range.commandBuffers[0].encodeStartNs, 0);
  assert.equal(range.commandBuffers[0].gpuEndNs, 150);
});

test("range validation clamps to one launch and rejects invalid or collapsed bounds", () => {
  const scope = {
    startNs: 10,
    endNs: 90,
    commandBuffers: [],
    dispatches: [],
    waits: [],
  };

  const clamped = buildRangeScope(scope, { startNs: -100, endNs: 200 });
  assert.deepEqual(clamped.range, { startNs: 10, endNs: 90 });
  assert.equal(clamped.summary.wallSpanNs, 80);

  assert.throws(
    () => buildRangeScope(scope, { startNs: 40, endNs: 40 }),
    RangeError,
  );
  assert.throws(
    () => buildRangeScope(scope, { startNs: 100, endNs: 120 }),
    RangeError,
  );
  assert.throws(
    () => buildRangeScope(scope, { startNs: Number.NaN, endNs: 50 }),
    TypeError,
  );
  assert.throws(
    () => buildRangeScope({ ...scope, endNs: Infinity }, { startNs: 20, endNs: 50 }),
    TypeError,
  );
});

test("empty-event ranges retain the selected wall span and exact omission counts", () => {
  const range = buildRangeScope({
    startNs: 0,
    endNs: 100,
    commandBuffers: [],
    dispatches: [{ kernel: "unplaced-a", atNs: null }, { kernel: "unplaced-b" }],
    waits: [{ bucket: "cap_wait", atNs: null }, { bucket: "memory_wait" }],
  }, { startNs: 20, endNs: 40 });

  assert.equal(range.summary.wallSpanNs, 20);
  assert.deepEqual(range.commandBuffers, []);
  assert.deepEqual(range.dispatches, []);
  assert.deepEqual(range.waits, []);
  assert.deepEqual(range.gpuIntervals, []);
  assert.deepEqual(range.kernelCensus, []);
  assert.deepEqual(Object.keys(range.waitTaxonomy), []);
  assert.deepEqual(range.omissions, {
    unplacedDispatches: 2,
    unanchoredWaits: 2,
  });
  assert.deepEqual(range.summary, {
    startNs: 20,
    endNs: 40,
    wallSpanNs: 20,
    exposedHostNs: 0,
    hiddenHostNs: 0,
    gpuBusyNs: 0,
    gpuWorkNs: 0,
    gpuSpanNs: 0,
    capWaitNs: 0,
    dependencyWaitNs: 0,
    decisionWaitNs: 0,
    otherWaitNs: 0,
    headlineWaitNs: 0,
    opsTotal: 0,
    cbsTotal: 0,
  });
});

test("installed launches propagate trace-level unattributable omissions without double counting", () => {
  const dataset = buildDataset([
    {
      record: "cb",
      command_buffer_index: 0,
      first_op_seq: 0,
      last_op_seq: 1,
      encode_start_ns: 0,
      encode_end_ns: 100,
      gpu_start_ns: 50,
      gpu_end_ns: 150,
    },
    {
      record: "cb",
      command_buffer_index: 1,
      encode_start_ns: 200,
      encode_end_ns: 300,
    },
    {
      record: "cb",
      command_buffer_index: 2,
      encode_start_ns: 400,
      encode_end_ns: 500,
    },
    {
      record: "cb",
      command_buffer_index: 3,
      encode_start_ns: 200_000_000,
      encode_end_ns: 200_000_100,
    },
    {
      record: "op",
      command_buffer_index: 0,
      seq: 0,
      kernel_name: "placed",
    },
    {
      record: "op",
      command_buffer_index: 0,
      kernel_name: "launch-local-unplaced",
    },
    {
      record: "op",
      command_buffer_index: 404,
      seq: 404,
      kernel_name: "trace-unowned",
    },
    {
      record: "wait",
      bucket: "cap_wait",
      wait_ns: 3,
      at_ns: 75,
    },
    {
      record: "wait",
      bucket: "dependency_cv_wait",
      wait_ns: 5,
      command_buffer_index: 0,
    },
  ]);

  assert.equal(dataset.launchWindows.length, 2);
  assert.equal(dataset.unassignedDispatches.length, 1);
  assert.equal(dataset.unassignedWaits.length, 1);
  for (const launch of dataset.launchWindows) {
    assert.deepEqual(launch.omissions, {
      scope: "trace-level-unattributable",
      unplacedDispatches: 1,
      unanchoredWaits: 1,
    });
    assert.equal(Object.isFrozen(launch.omissions), true);
  }

  const firstLaunch = dataset.launchWindows[0];
  const firstRange = buildRangeScope(firstLaunch, {
    startNs: firstLaunch.startNs,
    endNs: firstLaunch.endNs,
  });
  const secondLaunch = dataset.launchWindows[1];
  const secondRange = buildRangeScope(secondLaunch, {
    startNs: secondLaunch.startNs,
    endNs: secondLaunch.endNs,
  });

  assert.deepEqual(firstRange.omissions, {
    unplacedDispatches: 2,
    unanchoredWaits: 1,
  });
  assert.deepEqual(secondRange.omissions, {
    unplacedDispatches: 1,
    unanchoredWaits: 1,
  });
  assert.equal(Object.isFrozen(firstLaunch), true);
  assert.equal(Object.isFrozen(firstLaunch.dispatches), true);
  assert.equal(Object.isFrozen(firstLaunch.dispatches[0]), true);
  assert.equal(Object.isFrozen(firstLaunch.commandBuffers[0]), true);
  assert.equal(Object.isFrozen(firstLaunch.waits[0]), true);
  assert.equal(firstRange.dispatches[0], firstLaunch.dispatches[0]);
  assert.equal(firstRange.waits[0], firstLaunch.waits[0]);
});

test("overview bins retain exact coverage, sorted wait classes, and final endpoints", () => {
  const scope = {
    startNs: 0,
    endNs: 100,
    commandBuffers: [{
      encodeStartNs: 0,
      encodeEndNs: 100,
      gpuStartNs: 25,
      gpuEndNs: 75,
      exposedIntervals: [[0, 25], [75, 100]],
      hiddenIntervals: [[25, 75]],
    }],
    dispatches: [{ atNs: 0 }, { atNs: 50 }, { atNs: 100 }],
    waits: [
      { atNs: 25, waitClass: "cap" },
      { atNs: 75, waitClass: "decision" },
      { atNs: 100, waitClass: "cap" },
    ],
  };

  const overview = buildOverviewBins(scope, 4);

  assert.equal(overview.binCount, 4);
  assert.deepEqual(
    overview.bins.map((bin) => [bin.startNs, bin.endNs]),
    [[0, 25], [25, 50], [50, 75], [75, 100]],
  );
  assert.deepEqual(
    overview.bins.map((bin) => bin.hostEncodeNs),
    [25, 25, 25, 25],
  );
  assert.deepEqual(
    overview.bins.map((bin) => bin.gpuBusyNs),
    [0, 25, 25, 0],
  );
  assert.equal(
    overview.bins.reduce((total, bin) => total + bin.dispatchCount, 0),
    3,
  );
  assert.equal(
    overview.bins.reduce((total, bin) => total + bin.waitCount, 0),
    3,
  );
  assert.equal(
    overview.bins.reduce((total, bin) => total + bin.gpuBusyNs, 0),
    50,
  );
  assert.equal(overview.bins[3].dispatchCount, 1);
  assert.deepEqual(overview.bins[3].waitClasses, ["cap", "decision"]);
  assert.equal(Object.isFrozen(overview.bins[3].waitClasses), true);
});

test("overview rejects unsafe bin counts before allocating bins", () => {
  const scope = {
    startNs: 0,
    endNs: 1,
    commandBuffers: [],
    dispatches: [],
    waits: [],
  };
  const invalidCounts = [
    0,
    1.5,
    Infinity,
    4_097,
    2 ** 32,
    Number.MAX_SAFE_INTEGER,
  ];

  for (const binCount of invalidCounts) {
    assert.throws(
      () => buildOverviewBins(scope, binCount),
      {
        name: "RangeError",
        message: /safe integer between 1 and 4096/,
      },
      String(binCount),
    );
  }
  assert.equal(buildOverviewBins(scope).binCount, 512);
  assert.equal(buildOverviewBins(scope, 4_096).bins.length, 4_096);
});

test("range and overview reject finite endpoints whose derived span overflows", () => {
  const scope = {
    startNs: -Number.MAX_VALUE,
    endNs: Number.MAX_VALUE,
    commandBuffers: [],
    dispatches: [],
    waits: [],
  };

  assert.throws(
    () => buildRangeScope(scope, {
      startNs: scope.startNs,
      endNs: scope.endNs,
    }),
    {
      name: "RangeError",
      message: /finite positive duration/,
    },
  );
  assert.throws(
    () => buildOverviewBins(scope, 4),
    {
      name: "RangeError",
      message: /finite positive duration/,
    },
  );
});

test("overview bin geometry remains finite near the numeric range limit", () => {
  const maximum = Number.MAX_VALUE;
  const scope = {
    startNs: 0,
    endNs: maximum,
    commandBuffers: [{
      encodeStartNs: 0,
      encodeEndNs: maximum,
      gpuStartNs: 0,
      gpuEndNs: maximum,
      exposedIntervals: [[0, maximum]],
      hiddenIntervals: [],
    }],
    dispatches: [{ atNs: maximum }],
    waits: [{ atNs: maximum, waitClass: "decision" }],
  };

  const overview = buildOverviewBins(scope, 4);
  const range = buildRangeScope(scope, { startNs: 0, endNs: maximum });

  for (const bin of overview.bins) {
    for (const key of ["startNs", "endNs", "hostEncodeNs", "gpuBusyNs"]) {
      assert.equal(Number.isFinite(bin[key]), true, `${key}: ${bin[key]}`);
    }
  }
  for (const value of Object.values(range.summary)) {
    assert.equal(Number.isFinite(value), true, String(value));
  }
  assert.equal(overview.bins.at(-1).endNs, maximum);
  assert.equal(overview.bins.at(-1).dispatchCount, 1);
  assert.equal(overview.bins.at(-1).waitCount, 1);
});

test("overview interval work scales with touched bins instead of total resolution", () => {
  let endpointReads = 0;
  const trackedInterval = () =>
    new Proxy([999, 999.5], {
      get(target, property, receiver) {
        if (property === "0" || property === "1") {
          endpointReads += 1;
        }
        return Reflect.get(target, property, receiver);
      },
    });
  const intervalCount = 128;
  const commandBuffers = Array.from({ length: intervalCount }, () => ({
    exposedIntervals: [trackedInterval()],
    hiddenIntervals: [],
  }));

  const overview = buildOverviewBins({
    startNs: 0,
    endNs: 1_000,
    commandBuffers,
    dispatches: [],
    waits: [],
  }, 512);

  assert.equal(overview.bins.at(-1).hostEncodeNs, intervalCount / 2);
  assert.ok(
    endpointReads < intervalCount * 20,
    `read ${endpointReads} interval endpoints for ${intervalCount} one-bin intervals`,
  );
});

test("each launch scope carries a frozen overview without circular references", () => {
  const dataset = buildDataset([
    {
      record: "cb",
      command_buffer_index: 0,
      encode_start_ns: 0,
      encode_end_ns: 10,
      gpu_start_ns: 2,
      gpu_end_ns: 8,
    },
  ]);
  const launch = dataset.launchWindows[0];

  assert.equal(launch.overview.binCount, 512);
  assert.equal(launch.overview.startNs, launch.startNs);
  assert.equal(launch.overview.endNs, launch.endNs);
  assert.doesNotThrow(() => JSON.stringify(launch));
  assert.equal(Object.isFrozen(launch.overview), true);
  assert.equal(Object.isFrozen(launch.overview.bins), true);
  assert.equal(Object.isFrozen(launch.overview.bins[0]), true);
});

test("dataset construction retains untimed command buffers without fabricating an overview", () => {
  const dataset = buildDataset([
    {
      record: "cb",
      command_buffer_index: 0,
    },
  ]);

  assert.equal(dataset.launchWindows.length, 1);
  assert.equal(dataset.launchWindows[0].startNs, null);
  assert.equal(dataset.launchWindows[0].endNs, null);
  assert.equal(dataset.launchWindows[0].overview, null);
  assert.deepEqual(dataset.launchWindows[0].rangeAnalysis, {
    available: false,
    reason: "missing-launch-timing",
  });
  assert.throws(
    () => buildRangeScope(dataset.launchWindows[0], { startNs: 0, endNs: 1 }),
    {
      name: "RangeError",
      message: /missing launch timing/,
    },
  );
  assert.equal(Object.isFrozen(dataset.launchWindows[0]), true);
});

test("mixed timed and untimed command buffers remain inspectable but not range-analyzable", () => {
  const dataset = buildDataset([
    {
      record: "cb",
      command_buffer_index: 0,
      encode_start_ns: 0,
      encode_end_ns: 100,
      gpu_start_ns: 25,
      gpu_end_ns: 75,
    },
    {
      record: "cb",
      command_buffer_index: 1,
    },
  ]);
  const launch = dataset.launchWindows[0];

  assert.equal(launch.summary.cbsTotal, 2);
  assert.equal(launch.commandBuffers.length, 2);
  assert.deepEqual(launch.rangeAnalysis, {
    available: false,
    reason: "missing-command-buffer-timing",
  });
  assert.equal(Object.isFrozen(launch.rangeAnalysis), true);
  assert.equal(launch.overview.binCount, 512);
  assert.throws(
    () => buildRangeScope(launch, {
      startNs: launch.startNs,
      endNs: launch.endNs,
    }),
    {
      name: "RangeError",
      message: /missing command-buffer timing/,
    },
  );
});

test("anchored zero-op command buffers use inclusive point membership with zero duration", () => {
  const dataset = buildDataset([
    {
      record: "cb",
      command_buffer_index: 0,
      op_count: 1,
      encode_start_ns: 0,
      encode_end_ns: 100,
    },
    {
      record: "cb",
      command_buffer_index: 1,
      op_count: 0,
      encode_start_ns: 50,
      encode_end_ns: 50,
      gpu_start_ns: 60,
      gpu_end_ns: 60,
    },
  ]);
  const launch = dataset.launchWindows[0];

  assert.deepEqual(launch.rangeAnalysis, { available: true, reason: null });
  const full = buildRangeScope(launch, {
    startNs: launch.startNs,
    endNs: launch.endNs,
  });
  const excluding = buildRangeScope(launch, { startNs: 0, endNs: 49 });
  const including = buildRangeScope(launch, { startNs: 50, endNs: 55 });

  assert.equal(full.summary.cbsTotal, launch.summary.cbsTotal);
  assert.equal(excluding.summary.cbsTotal, 1);
  assert.equal(including.summary.cbsTotal, 2);
  assert.equal(including.summary.exposedHostNs, 5);
  assert.equal(including.summary.hiddenHostNs, 0);
  assert.equal(including.summary.gpuWorkNs, 0);
  assert.deepEqual(
    including.commandBuffers.find(
      (commandBuffer) => commandBuffer.commandBufferIndex === 1,
    ).rangeGpuInterval,
    null,
  );
});

test("a degenerate anchored command buffer that owns ops remains unavailable", () => {
  const dataset = buildDataset([
    {
      record: "cb",
      command_buffer_index: 0,
      op_count: 1,
      encode_start_ns: 0,
      encode_end_ns: 100,
    },
    {
      record: "cb",
      command_buffer_index: 1,
      op_count: 0,
      first_op_seq: 1,
      last_op_seq: 1,
      encode_start_ns: 50,
      encode_end_ns: 50,
    },
    {
      record: "op",
      command_buffer_index: 1,
      seq: 1,
    },
  ]);

  assert.deepEqual(dataset.launchWindows[0].rangeAnalysis, {
    available: false,
    reason: "missing-command-buffer-timing",
  });
});

test("all launches in the bundled showcases satisfy the range-analysis invariant", async () => {
  const showcaseUrl = new URL("../traces/showcase/", import.meta.url);
  const manifest = JSON.parse(
    await readFile(new URL("traces.json", showcaseUrl), "utf8"),
  );
  const filenames = Object.keys(manifest.traces);
  assert.ok(filenames.length > 0, "showcase manifest must register a trace");

  for (const filename of filenames) {
    const text = await readFile(new URL(filename, showcaseUrl), "utf8");
    const rows = text.trimEnd().split("\n").map(JSON.parse);
    const dataset = buildDataset(rows);
    assert.ok(dataset.launchWindows.length > 0, filename);
    for (const launch of dataset.launchWindows) {
      assert.deepEqual(
        launch.rangeAnalysis,
        { available: true, reason: null },
        filename,
      );
      const range = buildRangeScope(launch, {
        startNs: launch.startNs,
        endNs: launch.endNs,
      });
      for (const key of [
        "wallSpanNs",
        "exposedHostNs",
        "hiddenHostNs",
        "gpuBusyNs",
        "gpuWorkNs",
        "gpuSpanNs",
        "capWaitNs",
        "dependencyWaitNs",
        "decisionWaitNs",
        "otherWaitNs",
        "headlineWaitNs",
        "opsTotal",
        "cbsTotal",
      ]) {
        assert.equal(
          range.summary[key],
          launch.summary[key],
          `${filename}: full-range ${key} parity`,
        );
      }
    }
  }
});
