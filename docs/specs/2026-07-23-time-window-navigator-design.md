# Time-window navigator design

**Date:** 2026-07-23

**Status:** Approved and implemented; real-browser release gate pending

## Objective

Add a visible time-window control to the selected launch so a user can drag and
resize a range instead of relying only on wheel zoom and timeline panning.

The same selected range supports two explicit modes:

- **View** changes only the main timeline viewport. Headline metrics, kernel
  census, and wait taxonomy remain the complete selected-launch totals.
- **Analyze** changes the viewport and recomputes those metrics and tables for
  the exact selected range from the full trace held by the analysis worker. A
  confirmed result also supplies a range-focused compact event set to the
  Canvas while the complete launch remains its legal navigation bound.

The distinction must remain visible at all times. The application must never
present calculations over the bounded Canvas sample as exact range analysis.

## Scope

This round includes:

- a full-launch overview strip directly below the main timeline;
- a draggable selection band with independently resizable start and end
  handles;
- a View/Analyze segmented toggle;
- exact worker-side range aggregation in Analyze mode;
- range state in the URL;
- pointer and keyboard operation, responsive behavior, and screen-reader
  readouts;
- stale-result, worker-failure, and invalid-range handling.

## Non-goals

- Attaching to, tailing, or controlling a live GPU process.
- Comparing or overlaying ranges from multiple trace files or launches.
- Selecting a range across two launch windows.
- Partitioning a launch into adjacent statistical buckets.
- Inferring true per-dispatch timestamps, tensor dependencies, or output
  criticality that census schema v1 does not record.
- Adding a server range endpoint, rereading the trace on every drag, or changing
  the Express trace-folder contract.
- Changing the public profiler or census JSONL schema.

## Interaction design

The overview is a compact, full-launch strip aligned with the timeline's time
axis. It shows derived host activity, GPU activity, dispatch density, and wait
markers at a fixed overview resolution. A high-contrast selection band sits
over it:

- dragging the band pans the selected range without changing its duration;
- dragging either handle changes the range start or end;
- clicking outside the band recenters the current range at that position;
- wheel zoom and drag pan on the main timeline update the band in both modes;
- **Fit** resets the range to the complete selected launch;
- changing trace or launch resets to that launch's complete range unless a
  valid range for that exact trace and launch is present in the URL.

The band updates immediately during pointer movement. Range URL state is
committed on pointer release or keyboard input, not on every pointer event.

The View/Analyze toggle sits beside start, end, and duration readouts:

- In **View**, the metric heading says **Launch totals**. The selected band is a
  viewport control only.
- In **Analyze**, the metric heading says **Selected range**. Metrics, kernel
  census, wait taxonomy, and the Canvas dataset use the confirmed exact range
  result.
- Switching from View to Analyze requests the currently visible range.
- Switching from Analyze to View immediately restores the launch-level
  aggregates without changing the viewport.

While an Analyze request is running, the range readout says
`Analyzing <start> – <end>`. The last confirmed range result remains visible but
is marked busy and visually muted. No approximate replacement is shown.

Changing the Analyze range clears a pinned inspector item when the confirmed
range result replaces the active Canvas scope. View-only navigation preserves
the pin even if the item moves off screen.

## Visual and accessibility contract

The navigator extends the existing precision-instrument visual system rather
than introducing another dashboard card:

- overview height is 58px on desktop and 52px on narrow layouts;
- exposed host uses coral, hidden host and GPU use their existing distinct cyan
  treatments, and waits retain their existing class shapes and colors;
- the selected interval has a translucent fill, crisp vertical edges, and
  visible handle grips; the unselected regions are dimmed;
- overview bins are explicitly described as a navigation summary and never as
  measurement-resolution events.

The two handles are focusable sliders with `aria-valuemin`, `aria-valuemax`,
`aria-valuenow`, and formatted `aria-valuetext`. Arrow keys move the focused
edge by one percent of the launch span, Shift+Arrow moves by ten percent, Home
moves to the launch start, and End moves to the launch end. The handles cannot
cross. The minimum selectable duration is the larger of one nanosecond and one
overview pixel at the current strip width.

The overview Canvas has an accessible text summary. The mode toggle is a real
two-button segmented control with `aria-pressed`; color is not its only state
indicator. All range changes are announced through the existing polite status
region after commit, not continuously during pointer movement.

On narrow screens the readouts may wrap below the strip, but the handles remain
at least 24 CSS pixels wide as pointer targets and the timeline retains its
existing horizontal-scroll behavior.

