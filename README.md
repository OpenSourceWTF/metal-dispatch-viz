# Metal Dispatch Workbench

A local, read-only workbench for understanding host encode, Metal GPU execution,
waits, and dispatch density in profiler JSONL. It is designed for the practical
question that aggregate kernel timings miss: where did host work, GPU work, and
synchronization overlap within one launch?

The server serves files and registry metadata only. It does not capture,
instrument, modify, or upload traces.

## Requirements and installation

The supported Node.js engine lines are exactly:

- Node 20 from `20.19.0` onward;
- Node 22 from `22.13.0` onward;
- Node 24 or newer.

This is the package engine expression
`^20.19.0 || ^22.13.0 || >=24.0.0`. Install the locked dependency graph with:

```sh
npm ci
```

## React development, build, and start

For React component work with Vite hot reload:

```sh
npm exec -- vite --host 127.0.0.1 --port 5173
```

Open `http://127.0.0.1:5173/`. This is the source development server; it does
not provide the folder-driven Express trace API. Use the production runtime
below when exercising real traces and complete application behavior.

Build the relocatable React client and hosted artifact with:

```sh
npm run build
```

Vite first emits a clean staging client. The hosted builder then atomically
publishes `dist/client`, the generated browser registry, the five public
showcase traces, and the separate hosting artifacts.

Start the built React application through Express with:

```sh
npm start -- --trace-dir /path/to/trace-folder
```

`npm start` runs the authoritative build before starting the server. Open
`http://127.0.0.1:4173/`. Without `--trace-dir`, Express reads
`traces/showcase`.

## Bundled showcase

The default folder contains curated, referentially closed windows from five
authentic profiler captures:

- Hy3 2q — oQ2e, MTP K2
- Qwen3.6 27B — Optimized Speed, MTP K3
- Qwen3.6 35B — A3B, MTP K1
- GLM-5.2 1.58q — q1t/t158, MTP K3
- Laguna 2.1 S — oQ4e, target-only AR

The multi-run selector remains folder-driven: add another `.jsonl` or
`.ndjson` file and press Refresh to expose it in the trace rail. The four
2026-07-23 captures have current terminal summaries. The Qwen3.6 35B window
comes from an authentic older census whose raw summary predates the completeness
fields, so its manifest preserves that source as legacy/unverifiable rather
than upgrading it by assertion.

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

## Optional local folder manifest

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
server-generated opaque ID. All metadata fields are optional. In the Express
runtime this manifest enriches folder discovery; it is not an allowlist, and
unlisted supported trace files remain discoverable.

## Published showcase

Public static publication is intentionally stricter. The
[showcase manifest](traces/showcase/traces.json) is the publication allowlist
and trust anchor. `npm run build` requires its paths to exactly match the
supported trace files discovered under `traces/showcase`, copies only those
registered files into `dist/client/traces/showcase`, and writes the generated
browser registry to `dist/client/hosted-traces.json`. Missing, malformed,
symlinked, unlisted, or mismatched inputs fail the build.

To add or replace a public run:

1. Put the curated `.jsonl` or `.ndjson` file under `traces/showcase/`.
2. Add its exact relative POSIX path and display metadata to
   `traces/showcase/traces.json`.
3. Run `npm test`.
4. Run `npm run build`.
5. Run `npm run verify:pages`.
6. Inspect `dist/client/hosted-traces.json` and load the run through
   `npm start`.

The verifier proves that the source manifest, generated registry, and emitted
trace set are equal, and that the React entrypoint references relative,
content-hashed JavaScript, CSS, and worker bundles.

## Workbench controls

- Search runs from the top Run dropdown by label, path, model, mode,
  checkpoint, quantization, or capture metadata. Arrow keys move through
  matches and Enter loads the highlighted run.
- Choose a launch when a file contains more than one launch window. The
  selector is hidden for a single launch.
- Use the timeline buttons, mouse wheel, or keyboard: arrows pan,
  `+`/`-` zoom, `0` fits, `[` and `]` move to the previous and next timeline
  mark, Enter pins the active mark, and Escape clears.
- Drag to zoom into a horizontal timeline range. Shift-drag to pan without
  changing the current zoom.
- Select a command buffer, dispatch, density bin, or wait to populate the
  linked inspector.
- Switch between the Kernel families and Wait taxonomy tabs below the timeline.
  Every column heading sorts its table ascending or descending.
- Refresh rescans the folder while preserving the current opaque trace ID when
  it still exists. Theme follows the saved preference, then the system
  preference.
- Share the current view with `?trace=<opaque-id>&window=<index>`; unrelated
  query parameters are preserved.

### Preserved UI behavior

The React conversion preserves the existing interaction and state contracts:

- **View** and **Analyze** remain an explicit toggle. The range band, start and
  end handles, readouts, keyboard controls, zoom, and **Fit** continue to drive
  the selected time window. View changes the viewport; Analyze recomputes exact
  selected-range aggregates in the worker.
- The folder-driven trace rail remains the multi-run selector, and the launch
  selector remains available for traces with multiple launch windows.
- Selecting a timeline mark populates and pins the inspector. Enter pins the
  active mark; Escape or the inspector's **Clear** button clears it. Pins
  survive ordinary loading and range transitions and clear only when the
  selected evidence is genuinely invalidated.
- Trace status uses the precise terms **Not loaded** before analysis and
  **Capture complete** only for validated complete evidence. It does not revive
  the ambiguous old **Complete** or **Evidence: Pending** labels.
