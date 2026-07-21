# metal-dispatch-viz

Timeline visualizer for Metal dispatch streams. Renders host-encode vs GPU-execute
overlap, per-command-buffer gantt lanes, and per-kernel dispatch censuses from
instrumentation JSONL (as emitted by an MLX dispatch-census build, but the format
is engine-agnostic).

Born from an LLM-decode performance investigation on Apple Silicon: per-component
GPU wins kept vanishing end-to-end because the decode cycle is a coupled
host-encode/GPU-execute pipeline — seeing the interleave is the whole game, and no
existing tool renders it.

## Input format

JSONL, two record kinds:

```jsonc
// per encoded command
{"seq": 512, "cb_index": 11, "kind": "compute", "kernel_name": "qmm_n64", "set_bytes_calls": 2, "set_bytes_total": 96, "buffer_binds": 5, "grid": [32,128,32], "threadgroup": [32,4,1]}
// per command buffer (timeline)
{"cb_index": 11, "encode_start_ns": 123, "encode_end_ns": 456, "gpu_start_ns": 400, "gpu_end_ns": 900, "op_count": 50, "first_op_seq": 500, "last_op_seq": 549}
```

Extra fields are preserved and shown in detail panes. Wait-attribution records
(`{"kind": "wait", "cause": "active_tasks_cap", "ns": ...}`) render as annotations.

Record kinds are told apart by shape (an explicit `"kind":"wait"`, then
presence of any `encode_*_ns`/`gpu_*_ns` field, then `seq`+`cb_index`
together) rather than a required type tag, so the format can keep growing.
See [`schema.md`](schema.md) for the precise, field-by-field reference,
including how wait records get anchored to a timestamp when they don't carry
one, and the exact definition of the overlap/idle percentages.

## Usage

Single static page, no build step, no network: open `index.html` in a
browser (including straight from `file://` — no server needed) and either
drag a `.jsonl` trace onto the drop zone, use "Choose file", or click
"Load sample" to see the visualizer populated with a small synthetic trace
before you have a real one. Everything — parsing, rendering, zoom/pan — runs
locally in the page; nothing is uploaded anywhere.

The gantt (host-encode vs GPU-execute lanes, linked per command buffer),
dispatch strip, kind legend, kernel/setBytes/buffer_binds census, and wait
annotations all populate from the same load. Scroll to zoom the gantt, drag
to pan, double-click or "Reset zoom" to fit the whole trace back into view.

## Status

Early. Schema co-evolving with the MLX census instrumentation that feeds it.

## License

MIT
