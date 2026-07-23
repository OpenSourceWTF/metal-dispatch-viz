# Help, terminology, and AI export design

Date: 2026-07-23

## Purpose

Metal Dispatch Workbench is a local profiler data viewer for developers
investigating host encode work, Metal GPU execution, synchronization, and
dispatch density. This change should make unfamiliar terms understandable
without leaving the active trace and should make the visible timeline portable
to an LLM or analysis agent without implying that the workbench itself uploads
data.

The interface should feel technical and high-powered while remaining a basic,
dense data viewer. Clarity, evidence provenance, and fast navigation take
priority over decoration.

## Scope

This change adds:

- contextual definitions for jargon and measurement labels;
- an embedded Field manual;
- an AI export for the current visible timeline range;
- README documentation for all three features;
- targeted automated coverage for the new behavior.

It does not add:

- an LLM API integration or network upload;
- automatic optimization claims;
- tensor dependency or critical-path inference;
- a redesign of the trace ingestion or analysis pipeline;
- user-authored prompt templates or persistent export history.

## Visual direction

The UI is a compact technical instrument with minimal chrome:

- **Carbon** `#071116` — page and canvas base
- **Instrument panel** `#0b181e` — primary surfaces
- **Raised panel** `#10232b` — active and transient surfaces
- **Etched rule** `#28434c` — structural boundaries
- **Signal cyan** `#48d7ff` — GPU and active technical signals
- **Timing amber** `#ffc857` — waits, caution, and derived timing emphasis
- **Paper white** `#edf7f8` — primary text

Existing system sans and monospace stacks remain in use. Headings are compact
and direct; measurements, units, provenance badges, shortcuts, and exported
data use monospace. Controls remain rectangular with small radii. Signal colors
encode meaning and are never used as decoration.

The signature interaction is an evidence definition: every measurement
explanation distinguishes what the value means, how it was obtained, and what
it cannot prove. The same definition source powers contextual help and the
Field manual so the two surfaces cannot drift.

## Information architecture

The header adds a `Field manual` button beside Refresh and Theme. The timeline
toolbar adds an `Export for AI` button beside the viewport controls.

Desktop uses a right-side utility drawer over the workbench. This preserves the
trace context without permanently reducing the timeline or inspector. On
narrow viewports, the drawer becomes a full-height sheet.

Only one utility drawer is open at a time. The drawer has a visible title,
Close control, and stable content region. Escape closes it and focus returns to
the control that opened it. Background content is not keyboard-interactive
while a modal sheet is active.

## Terminology definitions

A centralized glossary defines each supported term with:

- a short plain-language definition;
- an optional measurement method;
- an optional evidence classification;
- an optional limitation or non-claim;
- an optional Field manual section.

Definition triggers appear beside specialized labels without making the label
itself a button. Triggers are reachable by keyboard, have explicit accessible
names, and support pointer hover, focus, click, and touch. Hover and focus show
a compact tooltip. Activating a trigger pins the explanation so it can be read
or followed into the full Field manual entry.

The first implementation covers all specialized terms and measurement headings
visible in the initial shell, dynamically rendered headline metrics, inspector,
kernel census, wait taxonomy, provenance strip, evidence badges, timeline
labels, and export UI. Ordinary interface words such as Refresh, Theme, File,
and Events do not receive definitions.

At minimum, definitions include:

- wall span;
- exposed host;
- hidden host;
- GPU busy;
- GPU work;
- decision drain;
- cap wait;
- dependency wait;
- command buffer;
- dispatch;
- kernel family;
- setBytes call and setBytes bytes;
- buffer bind;
- host encode;
- GPU execute;
- ordered placement;
- dispatch density;
- wait taxonomy;
- scheduler backpressure;
- worker wait;
- measured, derived, ordered, counted, and metadata evidence;
- complete, incomplete, legacy/unverifiable, and unsupported evidence.

## Field manual

The Field manual contains:

1. **Quick start** — select a trace, select a launch, navigate the timeline,
   inspect an item, and export the visible range.
2. **Read the timeline** — ruler, host encode, GPU execute, waits, dispatch
   order, density mode, selection, and viewport controls.
3. **Measurements** — headline metrics with method and limitations.
4. **Glossary** — searchable definitions for all centralized terms.
5. **Evidence limits** — sampling, malformed or unsupported rows, legacy
   anchors, ordered dispatch placement, non-additive waits, and the absence of
   tensor dependency identities.
6. **Keyboard controls** — arrows, zoom keys, Fit, mark navigation, pinning, and
   Escape behavior.

Opening the manual from a tooltip selects and focuses that term. Opening it from
the header begins at Quick start. Search filters glossary entries without
changing the current trace or timeline viewport.

## AI export interaction

`Export for AI` opens the utility drawer with:

- visible-range identity and duration;
- an explicit local-only notice;
- a format selector;
- a read-only preview;
- `Copy export` and `Download` actions;
- completion feedback in a polite live region.

Supported formats:

- **Prompt + data (`.md`)** — a concise analysis request followed by one fenced
  JSON payload.
- **Structured data (`.json`)** — the same versioned payload without prompt
  prose.

