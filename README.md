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

## Usage

Single static page, no build step, no network: open `index.html`, drop a `.jsonl`
file on it. Everything renders locally.

## Status

Early. Schema co-evolving with the MLX census instrumentation that feeds it.

## License

MIT