## Architecture and data flow

```text
selected trace
      |
      v
persistent module worker
  - fetch and parse once
  - build exact full dataset
  - retain exact launch scopes
  - build fixed-resolution overview bins
      |
      +--> compact launch dataset + overview --> main timeline/navigator
      |
      +<-- analyze-range request
      |
      +--> compact range dataset + exact aggregates
```

The current one-shot dataset worker becomes a selected-trace analysis session.
It stays alive until the user selects another trace, the trace is refreshed, or
the page is destroyed. At most one exact trace dataset is retained by a live
worker.

The existing compact-dataset cache remains useful for immediate View-mode
rendering after revisiting a trace. A cached compact result is not sufficient
for Analyze mode. When a cached trace is selected, a fresh worker session
hydrates the exact source in the background; Analyze is disabled and labeled
`Preparing exact analysis` until that session is ready.

No new Express route is needed. The worker continues to fetch the selected
`/api/traces/:id` stream once per analysis session.

### Main-thread components

- `TimelineRenderer` remains the owner of the main viewport. It gains a public
  viewport setter and an explicit navigation-bounds option. The viewport clamps
  to the selected launch even when the current event dataset represents a
  smaller confirmed Analyze range, and emits the same viewport-change callback
  used by wheel, pan, zoom, and fit.
- A separate `RangeNavigator` owns overview drawing, band geometry, handle
  pointer capture, and keyboard interaction. It emits committed and transient
  range changes without knowing how metrics are calculated.
- An analysis-session controller owns worker lifecycle, request IDs, trace
  generation, and cancellation. UI code receives only authoritative results.
- Application state records the launch scope, selected range, confirmed
  analysis range, range mode, and active worker readiness.

### Worker-derived overview

The worker produces 512 bins per launch. Each bin contains:

- host encode coverage in nanoseconds;
- GPU busy coverage in nanoseconds;
- dispatch count using ordered placement;
- wait count and present wait classes.

These bins are exact aggregates of the full worker-side launch dataset at the
overview resolution. They are used only to draw the navigator. Resizing the
browser does not cause the trace to be rebinned.

## Range-analysis contract

The worker exposes a pure range builder with this conceptual interface:

```js
buildRangeScope(launchScope, { startNs, endNs }) -> rangeScope
```

Input must be finite, non-collapsed, and confined to one launch. The worker
clamps a slightly out-of-bounds request to that launch; a still-collapsed range
is rejected.

The selection is inclusive for point records so a complete-launch selection
includes a dispatch or wait placed exactly at the launch end. Interval
durations are calculated from normal positive-length interval intersection, so
inclusion of an endpoint adds no duration.

The exact range scope uses these rules:

- host hidden and exposed fragments are intersected with the selected range,
  then summed;
- each command-buffer GPU interval is intersected with the range;
- GPU busy is the union duration of those clipped GPU intervals;
- GPU work is the sum of clipped per-command-buffer GPU intervals;
- a command buffer is counted when its encode or GPU interval intersects the
  range;
- a dispatch is counted when its ordered `atNs` placement is inside the range;
- a wait is counted when its measured or documented fallback anchor is inside
  the range; its complete recorded duration is attributed because schema v1
  does not record wait start and end timestamps;
- the kernel census and wait taxonomy are rebuilt only from those selected
  dispatches and waits;
- wall span is the selected range duration, including when the range contains
  no events.

Dispatches without an ordered placement and waits without an anchor cannot be
assigned to a time range. Analyze mode excludes them and displays an omission
note with exact counts when either exists. The existing provenance labels
continue to distinguish measured intervals, derived overlap, fallback anchors,
and ordered dispatch placement.

The range result is compacted only after its exact summary and tables are
computed. If its event arrays exceed Canvas limits, the existing sampling
disclosure remains visible and explicitly says that range metrics and tables
are exact.

During an uncommitted drag or a pending Analyze request, the Canvas uses the
compact complete-launch event set so newly exposed time does not appear empty
merely because the previous exact result covered another range. When the newest
range result is confirmed, its range-focused compact event set replaces that
temporary view. In both cases, renderer navigation bounds remain the complete
launch and the viewport remains the selected band.

## Worker protocol

Every message carries a trace generation. Range messages also carry a monotonic
request ID.

