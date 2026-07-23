const MIN_LAUNCH_GAP_NS = 100_000_000;
const LAUNCH_GAP_MULTIPLIER = 20;
const DEFAULT_OVERVIEW_BIN_COUNT = 512;
const MAX_OVERVIEW_BIN_COUNT = 4_096;
const TRACE_OMISSION_SCOPE = "trace-level-unattributable";

const TYPE_ALIASES = new Map([
  ["op", "op"],
  ["operation", "op"],
  ["dispatch", "op"],
  ["cb", "cb"],
  ["command_buffer", "cb"],
  ["command-buffer", "cb"],
  ["commandbuffer", "cb"],
  ["wait", "wait"],
  ["stall", "wait"],
  ["summary", "summary"],
  ["final_summary", "summary"],
  ["final-summary", "summary"],
]);

const SCHEDULER_DETAIL = new Map([
  ["sched_backpressure", "scheduler-mirror"],
  ["sched_worker_wait", "idle"],
]);
const EMPTY_INTERVALS = Object.freeze([]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cloneAndFreezeJson(value) {
  if (value === null || typeof value !== "object") {
    return value;
  }

  const createContainer = (source) =>
    Array.isArray(source)
      ? new Array(source.length)
      : Object.getPrototypeOf(source) === null
        ? Object.create(null)
        : {};
  const root = createContainer(value);
  const seen = new WeakMap([[value, root]]);
  const pending = [value];
  const freezeOrder = [];

  while (pending.length > 0) {
    const source = pending.pop();
    const target = seen.get(source);
    freezeOrder.push(target);

    for (const key of Object.keys(source)) {
      const sourceValue = source[key];
      let clonedValue = sourceValue;
      if (sourceValue !== null && typeof sourceValue === "object") {
        clonedValue = seen.get(sourceValue);
        if (clonedValue === undefined) {
          clonedValue = createContainer(sourceValue);
          seen.set(sourceValue, clonedValue);
          pending.push(sourceValue);
        }
      }
      Object.defineProperty(target, key, {
        value: clonedValue,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  }

  for (let index = freezeOrder.length - 1; index >= 0; index -= 1) {
    Object.freeze(freezeOrder[index]);
  }
  return root;
}

function firstDefined(row, names) {
  for (const name of names) {
    if (row[name] !== undefined) {
      return row[name];
    }
  }
  return undefined;
}

function finiteValue(row, names) {
  const value = firstDefined(row, names);
  return Number.isFinite(value) ? value : undefined;
}

function nonNegativeValue(row, names) {
  const value = finiteValue(row, names);
  return value !== undefined && value >= 0 ? value : undefined;
}

function stringValue(row, names) {
  const value = firstDefined(row, names);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function copyPresent(target, key, value) {
  if (value !== undefined) {
    target[key] = value;
  }
}

function normalizeTypeName(value) {
  if (typeof value !== "string") {
    return undefined;
  }
  return TYPE_ALIASES.get(value.trim().toLowerCase());
}

function inferType(row) {
  const explicit = firstDefined(row, ["record", "type"]);
  if (explicit !== undefined) {
    return normalizeTypeName(explicit) ?? "unknown";
  }

  const kindType = normalizeTypeName(row.kind);
  if (kindType) {
    return kindType;
  }
  if (
    row.bucket !== undefined ||
    row.cause !== undefined ||
    row.wait_ns !== undefined ||
    row.duration_ns !== undefined
  ) {
    return "wait";
  }
  if (
    row.encode_start_ns !== undefined ||
    row.encode_end_ns !== undefined ||
    row.gpu_start_ns !== undefined ||
    row.gpu_end_ns !== undefined ||
    row.op_count !== undefined
  ) {
    return "cb";
  }
  if (
    row.schema_version !== undefined ||
    row.complete !== undefined ||
    row.dropped_rows !== undefined ||
    row.ops_total !== undefined ||
    row.cbs_total !== undefined ||
    row.final !== undefined ||
    row.buckets !== undefined
  ) {
    return "summary";
  }
  if (
    row.seq !== undefined ||
    row.command_buffer_index !== undefined ||
    row.cb_index !== undefined ||
    row.kernel_name !== undefined ||
    row.kernel !== undefined
  ) {
    return "op";
  }
  return "unknown";
}

function normalizeOp(row) {
  const result = { type: "op" };
  copyPresent(result, "seq", nonNegativeValue(row, ["seq"]));
  copyPresent(
    result,
    "commandBufferIndex",
    nonNegativeValue(row, ["command_buffer_index", "cb_index", "commandBufferIndex"]),
  );
  copyPresent(result, "kind", stringValue(row, ["kind"]));
  copyPresent(result, "dispatch", stringValue(row, ["dispatch"]));
  copyPresent(result, "kernel", stringValue(row, ["kernel_name", "kernel"]));
  copyPresent(
    result,
    "setBytesCalls",
    nonNegativeValue(row, ["setBytes_calls", "set_bytes_calls", "setBytesCalls"]),
  );
  copyPresent(
    result,
    "setBytesTotalBytes",
    nonNegativeValue(row, ["setBytes_total_bytes", "set_bytes_total", "setBytesTotalBytes"]),
  );
  copyPresent(
    result,
    "bufferBinds",
    nonNegativeValue(row, ["buffer_binds", "bufferBinds"]),
  );
  copyPresent(result, "grid", row.grid);
  copyPresent(result, "threadgroup", row.threadgroup);
  result.raw = row;
  return Object.freeze(result);
}

function normalizeCommandBuffer(row) {
  const result = { type: "cb" };
  copyPresent(
    result,
    "commandBufferIndex",
    nonNegativeValue(row, ["command_buffer_index", "cb_index", "commandBufferIndex"]),
  );
  copyPresent(result, "opCount", nonNegativeValue(row, ["op_count", "opCount"]));
  copyPresent(result, "firstOpSeq", nonNegativeValue(row, ["first_op_seq", "firstOpSeq"]));
  copyPresent(result, "lastOpSeq", nonNegativeValue(row, ["last_op_seq", "lastOpSeq"]));
  copyPresent(
    result,
    "encodeStartNs",
    finiteValue(row, ["encode_start_ns", "encodeStartNs", "encode_start"]),
  );
  copyPresent(
    result,
    "encodeEndNs",
    finiteValue(row, ["encode_end_ns", "encodeEndNs", "encode_end"]),
  );
  copyPresent(
    result,
    "gpuStartNs",
    finiteValue(row, ["gpu_start_ns", "gpuStartNs", "gpu_start"]),
  );
  copyPresent(
    result,
    "gpuEndNs",
    finiteValue(row, ["gpu_end_ns", "gpuEndNs", "gpu_end"]),
  );
  result.raw = row;
  return Object.freeze(result);
}

function waitDetail(bucket, waitClass) {
  return SCHEDULER_DETAIL.get(bucket) ?? waitClass;
}

function normalizeWait(row) {
  const result = { type: "wait" };
  const bucket = stringValue(row, ["bucket", "cause"]);
  const waitClass = bucket === undefined ? undefined : classifyWait(bucket);
  const schedulerDetail = bucket === undefined ? undefined : SCHEDULER_DETAIL.get(bucket);

  copyPresent(result, "bucket", bucket);
  copyPresent(
    result,
    "waitNs",
    nonNegativeValue(row, ["wait_ns", "duration_ns", "ns", "dur_ns", "waitNs"]),
  );
  copyPresent(
    result,
    "atNs",
    finiteValue(row, [
      "at_ns",
      "ts_ns",
      "start_ns",
      "time_ns",
      "timestamp_ns",
      "atNs",
    ]),
  );
  copyPresent(
    result,
    "commandBufferIndex",
    nonNegativeValue(row, ["command_buffer_index", "cb_index", "commandBufferIndex"]),
  );
  copyPresent(result, "waitClass", waitClass);
  copyPresent(result, "detailClass", waitDetail(bucket, waitClass));
  if (waitClass !== undefined) {
    result.headlineCategory = schedulerDetail ? null : waitClass;
  }
  result.raw = row;
  return Object.freeze(result);
}

function normalizeSummary(row) {
  const result = { type: "summary" };
  copyPresent(
    result,
    "schemaVersion",
    nonNegativeValue(row, ["schema_version", "schemaVersion"]),
  );
  if (typeof row.final === "boolean") {
    result.final = row.final;
  }
  copyPresent(result, "opsTotal", nonNegativeValue(row, ["ops_total", "opsTotal"]));
  copyPresent(result, "cbsTotal", nonNegativeValue(row, ["cbs_total", "cbsTotal"]));
  copyPresent(result, "droppedRows", nonNegativeValue(row, ["dropped_rows", "droppedRows"]));
  if (typeof row.complete === "boolean") {
    result.complete = row.complete;
  }
  if (isRecord(row.buckets)) {
    result.buckets = row.buckets;
  }
  result.raw = row;
  return Object.freeze(result);
}

/**
 * Normalize one parsed dispatch-census row. Invalid container values return
 * null; well-formed but unsupported records remain visible as `unknown`.
 */
export function normalizeRow(row) {
  if (!isRecord(row)) {
    return null;
  }

  const immutableRow = cloneAndFreezeJson(row);
  switch (inferType(immutableRow)) {
    case "op":
      return normalizeOp(immutableRow);
    case "cb":
      return normalizeCommandBuffer(immutableRow);
    case "wait":
      return normalizeWait(immutableRow);
    case "summary":
      return normalizeSummary(immutableRow);
    default:
      return Object.freeze({ type: "unknown", raw: immutableRow });
  }
}

function validInterval(interval) {
  return (
    Array.isArray(interval) &&
    interval.length >= 2 &&
    Number.isFinite(interval[0]) &&
    Number.isFinite(interval[1]) &&
    interval[1] > interval[0]
  );
}

function freezeIntervals(intervals) {
  if (intervals.length === 0) {
    return EMPTY_INTERVALS;
  }
  return Object.freeze(
    intervals.map(([start, end]) => Object.freeze([start, end])),
  );
}

export function mergeIntervals(intervals) {
  if (!Array.isArray(intervals)) {
    return EMPTY_INTERVALS;
  }

  const sorted = intervals
    .filter(validInterval)
    .map(([start, end]) => [start, end])
    .sort((left, right) => left[0] - right[0] || left[1] - right[1]);

  const merged = [];
  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (!previous || interval[0] > previous[1]) {
      merged.push(interval);
    } else if (interval[1] > previous[1]) {
      previous[1] = interval[1];
    }
  }
  return freezeIntervals(merged);
}

export function intersectIntervals(left, right) {
  const leftUnion = mergeIntervals(left);
  const rightUnion = mergeIntervals(right);
  const intersections = [];
  let leftIndex = 0;
  let rightIndex = 0;

  while (leftIndex < leftUnion.length && rightIndex < rightUnion.length) {
    const leftInterval = leftUnion[leftIndex];
    const rightInterval = rightUnion[rightIndex];
    const start = Math.max(leftInterval[0], rightInterval[0]);
    const end = Math.min(leftInterval[1], rightInterval[1]);
    if (end > start) {
      intersections.push([start, end]);
    }
    if (leftInterval[1] <= rightInterval[1]) {
      leftIndex += 1;
    } else {
      rightIndex += 1;
    }
  }
  return freezeIntervals(intersections);
}

export function subtractIntervals(left, right) {
  const source = mergeIntervals(left);
  const coverage = mergeIntervals(right);
  const remainder = [];
  let coverageIndex = 0;

  for (const [sourceStart, sourceEnd] of source) {
    let cursor = sourceStart;

    while (coverageIndex < coverage.length && coverage[coverageIndex][1] <= cursor) {
      coverageIndex += 1;
    }

    let index = coverageIndex;
    while (index < coverage.length && coverage[index][0] < sourceEnd) {
      const [coverStart, coverEnd] = coverage[index];
      if (coverStart > cursor) {
        remainder.push([cursor, Math.min(coverStart, sourceEnd)]);
      }
      cursor = Math.max(cursor, coverEnd);
      if (cursor >= sourceEnd) {
        break;
      }
      index += 1;
    }

    if (cursor < sourceEnd) {
      remainder.push([cursor, sourceEnd]);
    }
  }
  return freezeIntervals(remainder);
}

function firstIntervalEndingAfter(intervals, value) {
  let low = 0;
  let high = intervals.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (intervals[middle][1] <= value) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

function intersectIntervalWithUnion(interval, union) {
  if (!validInterval(interval) || union.length === 0) {
    return EMPTY_INTERVALS;
  }
  const [start, end] = interval;
  const intersections = [];
  for (
    let index = firstIntervalEndingAfter(union, start);
    index < union.length && union[index][0] < end;
    index += 1
  ) {
    const intersectionStart = Math.max(start, union[index][0]);
    const intersectionEnd = Math.min(end, union[index][1]);
    if (intersectionEnd > intersectionStart) {
      intersections.push([intersectionStart, intersectionEnd]);
    }
  }
  return freezeIntervals(intersections);
}

function subtractIntervalFromUnion(interval, union) {
  if (!validInterval(interval)) {
    return EMPTY_INTERVALS;
  }
  const [start, end] = interval;
  if (union.length === 0) {
    return freezeIntervals([[start, end]]);
  }

  const remainder = [];
  let cursor = start;
  for (
    let index = firstIntervalEndingAfter(union, start);
    index < union.length && union[index][0] < end;
    index += 1
  ) {
    const [coverStart, coverEnd] = union[index];
    if (coverStart > cursor) {
      remainder.push([cursor, Math.min(coverStart, end)]);
    }
    cursor = Math.max(cursor, coverEnd);
    if (cursor >= end) {
      break;
    }
  }
  if (cursor < end) {
    remainder.push([cursor, end]);
  }
  return freezeIntervals(remainder);
}

export function classifyWait(bucket) {
  switch (bucket) {
    case "cap_wait":
      return "cap";
    case "memory_wait":
    case "dependency_cv_wait":
      return "dependency";
    case "cb_wait_until_completed":
      return "decision";
    default:
      return "other";
  }
}

function activityStart(commandBuffer) {
  if (Number.isFinite(commandBuffer.encodeStartNs)) {
    return commandBuffer.encodeStartNs;
  }
  return Number.isFinite(commandBuffer.gpuStartNs) ? commandBuffer.gpuStartNs : undefined;
}

function activityEnd(commandBuffer) {
  const values = [
    commandBuffer.encodeStartNs,
    commandBuffer.encodeEndNs,
    commandBuffer.gpuStartNs,
    commandBuffer.gpuEndNs,
  ].filter(Number.isFinite);
  return values.length > 0 ? Math.max(...values) : undefined;
}

function median(values) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const upperMiddle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[upperMiddle];
  }
  return (sorted[upperMiddle - 1] + sorted[upperMiddle]) / 2;
}

function windowBounds(commandBuffers) {
  let startNs = null;
  let endNs = null;
  for (const commandBuffer of commandBuffers) {
    const start = activityStart(commandBuffer);
    const end = activityEnd(commandBuffer);
    if (Number.isFinite(start)) {
      startNs = startNs === null ? start : Math.min(startNs, start);
    }
    if (Number.isFinite(end)) {
      endNs = endNs === null ? end : Math.max(endNs, end);
    }
  }
  return {
    startNs,
    endNs,
  };
}

/**
 * Split command buffers on activity gaps greater than the larger of 100 ms and
 * twenty times the standard median positive gap.
 */
export function partitionLaunchWindows(commandBuffers) {
  if (!Array.isArray(commandBuffers) || commandBuffers.length === 0) {
    return EMPTY_INTERVALS;
  }

  const immutableCommandBuffers = commandBuffers.map((commandBuffer) =>
    cloneAndFreezeJson(commandBuffer),
  );
  const sorted = immutableCommandBuffers
    .map((commandBuffer, sourceOrder) => ({ commandBuffer, sourceOrder }))
    .sort((left, right) => {
      const leftStart = activityStart(left.commandBuffer);
      const rightStart = activityStart(right.commandBuffer);
      if (Number.isFinite(leftStart) && Number.isFinite(rightStart)) {
        return leftStart - rightStart || left.sourceOrder - right.sourceOrder;
      }
      if (Number.isFinite(leftStart)) {
        return -1;
      }
      if (Number.isFinite(rightStart)) {
        return 1;
      }
      return left.sourceOrder - right.sourceOrder;
    })
    .map(({ commandBuffer }) => commandBuffer);

  const gaps = new Array(sorted.length).fill(null);
  const positiveGaps = [];
  let priorMaximumEnd;
  for (let index = 0; index < sorted.length; index += 1) {
    const start = Number.isFinite(sorted[index].encodeStartNs)
      ? sorted[index].encodeStartNs
      : undefined;
    if (Number.isFinite(start) && Number.isFinite(priorMaximumEnd)) {
      const gap = start - priorMaximumEnd;
      gaps[index] = gap;
      if (gap > 0) {
        positiveGaps.push(gap);
      }
    }
    const finiteEnds = [
      sorted[index].encodeEndNs,
      sorted[index].gpuEndNs,
    ].filter(Number.isFinite);
    if (finiteEnds.length > 0) {
      const end = Math.max(...finiteEnds);
      priorMaximumEnd = Number.isFinite(priorMaximumEnd)
        ? Math.max(priorMaximumEnd, end)
        : end;
    }
  }

  const gapThresholdNs = Math.max(
    MIN_LAUNCH_GAP_NS,
    LAUNCH_GAP_MULTIPLIER * median(positiveGaps),
  );
  const groups = [];
  let current = [];
  let gapBeforeNs = null;

  for (let index = 0; index < sorted.length; index += 1) {
    const gap = gaps[index];
    if (current.length > 0 && Number.isFinite(gap) && gap > gapThresholdNs) {
      groups.push({ commandBuffers: current, gapBeforeNs });
      current = [];
      gapBeforeNs = gap;
    }
    current.push(sorted[index]);
  }
  groups.push({ commandBuffers: current, gapBeforeNs });

  return Object.freeze(groups.map((group, index) => {
    const bounds = windowBounds(group.commandBuffers);
    return Object.freeze({
      index,
      commandBuffers: Object.freeze([...group.commandBuffers]),
      commandBufferIndices: Object.freeze(
        group.commandBuffers.map((commandBuffer) => commandBuffer.commandBufferIndex),
      ),
      startNs: bounds.startNs,
      endNs: bounds.endNs,
      gapBeforeNs: group.gapBeforeNs,
      gapThresholdNs,
    });
  }));
}

function intervalDuration(intervals) {
  return intervals.reduce((total, [start, end]) => total + (end - start), 0);
}

function finiteIntervalDuration(intervals, label) {
  const duration = intervalDuration(intervals);
  if (!Number.isFinite(duration)) {
    throw new RangeError(`${label} exceeds the finite numeric range.`);
  }
  return duration;
}

function finitePropertyTotal(items, property, label) {
  let total = 0;
  for (const item of items) {
    total += item[property];
    if (!Number.isFinite(total)) {
      throw new RangeError(`${label} exceeds the finite numeric range.`);
    }
  }
  return total;
}

function commandBufferGpuInterval(commandBuffer) {
  const interval = [commandBuffer.gpuStartNs, commandBuffer.gpuEndNs];
  return validInterval(interval) ? interval : null;
}

function commandBufferEncodeInterval(commandBuffer) {
  const interval = [commandBuffer.encodeStartNs, commandBuffer.encodeEndNs];
  return validInterval(interval) ? interval : null;
}

function classifyCommandBufferExposure(commandBuffer, gpuIntervals) {
  const encodeInterval = commandBufferEncodeInterval(commandBuffer);
  const hiddenIntervals =
    encodeInterval === null
      ? EMPTY_INTERVALS
      : intersectIntervalWithUnion(encodeInterval, gpuIntervals);
  const exposedIntervals =
    encodeInterval === null
      ? EMPTY_INTERVALS
      : subtractIntervalFromUnion(encodeInterval, gpuIntervals);
  return Object.freeze({
    ...commandBuffer,
    hiddenIntervals,
    exposedIntervals,
    hiddenHostNs: intervalDuration(hiddenIntervals),
    exposedHostNs: intervalDuration(exposedIntervals),
  });
}

function anchorLegacyWaits(waits, commandBuffers) {
  const commandBufferByIndex = new Map(
    commandBuffers
      .filter((commandBuffer) => Number.isFinite(commandBuffer.commandBufferIndex))
      .map((commandBuffer) => [
        commandBuffer.commandBufferIndex,
        commandBuffer,
      ]),
  );

  return waits.map((wait) => {
    if (
      Number.isFinite(wait.atNs) ||
      !Number.isFinite(wait.raw?.cb_index) ||
      !Number.isFinite(wait.commandBufferIndex)
    ) {
      return wait;
    }
    const commandBuffer = commandBufferByIndex.get(wait.commandBufferIndex);
    if (!commandBuffer) {
      return wait;
    }
    const candidates = [
      ["command-buffer-encode-end", commandBuffer.encodeEndNs],
      ["command-buffer-encode-start", commandBuffer.encodeStartNs],
      ["command-buffer-gpu-start", commandBuffer.gpuStartNs],
    ];
    const anchor = candidates.find(([, value]) => Number.isFinite(value));
    if (!anchor) {
      return wait;
    }
    return Object.freeze({
      ...wait,
      atNs: anchor[1],
      atNsSource: anchor[0],
      placement: "legacy-command-buffer-fallback",
    });
  });
}

function sequenceBoundsFor(commandBuffer, operations) {
  if (
    Number.isFinite(commandBuffer.firstOpSeq) &&
    Number.isFinite(commandBuffer.lastOpSeq)
  ) {
    return [commandBuffer.firstOpSeq, commandBuffer.lastOpSeq];
  }
  let minimum;
  let maximum;
  for (const operation of operations) {
    if (!Number.isFinite(operation.seq)) {
      continue;
    }
    minimum = minimum === undefined ? operation.seq : Math.min(minimum, operation.seq);
    maximum = maximum === undefined ? operation.seq : Math.max(maximum, operation.seq);
  }
  if (minimum === undefined) {
    return [undefined, undefined];
  }
  return [minimum, maximum];
}

function placeOperation(operation, commandBuffer, sequenceBounds) {
  const placement = { ...operation, placement: "ordered" };
  if (!commandBuffer) {
    placement.atNs = null;
    placement.placementDetail = "missing-parent-command-buffer";
    return Object.freeze(placement);
  }

  const start = commandBuffer.encodeStartNs;
  const end = commandBuffer.encodeEndNs;
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    placement.atNs = null;
    placement.placementDetail = "missing-encode-interval";
    return Object.freeze(placement);
  }
  if (end <= start) {
    placement.atNs = null;
    placement.placementDetail = "degenerate-encode-interval";
    return Object.freeze(placement);
  }
  if (!Number.isFinite(operation.seq)) {
    placement.atNs = null;
    placement.placementDetail = "missing-sequence";
    return Object.freeze(placement);
  }

  const [firstSequence, lastSequence] = sequenceBounds;
  if (!Number.isFinite(firstSequence) || !Number.isFinite(lastSequence)) {
    placement.atNs = start + (end - start) / 2;
    placement.placementDetail = "missing-sequence-span";
    return Object.freeze(placement);
  }
  if (lastSequence <= firstSequence) {
    placement.atNs = start + (end - start) / 2;
    placement.placementDetail = "degenerate-sequence-span";
    return Object.freeze(placement);
  }

  const rawFraction = (operation.seq - firstSequence) / (lastSequence - firstSequence);
  if (rawFraction < 0 || rawFraction > 1) {
    placement.atNs = null;
    placement.placementDetail = "sequence-outside-span";
    return Object.freeze(placement);
  }
  placement.atNs = start + rawFraction * (end - start);
  placement.placementDetail = "interpolated-sequence";
  return Object.freeze(placement);
}

function placeDispatches(operations, commandBuffers) {
  const operationsByCommandBuffer = new Map();
  for (const operation of operations) {
    const key = operation.commandBufferIndex;
    if (!Number.isFinite(key)) {
      continue;
    }
    if (!operationsByCommandBuffer.has(key)) {
      operationsByCommandBuffer.set(key, []);
    }
    operationsByCommandBuffer.get(key).push(operation);
  }

  const commandBufferByIndex = new Map(
    commandBuffers
      .filter((commandBuffer) => Number.isFinite(commandBuffer.commandBufferIndex))
      .map((commandBuffer) => [
        commandBuffer.commandBufferIndex,
        commandBuffer,
      ]),
  );
  const boundsByCommandBuffer = new Map();
  for (const commandBuffer of commandBuffers) {
    if (!Number.isFinite(commandBuffer.commandBufferIndex)) {
      continue;
    }
    boundsByCommandBuffer.set(
      commandBuffer.commandBufferIndex,
      sequenceBoundsFor(
        commandBuffer,
        operationsByCommandBuffer.get(commandBuffer.commandBufferIndex) ?? [],
      ),
    );
  }

  return operations
    .map((operation, sourceOrder) => {
      const commandBuffer = commandBufferByIndex.get(operation.commandBufferIndex);
      return {
        operation: placeOperation(
          operation,
          commandBuffer,
          boundsByCommandBuffer.get(operation.commandBufferIndex) ?? [
            undefined,
            undefined,
          ],
        ),
        sourceOrder,
      };
    })
    .sort((left, right) => {
      const leftSequence = left.operation.seq;
      const rightSequence = right.operation.seq;
      if (Number.isFinite(leftSequence) && Number.isFinite(rightSequence)) {
        return leftSequence - rightSequence || left.sourceOrder - right.sourceOrder;
      }
      if (Number.isFinite(leftSequence)) {
        return -1;
      }
      if (Number.isFinite(rightSequence)) {
        return 1;
      }
      return left.sourceOrder - right.sourceOrder;
    })
    .map(({ operation }) => operation);
}

function buildWaitTaxonomy(waits) {
  const taxonomy = Object.create(null);
  for (const wait of waits) {
    if (typeof wait.bucket !== "string") {
      continue;
    }
    const entry = Object.hasOwn(taxonomy, wait.bucket)
      ? taxonomy[wait.bucket]
      : {
          bucket: wait.bucket,
          waitClass: wait.waitClass,
          detailClass: wait.detailClass,
          headlineIncluded: wait.headlineCategory !== null,
          count: 0,
          waitNs: 0,
        };
    entry.count += 1;
    if (Number.isFinite(wait.waitNs) && wait.waitNs >= 0) {
      entry.waitNs += wait.waitNs;
    }
    taxonomy[wait.bucket] = entry;
  }
  for (const entry of Object.values(taxonomy)) {
    Object.freeze(entry);
  }
  return Object.freeze(taxonomy);
}

function kernelCensus(dispatches) {
  const byKernel = new Map();
  for (const dispatch of dispatches) {
    if (typeof dispatch.kernel !== "string") {
      continue;
    }
    const entry = byKernel.get(dispatch.kernel) ?? {
      kernel: dispatch.kernel,
      count: 0,
      setBytesCalls: 0,
      setBytesTotalBytes: 0,
      bufferBinds: 0,
    };
    entry.count += 1;
    entry.setBytesCalls += dispatch.setBytesCalls ?? 0;
    entry.setBytesTotalBytes += dispatch.setBytesTotalBytes ?? 0;
    entry.bufferBinds += dispatch.bufferBinds ?? 0;
    byKernel.set(dispatch.kernel, entry);
  }
  return Object.freeze(
    [...byKernel.values()]
      .sort((left, right) => right.count - left.count || left.kernel.localeCompare(right.kernel))
      .map(Object.freeze),
  );
}

function waitSummary(waits) {
  const totals = { cap: 0, dependency: 0, decision: 0, other: 0 };
  for (const wait of waits) {
    if (
      wait.headlineCategory !== null &&
      Object.hasOwn(totals, wait.headlineCategory) &&
      Number.isFinite(wait.waitNs) &&
      wait.waitNs >= 0
    ) {
      totals[wait.headlineCategory] += wait.waitNs;
      if (!Number.isFinite(totals[wait.headlineCategory])) {
        throw new RangeError("Wait duration exceeds the finite numeric range.");
      }
    }
  }
  return Object.freeze({
    capWaitNs: totals.cap,
    dependencyWaitNs: totals.dependency,
    decisionWaitNs: totals.decision,
    otherWaitNs: totals.other,
    headlineWaitNs:
      totals.cap + totals.dependency + totals.decision + totals.other,
  });
}

function aggregateData(commandBuffers, dispatches, waits) {
  const gpuWorkIntervals = commandBuffers
    .map(commandBufferGpuInterval)
    .filter((interval) => interval !== null);
  const gpuIntervals = mergeIntervals(gpuWorkIntervals);
  const waitTaxonomy = buildWaitTaxonomy(waits);
  const waitTotals = waitSummary(waits);

  let startNs = null;
  let endNs = null;
  const includeTimestamp = (value) => {
    if (!Number.isFinite(value)) {
      return;
    }
    startNs = startNs === null ? value : Math.min(startNs, value);
    endNs = endNs === null ? value : Math.max(endNs, value);
  };
  for (const commandBuffer of commandBuffers) {
    for (const value of [
      commandBuffer.encodeStartNs,
      commandBuffer.encodeEndNs,
      commandBuffer.gpuStartNs,
      commandBuffer.gpuEndNs,
    ]) {
      includeTimestamp(value);
    }
  }
  for (const wait of waits) {
    includeTimestamp(wait.atNs);
  }
  const gpuStartNs = gpuIntervals.length > 0 ? gpuIntervals[0][0] : null;
  const gpuEndNs = gpuIntervals.length > 0 ? gpuIntervals.at(-1)[1] : null;

  return {
    gpuIntervals: Object.freeze(gpuIntervals),
    waitTaxonomy,
    kernelCensus: kernelCensus(dispatches),
    summary: Object.freeze({
      startNs,
      endNs,
      wallSpanNs: startNs === null || endNs === null ? 0 : endNs - startNs,
      exposedHostNs: commandBuffers.reduce(
        (total, commandBuffer) => total + commandBuffer.exposedHostNs,
        0,
      ),
      hiddenHostNs: commandBuffers.reduce(
        (total, commandBuffer) => total + commandBuffer.hiddenHostNs,
        0,
      ),
      gpuBusyNs: intervalDuration(gpuIntervals),
      gpuWorkNs: intervalDuration(gpuWorkIntervals),
      gpuSpanNs: gpuStartNs === null || gpuEndNs === null ? 0 : gpuEndNs - gpuStartNs,
      ...waitTotals,
      opsTotal: dispatches.length,
      cbsTotal: commandBuffers.length,
    }),
  };
}

function clipInterval(interval, range) {
  if (!validInterval(interval)) {
    return null;
  }
  const start = Math.max(interval[0], range.startNs);
  const end = Math.min(interval[1], range.endNs);
  return end > start ? [start, end] : null;
}

function pointInRange(atNs, range) {
  return (
    Number.isFinite(atNs) &&
    atNs >= range.startNs &&
    atNs <= range.endNs
  );
}

function validSelectedRange(scope, requestedRange) {
  if (
    !Number.isFinite(scope?.startNs) ||
    !Number.isFinite(scope?.endNs) ||
    !Number.isFinite(requestedRange?.startNs) ||
    !Number.isFinite(requestedRange?.endNs)
  ) {
    throw new TypeError("Range and launch bounds must be finite.");
  }
  const launchSpanNs = scope.endNs - scope.startNs;
  if (!Number.isFinite(launchSpanNs) || launchSpanNs <= 0) {
    throw new RangeError("Launch must have finite positive duration.");
  }
  const startNs = Math.max(scope.startNs, requestedRange.startNs);
  const endNs = Math.min(scope.endNs, requestedRange.endNs);
  const selectedSpanNs = endNs - startNs;
  if (!Number.isFinite(selectedSpanNs) || selectedSpanNs <= 0) {
    throw new RangeError("Selected range must have finite positive duration.");
  }
  return Object.freeze({ startNs, endNs });
}

function propagatedOmissionCount(scope, key) {
  const omissions = scope?.omissions;
  if (
    omissions?.scope !== TRACE_OMISSION_SCOPE ||
    !Number.isSafeInteger(omissions[key]) ||
    omissions[key] < 0
  ) {
    return 0;
  }
  return omissions[key];
}

/**
 * Build exact aggregates for one positive-duration selection within a launch.
 * Point records are inclusive at both edges; measured intervals contribute
 * only their positive-duration intersection with the selected range.
 *
 * The scope is expected to be an immutable launch installed by `buildDataset`.
 * Selected point records are retained by reference; only command-buffer
 * wrappers and clipped interval fragments are created for each range.
 */
export function buildRangeScope(scope, requestedRange) {
  const range = validSelectedRange(scope, requestedRange);
  const sourceCommandBuffers = Array.isArray(scope.commandBuffers)
    ? scope.commandBuffers
    : [];
  const sourceDispatches = Array.isArray(scope.dispatches)
    ? scope.dispatches
    : [];
  const sourceWaits = Array.isArray(scope.waits) ? scope.waits : [];
  const commandBuffers = sourceCommandBuffers
    .map((commandBuffer) => {
      const encodeInterval = clipInterval(
        [commandBuffer.encodeStartNs, commandBuffer.encodeEndNs],
        range,
      );
      const gpuInterval = clipInterval(
        [commandBuffer.gpuStartNs, commandBuffer.gpuEndNs],
        range,
      );
      if (encodeInterval === null && gpuInterval === null) {
        return null;
      }
      const sourceHiddenIntervals = Array.isArray(commandBuffer.hiddenIntervals)
        ? commandBuffer.hiddenIntervals
        : [];
      const sourceExposedIntervals = Array.isArray(commandBuffer.exposedIntervals)
        ? commandBuffer.exposedIntervals
        : [];
      const hiddenIntervals = sourceHiddenIntervals
        .map((interval) => clipInterval(interval, range))
        .filter((interval) => interval !== null);
      const exposedIntervals = sourceExposedIntervals
        .map((interval) => clipInterval(interval, range))
        .filter((interval) => interval !== null);
      const hiddenHostNs = finiteIntervalDuration(
        hiddenIntervals,
        "Hidden host duration",
      );
      const exposedHostNs = finiteIntervalDuration(
        exposedIntervals,
        "Exposed host duration",
      );
      return Object.freeze({
        ...commandBuffer,
        hiddenIntervals: freezeIntervals(hiddenIntervals),
        exposedIntervals: freezeIntervals(exposedIntervals),
        hiddenHostNs,
        exposedHostNs,
        rangeGpuInterval:
          gpuInterval === null ? null : Object.freeze(gpuInterval),
      });
    })
    .filter((commandBuffer) => commandBuffer !== null);
  const dispatches = sourceDispatches.filter((dispatch) =>
    pointInRange(dispatch.atNs, range));
  const waits = sourceWaits.filter((wait) => pointInRange(wait.atNs, range));
  const gpuWorkIntervals = commandBuffers
    .map((commandBuffer) => commandBuffer.rangeGpuInterval)
    .filter((interval) => interval !== null);
  const gpuIntervals = mergeIntervals(gpuWorkIntervals);
  const waitTotals = waitSummary(waits);
  const localUnplacedDispatches = sourceDispatches.filter(
    (dispatch) => !Number.isFinite(dispatch.atNs),
  ).length;
  const localUnanchoredWaits = sourceWaits.filter(
    (wait) => !Number.isFinite(wait.atNs),
  ).length;
  const exposedHostNs = finitePropertyTotal(
    commandBuffers,
    "exposedHostNs",
    "Exposed host duration",
  );
  const hiddenHostNs = finitePropertyTotal(
    commandBuffers,
    "hiddenHostNs",
    "Hidden host duration",
  );
  const gpuBusyNs = finiteIntervalDuration(gpuIntervals, "GPU busy duration");
  const gpuWorkNs = finiteIntervalDuration(
    gpuWorkIntervals,
    "GPU work duration",
  );

  return Object.freeze({
    index: scope.index,
    startNs: range.startNs,
    endNs: range.endNs,
    range,
    commandBuffers: Object.freeze(commandBuffers),
    dispatches: Object.freeze(dispatches),
    waits: Object.freeze(waits),
    gpuIntervals,
    kernelCensus: kernelCensus(dispatches),
    waitTaxonomy: buildWaitTaxonomy(waits),
    omissions: Object.freeze({
      unplacedDispatches:
        localUnplacedDispatches +
        propagatedOmissionCount(scope, "unplacedDispatches"),
      unanchoredWaits:
        localUnanchoredWaits +
        propagatedOmissionCount(scope, "unanchoredWaits"),
    }),
    summary: Object.freeze({
      startNs: range.startNs,
      endNs: range.endNs,
      wallSpanNs: range.endNs - range.startNs,
      exposedHostNs,
      hiddenHostNs,
      gpuBusyNs,
      gpuWorkNs,
      gpuSpanNs:
        gpuIntervals.length === 0
          ? 0
          : gpuIntervals.at(-1)[1] - gpuIntervals[0][0],
      ...waitTotals,
      opsTotal: dispatches.length,
      cbsTotal: commandBuffers.length,
    }),
  });
}

function validOverviewBinCount(binCount) {
  if (
    !Number.isSafeInteger(binCount) ||
    binCount < 1 ||
    binCount > MAX_OVERVIEW_BIN_COUNT
  ) {
    throw new RangeError(
      `Overview bin count must be a safe integer between 1 and ${MAX_OVERVIEW_BIN_COUNT}.`,
    );
  }
  return binCount;
}

function finitePositiveSpan(startNs, endNs, label) {
  if (!Number.isFinite(startNs) || !Number.isFinite(endNs)) {
    throw new TypeError(`${label} bounds must be finite.`);
  }
  const spanNs = endNs - startNs;
  if (!Number.isFinite(spanNs) || spanNs <= 0) {
    throw new RangeError(`${label} must have finite positive duration.`);
  }
  return spanNs;
}

function hasFinitePositiveSpan(startNs, endNs) {
  return (
    Number.isFinite(startNs) &&
    Number.isFinite(endNs) &&
    endNs > startNs &&
    Number.isFinite(endNs - startNs)
  );
}

function overviewPointIndex(atNs, startNs, endNs, spanNs, binCount) {
  if (!Number.isFinite(atNs) || atNs < startNs || atNs > endNs) {
    return -1;
  }
  if (atNs === endNs) {
    return binCount - 1;
  }
  const scaled = ((atNs - startNs) / spanNs) * binCount;
  return Math.max(0, Math.min(binCount - 1, Math.floor(scaled)));
}

function addOverviewInterval(
  bins,
  interval,
  field,
  { startNs, endNs, spanNs, binCount },
) {
  if (!Array.isArray(interval)) {
    return;
  }
  const intervalStartNs = interval[0];
  const intervalEndNs = interval[1];
  if (
    !Number.isFinite(intervalStartNs) ||
    !Number.isFinite(intervalEndNs) ||
    intervalEndNs <= intervalStartNs
  ) {
    return;
  }
  const clippedStartNs = Math.max(intervalStartNs, startNs);
  const clippedEndNs = Math.min(intervalEndNs, endNs);
  if (clippedEndNs <= clippedStartNs) {
    return;
  }

  const firstBin = overviewPointIndex(
    clippedStartNs,
    startNs,
    endNs,
    spanNs,
    binCount,
  );
  const scaledEnd = ((clippedEndNs - startNs) / spanNs) * binCount;
  let lastBin = Math.min(binCount - 1, Math.ceil(scaledEnd) - 1);
  while (
    lastBin + 1 < binCount &&
    bins[lastBin + 1].startNs < clippedEndNs
  ) {
    lastBin += 1;
  }
  while (lastBin >= firstBin && bins[lastBin].startNs >= clippedEndNs) {
    lastBin -= 1;
  }

  for (let index = firstBin; index <= lastBin; index += 1) {
    const bin = bins[index];
    const overlapStart = Math.max(clippedStartNs, bin.startNs);
    const overlapEnd = Math.min(clippedEndNs, bin.endNs);
    if (overlapEnd > overlapStart) {
      const coverage = bin[field] + (overlapEnd - overlapStart);
      if (!Number.isFinite(coverage)) {
        throw new RangeError(
          "Overview coverage exceeds the finite numeric range.",
        );
      }
      bin[field] = coverage;
    }
  }
}

/**
 * Reduce a complete launch to fixed-resolution exact coverage and point-event
 * bins for the overview navigator.
 */
export function buildOverviewBins(
  scope,
  binCount = DEFAULT_OVERVIEW_BIN_COUNT,
) {
  const count = validOverviewBinCount(binCount);
  const startNs = scope?.startNs;
  const endNs = scope?.endNs;
  const spanNs = finitePositiveSpan(startNs, endNs, "Launch");
  const binEdges = Array.from({ length: count + 1 }, (_, index) => {
    if (index === 0) {
      return startNs;
    }
    if (index === count) {
      return endNs;
    }
    const edge = startNs + spanNs * (index / count);
    if (!Number.isFinite(edge)) {
      throw new RangeError("Overview bin edge exceeds the finite numeric range.");
    }
    return edge;
  });
  const bins = Array.from({ length: count }, (_, index) => ({
    startNs: binEdges[index],
    endNs: binEdges[index + 1],
    hostEncodeNs: 0,
    gpuBusyNs: 0,
    dispatchCount: 0,
    waitCount: 0,
    waitClasses: new Set(),
  }));
  const commandBuffers = Array.isArray(scope.commandBuffers)
    ? scope.commandBuffers
    : [];
  const dispatches = Array.isArray(scope.dispatches) ? scope.dispatches : [];
  const waits = Array.isArray(scope.waits) ? scope.waits : [];
  const geometry = { startNs, endNs, spanNs, binCount: count };

  for (const commandBuffer of commandBuffers) {
    const exposedIntervals = Array.isArray(commandBuffer.exposedIntervals)
      ? commandBuffer.exposedIntervals
      : [];
    const hiddenIntervals = Array.isArray(commandBuffer.hiddenIntervals)
      ? commandBuffer.hiddenIntervals
      : [];
    for (const interval of [...exposedIntervals, ...hiddenIntervals]) {
      addOverviewInterval(bins, interval, "hostEncodeNs", geometry);
    }
  }
  const gpuIntervals = mergeIntervals(
    commandBuffers
      .map(commandBufferGpuInterval)
      .filter((interval) => interval !== null),
  );
  for (const interval of gpuIntervals) {
    addOverviewInterval(bins, interval, "gpuBusyNs", geometry);
  }
  for (const dispatch of dispatches) {
    const index = overviewPointIndex(
      dispatch.atNs,
      startNs,
      endNs,
      spanNs,
      count,
    );
    if (index >= 0) {
      bins[index].dispatchCount += 1;
    }
  }
  for (const wait of waits) {
    const index = overviewPointIndex(
      wait.atNs,
      startNs,
      endNs,
      spanNs,
      count,
    );
    if (index < 0) {
      continue;
    }
    bins[index].waitCount += 1;
    bins[index].waitClasses.add(wait.waitClass ?? "other");
  }

  return Object.freeze({
    startNs,
    endNs,
    binCount: count,
    bins: Object.freeze(
      bins.map((bin) =>
        Object.freeze({
          ...bin,
          waitClasses: Object.freeze([...bin.waitClasses].sort()),
        }),
      ),
    ),
  });
}

function buildWindowLookup(windows) {
  return windows
    .map((window, windowIndex) => ({
      windowIndex,
      startNs: window.startNs,
      endNs: window.endNs,
    }))
    .filter(
      (window) =>
        Number.isFinite(window.startNs) && Number.isFinite(window.endNs),
    )
    .sort((left, right) => left.startNs - right.startNs || left.endNs - right.endNs);
}

function nearestWindowIndex(windowLookup, atNs) {
  if (!Number.isFinite(atNs) || windowLookup.length === 0) {
    return -1;
  }
  if (windowLookup.length === 1) {
    return windowLookup[0].windowIndex;
  }

  let low = 0;
  let high = windowLookup.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (windowLookup[middle].startNs <= atNs) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  const left = low > 0 ? windowLookup[low - 1] : null;
  const right = low < windowLookup.length ? windowLookup[low] : null;
  if (left && atNs <= left.endNs) {
    return left.windowIndex;
  }
  if (!left) {
    return right.windowIndex;
  }
  if (!right) {
    return left.windowIndex;
  }
  const leftDistance = atNs - left.endNs;
  const rightDistance = right.startNs - atNs;
  return leftDistance <= rightDistance ? left.windowIndex : right.windowIndex;
}

function buildLaunchWindows(commandBuffers, dispatches, waits) {
  const partitions = partitionLaunchWindows(commandBuffers);
  if (partitions.length === 0) {
    return {
      launchWindows: Object.freeze([]),
      unassignedDispatches: Object.freeze([...dispatches]),
      unassignedWaits: Object.freeze([...waits]),
    };
  }

  const windowByCommandBufferIndex = new Map();
  partitions.forEach((window, windowIndex) => {
    window.commandBufferIndices.forEach((commandBufferIndex) => {
      if (Number.isFinite(commandBufferIndex)) {
        windowByCommandBufferIndex.set(commandBufferIndex, windowIndex);
      }
    });
  });
  const dispatchGroups = partitions.map(() => []);
  const waitGroups = partitions.map(() => []);
  const unassignedDispatches = [];
  const unassignedWaits = [];
  const windowLookup = buildWindowLookup(partitions);

  for (const dispatch of dispatches) {
    const windowIndex = windowByCommandBufferIndex.get(dispatch.commandBufferIndex);
    if (windowIndex === undefined) {
      unassignedDispatches.push(dispatch);
    } else {
      dispatchGroups[windowIndex].push(dispatch);
    }
  }
  for (const wait of waits) {
    const ownedWindowIndex =
      wait.placement === "legacy-command-buffer-fallback"
        ? windowByCommandBufferIndex.get(wait.commandBufferIndex)
        : undefined;
    const windowIndex =
      ownedWindowIndex ?? nearestWindowIndex(windowLookup, wait.atNs);
    if (windowIndex < 0) {
      unassignedWaits.push(wait);
    } else {
      waitGroups[windowIndex].push(wait);
    }
  }
  // These rows cannot be attributed to any launch. The same frozen trace-level
  // counts are installed on every launch so any single-launch range analysis
  // can disclose them without assigning a timestamp or duration.
  const omissions = Object.freeze({
    scope: TRACE_OMISSION_SCOPE,
    unplacedDispatches: unassignedDispatches.length,
    unanchoredWaits: unassignedWaits.length,
  });

  const launchWindows = partitions.map((partition, index) => {
    const aggregate = aggregateData(
      partition.commandBuffers,
      dispatchGroups[index],
      waitGroups[index],
    );
    const launch = {
      ...partition,
      startNs: aggregate.summary.startNs,
      endNs: aggregate.summary.endNs,
      commandBuffers: partition.commandBuffers,
      dispatches: Object.freeze(dispatchGroups[index]),
      waits: Object.freeze(waitGroups[index]),
      gpuIntervals: aggregate.gpuIntervals,
      waitTaxonomy: aggregate.waitTaxonomy,
      kernelCensus: aggregate.kernelCensus,
      summary: aggregate.summary,
      omissions,
    };
    return Object.freeze({
      ...launch,
      overview: hasFinitePositiveSpan(launch.startNs, launch.endNs)
        ? buildOverviewBins(launch)
        : null,
    });
  });
  return {
    launchWindows: Object.freeze(launchWindows),
    unassignedDispatches: Object.freeze(unassignedDispatches),
    unassignedWaits: Object.freeze(unassignedWaits),
  };
}

function sourceCompleteness(summary) {
  if (!summary) {
    return "missing-summary";
  }
  if (
    summary.schemaVersion === undefined ||
    summary.complete === undefined ||
    summary.droppedRows === undefined
  ) {
    return "legacy-unverifiable";
  }
  if (summary.schemaVersion !== 1) {
    return "unsupported-schema";
  }
  if (summary.droppedRows > 0) {
    return "dropped-rows";
  }
  if (summary.complete !== true) {
    return "incomplete";
  }
  return "complete";
}

function selectSourceSummary(summaries) {
  for (let index = summaries.length - 1; index >= 0; index -= 1) {
    if (summaries[index].final === true) {
      return summaries[index];
    }
  }
  return summaries.at(-1) ?? null;
}

function quarantineDuplicateCommandBuffers(commandBuffers) {
  const counts = new Map();
  for (const commandBuffer of commandBuffers) {
    if (Number.isFinite(commandBuffer.commandBufferIndex)) {
      counts.set(
        commandBuffer.commandBufferIndex,
        (counts.get(commandBuffer.commandBufferIndex) ?? 0) + 1,
      );
    }
  }
  const duplicateIndices = Object.freeze(
    [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([commandBufferIndex]) => commandBufferIndex)
      .sort((left, right) => left - right),
  );
  const duplicateSet = new Set(duplicateIndices);
  const accepted = [];
  const quarantined = [];
  for (const commandBuffer of commandBuffers) {
    if (duplicateSet.has(commandBuffer.commandBufferIndex)) {
      quarantined.push(commandBuffer);
    } else {
      accepted.push(commandBuffer);
    }
  }
  return {
    accepted,
    quarantined: Object.freeze(quarantined),
    duplicateIndices,
  };
}

function buildCountMismatches(summary, analyzedOpsTotal, analyzedCbsTotal) {
  const mismatches = {};
  if (
    Number.isFinite(summary?.opsTotal) &&
    summary.opsTotal !== analyzedOpsTotal
  ) {
    mismatches.opsTotal = Object.freeze({
      reported: summary.opsTotal,
      analyzed: analyzedOpsTotal,
    });
  }
  if (
    Number.isFinite(summary?.cbsTotal) &&
    summary.cbsTotal !== analyzedCbsTotal
  ) {
    mismatches.cbsTotal = Object.freeze({
      reported: summary.cbsTotal,
      analyzed: analyzedCbsTotal,
    });
  }
  return Object.freeze(mismatches);
}

/**
 * Build immutable, UI-ready trace aggregates. The result contains only
 * measured intervals, interval-derived overlap, and explicitly ordered
 * dispatch placement; it intentionally performs no tensor critical-path
 * inference because dispatch-census rows carry no tensor identities.
 */
export function buildDataset(rows, diagnostics = {}) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const records = [];
  let rejectedRows = 0;
  for (const row of sourceRows) {
    const normalized = normalizeRow(row);
    if (normalized === null) {
      rejectedRows += 1;
    } else {
      records.push(normalized);
    }
  }

  const operations = records.filter((record) => record.type === "op");
  const allCommandBuffers = records.filter((record) => record.type === "cb");
  const duplicateResolution = quarantineDuplicateCommandBuffers(allCommandBuffers);
  const rawCommandBuffers = duplicateResolution.accepted;
  const normalizedWaits = records.filter((record) => record.type === "wait");
  const summaries = records.filter((record) => record.type === "summary");
  const unknownRows = records.filter((record) => record.type === "unknown").length;
  const gpuIntervals = mergeIntervals(
    rawCommandBuffers.map(commandBufferGpuInterval).filter((interval) => interval !== null),
  );
  const commandBuffers = rawCommandBuffers.map((commandBuffer) =>
    classifyCommandBufferExposure(commandBuffer, gpuIntervals),
  );
  const waits = anchorLegacyWaits(normalizedWaits, commandBuffers);
  const dispatches = placeDispatches(operations, commandBuffers);
  const aggregate = aggregateData(commandBuffers, dispatches, waits);
  const windows = buildLaunchWindows(commandBuffers, dispatches, waits);
  const sourceSummary = selectSourceSummary(summaries);
  const completeness = sourceCompleteness(sourceSummary);
  const diagnosticInput = isRecord(diagnostics) ? diagnostics : {};
  const diagnosticMalformedRows = nonNegativeValue(diagnosticInput, [
    "malformedRows",
    "invalidRows",
  ]) ?? 0;
  const malformedRows = diagnosticMalformedRows + rejectedRows;
  const countMismatches = buildCountMismatches(
    sourceSummary,
    operations.length,
    commandBuffers.length,
  );
  const validEvidence =
    completeness === "complete" &&
    malformedRows === 0 &&
    unknownRows === 0 &&
    Object.keys(countMismatches).length === 0 &&
    duplicateResolution.duplicateIndices.length === 0;
  const summary = Object.freeze({
    ...aggregate.summary,
    sourceCompleteness: completeness,
    reportedOpsTotal: sourceSummary?.opsTotal ?? null,
    reportedCbsTotal: sourceSummary?.cbsTotal ?? null,
    droppedRows: sourceSummary?.droppedRows ?? null,
    countMismatches,
  });
  const health = Object.freeze({
    validEvidence,
    sourceCompleteness: completeness,
    malformedRows,
    unknownRows,
    complete: sourceSummary?.complete ?? null,
    droppedRows: sourceSummary?.droppedRows ?? null,
    countMismatches,
    duplicateCommandBufferIndices: duplicateResolution.duplicateIndices,
    duplicateCommandBufferRows: duplicateResolution.quarantined.length,
  });
  const immutableDiagnostics = cloneAndFreezeJson({
    ...diagnosticInput,
    malformedRows,
    unknownRows,
    countMismatches,
    duplicateCommandBufferIndices: duplicateResolution.duplicateIndices,
    duplicateCommandBufferRows: duplicateResolution.quarantined.length,
  });

  return Object.freeze({
    records: Object.freeze(records),
    operations: Object.freeze(operations),
    ops: Object.freeze(dispatches),
    dispatches: Object.freeze(dispatches),
    commandBuffers: Object.freeze(commandBuffers),
    quarantinedCommandBuffers: duplicateResolution.quarantined,
    duplicateCommandBufferIndices: duplicateResolution.duplicateIndices,
    waits: Object.freeze(waits),
    sourceSummary,
    sourceCompleteness: completeness,
    gpuIntervals: aggregate.gpuIntervals,
    waitTaxonomy: aggregate.waitTaxonomy,
    kernelCensus: aggregate.kernelCensus,
    launchWindows: windows.launchWindows,
    unassignedDispatches: windows.unassignedDispatches,
    unassignedWaits: windows.unassignedWaits,
    summary,
    health,
    diagnostics: immutableDiagnostics,
  });
}

function compactNumber(value) {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return String(Math.round(value * 100) / 100);
}

export function formatDuration(ns) {
  if (!Number.isFinite(ns)) {
    return "—";
  }
  const magnitude = Math.abs(ns);
  if (magnitude < 1_000) {
    return `${compactNumber(ns)} ns`;
  }
  if (magnitude < 1_000_000) {
    return `${compactNumber(ns / 1_000)} µs`;
  }
  if (magnitude < 1_000_000_000) {
    return `${compactNumber(ns / 1_000_000)} ms`;
  }
  return `${compactNumber(ns / 1_000_000_000)} s`;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) {
    return "—";
  }
  const magnitude = Math.abs(bytes);
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let unitIndex = 0;
  let value = bytes;
  while (magnitude / 1024 ** unitIndex >= 1024 && unitIndex < units.length - 1) {
    unitIndex += 1;
    value = bytes / 1024 ** unitIndex;
  }
  return `${compactNumber(value)} ${units[unitIndex]}`;
}
