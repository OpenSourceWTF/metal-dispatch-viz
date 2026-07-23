# Metal Dispatch Workbench

A local, read-only workbench for understanding host encode, Metal GPU execution,
waits, and dispatch density in profiler JSONL. It is designed for the practical
question that aggregate kernel timings miss: where did host work, GPU work, and
synchronization overlap within one launch?

The server serves files and registry metadata only. It does not capture,
instrument, modify, or upload traces.

## Install and start

Node.js 18 or newer is required.

```sh
npm install
npm start -- --trace-dir /path/to/trace-folder
```

Then open `http://127.0.0.1:4173/`. With no option, the server reads
`traces/showcase`.

## Bundled showcase

The default folder contains curated, referentially closed windows from five
authentic profiler captures:

- Hy3 2q — oQ2e, MTP K2
- Qwen3.6 27B — Optimized Speed, MTP K3
- Qwen3.6 35B — A3B, MTP K1
- GLM-5.2 1.58q — q1t/t158, MTP K3
- Laguna 2.1 S — oQ4e, target-only AR

The toggle rail is still folder-driven: add another `.jsonl` or `.ndjson` file
and press Refresh to expose it. The four 2026-07-23 captures have current
terminal summaries. The Qwen3.6 35B window comes from an authentic older census
whose raw summary predates the completeness fields, so its manifest preserves
that source as legacy/unverifiable rather than upgrading it by assertion.

Configuration precedence is:

- Trace folder: `--trace-dir`, then `TRACE_DIR`, then `traces/showcase`
- Listen address: `HOST`, default `127.0.0.1`
- Port: `PORT`, default `4173`

For example:

```sh
TRACE_DIR=/Volumes/captures HOST=0.0.0.0 PORT=5000 npm start
```

The configured folder is rescanned when the registry is requested and when
Refresh is pressed. Discovery is recursive for `.jsonl` and `.ndjson` files,
case-insensitive. Dotfiles, dot-directories, non-regular files, and symlinks are
not followed. An empty folder remains an honest empty workbench; sample data is
never substituted.

## Optional folder manifest

Add `traces.json` at the trace-folder root to provide display metadata:

```json
{
  "schema_version": 1,
  "root_label": "Decode captures",
  "traces": {
    "hy3/decode.ndjson": {
      "label": "Hy3 decode K3",
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

Keys in `traces` are exact root-relative POSIX paths. Metadata enriches a
discovered file; it cannot create a trace, redirect a path, or replace the
server-generated opaque ID. All metadata fields are optional.

## Workbench controls

- Choose a trace with the button rail. Arrow keys move and select adjacent
  traces.
- Choose a launch when a file contains more than one launch window. The
  selector is hidden for a single launch.
- Use the timeline buttons, mouse wheel, drag, or keyboard: arrows pan,
  `+`/`-` zoom, `0` fits, `[` and `]` move to the previous and next timeline
  mark, Enter pins the active mark, and Escape clears.
- Select a command buffer, dispatch, density bin, or wait to populate the
  linked inspector.
- Refresh rescans the folder while preserving the current opaque trace ID when
  it still exists. Theme follows the saved preference, then the system
  preference.
- Share the current view with `?trace=<opaque-id>&window=<index>`; unrelated
  query parameters are preserved.

Trace fetch, byte-stream parsing, normalization, and interval analysis all run
inside one module Web Worker. Large files still report byte and row progress,
but their JSON parsing and exact aggregate construction never cross the browser
main thread. Registry file size remains the progress estimate when the
streaming response has no Content-Length; if a file grows beyond that estimate,
the UI explicitly reports the overflow instead of implying near-completion.

For very large launch windows, the worker sends a bounded, deterministic event
sample to the interactive Canvas while retaining exact full-window headline
metrics, kernel census, and wait taxonomy. A persistent note states the
displayed and total counts whenever sampling is active. Browsers without module
Web Worker support show an analysis error rather than silently running the
pipeline on the UI thread.

The browser keeps an LRU cache of at most two analyzed traces and 128 MiB of
source bytes. Cache identity includes the opaque trace ID, registry size, and
modification time, so changing a file in place invalidates its prior analysis.
Changing selection terminates the superseded worker; stale loads and pending
registry refreshes cannot publish over a newer selection.

## Evidence boundaries

Command-buffer host and GPU endpoints are measured profiler timestamps. GPU
busy, exposed host, and hidden host are interval-derived from those endpoints.
Per-dispatch marks are ordered placements across the owning command buffer's
encode interval, not measured operation timestamps. Wait durations are measured
when supplied, while a legacy wait anchor may be derived from command-buffer
ownership.

The UI keeps malformed-row, unsupported-row, incomplete, dropped-row,
count-mismatch, duplicate-command-buffer, legacy, unsupported-schema, and
missing-summary warnings visible while rendering the records that remain
usable. Scheduler backpressure and worker-wait buckets are detail signals and
are explicitly non-additive.

Profiler schema v1 does not contain tensor producer/consumer identities.
Therefore the workbench does not claim a tensor dependency path, an output
critical path, or automatic throughput comparisons between traces. See
[schema.md](schema.md) for the field and arithmetic contract.

## License

MIT
