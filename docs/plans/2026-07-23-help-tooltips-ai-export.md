# Help, Tooltips, and AI Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-optimized:subagent-driven-development (recommended) or superpowers-optimized:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add accessible terminology help, an embedded Field manual, and a local visible-timeline export for LLM optimization analysis.

**Architecture:** A new glossary module owns definitions shared by tooltip and manual rendering. A new pure export module builds a versioned payload and Markdown prompt from an immutable viewport snapshot exposed by `TimelineRenderer`. `app.js` coordinates two utility drawers, while existing HTML and CSS supply the accessible shell and technical visual treatment.

**Tech Stack:** Browser-native ES modules, Canvas 2D, HTML, CSS, Node.js built-in test runner.

**Assumptions:**

- The normalized selected launch remains available in `app.js` — this will not work from raw JSONL records before worker normalization.
- “Visible timeline” means the renderer viewport, including intersecting command buffers, viewport-anchored waits, and ordered dispatch placements — it does not mean every record in the selected launch.
- Export remains local browser functionality — this excludes calling or configuring an LLM provider.

---

## File structure

- Create `public/glossary.js` for immutable definitions and lookup/filter helpers.
- Create `public/ai-export.js` for visible-range payload and Markdown formatting.
- Modify `public/timeline.js` to expose a read-only viewport evidence snapshot.
- Modify `public/index.html` for Help, Export, tooltip, and drawer landmarks.
- Modify `public/app.js` for rendering and interaction coordination.
- Modify `public/styles.css` for the restrained instrument UI.
- Create `test/glossary.test.mjs` and `test/ai-export.test.mjs`.
- Extend `test/timeline.test.mjs` and `test/ui-contract.test.mjs`.
- Modify `README.md` with usage and evidence boundaries.

### Task 1: Shared terminology model

**Files:**
- Create: `public/glossary.js`
- Create: `test/glossary.test.mjs`

**Security flag:** none

- [x] **Step 1: Write failing glossary tests**

Test that every required term has a non-empty `label` and `definition`, that
measurement entries include `method` and `provenance`, that returned entries
are immutable, and that case-insensitive search matches labels and definitions.

```js
import assert from "node:assert/strict";
import test from "node:test";
import { GLOSSARY, glossaryEntry, searchGlossary } from "../public/glossary.js";

test("required profiler terminology has complete immutable definitions", () => {
  for (const id of ["wall-span", "gpu-busy", "ordered-placement", "command-buffer"]) {
    const entry = glossaryEntry(id);
    assert.ok(entry.label);
    assert.ok(entry.definition);
    assert.equal(Object.isFrozen(entry), true);
  }
  assert.equal(GLOSSARY["wall-span"].provenance, "measured");
  assert.ok(GLOSSARY["wall-span"].method);
});

test("glossary search is case-insensitive across useful copy", () => {
  assert.ok(searchGlossary("GPU").some((entry) => entry.id === "gpu-busy"));
  assert.ok(searchGlossary("outside gpu").some((entry) => entry.id === "exposed-host"));
});
```

- [x] **Step 2: Run the test and verify RED**

Run: `node --test test/glossary.test.mjs`

Expected: FAIL because `public/glossary.js` does not exist.

- [x] **Step 3: Implement the immutable glossary**

Export `GLOSSARY`, `glossaryEntry(id)`, and `searchGlossary(query)`. Cover every
term listed in the design specification. Freeze individual entries, the
top-level record, and search results. Use plain-language definitions plus
`method`, `provenance`, and `limitation` where applicable.

- [x] **Step 4: Verify GREEN**

Run: `node --test test/glossary.test.mjs`

Expected: PASS.

### Task 2: Visible timeline evidence and export contract

**Files:**
- Create: `public/ai-export.js`
- Create: `test/ai-export.test.mjs`
- Modify: `public/timeline.js`
- Modify: `test/timeline.test.mjs`

**Security flag:** none

**Does NOT cover:** Unanchored waits and unplaced dispatches are disclosed in
counts but are not assigned to the visible viewport.

- [x] **Step 1: Write failing snapshot and export tests**

Add a renderer test asserting `visibleEvidenceSnapshot()` returns copied
viewport bounds, intersecting command buffers, visible placed dispatches,
in-range waits, and unplaced/unanchored disclosure counts. Add pure export tests
for the schema name, original and clipped command-buffer endpoints, ordered
dispatch provenance, evidence limitations, deterministic payload values, and a
Markdown prompt containing one parseable fenced JSON block.

```js
const payload = buildVisibleTimelineExport({
  generatedAt: "2026-07-23T12:00:00.000Z",
  trace: { id: "opaque", label: "Decode" },
  launchIndex: 0,
  launch: fixtureLaunch,
  snapshot: fixtureSnapshot,
  evidenceHealth: { validEvidence: true },
});
assert.equal(payload.export_schema, "metal-dispatch-visible-timeline/v1");
assert.deepEqual(payload.selection.viewport_ns, { start: 100, end: 200, duration: 100 });
assert.deepEqual(payload.command_buffers[0].visible_gpu_ns, { start: 100, end: 180 });
assert.equal(payload.dispatch_summary.position_provenance, "ordered");
assert.deepEqual(JSON.parse(formatAiPrompt(payload).match(/```json\n([\\s\\S]+)\n```/)[1]), payload);
```

- [x] **Step 2: Run tests and verify RED**

Run: `node --test test/timeline.test.mjs test/ai-export.test.mjs`

Expected: FAIL because the snapshot method and export module do not exist.

- [x] **Step 3: Implement the snapshot and pure exporters**

