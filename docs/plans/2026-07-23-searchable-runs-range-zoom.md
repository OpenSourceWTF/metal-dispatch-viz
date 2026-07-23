# Searchable Runs and Range Zoom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-optimized:executing-plans to implement this plan task-by-task.

**Goal:** Replace the horizontal run rail with a searchable combobox and make timeline range dragging zoom into the selected span.

**Architecture:** Pure trace filtering and a small combobox controller stay in `app.js`, reusing the existing trace-selection coordinator. Timeline pointer state gains explicit range and pan modes while continuing to update the renderer's single viewport. Existing HTML/CSS, help, and README contracts document the controls.

**Tech Stack:** Browser JavaScript modules, semantic HTML, CSS, Canvas 2D, Node test runner.

**Assumptions:** Registry metadata is available before trace contents — search will not inspect event contents. Primary drag can replace pan — Shift-drag preserves panning.

---

### Task 1: Searchable run combobox

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Test: `test/app-integration.test.mjs`
- Test: `test/ui-contract.test.mjs`

**Security flag:** none

**Does NOT cover:** Search inside trace event contents or automatic loading while typing.

- [ ] Write failing tests asserting normalized multi-field filtering, explicit selection, empty results, keyboard behavior, accessible combobox/listbox markup, and bounded responsive styling.
- [ ] Run `node --test test/app-integration.test.mjs test/ui-contract.test.mjs` and confirm the missing combobox/filter behavior fails.
- [ ] Replace the trace rail with a labeled input/listbox and selected-run summary; implement local filtering and explicit selection through the existing `selectTrace`.
- [ ] Run `node --test test/app-integration.test.mjs test/ui-contract.test.mjs` and confirm it passes.

### Task 2: Drag-selected timeline zoom

**Files:**
- Modify: `public/timeline.js`
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Test: `test/timeline.test.mjs`
- Test: `test/ui-contract.test.mjs`

**Security flag:** none

**Does NOT cover:** Vertical zoom or a second application-level viewport.

- [ ] Write failing tests asserting primary drag zoom, reversed/clamped ranges, tiny-drag clicks, Shift-drag pan, cancellation, overlay rendering, and viewport notification.
- [ ] Run `node --test test/timeline.test.mjs test/ui-contract.test.mjs` and confirm the old pan-only behavior fails.
- [ ] Add explicit range/pan drag modes, range overlay drawing, completion zoom, and cancellation while preserving existing click, wheel, keyboard, and Fit paths.
- [ ] Run `node --test test/timeline.test.mjs test/ui-contract.test.mjs` and confirm it passes.

### Task 3: Documentation and release

**Files:**
- Modify: `README.md`
- Modify: `public/index.html`
- Test: `test/package-contract.test.mjs`

**Security flag:** none

- [ ] Write a failing documentation contract for searchable runs and `Drag to zoom · Shift-drag to pan`.
- [ ] Update README and embedded Field manual instructions.
- [ ] Run `node --test test/package-contract.test.mjs test/ui-contract.test.mjs`.
- [ ] Run `npm test` and `git diff --check` once at the commit gate.
- [ ] Commit, push, open and merge the PR, then run the merged viewer locally.