- **Legacy source**, **Source degraded**, **No summary**, **Legacy**,
  **Unsupported**, **Incomplete**, **Dropped rows**, and **Degraded** describe
  evidence limitations rather than application failures. A usable legacy or
  partial trace can still render while its caveats remain visible.
- URL state restores the trace, launch, View/Analyze mode, and selected range
  from `trace`, `window`, `range`, `from`, and `to`. Invalid range state falls
  back to View over the complete launch, and unrelated query parameters remain
  intact.

### Time-window control

The overview strip always represents the complete selected launch. It is a
navigation summary, not a measurement-resolution event plot.

- Drag the selection band to pan it, drag either handle to resize it, or click
  outside the band to recenter the same-duration selection.
- **View** changes the timeline viewport while the headline metrics and tables
  remain labeled **Launch totals**.
- **Analyze** recomputes **Selected range** metrics and tables from the full
  worker-side trace. It never calculates from the bounded Canvas sample.
- Wheel zoom and timeline drag update the same selection band. **Fit** or a
  timeline double-click restores the complete launch.
- Focus either range handle and use Arrow keys for 1% steps,
  Shift+Arrow for 10%, Home for the launch start, and End for the launch end.

Analyze is disabled as **Preparing exact analysis** until the trace worker is
ready. It reads **Analyze unavailable** when the launch lacks the timing needed
for exact range analysis or worker setup fails. While a range is being analyzed,
the metrics and tables are marked busy. A range-analysis error is shown in the
status line, returns the workbench to View, and restores launch totals; no sample
data is substituted.

The URL stores `trace=<opaque-id>`, the zero-based `window=<index>`,
`range=view|analyze`, and `from`/`to` as integer nanosecond offsets from the
launch start. Invalid range parameters restore View over the complete launch.
Unrelated query parameters are preserved.

The Canvas can use a deterministic compact sample for a large launch or selected
range. When it does, the note below the timeline gives displayed and total
record counts; headline metrics, kernel census, and wait taxonomy still use the
exact full launch in View or the exact selected range in Analyze.

Schema-v1 dispatch membership uses ordered placement within each command buffer,
not measured per-operation timestamps. Analyze discloses dispatches without an
ordered placement and waits without an anchor; those records are excluded from
selected-range aggregates. The schema also lacks tensor producer/consumer
identity, so a selected range does not establish an output critical path.

## Contextual help and Field manual

Specialized measurements and profiler terms have contextual definitions
available from their adjacent info controls. Hover or focus for a quick
definition, or activate the control to pin it and continue to the full entry.
The **Field manual** in the header includes a quick start, timeline guidance,
measurement methods and limitations, a searchable glossary, evidence cautions,
and keyboard shortcuts. Opening it from a definition focuses that term; opening
it from the header starts at Quick start.

## Export the visible timeline

Choose **Export for AI** above the timeline to capture its current visible
timeline scope. Refresh snapshot after panning or zooming when you want to
regenerate it. On narrow screens, this means the horizontally visible scroller
subsection, not the full timeline hidden beyond the scroller. Two local-only
formats are available:

- **Prompt + data (`.md`)** packages analysis instructions with one fenced JSON
  payload. Copy it and paste it into the chat or analysis tool you choose.
- **Structured data (`.json`)** downloads the same versioned payload without
  prompt prose for scripts or other tooling.

Copy and download happen only after an explicit action in the browser. The
workbench does not call a model or upload the export. The payload includes
selected-launch measurements, the viewport bounds, intersecting command
buffers, aggregate visible placed-dispatch counts, kernel-family totals with
ordered-placement provenance, anchored waits, evidence health, and limitations.
Individual dispatch records and positions are not exported.

When timeline collections are sampled for display, the export labels them as
displayed sample records. Exact viewport totals may be unavailable and appear
as `null`; they are never inferred from the sample. Selected-launch headline
aggregates remain exact.

Intervals that cross a viewport boundary retain their original endpoints and
add clipped visible endpoints. The dispatch aggregates retain ordered placement
rather than measured-timestamp provenance. Unplaced dispatches and unanchored
waits are disclosed but cannot be assigned to the visible range. Treat the
export as evidence for investigation, not an automatic optimization or
critical-path result; schema v1 cannot identify tensor dependencies.

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

## GitHub Pages

The
[Pages workflow](.github/workflows/deploy-pages.yml) owns the independent
static release. A push to `main` or a manual `workflow_dispatch` runs the
locked install, complete test suite, React build, full dependency audit, Pages
configuration, and final artifact verification. The verified `dist/client`
snapshot is uploaded immediately after that final verifier; the deploy job then
uses the `github-pages` environment with Pages and OIDC permissions.

Only `dist/client` is uploaded. The Express server, Sites worker, hosting
metadata, source traces outside the allowlisted showcase, and repository
sources are not part of the Pages artifact. The build job has read-only
repository permission, the deploy job is restricted to `main`, and concurrent
deployments use the non-cancelling `pages` group.

The intended canonical origin is
`https://mlx-profiler.opensource.wtf`. Configure that hostname in the
repository's GitHub Pages settings before adding a DNS-only CNAME to
`opensourcewtf.github.io`. The workflow does not commit or require a `CNAME`
file.

## Validation

Run these commands from the repository root:

```sh
npm ci
npm test
npm run build
npm run verify:pages
npm audit
if rg -n -i '\b(TODO|FIXME|stub)\b|not implemented|coming soon' \
  src public server scripts index.html; then
  exit 1
fi
```

The test command runs both the Node integration suite and Vitest React suite.
The build and verifier must each report five traces, the audit must report no
known vulnerabilities, and the final scan must find no implementation stubs.

## License

MIT
