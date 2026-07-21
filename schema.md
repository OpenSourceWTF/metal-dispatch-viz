# Input schema

`metal-dispatch-viz` reads **JSONL** (newline-delimited JSON): one JSON object
per non-blank line. Blank lines are skipped. A line that fails to parse as JSON
is skipped and counted (surfaced in the file-status bar and logged to the
console with its 1-based line number) — one bad line never aborts the rest of
the file.

This document is the precise, superset-tolerant field reference for what
`index.html` recognizes. **Unknown fields on any recognized record are kept**
(not stripped) and shown in hover-tooltip detail panes; **unrecognized record
shapes are counted and ignored**, not rejected — the file still renders.

## Record-kind detection

Every parsed line is classified independently, in this order:

1. `rec.kind === "wait"` → **wait** record.
2. Otherwise, if the object has *any* of `encode_start_ns`, `encode_end_ns`,
   `gpu_start_ns`, `gpu_end_ns` → **timeline** record (a command-buffer row).
3. Otherwise, if the object has both `seq` and `cb_index` → **command**
   record (a per-dispatch census row).
4. Otherwise → **unknown**. Counted, ignored, never plotted.

This order matters: an explicit `"kind":"wait"` always wins, even if the
record happens to also carry timeline-shaped fields.

## 1. Timeline record (per command buffer)

One row per `cb_index` describing its host/GPU lifetime.

| Field | Type | Required for | Meaning |
|---|---|---|---|
| `cb_index` | number | linking to commands/waits | Command buffer identifier. If absent, the row still renders as an isolated bar under a synthetic key, but no command or wait record can reference it. |
| `encode_start_ns` | number (ns) | host-lane bar | Host encode start timestamp. |
| `encode_end_ns` | number (ns) | host-lane bar | Host encode end timestamp. |
| `gpu_start_ns` | number (ns) | GPU-lane bar | GPU execute start timestamp. |
| `gpu_end_ns` | number (ns) | GPU-lane bar | GPU execute end timestamp. |
| `op_count` | number | tooltip only | Command count in this buffer. |
| `first_op_seq` / `last_op_seq` | number | tooltip only | `seq` range of commands belonging to this cb. |
| *(anything else)* | any | tooltip only | Preserved and shown verbatim. |

A bar is drawn on the **host encode** lane only if both `encode_start_ns` and
`encode_end_ns` are present and finite; likewise the **GPU execute** lane
needs both `gpu_start_ns` and `gpu_end_ns`. A cb missing one pair simply has
no bar on that lane (no error) — e.g. a cb that never got submitted still
shows its encode bar.

**Duplicate `cb_index`:** if more than one timeline record shares a
`cb_index` (e.g. a partial row emitted at encode time, completed later at
submit time), fields are merged with later records winning per-field
(`Object.assign`), not replaced wholesale.

## 2. Command record (per dispatch, census row)

| Field | Type | Meaning |
|---|---|---|
| `seq` | number | Global, monotonically-increasing dispatch order. Required (with `cb_index`) to classify as a command record. |
| `cb_index` | number | Owning command buffer. Used to place the mark on the dispatch strip and to attribute it to a cb's encode span. |
| `kind` | string | One of `compute`, `blit`, `fill`, `copy`, `other`. Any other value (or a missing field) is folded into **other** for coloring/legend purposes — the raw value is still shown in the tooltip. |
| `kernel_name` | string | Shown as the mark's label and used for the "top kernels" / "setBytes totals" census. Missing → grouped under `(unnamed)`. |
| `set_bytes_calls` | number | Count of `setBytes`-style calls. Tooltip + census only. |
| `set_bytes_total` | number | Byte total across those calls. Summed per kernel in the census panel. |
| `buffer_binds` | number | Bound-buffer count. Powers the buffer_binds histogram. |
| `grid` | `[x,y,z]` | Dispatch grid size. Tooltip only. |
| `threadgroup` | `[x,y,z]` | Threadgroup size. Tooltip only. |
| *(anything else)* | any | Preserved and shown verbatim. |

