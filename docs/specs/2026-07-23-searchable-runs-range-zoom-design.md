# Searchable runs and timeline range zoom design

Date: 2026-07-23

## Purpose

Trace folders can contain enough runs that the current horizontal button rail
stops scaling. Run selection must remain compact and searchable. Timeline
navigation must also support selecting a precise horizontal span and zooming
directly into it without removing pan, wheel, keyboard, inspection, or visible
AI-export behavior.

## Scope

This change:

- replaces the top-level trace button rail with an accessible searchable
  combobox;
- preserves selected-run model, mode, and evidence status in a compact summary;
- makes an unmodified horizontal drag select and zoom to a time range;
- moves pointer panning to Shift-drag;
- updates embedded help and README instructions;
- adds targeted tests for search, keyboard selection, range zoom, cancellation,
  minimum-span clamping, and retained pan behavior.

It does not add server-side search, saved filters, multi-run comparison,
vertical timeline zoom, or changes to trace discovery and analysis.

## Visual direction

The existing compact technical instrument system remains authoritative. The
selector uses square-edged controls, etched rules, monospaced metadata, signal
cyan focus and selection, and the existing semantic evidence colors. It occupies
one bounded row rather than growing with the registry.

The timeline range appears as a translucent signal-cyan band with clear start
and end rules. It is an analytical overlay, not decorative motion. No new
framework, icon set, or design tokens are required.

## Searchable run selector

The control is an editable combobox with an attached listbox:

- Its visible label is `Run`.
- Opening it without a query lists all runs in registry order.
- Search is case-insensitive and matches display label, filename or relative
  path, model, mode, checkpoint, quantization, and capture metadata.
- Results show the display label as the primary line and model, mode, and
  evidence as compact secondary data.
- Arrow Up and Arrow Down move the active option, Enter loads it, Escape closes
  the list without changing the selected run, and Tab follows normal focus
  order.
- Pointer selection loads the chosen run.
- The selected run remains visible in the input after selection. Reopening and
  typing replaces the display text as a query without loading until selection.
- A no-results state says `No runs match this search.` and leaves the current
  run loaded.
- Refresh preserves the selected opaque trace ID when it still exists and
  reruns the active query against the refreshed registry.

The selected-run summary retains model, mode, and evidence status adjacent to
the combobox. Full file and provenance details remain in the existing
provenance strip.

Filtering is performed locally over registry metadata. Trace contents are not
loaded merely to satisfy search.

## Timeline range zoom

An unmodified primary-pointer drag on the canvas creates a range selection:

1. Pointer down records the anchor in canvas coordinates and captures the
   pointer.
2. Movement beyond a small threshold displays the range band without changing
   the viewport.
3. Pointer up converts the clamped pixel endpoints through the current viewport
   transform and zooms to that time span.
4. The renderer applies its existing viewport bounds and minimum zoom span.

Drags below the movement threshold remain clicks and preserve evidence
inspection. Shift-primary-drag retains the existing continuous horizontal pan.
Pointer cancel or Escape removes an active range without changing the viewport.
The overlay clamps to the canvas even if the pointer leaves its bounds.

Wheel zoom, toolbar zoom, Fit, double-click Fit, arrow-key pan, mark navigation,
and selection remain unchanged. Help copy identifies `Drag to zoom · Shift-drag
to pan`. Touch follows the same range-selection behavior; horizontal page
scrolling remains available through the surrounding timeline scroller.

After a completed zoom, the viewport-change callback fires through the existing
path. Therefore scale text, sampling state, and a newly refreshed AI export all
use the zoomed visible range without a second state model.

## Interfaces and state

Run filtering is a pure function from `(traces, query)` to ordered trace
results. The combobox controller owns only query, open state, and active-option
index; the existing application selection coordinator remains the authority
for loading and race cancellation.

Timeline drag state gains an explicit mode:

- `range` stores pointer ID, anchor point, current point, and moved state;
- `pan` stores pointer ID, anchor point, initial viewport, and moved state.

The renderer exposes no new application-level viewport API. Range completion
sets the same `viewport` field and calls the same notification and render
methods used by wheel and keyboard zoom.

## Error and edge behavior

- Empty registries show the existing honest empty state and a disabled
  combobox.
- Search never starts trace I/O and cannot replace the loaded run without an
  explicit result selection.
- A selected run removed during refresh falls back through the existing
  deterministic refresh-selection policy.
- Non-finite pointer coordinates are normalized by the existing point mapping.
- Reversed drags produce ordered time bounds.
- Tiny or minimum-width ranges do not create invalid viewports.
- Pointer cancellation, Escape, dataset changes, and renderer teardown clear
  transient drag state.

## Testing strategy

Tests are written before production changes.

- Unit coverage verifies normalized multi-field run search with stable ordering.
- UI integration coverage verifies combobox roles, active-option navigation,
  explicit selection, no-results behavior, selected metadata, and refresh
  preservation.
- Timeline coverage verifies the range overlay contract, reversed and clamped
  drags, tiny-drag click behavior, Shift-drag pan, Escape and pointer
  cancellation, and viewport notification.
- UI contract coverage verifies responsive bounded width, visible labels,
  focus treatment, and updated help copy.
- README/package coverage verifies searchable run and drag interaction
  documentation.

Targeted tests run during implementation. The full suite runs once at the
commit gate.

## Failure-mode review

- **Critical: typing could load an unintended run.** The design requires an
  explicit option selection; filtering alone never changes application
  selection.
- **Critical: drag-to-zoom could break evidence clicks or erase panning.** A
  movement threshold preserves clicks, while Shift-drag provides an explicit
  retained pan path.
- **Critical: range zoom could diverge from AI export scope.** The design uses
  the renderer's existing viewport and notification path rather than separate
  range state.
- **Minor: native browser text-edit shortcuts may overlap combobox navigation.**
  Only list-navigation keys are intercepted while the popup is open.
- **Minor: search only covers registry metadata, not trace contents.** Content
  indexing and server-side search are explicit non-goals.

## Rollout

No data migration or server change is required. Existing `trace` and `window`
URLs continue to resolve. The feature can ship as a browser-only replacement
of the trace rail and extension of the renderer's pointer state.
