# Trace-folder profiler workbench design

**Date:** 2026-07-22  
**Status:** Approved direction; updated to the requested Express folder model

## Objective

Turn `metal-dispatch-viz` into a polished local profiler workbench that reads
real MLX dispatch-census traces from one directory and lets the user toggle
between them. The initial showcase directory contains representative traces for:

- Hy3 oQ2e (2-bit streamed experts)
- Qwen3.6 27B Optimized Speed
- Qwen3.6 35B-A3B Optimized Speed
- GLM-5.2 q1t/t158 (1.58-bit streamed experts)
- Laguna-S 2.1 oQ4e (target-only AR)

The models do not share one execution mode. The UI must identify the exact
checkpoint, quantization, speculative depth, and capture provenance and must not
present the five traces as an apples-to-apples speed ranking.

## Product shape

This is a small, localhost-first Express application rather than a static page
with a browser directory picker.

```text
configured trace directory
          |
          v
  Express trace registry ---- GET /api/traces
          |                         |
          |                         v
          +---- selected JSONL --> trace toggle rail
                                    |
                                    v
                           one detailed workbench
```

The server reads but never mutates the trace directory. The browser initially
loads only the registry. It fetches and parses a JSONL file when that trace is
selected, aborting a prior in-flight load when the user switches quickly.

## Runtime and dependency contract

- Node.js 18 or newer. The development machine is currently Node 20.20.2.
- Express 5.2.1 is the sole production dependency, locked by
  `package-lock.json`. Express 5 officially requires Node 18 or newer.
- JavaScript ES modules; no TypeScript, bundler, framework, database, upload
  middleware, or client dependency.
- Node's built-in test runner supplies server and pure-function tests, so there
  are no test-only packages.
- `npm start -- --trace-dir /absolute/or/relative/path` starts the app. The
  `TRACE_DIR` environment variable is the secondary configuration route and
  `./traces/showcase` is the checked-in default.
- The server binds to `127.0.0.1` by default. A non-loopback bind must be an
  explicit `HOST` setting.

## Trace folder contract

The registry recursively discovers `.jsonl` and `.ndjson` files. Dotfiles are
ignored. It returns a stable opaque ID, relative filename, byte size, modified
time, and optional metadata. The opaque ID indexes a server-owned registry
entry; request parameters are never joined into filesystem paths.

An optional `traces.json` at the directory root provides display metadata:

```json
{
  "schema_version": 1,
  "traces": {
    "hy3-oq2e.jsonl": {
      "label": "Hy3 2-bit",
      "model": "Hy3",
      "checkpoint": "mlx-community/Hy3-oQ2e",
      "quantization": "oQ2e",
      "mode": "MTP K3",
      "capture": "representative decode window",
      "source_sha256": "..."
    }
  }
}
```

Manifest entries enrich files but do not hardcode the UI to five models. Any
new census file placed in the configured directory appears after a registry
refresh. A filename remains a usable label when no manifest entry exists.

Raw full-run captures remain evidence artifacts outside this repository when
they are too large for a public web repo. The default showcase folder contains
small, deterministic windows curated from those real captures. Each manifest
entry records the raw source hash and marks the data as a curated window; the UI
must never display it as a complete run.

## HTTP surface

- `GET /api/health` returns the app and registry status.
- `GET /api/traces` rescans the configured directory and returns the registry.
- `GET /api/traces/:id` streams the selected JSONL with `no-store` caching.
- `GET /` and static assets serve the workbench.

Unknown IDs return 404. An unreadable directory or malformed manifest produces
a structured error without crashing the process. The trace endpoint serves only
files present in the most recent registry and verifies that the real path is
still under the configured root before opening it. Symlinks that resolve outside
the root are excluded.

## Ingestion and scale

The parser accepts both the public profiler schema and the visualizer's legacy
aliases:

| Meaning | Public profiler | Legacy alias |
| --- | --- | --- |
| row type | `record` | inferred from fields / `kind` |
| command buffer | `command_buffer_index` | `cb_index` |
| setBytes calls | `setBytes_calls` | `set_bytes_calls` |
| setBytes bytes | `setBytes_total_bytes` | `set_bytes_total` |
| wait class | `bucket` | `cause` |
| wait duration | `wait_ns` | `duration_ns` |

One module worker owns trace fetch, incremental parsing, normalization, and
interval analysis, so an 80 MB capture cannot freeze interaction for one long
main-thread task. It reports byte, row, and malformed-row progress to the main
document. Only the selected trace is required in memory; a size-budgeted
least-recently-used cache retains at most two traces and never more than 128 MB
of source data. Oversized traces are not cached.

