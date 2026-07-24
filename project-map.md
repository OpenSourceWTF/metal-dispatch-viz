# Project Map
_Generated: 2026-07-24 | Baseline Git: 1e747a7_

## Directory Structure
`public/` — Browser workbench, timeline renderer, glossary, export logic, and visual system.
`server/` — Express application and recursive trace-registry implementation.
`test/` — Node test coverage for browser contracts, data analysis, server behavior, and trace loading.
`traces/showcase/` — Default curated profiler traces and display manifest.
`fixtures/` — Small deterministic profiler input used by tests.
`scripts/` — Offline trace-curation utility.
`.github/ISSUE_TEMPLATE/` — Structured community run intake.
`docs/specs/` — Approved feature and interaction designs.
`docs/plans/` — Executable implementation plans.
`docs/submitting-traces.md` — Capture, evidence, naming, privacy, curation, and submission contract.

## Key Files
`public/index.html` — Semantic workbench shell and stable element IDs consumed by the browser controller.
`public/app.js` — Main UI controller for registry selection, trace loading, rendering, help, export, and URL state.
`public/timeline.js` — Canvas timeline renderer, indexed visible-range analysis, selection, pan, zoom, and keyboard interactions.
`public/styles.css` — Shared dark/light instrument design system and responsive layout rules.
`public/data.js` — Profiler record normalization and exact interval-derived analysis.
`public/client-dataset.js` — Bounds browser-facing event collections while retaining exact worker aggregates.
`public/dataset-worker.js` — Off-main-thread streaming parse and analysis boundary.
`public/trace-loader.js` — Worker lifecycle, fetch streaming, progress, and cancellation.
`public/glossary.js` — Central jargon definitions shared by tooltips and the Field manual.
`public/ai-export.js` — Deterministic visible-timeline Markdown and JSON export contract.
`public/run-identity.js` — Model-first trace naming and safe Hugging Face repository URL contract.
`server/trace-registry.mjs` — Safe recursive trace discovery, manifest enrichment, and opaque IDs.
`server/app.mjs` — Read-only HTTP routes for registry metadata and trace streaming.
`scripts/validate_run_name.mjs` — CLI validator for new public run filenames.
`test/ui-contract.test.mjs` — DOM, accessibility, responsive CSS, help, and export interaction contracts.
`test/timeline.test.mjs` — Timeline geometry, performance, rendering, selection, and input behavior.
`test/app-integration.test.mjs` — Registry races, trace-selection rendering, worker boundaries, and UI integration.
`schema.md` — Evidence fields, arithmetic definitions, provenance, and explicit non-claims.
`CONTRIBUTING.md` — Code and trace contribution entry point and repository gates.

## Critical Constraints
- The server is local and read-only; trace data is never uploaded or silently replaced with samples.
- Trace selection uses opaque server IDs; URLs preserve `trace` and launch-window index without exposing filesystem paths.
- Headline metrics are exact worker aggregates even when browser timeline records are deterministically sampled.
- Dispatch timeline positions preserve order within host encode intervals and are not measured operation timestamps.
- AI export is generated locally from the visible viewport and must preserve provenance, sampling limits, and schema-v1 non-claims.
- New public trace names sort by Hugging Face repository, contributor, and UTC date; the five original published paths remain stable legacy names.
- Hugging Face links are derived only from validated repository IDs; manifest-provided arbitrary URLs are never rendered.
- New hosted traces require public model, immutable revision, contributor, hardware, command, hash, and redistribution evidence.
- Native `[hidden]` must remain `display: none !important` because utility drawer component styles otherwise override browser presentation.
- Iteration uses targeted tests; the full suite runs only at the commit gate.
- Feature worktrees live under the organization-level `.worktree/` directory.

## Hot Files
`public/app.js`, `public/timeline.js`, `public/styles.css`, `public/run-identity.js`, `traces/showcase/traces.json`, `test/ui-contract.test.mjs`, `test/timeline.test.mjs`, `test/app-integration.test.mjs`