```text
main -> worker  { type: "load", generation, url }
worker -> main  { type: "progress", generation, progress }
worker -> main  { type: "ready", generation, dataset, diagnostics }

main -> worker  {
  type: "analyze-range",
  generation,
  requestId,
  launchIndex,
  startNs,
  endNs
}
worker -> main  {
  type: "range-result",
  generation,
  requestId,
  launchIndex,
  range,
  dataset
}
```

Only a result matching the current trace generation, launch index, and newest
request ID may update the UI. Dragging in Analyze mode is debounced by 100ms;
pointer release and keyboard commits issue an immediate final request. A new
request does not cancel synchronous range arithmetic already executing in the
worker, but stale results are discarded.

Terminating the worker is the cancellation mechanism for trace switches and
page teardown. Worker errors are serialized through the existing structured
error shape.

## URL contract

The existing `trace` and `window` parameters remain unchanged. Range state adds:

```text
range=view|analyze
from=<integer nanoseconds from selected-launch start>
to=<integer nanoseconds from selected-launch start>
```

Offsets keep URLs stable when a trace uses a large monotonic-clock origin.
Missing parameters select View mode and the complete launch. Invalid,
non-finite, reversed, or collapsed offsets are ignored. Out-of-bounds offsets
are clamped to the selected launch. Changing trace or launch removes stale
range offsets before applying the new selection.

History updates use `replaceState`, matching current trace and launch
selection. Loading an old URL without range parameters preserves current
behavior.

## Error handling

- If exact-session hydration fails while cached View data is available, View
  remains usable, Analyze stays disabled, and the error states that exact range
  analysis is unavailable.
- If an Analyze request fails, the toggle returns to View, the launch totals are
  restored, and the failure is announced. Sampled client data is never used as
  a fallback calculation.
- If the active trace disappears, existing registry rescan behavior terminates
  the worker and clears its range state.
- An empty selected range is prevented by handle clamping and rejected again at
  the worker boundary.
- A launch change invalidates the latest request ID before resetting the range;
  every result is also checked against the current launch index.

## Failure-mode check

1. **A slow earlier request overwrites a later drag result.** This would make
   the metrics disagree with the visible band and is critical. Trace
   generations plus monotonic request IDs make only the newest matching result
   authoritative.
2. **A revisited trace renders from the compact cache and silently analyzes the
   sample.** This would invalidate the profiler arithmetic and is critical.
   Analyze stays disabled until a new exact worker session reports ready; there
   is no client-side sampled fallback.
3. **Schema-v1 placement is mistaken for measured per-dispatch timing.** This is
   a material interpretation risk. Analyze uses ordered placement only for
   dispatch membership, retains the `ordered placement` disclosure, and reports
   unplaceable rows instead of inventing timestamps.

Ranges spanning launches and adjacent statistical partitioning are minor
limitations for this single-range interface and are documented as non-goals.

## Testing strategy

Pure data tests cover:

- host, GPU, and merged-union clipping at both range boundaries;
- inclusive dispatch and wait membership at launch start and end;
- command-buffer intersection and counts;
- exact full-launch range parity with existing launch aggregates;
- empty-event ranges, unplaceable-row omissions, and invalid inputs;
- overview-bin totals and fixed-resolution output.

Worker and controller tests cover:

- load/ready/range protocol messages;
- generation and request-ID stale-result rejection;
- worker termination on trace switch and page teardown;
- cached View rendering while exact analysis hydrates;
- Analyze failure restoring View without sampled arithmetic;
- drag debounce and immediate final request.

Navigator tests cover:

- time/pixel conversion, minimum width, edge clamping, pan, and resize;
- main-timeline viewport synchronization in both directions;
- pointer capture cancellation;
- handle keyboard increments and accessible attributes;
- View/Analyze state and URL parsing/serialization.

Application integration and UI-contract tests cover:

- Launch totals versus Selected range labels;
- Analyze busy and unavailable states;
- trace/launch reset behavior;
- fit, wheel, pan, overview drag, and mode-toggle coordination;
- omission and Canvas-sampling disclosures.

Verification runs the complete Node suite and production dependency audit.
Manual browser checks cover desktop and narrow layouts, dark and light themes,
pointer and keyboard use, cached trace revisits, rapid drags, rapid trace
switches, and one large authentic census trace.

## Rollout

The feature is additive and requires no data migration. Existing trace URLs and
showcase files continue to work. View is the default so loading and reading a
trace behaves as it does today until the user chooses Analyze.

The change ships only in `metal-dispatch-viz`; the public `mlx-profiler`,
serving paths, capture behavior, and census schema remain untouched.