Add `TimelineRenderer.visibleEvidenceSnapshot()` returning frozen copied arrays
and bounds. In `ai-export.js`, export:

```js
export function buildVisibleTimelineExport(input) {}
export function formatAiPrompt(payload) {}
export function exportFilename(trace, launchIndex, extension) {}
```

Keep selected-launch headline measurements labeled `scope:
"selected-launch"`. Clip intersecting host/GPU intervals without discarding
original endpoints. Aggregate visible placed dispatches by kernel. Preserve
wait anchor provenance and all schema-v1 limitations from the design.

- [x] **Step 4: Verify GREEN**

Run: `node --test test/timeline.test.mjs test/ai-export.test.mjs`

Expected: PASS.

### Task 3: Accessible tooltip and Field manual UI

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Modify: `test/ui-contract.test.mjs`

**Security flag:** none

**Does NOT cover:** Ordinary controls and plain-language labels do not receive
tooltip triggers.

- [x] **Step 1: Write failing UI contract tests**

Require `field-manual-button`, one `utility-backdrop`, `field-manual-drawer`,
`manual-search`, `manual-content`, `definition-tooltip`, Close controls, dialog
semantics, accessible names, Help placement in header actions, and CSS rules for
focus, desktop drawer, mobile sheet, and reduced motion. Test exported DOM
helpers with lightweight fakes for glossary filtering, Escape close, and focus
restoration.

- [x] **Step 2: Run tests and verify RED**

Run: `node --test test/ui-contract.test.mjs`

Expected: FAIL because the Help UI and definitions are absent.

- [x] **Step 3: Implement the Field manual and definitions**

Add compact `ⓘ` buttons next to specialized static and dynamically rendered
labels using `data-term`. Render Quick start, timeline guidance,
measurements, searchable glossary, evidence limits, and shortcuts from the
shared glossary. Implement hover/focus tooltip presentation and click/touch
pinning. Opening the manual with a term selects and focuses the matching entry.
Escape closes pinned help or the drawer and restores focus.

- [x] **Step 4: Apply the restrained technical styling**

Use sharp compact surfaces, existing signal colors, mono evidence tags, 44px
interactive targets, a right-side desktop drawer, a full-height mobile sheet,
and no decorative animation. Add only a short drawer transition and disable it
under `prefers-reduced-motion`.

- [x] **Step 5: Verify GREEN**

Run: `node --test test/ui-contract.test.mjs test/glossary.test.mjs`

Expected: PASS.

### Task 4: AI export drawer and local actions

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Modify: `test/ui-contract.test.mjs`

**Security flag:** security

**Does NOT cover:** The actions copy or download generated text only; they do
not upload data, call a model, accept executable prompt templates, or expose
unlisted filesystem paths.

- [x] **Step 1: Write failing interaction tests**

Require `ai-export-button`, `ai-export-drawer`, format control, scope readout,
local-only notice, read-only preview, `copy-export`, `download-export`, and
polite status output. Test that opening reads a fresh renderer snapshot, format
changes regenerate preview, clipboard copy requires a click, download revokes
its object URL, and unavailable clipboard writes produce actionable status.

- [x] **Step 2: Run tests and verify RED**

Run: `node --test test/ui-contract.test.mjs test/ai-export.test.mjs`

Expected: FAIL because AI export controls are absent.

- [x] **Step 3: Implement export coordination**

Wire `Export for AI` to build from the current selected trace, selected launch,
evidence health, and `visibleEvidenceSnapshot()`. Default to Markdown; allow
JSON. Generate a new timestamp only when opening or refreshing the export.
Implement explicit clipboard and Blob download actions with success/error live
status. Disable export until a usable selected launch exists.

- [x] **Step 4: Verify GREEN**

Run: `node --test test/ui-contract.test.mjs test/ai-export.test.mjs test/timeline.test.mjs`

Expected: PASS.

### Task 5: Documentation, integration verification, and publication

**Files:**
- Modify: `README.md`
- Modify: `test/package-contract.test.mjs`
- Verify: all changed files

**Security flag:** none

- [x] **Step 1: Write a failing README contract test**

Assert that README documents Field manual, contextual definitions, visible
timeline scope, Prompt + data, structured JSON, local-only behavior, clipping,
ordered placement, and schema-v1 limitations.

- [x] **Step 2: Run the test and verify RED**

Run: `node --test test/package-contract.test.mjs`

Expected: FAIL because README lacks the new guidance.

- [x] **Step 3: Update README**

Add concise sections for contextual Help, the embedded manual, exporting the
visible range, output formats, local privacy, pasted-prompt workflow, and
evidence cautions. Keep existing controls and evidence-boundary documentation
consistent with the new text.

- [x] **Step 4: Run targeted integration tests**

Run: `node --test test/glossary.test.mjs test/ai-export.test.mjs test/timeline.test.mjs test/ui-contract.test.mjs test/package-contract.test.mjs`

Expected: PASS.

- [x] **Step 5: Run commit-gate verification**

Run: `npm test`

Expected: all tests PASS with zero failures.

- [x] **Step 6: Run static completion checks**

Run: `git diff --check && rg -n "TODO|FIXME|NotImplementedError" public test README.md || true`

Expected: no whitespace errors and no implementation stubs in changed
production files.

- [x] **Step 7: Review, commit, push, and create the requested PR**

Inspect `git status -sb`, `git diff`, and repository remote/default branch.
Create `agent/help-ai-export` when currently on the default branch. Stage only
the spec, plan, source, tests, and README from this feature. Commit with
`Add profiler help and AI timeline export`, push with upstream tracking, and
open a draft PR containing What changed, Why, How to verify, and Notable
decisions.