The default is Prompt + data because it is immediately useful in a chat or
agent. Export generation is deterministic for the same normalized dataset,
trace metadata, selected launch, and viewport.

No export action sends a request to an external service. Clipboard copy occurs
only after an explicit action. Download creates a local browser file.

## Export contract

The payload has a stable top-level shape:

```json
{
  "export_schema": "metal-dispatch-visible-timeline/v1",
  "generated_at": "ISO-8601 timestamp",
  "source": {},
  "selection": {},
  "evidence_health": {},
  "measurements": [],
  "command_buffers": [],
  "dispatch_summary": {},
  "waits": [],
  "limitations": []
}
```

`source` includes display metadata and opaque trace identity, but never invents
filesystem identity beyond metadata already visible in the workbench.

`selection` includes the selected launch index, full launch bounds, viewport
bounds, and visible duration in nanoseconds.

`measurements` uses explicit values and units and includes evidence provenance.
Headline measurements remain selected-launch measurements and are labeled as
such; they are not silently recomputed as viewport-only values.

`command_buffers` includes every command buffer whose usable host or GPU bounds
intersect the viewport. Each entry retains original measured endpoints and adds
clipped visible endpoints where applicable. This prevents a boundary-crossing
interval from being mistaken for a fully visible interval.

`dispatch_summary` includes the count of placed dispatches in the viewport,
unplaced-count disclosure, density-mode disclosure, and kernel-family counts
for visible placed dispatches. Ordered dispatch positions remain labeled
ordered, not measured.

`waits` includes waits whose anchor falls inside the viewport. Each entry
retains duration, bucket, class, ownership, anchor, and anchor provenance.
Unanchored waits are disclosed but cannot be assigned to the visible range.

`evidence_health` and `limitations` preserve completeness warnings, source
sampling disclosure, non-additive wait cautions, and schema-v1 non-claims.

The Markdown prompt asks an LLM to:

1. identify likely host, GPU, synchronization, or dispatch-density bottlenecks;
2. cite payload fields for every conclusion;
3. distinguish observation from inference;
4. assign confidence;
5. recommend prioritized experiments and expected confirming measurements;
6. avoid tensor dependency or critical-path claims unsupported by schema v1.

## State and data flow

The timeline renderer already owns the current viewport and indexed visible
dispatches, command buffers, and waits. It will expose a read-only snapshot
method rather than duplicating viewport filtering in unrelated UI code.

The application combines that snapshot with the selected trace, selected
launch, exact launch aggregates, and evidence health. A pure export builder
produces the versioned structured payload. A second pure formatter produces the
Markdown prompt. DOM code handles only drawer state, preview, clipboard, and
download.

Central glossary data and pure export functions remain testable without a
browser.

## Accessibility and responsive behavior

- Tooltip triggers and drawer controls have visible focus states.
- Tooltips are associated with triggers through ARIA and never require hover.
- Pinned tooltip and drawer content can be dismissed with Escape.
- Drawer focus is contained while open and restored on close.
- Status feedback uses a polite live region.
- Touch targets remain at least 44 CSS pixels.
- Mobile sheets do not create horizontal document scrolling.
- Motion is limited to a short drawer transition and is removed under
  `prefers-reduced-motion`.
- Evidence classifications use text labels in addition to color.

## Testing strategy

Follow red-green-refactor with the smallest targeted Node test files:

- glossary completeness and definition shape;
- accessible tooltip and Field manual shell contracts;
- drawer open, close, focus restoration, and glossary filtering;
- visible viewport snapshot boundaries;
- deterministic structured export shape;
- clipped versus original command-buffer endpoints;
- visible dispatch and wait inclusion;
- evidence warnings and schema limitations;
- Markdown prompt contents and fenced JSON validity;
- clipboard/download UI wiring through lightweight browser fakes;
- README documentation contract.

The full test suite runs only at the commit gate, consistent with the project
testing policy.

## Failure-mode review

1. **The export could imply dispatch timestamps are measured.** This would
   materially mislead optimization work. Every dispatch position and relevant
   prompt instruction therefore carries ordered-placement provenance.
2. **Viewport clipping could understate work crossing an edge.** Original and
   clipped interval endpoints are both exported, with explicit names.
3. **Tooltips could make a dense viewer noisy or inaccessible.** Only
   specialized terms receive compact triggers; explanations are shared,
   keyboard-accessible, pinnable, and available in the searchable manual.
4. **Large visible ranges could create impractically large prompts.** The
   export contains aggregate dispatch-by-kernel data rather than every dispatch
   record. Command buffers and anchored waits remain enumerated because their
   timing relationships are the relevant optimization evidence.
5. **Users could assume AI data is uploaded.** The drawer and README state that
   export generation is local and no AI service is contacted.

## Acceptance criteria

- Specialized terms and measurements have consistent accessible definitions.
- The Field manual is usable without leaving or resetting the active trace.
- AI export represents the current viewport and preserves evidence boundaries.
- Markdown output can be pasted directly into an LLM.
- JSON output is versioned, deterministic apart from `generated_at`, and
  machine-readable.
- No network request is introduced for help or export.
- The visual treatment remains dense, technical, responsive, and subordinate
  to the data.
- README documents tooltips, Field manual, AI export, privacy, format, and
  evidence limitations.
