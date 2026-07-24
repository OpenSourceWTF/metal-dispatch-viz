# Trace and manifest schema

The workbench accepts newline-delimited JSON (`.jsonl` or `.ndjson`), one JSON
object per non-blank line. It streams UTF-8, preserves the final line without a
newline, skips malformed lines with diagnostics, and continues to analyze valid
records. Unknown record types remain visible in evidence health instead of
being silently treated as valid.

The public profiler schema uses `record` as its discriminator. The normalizer
also accepts the legacy aliases below; aliases exist for reading old captures,
not as preferred names for new instrumentation.

## Operation record

```json
{
  "record": "op",
  "seq": 512,
  "command_buffer_index": 11,
  "kind": "compute",
  "dispatch": "threads",
  "kernel_name": "qmm_n64",
  "setBytes_calls": 2,
  "setBytes_total_bytes": 96,
  "buffer_binds": 5,
  "grid": [32, 128, 32],
  "threadgroup": [32, 4, 1]
}
```

| Public field | Legacy aliases | Meaning |
|---|---|---|
| `record: "op"` | `type: "operation"`, `kind: "dispatch"`, or field-shape inference | Operation discriminator |
| `seq` | — | Global dispatch order |
| `command_buffer_index` | `cb_index`, `commandBufferIndex` | Owning command buffer |
| `kind` | — | Operation kind metadata |
| `dispatch` | — | Dispatch style metadata |
| `kernel_name` | `kernel` | Kernel identity used by the census |
| `setBytes_calls` | `set_bytes_calls`, `setBytesCalls` | Number of setBytes calls |
| `setBytes_total_bytes` | `set_bytes_total`, `setBytesTotalBytes` | Total inline bytes |
| `buffer_binds` | `bufferBinds` | Buffer-bind count |
| `grid` | — | Dispatch grid metadata |
| `threadgroup` | — | Threadgroup metadata |

An operation has no measured timestamp in schema v1. Operations are grouped by
command-buffer ownership, sorted by `seq`, and assigned ordered positions over
the owning command buffer's measured encode interval. First and last sequence
bounds are honored when present. These positions are labeled **ordered
placement** everywhere; they are not operation timing measurements. Unowned or
unplaceable operations stay in counts and census data but do not receive an
invented timeline position.

## Command-buffer record

```json
{
  "record": "cb",
  "command_buffer_index": 11,
  "op_count": 50,
  "first_op_seq": 500,
  "last_op_seq": 549,
  "encode_start_ns": 123,
  "encode_end_ns": 456,
  "gpu_start_ns": 400,
  "gpu_end_ns": 900
}
```

| Public field | Legacy aliases | Meaning |
|---|---|---|
| `record: "cb"` | `type: "command_buffer"`, `command-buffer`, `commandbuffer`, or field-shape inference | Command-buffer discriminator |
| `command_buffer_index` | `cb_index`, `commandBufferIndex` | Command-buffer identifier |
| `op_count` | `opCount` | Reported operation count for the buffer |
| `first_op_seq` | `firstOpSeq` | First owned sequence |
| `last_op_seq` | `lastOpSeq` | Last owned sequence |
| `encode_start_ns` | `encodeStartNs`, `encode_start` | Measured host encode start |
| `encode_end_ns` | `encodeEndNs`, `encode_end` | Measured host encode end |
| `gpu_start_ns` | `gpuStartNs`, `gpu_start` | Measured GPU execution start |
| `gpu_end_ns` | `gpuEndNs`, `gpu_end` | Measured GPU execution end |

A host or GPU interval is usable only when both finite endpoints exist and the
end is later than the start. Duplicate finite
`command_buffer_index` records are quarantined as ambiguous; they are not
merged or allowed into timing arithmetic. Their IDs and row count remain in
health diagnostics.

## Wait record

```json
{
  "record": "wait",
  "bucket": "cap_wait",
  "wait_ns": 3000,
  "at_ns": 123456,
  "command_buffer_index": 11
}
```

| Public field | Legacy aliases | Meaning |
|---|---|---|
| `record: "wait"` | `type: "stall"`, `kind: "wait"`, or field-shape inference | Wait discriminator |
| `bucket` | `cause` | Taxonomy bucket |
| `wait_ns` | `duration_ns`, `ns`, `dur_ns`, `waitNs` | Measured duration |
| `at_ns` | `ts_ns`, `start_ns`, `time_ns`, `timestamp_ns`, `atNs` | Measured anchor when supplied |
| `command_buffer_index` | `cb_index`, `commandBufferIndex` | Optional ownership |

If an old wait lacks an anchor but has command-buffer ownership, the workbench
may place it at that buffer's encode end (then encode start or GPU start). That
anchor is labeled derived legacy fallback. An unowned wait remains in the table
without a fabricated position.