**Placement on the dispatch strip:** commands are grouped by `cb_index`,
sorted by `seq`, and spread evenly (by rank, not by raw `seq` value) across
their owning cb's `[encode_start_ns, encode_end_ns]` span — `seq` is a global
counter so raw values are not assumed contiguous per cb. A command whose
`cb_index` has no matching timeline record (or whose timeline record lacks an
encode span) cannot be placed; it is counted and reported in the file-status
line, but not silently dropped from the census tables.

## 3. Wait record (optional annotation)

| Field | Type | Meaning |
|---|---|---|
| `kind` | `"wait"` | Required — this is the discriminator. |
| `cause` | string | Shown as the marker/table label. Missing → `(no cause field)`. |
| a duration field | number (ns) | First present of: `ns`, `wait_ns`, `duration_ns`, `dur_ns`. |
| an anchor field (optional) | number (ns) | First present of: `ts_ns`, `at_ns`, `start_ns`, `time_ns`, `timestamp_ns`. |
| `cb_index` | number (optional) | Fallback anchor (see below). |
| *(anything else)* | any | Preserved and shown verbatim. |

**Anchoring a wait on the timeline** (the README's example carries only
`cause`/`ns`, no timestamp, so this is a documented design decision, not
part of the upstream schema):

1. If any of the timestamp fields above is present, anchor there.
2. Otherwise, if `cb_index` matches a known timeline record, anchor at that
   cb's `encode_end_ns` (falling back to `encode_start_ns`, then
   `gpu_start_ns`) — a wait is assumed to block *after* encoding, before
   submit/reuse.
3. Otherwise the wait **cannot be placed** on the graphical timeline. It is
   still listed in the "Wait annotations" table with an explicit
   "unplaced" note, so it is never silently lost — it just isn't drawn.

Waits render as small flagged (▲) markers on a dedicated row above the host
lane, colored with the fixed "warning" status color, and are always paired
with a text label (cause) — never color alone.

## Numbers, units, time base

All `*_ns` fields are nanoseconds. Their absolute origin is not assumed to be
zero or epoch-relative — the UI normalizes *display* by subtracting the
earliest timestamp seen across all placed host/GPU intervals (`t=0` badge is
implicit: the axis and tooltips show time relative to the first event). Raw
values are never mutated; only the labels are offset.

The axis auto-picks a unit (ns / µs / ms / s) from the visible zoom span, not
the whole-file span, so it stays readable while zoomed in.

## Overlap summary definition

Given the union of all host encode intervals `H` and the union of all GPU
execute intervals `G` (each merged internally so a lane's own overlaps don't
double count):

- **Total encode** = sum of raw (unmerged) encode durations.
- **Total GPU** = sum of raw (unmerged) GPU durations.
- **Wall span** = `max(end) - min(start)` across every placed host/GPU interval.
- **Overlap** = total length of `H ∩ G` — the time host and GPU were
  *simultaneously* busy. This is the headline "coupled pipeline" number.
- **Idle** = wall span minus the union `H ∪ G` — time neither engine was busy.

`Overlap %` and `Idle %` are both expressed as a fraction of wall span.

## Things intentionally out of scope for v1

- No support for multiple GPU queues/devices in one trace (single implicit
  timeline).
- No persistence/history across file loads — loading a new file replaces the
  current view.
- Per-command-buffer color hue (used to visually link a cb's host bar to its
  GPU bar) is a hashed, unbounded-cardinality identity channel, not a
  legend-backed categorical palette — it is not expected to be
  distinguishable cb-to-cb at a glance for large traces; position, the
  `cb<N>` label, and the tooltip are the reliable identifiers. The 5-color
  `kind` palette (used in the legend, dispatch strip, and census) is the one
  held to accessibility checks (fixed hue order, contrast, CVD separation).