Rendering changes with density. At overview scale, dispatches are binned by
horizontal pixel and rendered as density rather than iterating hundreds of
thousands of individual marks on every frame. Zooming crosses into individual
dispatch marks and hit-testing only when they are visually separable. Before
crossing the worker boundary, very large windows are deterministically bounded
for Canvas interaction; exact full-window metrics and census tables remain
unchanged. The renderer persistently states displayed and total event counts
whenever this sampling mode is active.

Schema v1 records dispatch order and command-buffer ownership but no per-op
timestamp. Dispatch marks are therefore distributed in sequence order across
their parent command buffer's encode interval and are explicitly labeled
"ordered placement" rather than presented as measured per-op timing.

Launch windows are split at large timestamp discontinuities using a documented,
data-derived gap threshold. Decision-sync waits remain cycle markers inside a
launch rather than being misclassified as separate launches.

## Visual system and interaction

The interface should feel like a precision instrument, not a generic dashboard:

- dark-first deep-ink canvas with a restrained light theme;
- electric cyan for GPU execution and host time hidden under the GPU;
- coral for exposed host time;
- amber for decision drains and cap waits;
- line pattern and labels in addition to color for wait categories;
- system sans-serif for navigation and explanation, SF Mono/monospace for
  timings and kernel names;
- subtle timing grid, crisp one-pixel rules, restrained radii, and no ornamental
  gradients or gratuitous motion.

The header contains the trace-directory identity, refresh action, and theme
control. A horizontally scrollable trace rail shows every discovered file as a
toggle with model, mode, and completeness badges. Selection is reflected in
`?trace=<id>` so refresh and copied local URLs preserve it.

The selected-trace workbench contains:

1. A provenance strip with exact file, model, quantization, mode, raw/curated
   status, file size, and row health.
2. A launch-window selector when one file contains timestamp-separated runs;
   the selected launch is never visually spliced together with another run.
3. A compact decomposition row: wall span, exposed host, hidden host, GPU busy,
   decision drain, cap wait, dependency wait, command buffers, and dispatches.
4. The main synchronized timeline with host encode, GPU execution, waits, sync
   curtains, and dispatch density/marks.
5. A pinned inspector for command-buffer and kernel details.
6. Kernel census and wait-taxonomy tables beneath the timeline.

Host encode intervals are split exactly against the union of GPU intervals.
The uncovered pieces are exposed host; intersecting pieces are hidden host. The
visualizer reports both per command buffer and for the selected window. It does
not infer tensor critical-path consumption because the current profiler schema
does not carry tensor producer/consumer identities.

Mouse wheel zooms around the pointer, drag pans, double-click fits, and keyboard
controls cover trace selection, zoom, pan, fit, and inspector movement. Canvas
content has a useful accessible summary and all key aggregates remain available
as semantic HTML. Motion respects `prefers-reduced-motion`.

### Renderer contract

The renderer is an analytical view, not a decorative summary. Its first screen
at 1440px must show the trace rail, provenance, headline decomposition, complete
timeline, and the beginning of the census tables without hiding the chart below
a tall hero. Use one continuous instrument surface; do not turn every metric or
lane into an unrelated rounded card.

The desktop workbench uses a fluid main column and a 304px inspector column.
The trace rail is 76px tall, the metric band is 96px, and the timeline plot is
between 360px and 440px tall. Below 980px the inspector moves under the plot;
below 760px the metric band becomes two columns, trace toggles remain
horizontally scrollable, and the Canvas retains a minimum 720px internal width
inside an accessible horizontal scroller rather than crushing labels.

Canvas lane geometry is fixed and named:

| Lane | Height | Contents |
| --- | ---: | --- |
| ruler | 28px | absolute offset ticks and selected-window duration |
| host encode | 68px | exposed and hidden encode fragments, grouped by CB |
| GPU execute | 68px | GPU intervals and overlap depth |
| waits | 46px | decision curtains, cap markers, dependency markers |
| dispatch order | 72px | density bins or ordered per-op marks |
| footer | 24px | zoom scale and ordered-placement disclosure |

Draw in this order: background, timing grid, launch/cycle boundaries, wait
curtains, host fragments, GPU spans, dispatch density/marks, selected item,
crosshair, labels. The timing grid and labels never cover selected marks. A
vertical crosshair spans every lane so one time position can be read across the
coupled pipeline.