Taxonomy and headline arithmetic:

- `cap_wait` → cap wait
- `memory_wait`, `dependency_cv_wait` → dependency wait
- `cb_wait_until_completed` → decision drain
- unknown buckets → other wait
- `sched_backpressure` → scheduler mirror, shown but non-additive
- `sched_worker_wait` → worker idle, shown but non-additive

All observed buckets are retained in the wait table. The two scheduler-detail
buckets are never added again to headline wait totals.

## Final summary and completeness

```json
{
  "record": "summary",
  "schema_version": 1,
  "final": true,
  "complete": true,
  "dropped_rows": 0,
  "ops_total": 50,
  "cbs_total": 2,
  "buckets": {}
}
```

Legacy aliases are `type: "final_summary"` or `"final-summary"`,
`schemaVersion`, `droppedRows`, `opsTotal`, and `cbsTotal`. When multiple
summaries exist, the last row with `final: true` wins; otherwise the last
summary wins.

Evidence is complete only when all of the following hold:

- a summary exists;
- `schema_version` is exactly `1`;
- `complete` is `true`;
- `dropped_rows` is `0`;
- no input rows were malformed or unsupported;
- analyzed operation and command-buffer counts match finite reported totals;
- no duplicate command-buffer IDs were quarantined.

A missing summary is `missing-summary`. A summary without the completeness
fields is `legacy-unverifiable`. Other explicit states are
`unsupported-schema`, `incomplete`, and `dropped-rows`. Count mismatches do not
rewrite analyzed counts, and none of these states prevents valid rows from
rendering with a degraded badge.

## Launch windows and interval math

Command buffers are sorted by measured time and partitioned at a gap larger
than the greater of 100 ms or 20 times the median positive inter-buffer gap.
Waits do not create launch boundaries. Each launch owns its command buffers,
owned dispatches, and nearest measured waits. UI metrics, timeline, inspector,
kernel census, waits, and counts are computed from one selected launch only;
launches are never spliced together.

For the selected launch:

- **Wall span (measured endpoints)** is the last usable endpoint minus the
  first usable endpoint.
- **GPU work (measured intervals)** is the sum of raw valid GPU interval
  lengths, so overlapping command buffers may contribute simultaneously.
- **GPU busy (interval-derived union)** is the duration of the union of GPU
  intervals, without double counting.
- **Hidden host (interval-derived)** is host encode time intersecting the GPU
  interval union.
- **Exposed host (interval-derived)** is host encode time outside the GPU
  interval union.
- Wait durations are summed by the taxonomy above, excluding non-additive
  scheduler detail.

These are host/GPU interval relationships. Schema v1 has no tensor identity,
producer/consumer edge, output identity, or per-operation measured timestamp.
The workbench therefore makes no tensor critical-path or output critical-path
inference.

## Optional `traces.json` manifest

The trace-folder root may contain:

```json
{
  "schema_version": 1,
  "root_label": "Showcase captures",
  "traces": {
    "nested/capture.ndjson": {
      "label": "Hy3 steady decode",
      "model": "Hy3",
      "checkpoint": "org/hy3",
      "quantization": "2-bit",
      "mode": "MTP K3",
      "capture": "steady-state decode",
      "curation": "curated",
      "source_hash": "sha256:..."
    }
  }
}
```

`schema_version` must be `1`. `root_label` is optional. `traces` must be an
object keyed by exact root-relative POSIX file paths. Each value is an optional
plain metadata object. Display metadata may include `label`, `model`,
`checkpoint`, `quantization`, `mode`, capture description, raw-versus-curated
status, and source hash. New published runs also record `huggingface_repo`,
`huggingface_revision`, `contributor`, `capture_utc`, and `hardware`.
`huggingface_source_repo` identifies only the upstream source for a legacy or
locally derived artifact; it must not be presented as the exact executed
checkpoint. The browser constructs outbound Hugging Face links from validated
repository IDs and never trusts an arbitrary manifest URL. The registry strips
any attempted filesystem path, ID, file size, modification time, extension, or
other server-owned identity override.

New public run filenames use:

```text
<hf-owner>--<hf-repo>__<contributor>__<utc-date>.<artifact>.jsonl
```

The model-first layout groups lexical listings by Hugging Face repository,
then contributor, then capture date. Existing published filenames are retained
because the path participates in the stable opaque trace ID. See
[`docs/submitting-traces.md`](docs/submitting-traces.md) for the complete
naming, evidence, privacy, and submission contract.

For a curated launch window, keep the normal schema-v1 summary as the terminal
row and record provenance in the manifest: identify it as curated, describe the
capture/window, and provide the source hash. Summary totals describe the rows in
the curated file, not the uncurated parent capture. A curated file is still
judged by the same completeness, mismatch, duplicate, and dropped-row rules.
