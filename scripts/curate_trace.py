#!/usr/bin/env python3
"""Deterministically curate and structurally verify closed trace windows.

The curator is deliberately two-pass.  Pass one validates and retains only
compact command-buffer/wait metadata plus packed operation ownership.  After
selection, pass two reparses the source and writes selected rows directly to a
sibling temporary file.  The second-pass hash must match before replacement.

The public profiler vocabulary is ``record``, ``command_buffer_index``,
``bucket``, and ``at_ns``.  Documented workbench aliases (``cb_index``,
shape-based records, ``kind="wait"``, ``cause``, and alternate wait timestamp
fields) are normalized only for validation and selection.  Output data rows
keep their original keys and non-time values.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import sys
import tempfile
from array import array
from bisect import bisect_right
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


CURATOR_SCHEMA = "metal-dispatch-viz.curated-window"
CURATOR_VERSION = 1
JS_SAFE_INTEGER = 2**53 - 1
MAX_JSON_DEPTH = 128
CB_TIMESTAMP_PAIRS = (
    ("encode_start_ns", "encode_end_ns"),
    ("gpu_start_ns", "gpu_end_ns"),
)
CB_TIMESTAMP_FIELDS = frozenset(
    field for pair in CB_TIMESTAMP_PAIRS for field in pair
)
WAIT_TIMESTAMP_FIELDS = (
    "ts_ns",
    "at_ns",
    "start_ns",
    "time_ns",
    "timestamp_ns",
)
WAIT_DURATION_FIELDS = (
    "wait_ns",
    "duration_ns",
    "ns",
    "dur_ns",
    "waitNs",
)
COUNT_KEYS = ("rows", "command_buffers", "ops", "waits")
SHA256_PATTERN = re.compile(r"[0-9a-f]{64}\Z")


class TraceValidationError(ValueError):
    """Raised when a source or curated trace violates an integrity gate."""


@dataclass(frozen=True, slots=True)
class CommandBuffer:
    line: int
    index: int
    op_count: int
    first_op_seq: int
    last_op_seq: int
    start: int
    end: int
    owner_wait_anchor: int


@dataclass(frozen=True, slots=True)
class PendingWait:
    line: int
    bucket: str | None
    cb_index: int | None
    explicit_anchor: int | None
    duration: int


@dataclass(frozen=True, slots=True)
class Wait:
    line: int
    bucket: str | None
    cb_index: int | None
    anchor: int | None
    has_explicit_anchor: bool
    duration: int


@dataclass(frozen=True, slots=True)
class TraceIndex:
    row_count: int
    command_buffers: tuple[CommandBuffer, ...]
    waits: tuple[Wait, ...]
    op_seqs: array
    op_owners: array
    op_lines: array
    summary: dict[str, Any]
    summary_line: int
    summary_count: int
    source_sha256: str
    source_complete: bool | None
    valid_evidence: bool

    @property
    def op_count(self) -> int:
        return len(self.op_seqs)


def _json_object(pairs: Iterable[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise TraceValidationError(f"duplicate JSON key {key!r}")
        result[key] = value
    return result


def _reject_json_constant(value: str) -> None:
    raise TraceValidationError(f"non-finite JSON number {value}")


def _integer(
    value: Any,
    *,
    field: str,
    line: int,
    nonnegative: bool = False,
) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise TraceValidationError(
            f"line {line}: {field} must be an integer"
        )
    if value < -JS_SAFE_INTEGER or value > JS_SAFE_INTEGER:
        raise TraceValidationError(
            f"line {line}: {field} is outside the JavaScript safe integer range"
        )
    if nonnegative and value < 0:
        raise TraceValidationError(
            f"line {line}: {field} must be a nonnegative integer"
        )
    return value


def _validate_json_tree(value: Any, *, line: int) -> None:
    """Iteratively reject non-finite numbers and excessive JSON depth."""

    stack: list[tuple[Any, int, str]] = [(value, 0, "$")]
    while stack:
        current, depth, path = stack.pop()
        if depth > MAX_JSON_DEPTH:
            raise TraceValidationError(
                f"line {line}: JSON nesting exceeds safe depth "
                f"{MAX_JSON_DEPTH} at {path}"
            )
        if isinstance(current, float) and not math.isfinite(current):
            raise TraceValidationError(
                f"line {line}: non-finite number at {path}"
            )
        if isinstance(current, dict):
            for key, child in current.items():
                child_path = f"{path}.{key}"
                if (
                    key.endswith("_ns")
                    or key == "count"
                    or key.endswith("_count")
                ):
                    _integer(child, field=child_path, line=line)
                if isinstance(child, (dict, list)):
                    stack.append((child, depth + 1, child_path))
                elif isinstance(child, float) and not math.isfinite(child):
                    raise TraceValidationError(
                        f"line {line}: non-finite number at {child_path}"
                    )
        elif isinstance(current, list):
            for index, child in enumerate(current):
                child_path = f"{path}[{index}]"
                if isinstance(child, (dict, list)):
                    stack.append((child, depth + 1, child_path))
                elif isinstance(child, float) and not math.isfinite(child):
                    raise TraceValidationError(
                        f"line {line}: non-finite number at {child_path}"
                    )


def _parse_line(encoded_line: bytes, line_number: int) -> dict[str, Any]:
    try:
        line = encoded_line.decode("utf-8")
    except UnicodeDecodeError as error:
        raise TraceValidationError(
            f"line {line_number}: invalid UTF-8: {error}"
        ) from error
    if not line.strip():
        raise TraceValidationError(
            f"line {line_number}: blank lines are not valid strict JSONL"
        )
    try:
        row = json.loads(
            line,
            parse_constant=_reject_json_constant,
            object_pairs_hook=_json_object,
        )
    except RecursionError as error:
        raise TraceValidationError(
            f"line {line_number}: JSON nesting exceeds parser depth"
        ) from error
    except (json.JSONDecodeError, TraceValidationError) as error:
        raise TraceValidationError(
            f"line {line_number}: malformed JSON: {error}"
        ) from error
    if not isinstance(row, dict):
        raise TraceValidationError(
            f"line {line_number}: JSONL record must be an object"
        )
    _validate_json_tree(row, line=line_number)
    return row


def _classify(row: dict[str, Any], line: int) -> str:
    if "record" in row:
        record = row["record"]
        if record not in {"op", "cb", "wait", "summary"}:
            raise TraceValidationError(
                f"line {line}: unknown public record type {record!r}"
            )
        return record
    if row.get("kind") == "wait":
        return "wait"
    if any(field in row for field in CB_TIMESTAMP_FIELDS):
        return "cb"
    if "seq" in row and "cb_index" in row:
        return "op"
    if row.get("kind") == "summary":
        return "summary"
    raise TraceValidationError(f"line {line}: unrecognized trace record")


def _aliased_integer(
    row: dict[str, Any],
    names: tuple[str, ...],
    *,
    label: str,
    line: int,
    required: bool = True,
    nonnegative: bool = True,
) -> int | None:
    present = [name for name in names if name in row]
    if not present:
        if required:
            raise TraceValidationError(f"line {line}: missing {label}")
        return None
    values = [
        _integer(
            row[name],
            field=name,
            line=line,
            nonnegative=nonnegative,
        )
        for name in present
    ]
    if any(value != values[0] for value in values[1:]):
        raise TraceValidationError(
            f"line {line}: conflicting aliases for {label}: "
            + ", ".join(present)
        )
    return values[0]


def _cb_index(
    row: dict[str, Any], line: int, *, required: bool = True
) -> int | None:
    return _aliased_integer(
        row,
        ("command_buffer_index", "cb_index"),
        label="command buffer index",
        line=line,
        required=required,
    )


def _parse_command_buffer(
    row: dict[str, Any], line: int
) -> CommandBuffer:
    index = _cb_index(row, line)
    assert index is not None
    op_count = _integer(
        row.get("op_count"),
        field="op_count",
        line=line,
        nonnegative=True,
    )
    first_op_seq = _integer(
        row.get("first_op_seq"),
        field="first_op_seq",
        line=line,
        nonnegative=True,
    )
    last_op_seq = _integer(
        row.get("last_op_seq"),
        field="last_op_seq",
        line=line,
        nonnegative=True,
    )

    starts: list[int] = []
    ends: list[int] = []
    for start_field, end_field in CB_TIMESTAMP_PAIRS:
        has_start = start_field in row
        has_end = end_field in row
        if has_start != has_end:
            raise TraceValidationError(
                f"line {line}: {start_field}/{end_field} must be present together"
            )
        if has_start:
            start = _integer(row[start_field], field=start_field, line=line)
            end = _integer(row[end_field], field=end_field, line=line)
            if end < start:
                raise TraceValidationError(
                    f"line {line}: {end_field} precedes {start_field}"
                )
            starts.append(start)
            ends.append(end)
    if not starts:
        raise TraceValidationError(
            f"line {line}: command buffer has no usable timestamp interval"
        )

    if op_count == 0:
        if first_op_seq != last_op_seq:
            raise TraceValidationError(
                f"line {line}: zero-op command buffer needs an empty sentinel range"
            )
    elif (
        last_op_seq < first_op_seq
        or last_op_seq - first_op_seq + 1 != op_count
    ):
        raise TraceValidationError(
            f"line {line}: op_count does not match first/last op range"
        )

    if "encode_end_ns" in row:
        owner_wait_anchor = row["encode_end_ns"]
    elif "encode_start_ns" in row:
        owner_wait_anchor = row["encode_start_ns"]
    elif "gpu_start_ns" in row:
        owner_wait_anchor = row["gpu_start_ns"]
    else:
        owner_wait_anchor = min(starts)

    return CommandBuffer(
        line=line,
        index=index,
        op_count=op_count,
        first_op_seq=first_op_seq,
        last_op_seq=last_op_seq,
        start=min(starts),
        end=max(ends),
        owner_wait_anchor=owner_wait_anchor,
    )


def _parse_operation(row: dict[str, Any], line: int) -> tuple[int, int]:
    seq = _integer(
        row.get("seq"), field="seq", line=line, nonnegative=True
    )
    owner = _cb_index(row, line)
    assert owner is not None
    return seq, owner


def _parse_wait(row: dict[str, Any], line: int) -> PendingWait:
    duration_fields = [
        field for field in WAIT_DURATION_FIELDS if field in row
    ]
    if not duration_fields:
        raise TraceValidationError(
            f"line {line}: wait record is missing a documented duration field"
        )
    duration_values: list[int] = []
    for field in duration_fields:
        duration_values.append(
            _integer(
                row[field], field=field, line=line, nonnegative=True
            )
        )
    if any(
        duration != duration_values[0]
        for duration in duration_values[1:]
    ):
        aliases = ", ".join(
            f"{field}={row[field]!r}" for field in duration_fields
        )
        raise TraceValidationError(
            f"line {line}: conflicting wait duration aliases: {aliases}"
        )

    timestamp_fields = [
        field for field in WAIT_TIMESTAMP_FIELDS if field in row
    ]
    timestamp_values = [
        _integer(row[field], field=field, line=line)
        for field in timestamp_fields
    ]
    if any(
        timestamp != timestamp_values[0]
        for timestamp in timestamp_values[1:]
    ):
        aliases = ", ".join(
            f"{field}={row[field]!r}" for field in timestamp_fields
        )
        raise TraceValidationError(
            f"line {line}: conflicting wait timestamp aliases: {aliases}"
        )

    owner_index = _cb_index(row, line, required=False)
    bucket = row.get("bucket", row.get("cause"))
    if bucket is not None and not isinstance(bucket, str):
        raise TraceValidationError(
            f"line {line}: wait bucket/cause must be a string"
        )
    return PendingWait(
        line=line,
        bucket=bucket,
        cb_index=owner_index,
        explicit_anchor=timestamp_values[0] if timestamp_values else None,
        duration=duration_values[0],
    )


def _validate_summary(
    summary: dict[str, Any],
    *,
    line: int,
    allow_legacy_summary: bool,
) -> tuple[bool | None, bool]:
    has_complete = "complete" in summary
    has_dropped = "dropped_rows" in summary
    if has_complete != has_dropped:
        raise TraceValidationError(
            f"line {line}: summary must contain both complete and dropped_rows, "
            "or neither for the gated legacy format"
        )
    if not has_complete:
        if not allow_legacy_summary:
            raise TraceValidationError(
                f"line {line}: legacy summary is unverifiable; pass "
                "allow_legacy_summary=True explicitly"
            )
        return None, False
    if summary["complete"] is not True:
        raise TraceValidationError(
            f"line {line}: source summary is incomplete"
        )
    dropped_rows = _integer(
        summary["dropped_rows"],
        field="dropped_rows",
        line=line,
        nonnegative=True,
    )
    if dropped_rows:
        raise TraceValidationError(
            f"line {line}: source summary reports {dropped_rows} dropped rows"
        )
    return True, True


def _summary_schema(value: Any) -> Any:
    if isinstance(value, dict):
        return (
            "object",
            tuple(
                (key, _summary_schema(child))
                for key, child in sorted(value.items())
            ),
        )
    if isinstance(value, list):
        return ("array", tuple(_summary_schema(child) for child in value))
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "number"
    if isinstance(value, str):
        return "string"
    if value is None:
        return "null"
    raise AssertionError(f"unexpected JSON value type: {type(value)!r}")


def _summary_count_values(
    summary: dict[str, Any], *, line: int
) -> dict[str, int]:
    count_values: dict[str, int] = {}
    stack: list[tuple[Any, str]] = [(summary, "$")]
    while stack:
        current, path = stack.pop()
        if isinstance(current, dict):
            for key, child in current.items():
                child_path = f"{path}.{key}"
                if key == "buckets":
                    continue
                if (
                    key == "dropped_rows"
                    or key == "count"
                    or key.endswith("_count")
                    or key in {"ops_total", "cbs_total", "waits_total"}
                ):
                    count_values[child_path] = _integer(
                        child,
                        field=child_path,
                        line=line,
                        nonnegative=True,
                    )
                if isinstance(child, (dict, list)):
                    stack.append((child, child_path))
        elif isinstance(current, list):
            for index, child in enumerate(current):
                if isinstance(child, (dict, list)):
                    stack.append((child, f"{path}[{index}]"))
    return count_values


_DYNAMIC_SUMMARY_FIELDS = frozenset(
    {
        "final",
        "summary_seq",
        "complete",
        "dropped_rows",
        "ops_total",
        "cbs_total",
        "waits_total",
        "buckets",
    }
)


def _summary_fixed_values(summary: dict[str, Any]) -> str:
    fixed = {
        key: value
        for key, value in summary.items()
        if key not in _DYNAMIC_SUMMARY_FIELDS
    }
    return json.dumps(
        fixed,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    )


def _summary_buckets(
    summary: dict[str, Any],
    *,
    line: int,
    expected_entry_schema: Any,
) -> tuple[dict[str, tuple[int, int]], Any]:
    buckets = summary.get("buckets")
    if not isinstance(buckets, dict):
        raise TraceValidationError(
            f"line {line}: cumulative summary buckets must be an object"
        )
    values: dict[str, tuple[int, int]] = {}
    entry_schema = expected_entry_schema
    for bucket, entry in buckets.items():
        if not isinstance(entry, dict):
            raise TraceValidationError(
                f"line {line}: bucket {bucket!r} value must be an object"
            )
        if "count" not in entry or "total_ns" not in entry:
            raise TraceValidationError(
                f"line {line}: bucket {bucket!r} must contain count and total_ns"
            )
        current_schema = _summary_schema(entry)
        if entry_schema is None:
            entry_schema = current_schema
        elif current_schema != entry_schema:
            raise TraceValidationError(
                f"line {line}: bucket {bucket!r} value schema changed"
            )
        count = _integer(
            entry["count"],
            field=f"buckets.{bucket}.count",
            line=line,
            nonnegative=True,
        )
        total_ns = _integer(
            entry["total_ns"],
            field=f"buckets.{bucket}.total_ns",
            line=line,
            nonnegative=True,
        )
        values[bucket] = (count, total_ns)
    return values, entry_schema


class _SummaryTracker:
    """Streaming state for traditional or cumulative source summaries."""

    __slots__ = (
        "checkpoint_count",
        "bucket_entry_schema",
        "fixed_values",
        "mode",
        "previous_buckets",
        "previous_counts",
        "previous_seq",
        "record_count",
        "schema",
        "terminal",
        "terminal_line",
        "terminal_seen",
    )

    def __init__(self) -> None:
        self.checkpoint_count = 0
        self.bucket_entry_schema: Any = None
        self.fixed_values: str | None = None
        self.mode: str | None = None
        self.previous_buckets: dict[str, tuple[int, int]] | None = None
        self.previous_counts: dict[str, int] | None = None
        self.previous_seq: int | None = None
        self.record_count = 0
        self.schema: Any = None
        self.terminal: dict[str, Any] | None = None
        self.terminal_line = 0
        self.terminal_seen = False

    def add(self, summary: dict[str, Any], *, line: int) -> None:
        self.record_count += 1
        has_final = "final" in summary
        has_seq = "summary_seq" in summary
        if has_final != has_seq:
            raise TraceValidationError(
                f"line {line}: cumulative summary schema requires both final "
                "and summary_seq"
            )

        if self.mode is None:
            if not has_final:
                self.mode = "traditional"
                self.terminal = summary
                self.terminal_line = line
                return
            self.mode = "cumulative"
        elif self.mode == "traditional":
            raise TraceValidationError(
                f"line {line}: ambiguous multi-summary trace; traditional "
                "summaries must be unique"
            )
        elif not has_final:
            raise TraceValidationError(
                f"line {line}: cumulative summary schema mismatch"
            )

        self._add_cumulative(summary, line=line)

    def _add_cumulative(
        self, summary: dict[str, Any], *, line: int
    ) -> None:
        is_final = summary.get("final")
        if not isinstance(is_final, bool):
            raise TraceValidationError(
                f"line {line}: summary final must be boolean"
            )
        seq = _integer(
            summary.get("summary_seq"),
            field="summary_seq",
            line=line,
            nonnegative=True,
        )
        if (
            "complete" not in summary
            or not isinstance(summary["complete"], bool)
            or "dropped_rows" not in summary
        ):
            raise TraceValidationError(
                f"line {line}: cumulative summary evidence schema mismatch"
            )
        for field in ("ops_total", "cbs_total"):
            if field not in summary:
                raise TraceValidationError(
                    f"line {line}: cumulative summary is missing {field}"
                )
            _integer(
                summary[field],
                field=field,
                line=line,
                nonnegative=True,
            )
        schema = _summary_schema(
            {
                key: value
                for key, value in summary.items()
                if key != "buckets"
            }
        )
        fixed_values = _summary_fixed_values(summary)
        if self.schema is None:
            self.schema = schema
            self.fixed_values = fixed_values
        elif schema != self.schema:
            raise TraceValidationError(
                f"line {line}: cumulative summary schema mismatch"
            )
        elif fixed_values != self.fixed_values:
            raise TraceValidationError(
                f"line {line}: cumulative summary fixed fields changed"
            )
        if self.previous_seq is not None and seq <= self.previous_seq:
            raise TraceValidationError(
                f"line {line}: summary_seq must increase strictly"
            )

        counts = _summary_count_values(summary, line=line)
        if self.previous_counts is not None:
            for path, previous in self.previous_counts.items():
                if counts[path] < previous:
                    raise TraceValidationError(
                        f"line {line}: cumulative summary count {path} "
                        f"decreased from {previous} to {counts[path]}"
                    )
        buckets, bucket_entry_schema = _summary_buckets(
            summary,
            line=line,
            expected_entry_schema=self.bucket_entry_schema,
        )
        if self.previous_buckets is not None:
            missing = self.previous_buckets.keys() - buckets.keys()
            if missing:
                raise TraceValidationError(
                    f"line {line}: cumulative summary removed bucket(s): "
                    + ", ".join(sorted(missing))
                )
            for bucket, (previous_count, previous_total) in (
                self.previous_buckets.items()
            ):
                count, total_ns = buckets[bucket]
                if count < previous_count:
                    raise TraceValidationError(
                        f"line {line}: bucket {bucket!r} count decreased "
                        f"from {previous_count} to {count}"
                    )
                if total_ns < previous_total:
                    raise TraceValidationError(
                        f"line {line}: bucket {bucket!r} total_ns decreased "
                        f"from {previous_total} to {total_ns}"
                    )

        if self.terminal_seen:
            if is_final:
                raise TraceValidationError(
                    f"line {line}: multiple final:true summaries"
                )
            raise TraceValidationError(
                f"line {line}: checkpoint summary appears after terminal summary"
            )
        if is_final:
            self.terminal_seen = True
            self.terminal = summary
            self.terminal_line = line
        else:
            self.checkpoint_count += 1

        self.previous_seq = seq
        self.previous_counts = counts
        self.previous_buckets = buckets
        self.bucket_entry_schema = bucket_entry_schema

    def finish(
        self,
        *,
        row_count: int,
        allow_legacy_summary: bool,
    ) -> tuple[dict[str, Any], int, bool | None, bool]:
        if self.record_count == 0:
            raise TraceValidationError("trace has no terminal summary")
        if self.mode == "cumulative" and not self.terminal_seen:
            raise TraceValidationError(
                "cumulative trace has no terminal final:true summary"
            )
        assert self.terminal is not None
        if self.terminal_line != row_count:
            raise TraceValidationError(
                "terminal source summary must be the final JSONL record"
            )
        source_complete, valid_evidence = _validate_summary(
            self.terminal,
            line=self.terminal_line,
            allow_legacy_summary=allow_legacy_summary,
        )
        return (
            self.terminal,
            self.terminal_line,
            source_complete,
            valid_evidence,
        )


def _validate_operation_closure(
    command_buffers: dict[int, CommandBuffer],
    op_seqs: array,
    op_owners: array,
    op_lines: array,
) -> None:
    declared_total = sum(cb.op_count for cb in command_buffers.values())
    if declared_total > JS_SAFE_INTEGER:
        raise TraceValidationError(
            "declared operation count is outside the JavaScript safe integer range"
        )
    if declared_total != len(op_seqs):
        raise TraceValidationError(
            f"command buffers declare {declared_total} ops but source has "
            f"{len(op_seqs)}"
        )

    nonempty_ranges = sorted(
        (
            cb.first_op_seq,
            cb.last_op_seq,
            cb.index,
            cb.line,
        )
        for cb in command_buffers.values()
        if cb.op_count
    )
    for previous, current in zip(nonempty_ranges, nonempty_ranges[1:]):
        if current[0] <= previous[1]:
            raise TraceValidationError(
                f"line {current[3]}: command buffer op range overlaps "
                f"command buffer {previous[2]}"
            )

    offsets: dict[int, int] = {}
    offset = 0
    for cb in command_buffers.values():
        offsets[cb.index] = offset
        offset += cb.op_count
    seen = bytearray((declared_total + 7) // 8)
    owned_counts: dict[int, int] = {}

    for seq, owner, line in zip(op_seqs, op_owners, op_lines):
        cb = command_buffers.get(owner)
        if cb is None:
            raise TraceValidationError(
                f"line {line}: op {seq} references missing command buffer {owner}"
            )
        if (
            cb.op_count == 0
            or seq < cb.first_op_seq
            or seq > cb.last_op_seq
        ):
            raise TraceValidationError(
                f"line {line}: op {seq} is outside command buffer "
                f"{owner}'s declared range"
            )
        position = offsets[owner] + seq - cb.first_op_seq
        byte_index, bit_index = divmod(position, 8)
        mask = 1 << bit_index
        if seen[byte_index] & mask:
            raise TraceValidationError(
                f"line {line}: duplicate op seq {seq} for command buffer {owner}"
            )
        seen[byte_index] |= mask
        owned_counts[owner] = owned_counts.get(owner, 0) + 1

    for cb in command_buffers.values():
        actual = owned_counts.get(cb.index, 0)
        if actual != cb.op_count:
            raise TraceValidationError(
                f"line {cb.line}: command buffer {cb.index} declares "
                f"{cb.op_count} ops but owns {actual}"
            )


def _pass_one(
    source: Path, *, allow_legacy_summary: bool
) -> TraceIndex:
    digest = hashlib.sha256()
    command_buffers: dict[int, CommandBuffer] = {}
    pending_waits: list[PendingWait] = []
    op_seqs = array("q")
    op_owners = array("q")
    op_lines = array("Q")
    summaries = _SummaryTracker()
    row_count = 0

    with source.open("rb") as stream:
        for line_number, encoded_line in enumerate(stream, 1):
            digest.update(encoded_line)
            row = _parse_line(encoded_line, line_number)
            kind = _classify(row, line_number)
            row_count = line_number
            if row_count > JS_SAFE_INTEGER:
                raise TraceValidationError(
                    "row count is outside the JavaScript safe integer range"
                )

            if kind == "cb":
                command_buffer = _parse_command_buffer(row, line_number)
                first = command_buffers.get(command_buffer.index)
                if first is not None:
                    raise TraceValidationError(
                        f"line {line_number}: duplicate command buffer index "
                        f"{command_buffer.index} (first at line {first.line})"
                    )
                command_buffers[command_buffer.index] = command_buffer
            elif kind == "op":
                seq, owner = _parse_operation(row, line_number)
                op_seqs.append(seq)
                op_owners.append(owner)
                op_lines.append(line_number)
            elif kind == "wait":
                pending_waits.append(_parse_wait(row, line_number))
            else:
                summaries.add(row, line=line_number)

    if not row_count:
        raise TraceValidationError("trace is empty")
    (
        summary,
        summary_line,
        source_complete,
        valid_evidence,
    ) = summaries.finish(
        row_count=row_count,
        allow_legacy_summary=allow_legacy_summary,
    )
    if not command_buffers:
        raise TraceValidationError("trace contains no command buffers")

    _validate_operation_closure(
        command_buffers, op_seqs, op_owners, op_lines
    )

    waits: list[Wait] = []
    for pending in pending_waits:
        owner = None
        if pending.cb_index is not None:
            owner = command_buffers.get(pending.cb_index)
            if owner is None:
                raise TraceValidationError(
                    f"line {pending.line}: wait references missing command "
                    f"buffer {pending.cb_index}"
                )
        anchor = pending.explicit_anchor
        if anchor is None and owner is not None:
            anchor = owner.owner_wait_anchor
        waits.append(
            Wait(
                line=pending.line,
                bucket=pending.bucket,
                cb_index=pending.cb_index,
                anchor=anchor,
                has_explicit_anchor=pending.explicit_anchor is not None,
                duration=pending.duration,
            )
        )

    expected_summary_counts = {
        "ops_total": len(op_seqs),
        "cbs_total": len(command_buffers),
        "waits_total": len(waits),
    }
    for field, expected in expected_summary_counts.items():
        if field in summary:
            actual = _integer(
                summary[field],
                field=field,
                line=summary_line,
                nonnegative=True,
            )
            if actual != expected:
                raise TraceValidationError(
                    f"line {summary_line}: summary {field}={actual} does not "
                    f"match parsed count {expected}"
                )

    return TraceIndex(
        row_count=row_count,
        command_buffers=tuple(command_buffers.values()),
        waits=tuple(waits),
        op_seqs=op_seqs,
        op_owners=op_owners,
        op_lines=op_lines,
        summary=summary,
        summary_line=summary_line,
        summary_count=summaries.record_count,
        source_sha256=digest.hexdigest(),
        source_complete=source_complete,
        valid_evidence=valid_evidence,
    )


def _select_window(
    trace: TraceIndex,
    *,
    max_command_buffers: int,
    anchor_bucket: str,
) -> tuple[
    tuple[CommandBuffer, ...],
    tuple[Wait, ...],
    int,
    int,
    str,
]:
    ordered = sorted(
        trace.command_buffers,
        key=lambda cb: (cb.end, cb.start, cb.index, cb.line),
    )
    end_index = [cb.end for cb in ordered]
    candidates = sorted(
        (
            wait
            for wait in trace.waits
            if wait.bucket == anchor_bucket and wait.anchor is not None
        ),
        key=lambda wait: (wait.anchor, wait.line),
        reverse=True,
    )

    partial: tuple[tuple[CommandBuffer, ...], Wait] | None = None
    selected: tuple[CommandBuffer, ...] | None = None
    chosen_anchor: Wait | None = None
    selection_mode = "final-command-buffers"
    for wait in candidates:
        assert wait.anchor is not None
        stop = bisect_right(end_index, wait.anchor)
        if not stop:
            continue
        candidate = tuple(ordered[max(0, stop - max_command_buffers) : stop])
        if wait.cb_index is not None and all(
            cb.index != wait.cb_index for cb in candidate
        ):
            continue
        if partial is None:
            partial = (candidate, wait)
        if stop >= max_command_buffers:
            selected = candidate
            chosen_anchor = wait
            selection_mode = "anchor"
            break

    if selected is None and partial is not None:
        selected, chosen_anchor = partial
        selection_mode = "anchor-partial"
    if selected is None:
        selected = tuple(ordered[-max_command_buffers:])

    if not selected:
        raise TraceValidationError("no command buffers are selectable")
    selected_ids = {cb.index for cb in selected}
    lower_bound = min(cb.start for cb in selected)
    upper_bound = max(cb.end for cb in selected)
    if chosen_anchor is not None:
        assert chosen_anchor.anchor is not None
        upper_bound = chosen_anchor.anchor
    if upper_bound - lower_bound > JS_SAFE_INTEGER:
        raise TraceValidationError(
            "selected timestamp span is outside the JavaScript safe integer range"
        )

    selected_waits = tuple(
        wait
        for wait in trace.waits
        if wait.anchor is not None
        and lower_bound <= wait.anchor <= upper_bound
        and (wait.cb_index is None or wait.cb_index in selected_ids)
    )
    if chosen_anchor is not None and chosen_anchor not in selected_waits:
        raise TraceValidationError(
            "selected anchor wait could not be included referentially"
        )
    return (
        selected,
        selected_waits,
        lower_bound,
        upper_bound,
        selection_mode,
    )


def _serialize_row(row: dict[str, Any]) -> str:
    return (
        json.dumps(
            row,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
            allow_nan=False,
        )
        + "\n"
    )


def _rebase_row(
    row: dict[str, Any], kind: str, lower_bound: int, line: int
) -> dict[str, Any]:
    timestamp_fields: Iterable[str]
    if kind == "cb":
        timestamp_fields = CB_TIMESTAMP_FIELDS
    elif kind == "wait":
        timestamp_fields = WAIT_TIMESTAMP_FIELDS
    else:
        timestamp_fields = ()
    for field in timestamp_fields:
        if field not in row:
            continue
        rebased = _integer(row[field], field=field, line=line) - lower_bound
        if rebased < 0 or rebased > JS_SAFE_INTEGER:
            raise TraceValidationError(
                f"line {line}: rebased {field} is outside curated bounds"
            )
        row[field] = rebased
    return row


def _fsync_parent(path: Path) -> None:
    try:
        descriptor = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    except OSError:
        # Directory fsync is unavailable on some filesystems.  The file itself
        # is always flushed and synced before replacement.
        pass


def _write_selected_second_pass(
    source: Path,
    destination: Path,
    *,
    trace: TraceIndex,
    selected_command_buffers: tuple[CommandBuffer, ...],
    selected_waits: tuple[Wait, ...],
    lower_bound: int,
    summary: dict[str, Any],
) -> None:
    selected_cb_indices = {cb.index for cb in selected_command_buffers}
    selected_wait_lines = {wait.line for wait in selected_waits}
    expected_counts = summary["selected_counts"]
    written_counts = {"command_buffers": 0, "ops": 0, "waits": 0}
    digest = hashlib.sha256()

    descriptor, temporary_name = tempfile.mkstemp(
        dir=destination.parent,
        prefix=f".{destination.name}.",
        suffix=".tmp",
    )
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(
            descriptor, "w", encoding="utf-8", newline="\n"
        ) as output, source.open("rb") as stream:
            descriptor = -1
            for line_number, encoded_line in enumerate(stream, 1):
                digest.update(encoded_line)
                row = _parse_line(encoded_line, line_number)
                kind = _classify(row, line_number)
                include = False
                if kind == "cb":
                    include = _cb_index(row, line_number) in selected_cb_indices
                    if include:
                        written_counts["command_buffers"] += 1
                elif kind == "op":
                    include = _cb_index(row, line_number) in selected_cb_indices
                    if include:
                        written_counts["ops"] += 1
                elif kind == "wait":
                    include = line_number in selected_wait_lines
                    if include:
                        written_counts["waits"] += 1
                if include:
                    output.write(
                        _serialize_row(
                            _rebase_row(row, kind, lower_bound, line_number)
                        )
                    )

            if digest.hexdigest() != trace.source_sha256:
                raise TraceValidationError(
                    "source changed between validation and write passes"
                )
            for key, actual in written_counts.items():
                if actual != expected_counts[key]:
                    raise TraceValidationError(
                        f"second pass wrote {actual} {key}, expected "
                        f"{expected_counts[key]}"
                    )
            output.write(_serialize_row(summary))
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary_path, destination)
        _fsync_parent(destination)
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        try:
            temporary_path.unlink()
        except FileNotFoundError:
            pass


def _paths_refer_to_same_file(source: Path, destination: Path) -> bool:
    if source.resolve(strict=False) == destination.resolve(strict=False):
        return True
    if destination.exists():
        try:
            return os.path.samefile(source, destination)
        except OSError:
            return False
    return False


def _validate_arguments(
    source: Path,
    destination: Path,
    max_command_buffers: int,
    anchor_bucket: str,
) -> None:
    if (
        isinstance(max_command_buffers, bool)
        or not isinstance(max_command_buffers, int)
        or max_command_buffers <= 0
        or max_command_buffers > JS_SAFE_INTEGER
    ):
        raise ValueError(
            "max_command_buffers must be a positive JavaScript-safe integer"
        )
    if not isinstance(anchor_bucket, str) or not anchor_bucket:
        raise ValueError("anchor_bucket must be a non-empty string")
    if _paths_refer_to_same_file(source, destination):
        raise ValueError("source and destination must be different files")
    if not source.is_file():
        raise FileNotFoundError(f"source file does not exist: {source}")
    if not destination.parent.exists():
        raise FileNotFoundError(
            f"destination parent does not exist: {destination.parent}"
        )
    if not destination.parent.is_dir():
        raise NotADirectoryError(
            f"destination parent is not a directory: {destination.parent}"
        )


def _selected_bucket_summary(
    waits: tuple[Wait, ...],
) -> dict[str, dict[str, int]]:
    buckets: dict[str, dict[str, int]] = {}
    for wait in waits:
        if wait.bucket is None:
            continue
        aggregate = buckets.setdefault(
            wait.bucket, {"count": 0, "total_ns": 0}
        )
        aggregate["count"] += 1
        aggregate["total_ns"] += wait.duration
        if (
            aggregate["count"] > JS_SAFE_INTEGER
            or aggregate["total_ns"] > JS_SAFE_INTEGER
        ):
            raise TraceValidationError(
                f"line {wait.line}: selected bucket aggregate is outside the "
                "JavaScript safe integer range"
            )
    return buckets


def curate_trace(
    source: Path,
    destination: Path,
    *,
    max_command_buffers: int,
    anchor_bucket: str = "cb_wait_until_completed",
    allow_legacy_summary: bool = False,
) -> dict[str, Any]:
    """Write one deterministic, referentially closed command-buffer window."""

    source = Path(source)
    destination = Path(destination)
    _validate_arguments(
        source, destination, max_command_buffers, anchor_bucket
    )
    trace = _pass_one(
        source, allow_legacy_summary=allow_legacy_summary
    )
    (
        selected_command_buffers,
        selected_waits,
        lower_bound,
        upper_bound,
        selection_mode,
    ) = _select_window(
        trace,
        max_command_buffers=max_command_buffers,
        anchor_bucket=anchor_bucket,
    )

    selected_cb_indices = {cb.index for cb in selected_command_buffers}
    selected_op_count = sum(
        1 for owner in trace.op_owners if owner in selected_cb_indices
    )
    source_counts = {
        "rows": trace.row_count,
        "command_buffers": len(trace.command_buffers),
        "ops": trace.op_count,
        "waits": len(trace.waits),
        "summary_records": trace.summary_count,
    }
    selected_counts = {
        "rows": (
            len(selected_command_buffers)
            + selected_op_count
            + len(selected_waits)
            + 1
        ),
        "command_buffers": len(selected_command_buffers),
        "ops": selected_op_count,
        "waits": len(selected_waits),
    }
    summary: dict[str, Any] = {
        "schema_version": 1,
        "record": "summary",
        "summary_seq": 0,
        "final": True,
        "complete": True,
        "dropped_rows": 0,
        "ops_total": selected_counts["ops"],
        "cbs_total": selected_counts["command_buffers"],
        "buckets": _selected_bucket_summary(selected_waits),
        "curated_window": True,
        "curator_schema": CURATOR_SCHEMA,
        "curator_version": CURATOR_VERSION,
        "curator_bounds": {
            "source_start_ns": lower_bound,
            "source_end_ns": upper_bound,
            "rebased_start_ns": 0,
            "rebased_end_ns": upper_bound - lower_bound,
        },
        "anchor_bucket": anchor_bucket,
        "selection_mode": selection_mode,
        "source_complete": trace.source_complete,
        "valid_evidence": trace.valid_evidence,
        "source_evidence_status": (
            "verified-complete"
            if trace.valid_evidence
            else "legacy-unverifiable"
        ),
        "source_sha256": trace.source_sha256,
        "source_metadata": {"summary": trace.summary},
        "source_counts": source_counts,
        "selected_counts": selected_counts,
        "rows": selected_counts["rows"],
        "command_buffers": selected_counts["command_buffers"],
        "ops": selected_counts["ops"],
        "waits": selected_counts["waits"],
    }
    _write_selected_second_pass(
        source,
        destination,
        trace=trace,
        selected_command_buffers=selected_command_buffers,
        selected_waits=selected_waits,
        lower_bound=lower_bound,
        summary=summary,
    )
    return summary


def _validated_count_map(
    value: Any, *, field: str, line: int
) -> dict[str, int]:
    if not isinstance(value, dict):
        raise TraceValidationError(f"line {line}: {field} must be an object")
    result: dict[str, int] = {}
    for key in COUNT_KEYS:
        if key not in value:
            raise TraceValidationError(
                f"line {line}: {field} is missing {key}"
            )
        result[key] = _integer(
            value[key],
            field=f"{field}.{key}",
            line=line,
            nonnegative=True,
        )
    return result


def verify_curated(path: Path) -> dict[str, Any]:
    """Structurally validate a curated file; this does not attest raw input."""

    path = Path(path)
    if not path.is_file():
        raise FileNotFoundError(f"curated trace does not exist: {path}")
    trace = _pass_one(path, allow_legacy_summary=False)
    summary = trace.summary
    line = trace.summary_line

    if summary.get("curated_window") is not True:
        raise TraceValidationError(
            f"line {line}: summary is missing curated_window=true"
        )
    if summary.get("curator_schema") != CURATOR_SCHEMA:
        raise TraceValidationError(
            f"line {line}: unsupported curator schema"
        )
    if summary.get("curator_version") != CURATOR_VERSION:
        raise TraceValidationError(
            f"line {line}: unsupported curator version"
        )
    source_sha256 = summary.get("source_sha256")
    if not isinstance(source_sha256, str) or not SHA256_PATTERN.fullmatch(
        source_sha256
    ):
        raise TraceValidationError(
            f"line {line}: source_sha256 must be 64 lowercase hex characters"
        )

    raw_source_counts = summary.get("source_counts")
    source_counts = _validated_count_map(
        raw_source_counts, field="source_counts", line=line
    )
    assert isinstance(raw_source_counts, dict)
    source_summary_records = _integer(
        raw_source_counts.get("summary_records", 1),
        field="source_counts.summary_records",
        line=line,
        nonnegative=True,
    )
    if source_summary_records < 1:
        raise TraceValidationError(
            f"line {line}: source_counts.summary_records must be positive"
        )
    selected_counts = _validated_count_map(
        summary.get("selected_counts"), field="selected_counts", line=line
    )
    actual_counts = {
        "rows": trace.row_count,
        "command_buffers": len(trace.command_buffers),
        "ops": trace.op_count,
        "waits": len(trace.waits),
    }
    if summary.get("schema_version") != 1:
        raise TraceValidationError(
            f"line {line}: curated summary must use schema_version 1"
        )
    if summary.get("final") is not True:
        raise TraceValidationError(
            f"line {line}: curated summary must be final:true"
        )
    if summary.get("ops_total") != actual_counts["ops"]:
        raise TraceValidationError(
            f"line {line}: ops_total does not match selected ops"
        )
    if summary.get("cbs_total") != actual_counts["command_buffers"]:
        raise TraceValidationError(
            f"line {line}: cbs_total does not match selected command buffers"
        )
    expected_buckets = _selected_bucket_summary(trace.waits)
    if summary.get("buckets") != expected_buckets:
        raise TraceValidationError(
            f"line {line}: buckets do not match selected wait aggregates"
        )
    if selected_counts != actual_counts:
        raise TraceValidationError(
            f"line {line}: selected_counts do not match curated rows"
        )
    for key in COUNT_KEYS:
        if source_counts[key] < selected_counts[key]:
            raise TraceValidationError(
                f"line {line}: source_counts.{key} is smaller than selected count"
            )
    if source_counts["rows"] != (
        source_counts["command_buffers"]
        + source_counts["ops"]
        + source_counts["waits"]
        + source_summary_records
    ):
        raise TraceValidationError(
            f"line {line}: source_counts.rows is inconsistent with record counts"
        )
    for key in COUNT_KEYS:
        if summary.get(key) != selected_counts[key]:
            raise TraceValidationError(
                f"line {line}: summary {key} does not match selected_counts"
            )

    anchor_bucket = summary.get("anchor_bucket")
    if not isinstance(anchor_bucket, str) or not anchor_bucket:
        raise TraceValidationError(
            f"line {line}: anchor_bucket must be a non-empty string"
        )
    selection_mode = summary.get("selection_mode")
    if selection_mode not in {
        "anchor",
        "anchor-partial",
        "final-command-buffers",
    }:
        raise TraceValidationError(
            f"line {line}: unsupported selection_mode"
        )

    bounds = summary.get("curator_bounds")
    if not isinstance(bounds, dict):
        raise TraceValidationError(
            f"line {line}: curator_bounds must be an object"
        )
    numeric_bounds: dict[str, int] = {}
    for field in (
        "source_start_ns",
        "source_end_ns",
        "rebased_start_ns",
        "rebased_end_ns",
    ):
        if field not in bounds:
            raise TraceValidationError(
                f"line {line}: curator_bounds is missing {field}"
            )
        numeric_bounds[field] = _integer(
            bounds[field], field=f"curator_bounds.{field}", line=line
        )
    if numeric_bounds["rebased_start_ns"] != 0:
        raise TraceValidationError(
            f"line {line}: rebased window must start at zero"
        )
    if (
        numeric_bounds["source_end_ns"]
        < numeric_bounds["source_start_ns"]
        or numeric_bounds["rebased_end_ns"] < 0
        or numeric_bounds["source_end_ns"]
        - numeric_bounds["source_start_ns"]
        != numeric_bounds["rebased_end_ns"]
    ):
        raise TraceValidationError(
            f"line {line}: curator bounds are inconsistent"
        )

    if min(cb.start for cb in trace.command_buffers) != 0:
        raise TraceValidationError(
            "curated command-buffer timeline does not begin at zero"
        )
    rebased_end = numeric_bounds["rebased_end_ns"]
    if any(
        cb.start < 0 or cb.end < cb.start or cb.end > rebased_end
        for cb in trace.command_buffers
    ):
        raise TraceValidationError(
            "curated command-buffer intervals fall outside curator bounds"
        )
    for wait in trace.waits:
        if wait.anchor is not None and (
            wait.anchor < 0 or wait.anchor > rebased_end
        ):
            raise TraceValidationError(
                f"line {wait.line}: curated wait anchor falls outside "
                "curator bounds"
            )

    if selection_mode in {"anchor", "anchor-partial"}:
        matching_anchors = [
            wait
            for wait in trace.waits
            if wait.bucket == anchor_bucket and wait.anchor == rebased_end
        ]
        if not matching_anchors:
            raise TraceValidationError(
                f"line {line}: anchored selection has no {anchor_bucket!r} "
                "wait at the rebased upper bound"
            )

    source_complete = summary.get("source_complete", object())
    valid_evidence = summary.get("valid_evidence")
    status = summary.get("source_evidence_status")
    source_metadata = summary.get("source_metadata")
    if (
        not isinstance(source_metadata, dict)
        or not isinstance(source_metadata.get("summary"), dict)
    ):
        raise TraceValidationError(
            f"line {line}: source_metadata.summary must preserve the source summary"
        )
    preserved_summary = source_metadata["summary"]
    if (
        preserved_summary.get("record") != "summary"
        and preserved_summary.get("kind") != "summary"
    ):
        raise TraceValidationError(
            f"line {line}: source_metadata.summary is not a source summary"
        )
    for field, count_key in (
        ("ops_total", "ops"),
        ("cbs_total", "command_buffers"),
        ("waits_total", "waits"),
    ):
        if field in preserved_summary and (
            isinstance(preserved_summary[field], bool)
            or not isinstance(preserved_summary[field], int)
            or preserved_summary[field] != source_counts[count_key]
        ):
            raise TraceValidationError(
                f"line {line}: preserved {field} contradicts source_counts"
            )
    if source_complete is None:
        if valid_evidence is not False or status != "legacy-unverifiable":
            raise TraceValidationError(
                f"line {line}: legacy source must remain legacy-unverifiable"
            )
        if "complete" in preserved_summary or "dropped_rows" in preserved_summary:
            raise TraceValidationError(
                f"line {line}: legacy source metadata contradicts legacy status"
            )
    elif source_complete is True:
        if valid_evidence is not True or status != "verified-complete":
            raise TraceValidationError(
                f"line {line}: verified source evidence fields are inconsistent"
            )
        if (
            preserved_summary.get("complete") is not True
            or preserved_summary.get("dropped_rows") != 0
        ):
            raise TraceValidationError(
                f"line {line}: preserved source summary is not clean"
            )
    else:
        raise TraceValidationError(
            f"line {line}: source_complete must be true or null"
        )

    return {
        "valid": True,
        "validation_scope": "structural-curated-file",
        "raw_provenance_attested": False,
        "rows": actual_counts["rows"],
        "command_buffers": actual_counts["command_buffers"],
        "ops": actual_counts["ops"],
        "waits": actual_counts["waits"],
        "source_sha256": source_sha256,
        "source_complete": source_complete,
        "valid_evidence": valid_evidence,
    }


def _print_json(value: dict[str, Any]) -> None:
    print(
        json.dumps(
            value,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
            allow_nan=False,
        )
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Curate or structurally verify dispatch-census windows."
    )
    parser.add_argument("paths", nargs="*", metavar="PATH")
    parser.add_argument(
        "--max-command-buffers",
        type=int,
        help="maximum whole command buffers in the curated window",
    )
    parser.add_argument(
        "--anchor-bucket",
        default="cb_wait_until_completed",
        help="wait bucket/cause used to end an anchored window",
    )
    parser.add_argument(
        "--allow-legacy-summary",
        action="store_true",
        help="accept a source summary missing both completeness gate fields",
    )
    parser.add_argument(
        "--verify",
        metavar="CURATED_JSONL",
        help="structurally verify an existing curated trace",
    )
    arguments = parser.parse_args(argv)

    if arguments.verify:
        if arguments.paths or arguments.max_command_buffers is not None:
            parser.error("--verify cannot be combined with input/output paths")
        if arguments.allow_legacy_summary:
            parser.error("--allow-legacy-summary is not valid with --verify")
        try:
            _print_json(verify_curated(Path(arguments.verify)))
        except (OSError, ValueError) as error:
            print(f"error: {error}", file=sys.stderr)
            return 2
        return 0

    if len(arguments.paths) != 2:
        parser.error("curation requires RAW.jsonl and OUT.jsonl")
    if arguments.max_command_buffers is None:
        parser.error("curation requires --max-command-buffers")
    try:
        result = curate_trace(
            Path(arguments.paths[0]),
            Path(arguments.paths[1]),
            max_command_buffers=arguments.max_command_buffers,
            anchor_bucket=arguments.anchor_bucket,
            allow_legacy_summary=arguments.allow_legacy_summary,
        )
        _print_json(result)
    except (OSError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