Use these dark-theme semantic anchors, adjusting only enough to meet contrast:

- canvas `#071116`, panel `#0b181e`, raised `#10232b`, rule `#213942`;
- primary text `#edf7f8`, secondary text `#91aab2`;
- GPU `#48d7ff`, exposed host `#ff756d`, decision/cap wait `#ffc857`;
- dependency wait `#b49cff`, selection `#f5fbff`.

Hidden host uses a cyan diagonal hatch on the host lane; GPU is a solid cyan
bar, so the two remain distinguishable without hue. Cap waits are triangles,
decision syncs are full-height double rules with a translucent curtain, and
dependencies are diamond markers with dashed stems. In light mode use darker
semantic equivalents rather than lowering opacity until the marks disappear.

At fit scale, dispatch bins encode count by height and intensity while retaining
the dominant kernel family as a short label only where space permits. At
individual scale, every op mark is placed by sequence fraction inside its CB,
never portrayed as a measured timestamp. The footer and tooltip must say
"ordered placement". A zero-op CB stays visible as a hairline if it carries a
GPU interval or wait boundary.

Hover shows a compact non-modal tooltip; click or Enter pins the same item in the
inspector. The inspector always identifies whether a value is measured,
derived, interpolated, or metadata. Selecting a CB highlights its host fragment,
GPU span, and dispatch range together. Selecting a dispatch highlights its
parent CB. Escape clears selection. Tooltips remain inside the viewport and do
not intercept pointer events.

Loading uses the real plot skeleton and a determinate byte/row readout, not a
spinning blank card. Empty and error states preserve lane labels and explain
what is missing. Incomplete or legacy evidence adds a persistent striped badge
beside provenance and never recolors the trace as if it were valid.

When a worker-bounded timeline sample is active, place a persistent,
non-color-only disclosure immediately below the plot. It must enumerate
displayed and total dispatch, command-buffer, and wait counts and state that the
headline metrics and tables use the exact full window.

## States and failure behavior

- **Empty directory:** explain the accepted file types and show an honest empty
  chart state; never substitute sample data for an empty configured folder.
- **Loading:** preserve layout, show filename, streamed bytes, and parsed rows.
- **Malformed rows:** render valid data with a visible degraded-data badge.
- **Unsupported file:** keep the file in the toggle rail and show a diagnostic;
  never silently replace it with sample data.
- **Incomplete profiler summary or dropped rows:** mark the trace invalid for
  evidence and keep it inspectable.
- **Rapid toggle:** cancel the previous fetch and make only the latest selection
  authoritative.
- **Server restart or missing file:** refresh the registry and select the nearest
  remaining trace.

## Capture and curation contract

Each requested model receives a short native-mode decode capture using the
public `mlx-profiler` build, never a synthetic substitute. Census instrumentation
is enabled only in an offline guarded diagnostic process. It stays disarmed in
serving.

| Toggle label | Exact lane | Native mode shown |
| --- | --- | --- |
| Hy3 2-bit | `hy3-expert-oq2e` streamed artifact | champion MTP K2 route |
| Qwen3.6 27B | installed Optimized-Speed checkpoint | native MTP K3 route |
| Qwen3.6 35B | installed 35B-A3B Optimized-Speed checkpoint | existing authentic K1 census |
| GLM-5.2 1.58-bit | `glm52-q1t` t158 158 GiB bank | native depth-3 route |
| Laguna-S 2.1 | exact `mlx-community/Laguna-S-2.1-oQ4e` pin | target-only AR K1 |

Every GPU run follows the workspace's exclusive-lane protocol. GLM uses only
the established `f-nocache` path; buffered execution is forbidden. Curated
windows retain all command buffers, ops, and waits needed for referential
integrity, carry source hashes, and are checked for malformed or dropped rows.

## Verification gates

- Unit tests cover registry discovery, manifest merging, path containment,
  symlink exclusion, stable IDs, schema normalization, interval subtraction,
  wait taxonomy, and rapid-selection cancellation state.
- API tests use temporary trace directories and real HTTP requests.
- The app starts on Node 20 and each endpoint passes a smoke test.
- `npm audit --omit=dev` reports no known production vulnerability.
- The five showcase toggles all load authentic curated traces and show their
  distinct metadata.
- A large real census loads without a browser long-task failure and renders in
  density mode at fit scale.
- Browser inspection covers desktop, narrow viewport, dark/light themes,
  keyboard operation, reduced motion, empty/loading/error states, and readable
  contrast.
- No visualizer or profiler changes are pushed without explicit user approval.
